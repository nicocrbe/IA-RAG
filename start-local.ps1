$ErrorActionPreference = "Stop"

Set-Location -Path $PSScriptRoot

Write-Host ""
Write-Host "RAG Nexus local startup" -ForegroundColor Cyan
Write-Host "-----------------------" -ForegroundColor DarkCyan

function Get-OllamaCommand {
    $cmd = Get-Command ollama -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }

    $defaultPath = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
    if (Test-Path $defaultPath) {
        return $defaultPath
    }

    return $null
}

function Wait-HttpOk {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Url,

        [int] $TimeoutSeconds = 60
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            Invoke-RestMethod -Uri $Url -TimeoutSec 5 | Out-Null
            return $true
        } catch {
            Start-Sleep -Seconds 2
        }
    }

    return $false
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker no esta instalado o no esta disponible en PATH. Instala Docker Desktop manualmente y volve a ejecutar este script."
}

try {
    docker compose version | Out-Null
} catch {
    throw "Docker Compose no esta disponible. Instala/actualiza Docker Desktop y volve a ejecutar este script."
}

$ollamaCommand = Get-OllamaCommand
if (-not $ollamaCommand) {
    Write-Host "Ollama no esta instalado. Intentando instalarlo con winget..." -ForegroundColor Cyan

    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "No se encontro winget. Instala Ollama manualmente desde https://ollama.com/download/windows y volve a ejecutar este script."
    }

    winget install --id Ollama.Ollama --exact --accept-package-agreements --accept-source-agreements
    $ollamaCommand = Get-OllamaCommand

    if (-not $ollamaCommand) {
        throw "Ollama se instalo, pero no quedo disponible en PATH. Cerra y abri la terminal, o instala Ollama manualmente."
    }
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
    Start-Process -FilePath $ollamaCommand -ArgumentList "serve" -WindowStyle Hidden
}

if (-not (Wait-HttpOk -Url "http://127.0.0.1:11434/api/tags" -TimeoutSeconds 90)) {
    throw "Ollama no respondio en http://127.0.0.1:11434. Revisa la instalacion de Ollama y volve a ejecutar este script."
}

Write-Host "Verificando modelos locales de Ollama..." -ForegroundColor Cyan
& $ollamaCommand pull embeddinggemma
& $ollamaCommand pull gemma3:4b

Write-Host "Levantando base de datos, APIs y frontend. Ollama queda en tu PC local." -ForegroundColor Cyan
docker compose up --build --remove-orphans

Write-Host ""
Write-Host "RAG Nexus esta disponible en http://127.0.0.1:3000" -ForegroundColor Green
