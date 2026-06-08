$ErrorActionPreference = "Stop"

Set-Location -Path $PSScriptRoot

Write-Host ""
Write-Host "RAG Nexus local shutdown" -ForegroundColor Cyan
Write-Host "------------------------" -ForegroundColor DarkCyan

if (Get-Command docker -ErrorAction SilentlyContinue) {
    try {
        docker compose down --remove-orphans
    } catch {
        Write-Host "No se pudo apagar Docker Compose: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

$ollamaProcesses = Get-Process -Name "ollama" -ErrorAction SilentlyContinue
if ($ollamaProcesses) {
    Write-Host "Cerrando Ollama local..." -ForegroundColor Cyan
    $ollamaProcesses | Stop-Process -Force
} else {
    Write-Host "Ollama local no estaba corriendo." -ForegroundColor DarkGray
}

Write-Host "Listo." -ForegroundColor Green
