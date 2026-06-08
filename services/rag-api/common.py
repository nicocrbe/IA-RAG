import hashlib
import os
import re
from typing import Iterable

import httpx
import psycopg
from psycopg.rows import dict_row

DB_DSN = os.getenv("DB_DSN", "postgresql://rag:rag@postgres:5432/rag")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://ollama:11434/api")
EMBED_MODEL = os.getenv("EMBED_MODEL", "embeddinggemma")
CHAT_MODEL = os.getenv("CHAT_MODEL", "qwen3:4b")

EMBED_BATCH_SIZE = int(os.getenv("EMBED_BATCH_SIZE", "8"))
MAX_EMBED_CHARS = int(os.getenv("MAX_EMBED_CHARS", "1800"))


def get_conn():
    return psycopg.connect(DB_DSN, row_factory=dict_row)


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def vector_to_sql(values: Iterable[float]) -> str:
    return "[" + ",".join(f"{float(v):.8f}" for v in values) + "]"


def sanitize_text(text: str) -> str:
    if text is None:
        return ""

    text = str(text)
    text = text.replace("\x00", " ")
    text = "".join(ch for ch in text if ch.isprintable() or ch in "\n\t ")
    text = re.sub(r"\|[-: ]+\|", " ", text)   # limpia filas separadoras de tablas markdown
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = " ".join(text.split())
    return text.strip()


def smart_split_text(text: str, max_chars: int = MAX_EMBED_CHARS) -> list[str]:
    text = sanitize_text(text)
    if not text:
        return []

    if len(text) <= max_chars:
        return [text]

    parts = []
    remaining = text

    while len(remaining) > max_chars:
        candidate = remaining[:max_chars]

        # preferir corte por doble salto, luego punto, luego espacio
        cut = candidate.rfind("\n\n")
        if cut < max_chars // 2:
            cut = candidate.rfind(". ")
        if cut < max_chars // 2:
            cut = candidate.rfind(" ")
        if cut < max_chars // 2:
            cut = max_chars

        piece = remaining[:cut].strip()
        if piece:
            parts.append(piece)

        remaining = remaining[cut:].strip()

    if remaining:
        parts.append(remaining)

    return parts


def batched(items: list, batch_size: int):
    for i in range(0, len(items), batch_size):
        yield items[i:i + batch_size]


async def _embed_payload(client: httpx.AsyncClient, payload: dict) -> httpx.Response:
    return await client.post(f"{OLLAMA_URL}/embed", json=payload)


async def embed_rows(rows: list[dict], batch_size: int = EMBED_BATCH_SIZE) -> list[dict]:
    prepared: list[dict] = []

    for row in rows:
        pieces = smart_split_text(row.get("chunk_text", ""))
        if not pieces:
            continue

        if len(pieces) == 1:
            prepared.append(
                {
                    **row,
                    "clean_text": pieces[0],
                }
            )
        else:
            # si un chunk original se divide, generamos subchunks lógicos
            for idx, piece in enumerate(pieces, start=1):
                prepared.append(
                    {
                        **row,
                        "chunk_no": int(row["chunk_no"]) * 1000 + idx,
                        "clean_text": piece,
                    }
                )

    if not prepared:
        raise ValueError("No hay textos válidos para vectorizar")

    embedded_rows: list[dict] = []

    async with httpx.AsyncClient(timeout=300) as client:
        for batch_idx, batch in enumerate(batched(prepared, batch_size), start=1):
            payload = {
                "model": EMBED_MODEL,
                "input": [item["clean_text"] for item in batch],
                "truncate": True,
                "keep_alive": "30m",
            }

            resp = await _embed_payload(client, payload)

            if resp.status_code < 400:
                data = resp.json()
                batch_embeddings = data["embeddings"]

                if len(batch_embeddings) != len(batch):
                    raise RuntimeError(
                        f"Cantidad de embeddings inconsistente en batch {batch_idx}: "
                        f"esperados={len(batch)} recibidos={len(batch_embeddings)}"
                    )

                for item, emb in zip(batch, batch_embeddings):
                    embedded_rows.append(
                        {
                            **item,
                            "embedding": emb,
                        }
                    )
                continue

            print(
                f"[ERROR] batch failed batch_idx={batch_idx} "
                f"status={resp.status_code} body={resp.text[:1500]}"
            )

            for item in batch:
                single_payload = {
                    "model": EMBED_MODEL,
                    "input": item["clean_text"],
                    "truncate": True,
                }

                single_resp = await _embed_payload(client, single_payload)

                if single_resp.status_code >= 400:
                    raise RuntimeError(
                        "Chunk inválido para embeddings. "
                        f"page={item.get('page_no')} "
                        f"chunk={item.get('chunk_no')} "
                        f"len={len(item['clean_text'])} "
                        f"status={single_resp.status_code} "
                        f"body={single_resp.text[:1500]} "
                        f"text={item['clean_text'][:500]!r}"
                    )

                data = single_resp.json()
                embeddings = data["embeddings"]

                if not embeddings or len(embeddings) != 1:
                    raise RuntimeError(
                        "Respuesta inesperada de Ollama al vectorizar chunk individual. "
                        f"page={item.get('page_no')} chunk={item.get('chunk_no')}"
                    )

                embedded_rows.append(
                    {
                        **item,
                        "embedding": embeddings[0],
                    }
                )

    return embedded_rows


async def chat(messages: list[dict]) -> str:
    async with httpx.AsyncClient(timeout=300) as client:
        resp = await client.post(
            f"{OLLAMA_URL}/chat",
            json={
                "model": CHAT_MODEL,
                "messages": messages,
                "stream": False,
                "keep_alive": "30m",
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data["message"]["content"].strip()

async def embed_query_text(question: str) -> list[float]:
    """
    Vectoriza una sola pregunta de usuario para retrieval.
    """
    clean_text = sanitize_text(question)

    if not clean_text:
        raise ValueError("La pregunta está vacía luego de sanitizar")

    clean_text = clean_text[:MAX_EMBED_CHARS]

    async with httpx.AsyncClient(timeout=300) as client:
        resp = await client.post(
            f"{OLLAMA_URL}/embed",
            json={
                "model": EMBED_MODEL,
                "input": clean_text,
                "truncate": True,
                "keep_alive": "30m",
            },
        )

        if resp.status_code >= 400:
            raise RuntimeError(
                f"Fallo Ollama embeddings para query. "
                f"status={resp.status_code} body={resp.text[:1500]}"
            )

        data = resp.json()
        embeddings = data.get("embeddings", [])

        if not embeddings or len(embeddings) != 1:
            raise RuntimeError(
                "Respuesta inesperada de Ollama al vectorizar la consulta"
            )

        return embeddings[0]