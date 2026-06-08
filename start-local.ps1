$ErrorActionPreference = "Stop"

Set-Location -Path $PSScriptRoot

Write-Host ""
Write-Host "RAG Nexus local startup" -ForegroundColor Cyan
Write-Host "-----------------------" -ForegroundColor DarkCyan

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker no esta instalado o no esta disponible en PATH."
}

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    throw "Ollama no esta instalado o no esta disponible en PATH."
}

try {
    docker info | Out-Null
} catch {
    throw "Docker no esta corriendo. Abri Docker Desktop y volve a ejecutar este script."
}

try {
    Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 5 | Out-Null
} catch {
    Write-Host "Iniciando Ollama local..." -ForegroundColor Cyan
    Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 3
}

Write-Host "Verificando modelos locales de Ollama..." -ForegroundColor Cyan
ollama pull embeddinggemma
ollama pull gemma3:4b

Write-Host "Levantando base de datos, APIs y frontend. Ollama queda en tu PC local." -ForegroundColor Cyan
docker compose up --build --remove-orphans
