# Start both halves of SuaraSah for local development / the demo.
#
#   .\dev.ps1            API on :8000, web on :3000, bound to the LAN
#   .\dev.ps1 -Lan:$false   bind to localhost only
#
# The phone browses to http://<this-machine-ip>:3000 and the web app finds the
# API automatically on port 8000 of the same host.
param(
    [switch]$Lan = $true,
    # Serve both halves over TLS. Required for microphone access from a
    # phone, because getUserMedia only runs in a secure context.
    [switch]$Https,
    [int]$ApiPort = 8000,
    [int]$WebPort = 3000
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$bind = if ($Lan) { "0.0.0.0" } else { "127.0.0.1" }
$scheme = if ($Https) { "https" } else { "http" }

if ($Https -and -not (Test-Path (Join-Path $root "certs\dev.crt"))) {
    Write-Host "No certificate yet. Run:  bash scripts/make-dev-cert.sh" -ForegroundColor Yellow
    exit 1
}

$python = Join-Path $root "api\.venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    Write-Host "Backend venv missing. Run this first:" -ForegroundColor Yellow
    Write-Host "  cd api; python -m venv .venv; .\.venv\Scripts\pip install -r requirements.txt"
    exit 1
}

Write-Host "API  -> ${scheme}://${bind}:$ApiPort" -ForegroundColor Cyan
$apiArgs = @("-m", "uvicorn", "app.main:app", "--host", $bind, "--port", "$ApiPort", "--reload")
if ($Https) {
    $apiArgs += @("--ssl-keyfile", "../certs/dev.key", "--ssl-certfile", "../certs/dev.crt")
}
Start-Process -FilePath $python -ArgumentList $apiArgs -WorkingDirectory (Join-Path $root "api")

Write-Host "Web  -> ${scheme}://${bind}:$WebPort" -ForegroundColor Cyan
$webScript = if ($Https) { "dev:https" } elseif ($Lan) { "dev:lan" } else { "dev" }
Start-Process -FilePath "npm" -ArgumentList @("run", $webScript) -WorkingDirectory (Join-Path $root "web")

if ($Lan) {
    $ips = Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" }
    Write-Host ""
    Write-Host "Open on your phone (same Wi-Fi):" -ForegroundColor Green
    foreach ($ip in $ips) { Write-Host "  ${scheme}://$($ip.IPAddress):$WebPort" }
    Write-Host ""
    if (-not $Https) {
        Write-Host "Microphone note: getUserMedia only runs in a secure context." -ForegroundColor Yellow
        Write-Host "A plain http:// LAN address is NOT secure, so Live Scan and recording" -ForegroundColor Yellow
        Write-Host "will not work on a phone. Re-run with -Https (see README)." -ForegroundColor Yellow
    } else {
        Write-Host "Accept the certificate on the phone at ${scheme}://<ip>:$ApiPort/health FIRST," -ForegroundColor Yellow
        Write-Host "then open the app - otherwise its API calls fail silently." -ForegroundColor Yellow
    }
}
