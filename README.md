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

- Windows 10/11.
- Docker Desktop instalado manualmente y corriendo.
- Conexion a internet la primera vez para descargar imagenes Docker y modelos de Ollama.

Docker Desktop debe instalarse manualmente porque requiere instalador propio, permisos del sistema, WSL2/virtualizacion y aceptar terminos de Docker Desktop.

Descarga Docker Desktop desde:

```text
https://www.docker.com/products/docker-desktop/
```

Luego abrilo y espera a que diga que Docker esta corriendo.

## Setup rapido en Windows

### 1. Clonar el repositorio

```cmd
git clone https://github.com/nicocrbe/IA-RAG.git
cd IA-RAG
```

### 2. Instalar y abrir Docker Desktop

Instala Docker Desktop manualmente desde:

```text
https://www.docker.com/products/docker-desktop/
```

Despues de instalarlo:

- Abrir Docker Desktop.
- Esperar a que el motor quede corriendo.
- Si Docker pide habilitar WSL2 o virtualizacion, aceptar y reiniciar si hace falta.

### 3. Ejecutar el setup/start

```cmd
start-local.cmd
```

Ese unico comando hace el setup operativo del proyecto:

- Detectar Ollama.
- Si no esta instalado, intentar instalarlo con `winget install --id Ollama.Ollama`.
- Iniciar Ollama local si no esta respondiendo.
- Descargar/verificar los modelos `embeddinggemma` y `gemma3:4b`.
- Construir y levantar los contenedores Docker.
- Publicar la app en `http://127.0.0.1:3000`.

La primera ejecucion puede tardar porque descarga imagenes Docker y modelos de IA.

Si la instalacion automatica falla, instala Ollama manualmente desde:

```text
https://ollama.com/download/windows
```

Luego cerra y abri la terminal para refrescar el PATH.

## Como levantar el proyecto

Despues del setup inicial, se usa el mismo comando para levantar todo:

```cmd
start-local.cmd
```

Esto:

- Verifica Docker.
- Verifica Docker Compose.
- Verifica Ollama local.
- Instala Ollama con `winget` si no lo encuentra y `winget` esta disponible.
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

## Instalacion automatica: que se puede y que no

El proyecto automatiza desde `start-local.cmd`:

- Instalacion de Ollama con `winget`, cuando `winget` esta disponible.
- Descarga de modelos `embeddinggemma` y `gemma3:4b`.
- Inicio de Ollama local.
- Build y arranque de contenedores Docker.

El proyecto no instala Docker Desktop automaticamente. Docker Desktop se debe instalar manualmente por el usuario por requerimientos de permisos, WSL2/virtualizacion y configuracion del sistema operativo.

## Troubleshooting

### Docker no esta corriendo

Abrir Docker Desktop y esperar a que termine de iniciar. Luego volver a correr:

```cmd
start-local.cmd
```

### Ollama no queda disponible despues de instalar

Cerrar y abrir la terminal para refrescar el PATH. Tambien se puede probar:

```cmd
ollama --version
```

### Puerto ocupado

Los servicios usan estos puertos locales:

- `3000`: frontend
- `8001`: ingest API
- `8002`: query API
- `5432`: PostgreSQL
- `11434`: Ollama local

Si alguno esta ocupado, hay que cerrar el proceso que lo usa o cambiar el puerto en `docker-compose.yml`.

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
