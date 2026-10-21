# Start both halves of SilentVoice for local development / the demo.
#
#   .\dev.ps1              API on :8000, web on :3000, bound strictly to 127.0.0.1 [SECURE DEFAULT]
#   .\dev.ps1 -Lan         bind to 0.0.0.0 (LAN) for phone testing/demos
#   .\dev.ps1 -Lan -Https  serve over TLS for microphone access on phone
#
# By default, servers bind strictly to localhost (127.0.0.1) to protect your machine
# on untrusted / campus / hackathon Wi-Fi networks.
param(
    # By default, bind strictly to localhost (127.0.0.1) for security.
    # Pass -Lan to bind to 0.0.0.0 for phone demos on the local network.
    [switch]$Lan = $false,
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
    $python = Join-Path $root "api\.venv\bin\python"
}
if (-not (Test-Path $python)) {
    Write-Host "Backend venv missing. Run this first:" -ForegroundColor Yellow
    Write-Host "  cd api; python -m venv .venv; .\.venv\Scripts\pip install -r requirements.txt"
    exit 1
}

if ($Lan) {
    Write-Host "=======================================================================" -ForegroundColor Yellow
    Write-Host "[!] LAN EXPOSURE WARNING: Servers bound to 0.0.0.0 (ports $ApiPort & $WebPort)" -ForegroundColor Yellow
    Write-Host "    Anyone on your Wi-Fi network (campus / hackathon) can access your API." -ForegroundColor Yellow
    Write-Host "    - Set Windows Network Profile to 'Public' to block incoming traffic." -ForegroundColor Yellow
    Write-Host "    - Stop servers immediately after your demo completes." -ForegroundColor Yellow
    Write-Host "=======================================================================" -ForegroundColor Yellow
} else {
    Write-Host "=======================================================================" -ForegroundColor Green
    Write-Host "[*] SECURE LOCALHOST MODE (Default)" -ForegroundColor Green
    Write-Host "    Servers bound strictly to 127.0.0.1 (ports $ApiPort & $WebPort)." -ForegroundColor Green
    Write-Host "    Other devices on this Wi-Fi network CANNOT connect." -ForegroundColor Green
    Write-Host "    To test on a phone on the same Wi-Fi, run: .\dev.ps1 -Lan" -ForegroundColor DarkGray
    Write-Host "=======================================================================" -ForegroundColor Green
}

Write-Host "API  -> ${scheme}://${bind}:$ApiPort" -ForegroundColor Cyan
$apiArgs = @("-m", "uvicorn", "app.main:app", "--host", $bind, "--port", "$ApiPort", "--reload")
if ($Https) {
    $apiArgs += @("--ssl-keyfile", "../certs/dev.key", "--ssl-certfile", "../certs/dev.crt")
}
$apiProc = Start-Process -FilePath $python -ArgumentList $apiArgs -WorkingDirectory (Join-Path $root "api") -PassThru

Write-Host "Web  -> ${scheme}://${bind}:$WebPort" -ForegroundColor Cyan
$webScript = if ($Https) { "dev:https" } elseif ($Lan) { "dev:lan" } else { "dev" }
$webProc = Start-Process -FilePath "npm" -ArgumentList @("run", $webScript) -WorkingDirectory (Join-Path $root "web") -PassThru

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

Write-Host ""
Write-Host "Development servers running. Press Ctrl+C to stop both servers..." -ForegroundColor Cyan

try {
    while (-not $apiProc.HasExited -and -not $webProc.HasExited) {
        Start-Sleep -Milliseconds 500
    }
}
finally {
    Write-Host "`nStopping development servers..." -ForegroundColor Yellow
    if ($apiProc -and -not $apiProc.HasExited) {
        Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
    }
    if ($webProc -and -not $webProc.HasExited) {
        Stop-Process -Id $webProc.Id -Force -ErrorAction SilentlyContinue
    }
    Write-Host "Servers stopped. Ports $ApiPort and $WebPort closed." -ForegroundColor Green
}
