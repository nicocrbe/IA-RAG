CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
    id           BIGSERIAL PRIMARY KEY,
    filename     TEXT NOT NULL,
    checksum     TEXT NOT NULL UNIQUE,
    page_count   INTEGER,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chunks (
    id           BIGSERIAL PRIMARY KEY,
    document_id  BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_no      INTEGER NOT NULL,
    chunk_no     INTEGER NOT NULL,
    chunk_text   TEXT NOT NULL,
    embedding    VECTOR NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(document_id, page_no, chunk_no)
);

CREATE INDEX IF NOT EXISTS idx_chunks_document_page
    ON chunks(document_id, page_no);

CREATE INDEX IF NOT EXISTS idx_documents_created_at
    ON documents(created_at DESC);