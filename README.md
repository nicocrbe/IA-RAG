# IA-RAG

Aplicacion local de RAG para cargar documentos PDF, indexarlos con embeddings y consultar su contenido usando modelos locales de Ollama.

## Que hace

- Carga PDFs desde una interfaz web.
- Extrae texto del PDF y lo divide en chunks.
- Genera embeddings con `embeddinggemma`.
- Guarda documentos, chunks y vectores en PostgreSQL con `pgvector`.
- Permite hacer preguntas sobre los documentos indexados usando `gemma3:4b`.
- Muestra fuentes por pagina/chunk.
- Renderiza respuestas en Markdown.
- Genera diagramas conceptuales Mermaid y permite abrirlos en draw.io.
- Usa Ollama local de la PC, fuera de Docker, para aprovechar mejor el hardware disponible.

## Stack

- Frontend: React + Vite + Mermaid + Nginx
- Backend: FastAPI
- Base de datos: PostgreSQL + pgvector
- IA local: Ollama
- Modelos:
  - Embeddings: `embeddinggemma`
  - Chat: `gemma3:4b`

## Requisitos

- Windows con Docker Desktop corriendo.
- Ollama instalado y disponible en PATH.
- Conexion a internet la primera vez para descargar imagenes Docker y modelos.

El script de inicio verifica y descarga los modelos necesarios:

```powershell
ollama pull embeddinggemma
ollama pull gemma3:4b
```

## Como levantar el proyecto

Desde la carpeta del proyecto:

```cmd
start-local.cmd
```

Esto:

- Verifica Docker.
- Verifica Ollama local.
- Inicia Ollama local si no esta respondiendo.
- Descarga/verifica los modelos.
- Levanta PostgreSQL, APIs y frontend con Docker Compose.

Luego abrir:

```text
http://127.0.0.1:3000
```

## Como apagar el proyecto

```cmd
stop-local.cmd
```

Esto baja Docker Compose y cierra procesos locales de Ollama.

## Servicios

| Servicio | URL |
| --- | --- |
| Frontend | `http://127.0.0.1:3000` |
| Ingest API | `http://127.0.0.1:8001` |
| Query API | `http://127.0.0.1:8002` |
| PostgreSQL | `127.0.0.1:5432` |
| Ollama local | `http://127.0.0.1:11434` |

## Endpoints principales

### Ingesta

```http
POST /ingest
```

Recibe un PDF por multipart form-data bajo el campo `file`.

### Consulta

```http
POST /ask
```

Payload:

```json
{
  "question": "Cuales son los puntos principales?",
  "document_id": 1,
  "top_k": 5
}
```

`document_id` es opcional. Si se omite, busca en todos los documentos.

### Listar documentos

```http
GET /documents
```

### Eliminar documento

```http
DELETE /documents/{document_id}
```

Elimina el documento y sus chunks asociados.

### Generar diagrama

```http
POST /diagram
```

Genera Mermaid a partir de la respuesta del modelo y sus fuentes.

## Que es Top K

`Top K` controla cuantos chunks semanticamente mas cercanos se recuperan desde la base vectorial para alimentar al modelo.

- Un valor bajo, como `3`, da menos contexto y puede ser mejor para preguntas puntuales.
- Un valor alto, como `10` o `15`, da mas contexto y puede ser mejor para preguntas amplias.
- Si se sube demasiado, puede entrar ruido y empeorar la respuesta.

## Estructura

```text
.
|-- db/
|   `-- init.sql
|-- frontend/
|   |-- src/
|   |-- Dockerfile
|   |-- nginx.conf
|   `-- package.json
|-- services/
|   `-- rag-api/
|       |-- common.py
|       |-- ingest_api.py
|       |-- query_api.py
|       `-- requirements.txt
|-- docker-compose.yml
|-- start-local.cmd
|-- start-local.ps1
|-- stop-local.cmd
`-- stop-local.ps1
```

## Notas

- Los datos persistentes de PostgreSQL se guardan en el volumen Docker `pgdata`.
- Los modelos de Ollama se guardan en la instalacion local de Ollama, no dentro del proyecto.
- No se suben PDFs ni datos temporales al repositorio.
