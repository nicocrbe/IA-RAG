import os
import re
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from common import chat, embed_query_text, get_conn, vector_to_sql

app = FastAPI(title="RAG Query API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_CONTEXT_CHARS = int(os.getenv("MAX_CONTEXT_CHARS", "8000"))


class AskRequest(BaseModel):
    question: str = Field(..., min_length=3)
    document_id: Optional[int] = None
    top_k: int = Field(default=5, ge=1, le=20)


class DiagramRequest(BaseModel):
    question: str = Field(..., min_length=3)
    answer: str = Field(..., min_length=3)
    sources: list[dict] = Field(default_factory=list)


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/documents")
def list_documents():
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    d.id,
                    d.filename,
                    d.page_count,
                    d.created_at,
                    COUNT(c.id)::int AS chunk_count
                FROM documents d
                LEFT JOIN chunks c ON c.document_id = d.id
                GROUP BY d.id
                ORDER BY d.created_at DESC
                """
            )
            rows = cur.fetchall()
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Fallo listando documentos: {str(e)}"
        ) from e

    return {
        "documents": [
            {
                **row,
                "created_at": row["created_at"].isoformat(),
            }
            for row in rows
        ]
    }


@app.delete("/documents/{document_id}")
def delete_document(document_id: int):
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                "DELETE FROM documents WHERE id = %s RETURNING id, filename",
                (document_id,),
            )
            deleted = cur.fetchone()
            conn.commit()
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Fallo eliminando documento: {str(e)}"
        ) from e

    if not deleted:
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    return {
        "status": "deleted",
        "document_id": deleted["id"],
        "filename": deleted["filename"],
    }


def build_context(hits: list[dict], max_context_chars: int = MAX_CONTEXT_CHARS) -> tuple[str, list[dict]]:
    context_blocks: list[str] = []
    sources: list[dict] = []
    current_size = 0

    for h in hits:
        block = (
            f"[Documento: {h['filename']} | Página: {h['page_no']} | Chunk: {h['chunk_no']}]\n"
            f"{h['chunk_text']}"
        )

        block_size = len(block)
        if context_blocks and current_size + block_size > max_context_chars:
            break

        context_blocks.append(block)
        current_size += block_size

        sources.append(
            {
                "document_id": h["document_id"],
                "filename": h["filename"],
                "page_no": h["page_no"],
                "chunk_no": h["chunk_no"],
                "distance": float(h["cosine_distance"]),
            }
        )

    return "\n\n---\n\n".join(context_blocks), sources


def clean_mermaid(raw: str) -> str:
    text = raw.strip()
    fenced = re.search(r"```(?:mermaid)?\s*(.*?)```", text, re.DOTALL | re.IGNORECASE)
    if fenced:
        text = fenced.group(1).strip()

    lines = [line.rstrip() for line in text.splitlines() if line.strip()]
    if not lines:
        raise ValueError("El modelo no devolvió un diagrama Mermaid")

    first = lines[0].strip().lower()
    if not first.startswith(("flowchart", "graph")):
        lines.insert(0, "flowchart TD")

    return "\n".join(lines)


@app.post("/ask")
async def ask(req: AskRequest):
    try:
        query_embedding = await embed_query_text(req.question)
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Fallo embeddings de consulta: {str(e)}"
        ) from e

    query_vector = vector_to_sql(query_embedding)

    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    c.id,
                    c.document_id,
                    d.filename,
                    c.page_no,
                    c.chunk_no,
                    c.chunk_text,
                    c.embedding <=> %s::vector AS cosine_distance
                FROM chunks c
                JOIN documents d ON d.id = c.document_id
                WHERE (%s::bigint IS NULL OR c.document_id = %s::bigint)
                ORDER BY c.embedding <=> %s::vector
                LIMIT %s
                """,
                (
                    query_vector,
                    req.document_id,
                    req.document_id,
                    query_vector,
                    req.top_k,
                ),
            )
            hits = cur.fetchall()
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Fallo consulta vectorial en Postgres: {str(e)}"
        ) from e

    if not hits:
        return {
            "question": req.question,
            "answer": "No encontré contexto relevante en los documentos indexados.",
            "sources": [],
        }

    context, sources = build_context(hits)

    if not context.strip():
        return {
            "question": req.question,
            "answer": "Recuperé resultados, pero no pude construir contexto útil para responder.",
            "sources": sources,
        }

    system_prompt = (
        "Sos un asistente RAG. "
        "Respondé únicamente usando el contexto recuperado. "
        "Si la respuesta no está en el contexto, decí explícitamente que no está en el documento. "
        "No inventes información. "
        "Cerrá la respuesta con una sección breve llamada 'Fuentes' indicando páginas con formato [p.X]."
    )

    user_prompt = f"""
Pregunta:
{req.question}

Contexto recuperado:
{context}
""".strip()

    try:
        answer = await chat(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]
        )
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Fallo generación con Ollama chat: {str(e)}"
        ) from e

    return {
        "question": req.question,
        "answer": answer,
        "sources": sources,
    }


@app.post("/diagram")
async def diagram(req: DiagramRequest):
    source_hint = "\n".join(
        f"- {src.get('filename', 'documento')} p.{src.get('page_no', '?')} chunk {src.get('chunk_no', '?')}"
        for src in req.sources[:8]
    )

    system_prompt = (
        "Sos un diseñador de diagramas conceptuales. "
        "Generá únicamente código Mermaid válido para un flowchart TD. "
        "No uses markdown, comentarios ni texto fuera del diagrama. "
        "Usá nodos breves, conexiones claras y etiquetas en español. "
        "El diagrama debe explicar la respuesta y sus relaciones principales."
    )
    user_prompt = f"""
Pregunta:
{req.question}

Respuesta:
{req.answer}

Fuentes disponibles:
{source_hint or "Sin fuentes declaradas"}
""".strip()

    try:
        raw = await chat(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]
        )
        mermaid = clean_mermaid(raw)
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Fallo generando diagrama conceptual: {str(e)}"
        ) from e

    return {
        "question": req.question,
        "mermaid": mermaid,
    }
