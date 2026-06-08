import os
import re
import tempfile
from pathlib import Path

import pymupdf4llm
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from common import embed_rows, get_conn, sha256_file, vector_to_sql

app = FastAPI(title="RAG Ingest API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "800"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "120"))
DEBUG_CHUNKS_FILE = os.getenv("DEBUG_CHUNKS_FILE", "/app/data/debug_chunks.txt")


def chunk_text(text: str, chunk_size: int = 800, overlap: int = 120) -> list[str]:
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if not text:
        return []

    chunks: list[str] = []
    start = 0
    length = len(text)

    while start < length:
        end = min(start + chunk_size, length)
        candidate = text[start:end]

        if end < length:
            cut = candidate.rfind("\n\n")
            if cut > chunk_size // 2:
                end = start + cut
                candidate = text[start:end]
            else:
                dot_cut = candidate.rfind(". ")
                if dot_cut > chunk_size // 2:
                    end = start + dot_cut + 1
                    candidate = text[start:end]

        candidate = candidate.strip()
        if candidate:
            chunks.append(candidate)

        if end >= length:
            break

        start = max(0, end - overlap)

    return chunks


def extract_pages_markdown(pdf_path: str) -> list[dict]:
    pages = pymupdf4llm.to_markdown(pdf_path, page_chunks=True)

    normalized: list[dict] = []

    if isinstance(pages, list):
        for idx, page in enumerate(pages, start=1):
            if isinstance(page, dict):
                text = page.get("text") or page.get("md") or page.get("markdown") or ""
                page_no = page.get("page") or page.get("page_number") or idx
            else:
                text = str(page)
                page_no = idx

            normalized.append(
                {
                    "page_no": int(page_no),
                    "text": str(text).strip(),
                }
            )
        return normalized

    return [{"page_no": 1, "text": str(pages).strip()}]


def write_debug_chunks(rows: list[dict]) -> None:
    try:
        Path(DEBUG_CHUNKS_FILE).parent.mkdir(parents=True, exist_ok=True)
        with open(DEBUG_CHUNKS_FILE, "w", encoding="utf-8") as f:
            for row in rows:
                f.write(
                    f"\n--- PAGE {row['page_no']} CHUNK {row['chunk_no']} "
                    f"LEN {len(row['chunk_text'])} ---\n"
                )
                f.write(row["chunk_text"])
                f.write("\n")
    except Exception as e:
        print(f"[WARN] No se pudo escribir debug_chunks.txt: {e}")


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/ingest")
async def ingest_pdf(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Solo se aceptan PDFs")

    tmp_path = None

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            tmp.write(await file.read())
            tmp_path = tmp.name

        checksum = sha256_file(tmp_path)
        pages = extract_pages_markdown(tmp_path)

        if not pages:
            raise HTTPException(status_code=400, detail="No se pudo extraer contenido del PDF")

        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT id FROM documents WHERE checksum = %s", (checksum,))
            existing = cur.fetchone()
            if existing:
                return {
                    "document_id": existing["id"],
                    "status": "already_ingested",
                    "pages": len(pages),
                }

            cur.execute(
                """
                INSERT INTO documents(filename, checksum, page_count)
                VALUES (%s, %s, %s)
                RETURNING id
                """,
                (file.filename, checksum, len(pages)),
            )
            document_id = cur.fetchone()["id"]

            valid_rows: list[dict] = []

            for page in pages:
                page_no = page["page_no"]
                page_chunks = chunk_text(page["text"], CHUNK_SIZE, CHUNK_OVERLAP)

                for chunk_no, chunk in enumerate(page_chunks, start=1):
                    chunk = chunk.strip()
                    if not chunk:
                        continue

                    valid_rows.append(
                        {
                            "document_id": document_id,
                            "page_no": page_no,
                            "chunk_no": chunk_no,
                            "chunk_text": chunk,
                        }
                    )

            if not valid_rows:
                raise HTTPException(status_code=400, detail="No se generaron chunks útiles")

            write_debug_chunks(valid_rows)

            try:
                embedded_rows = await embed_rows(valid_rows)
            except Exception as e:
                conn.rollback()
                raise HTTPException(
                    status_code=502,
                    detail=f"Fallo Ollama embeddings: {str(e)}"
                ) from e

            insert_values = []
            for row in embedded_rows:
                insert_values.append(
                    (
                        row["document_id"],
                        row["page_no"],
                        row["chunk_no"],
                        row["clean_text"],
                        vector_to_sql(row["embedding"]),
                    )
                )

            cur.executemany(
                """
                INSERT INTO chunks(document_id, page_no, chunk_no, chunk_text, embedding)
                VALUES (%s, %s, %s, %s, %s::vector)
                """,
                insert_values,
            )

            conn.commit()

        return {
            "document_id": document_id,
            "status": "ingested",
            "pages": len(pages),
            "chunks": len(embedded_rows),
        }

    finally:
        if tmp_path:
            Path(tmp_path).unlink(missing_ok=True)
