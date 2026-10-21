#!/usr/bin/env bash
# Start both halves of SilentVoice (macOS / Linux / Git Bash).
#
#   ./dev.sh              API on :8000, web on :3000, bound strictly to 127.0.0.1 [SECURE DEFAULT]
#   ./dev.sh --lan        bind to 0.0.0.0 (LAN) for phone testing/demos
#   ./dev.sh --lan --https serve over TLS for microphone access on phone
#
# By default, servers bind strictly to localhost (127.0.0.1) to protect your machine
# on untrusted / campus / hackathon Wi-Fi networks.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

python_bin="$root/api/.venv/bin/python"
[ -x "$python_bin" ] || python_bin="$root/api/.venv/Scripts/python.exe"
if [ ! -x "$python_bin" ]; then
  echo "Backend venv missing. Run: cd api && python -m venv .venv && .venv/bin/pip install -r requirements.txt"
  exit 1
fi

LAN=false
HTTPS=false
API_PORT=8000
WEB_PORT=3000

for arg in "$@"; do
  case "$arg" in
    --lan|-lan|-l)
      LAN=true
      ;;
    --no-lan|-no-lan)
      LAN=false
      ;;
    --https|-https)
      HTTPS=true
      ;;
    -h|--help)
      echo "Usage: ./dev.sh [OPTIONS]"
      echo "Options:"
      echo "  --lan, -l       Bind to 0.0.0.0 for mobile phone testing on local Wi-Fi"
      echo "  --no-lan        Bind strictly to 127.0.0.1 (default, secure)"
      echo "  --https         Serve both API and Web over HTTPS (required for phone mic)"
      echo "  -h, --help      Show this help message"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg"
      echo "Use ./dev.sh --help for usage."
      exit 1
      ;;
  esac
done

cleanup() {
  echo
  echo "Stopping development servers..."
  kill 0 2>/dev/null || true
  wait 2>/dev/null || true
  echo "Servers stopped. Ports $API_PORT and $WEB_PORT closed."
}
trap cleanup EXIT INT TERM

if [ "$LAN" = true ]; then
  BIND="0.0.0.0"
  WEB_SCRIPT="dev:lan"
  echo "======================================================================="
  echo "⚠️  LAN EXPOSURE WARNING: Servers bound to 0.0.0.0 (ports $API_PORT & $WEB_PORT)"
  echo "   Anyone on your Wi-Fi (campus/hackathon) can access your API & frontend."
  echo "   - Make sure your OS firewall is set to 'Public' to block incoming traffic."
  echo "   - Press Ctrl+C to terminate servers immediately after your demo."
  echo "======================================================================="
else
  BIND="127.0.0.1"
  WEB_SCRIPT="dev"
  echo "======================================================================="
  echo "🔒 SECURE LOCALHOST MODE (Default)"
  echo "   Servers bound strictly to 127.0.0.1 (ports $API_PORT & $WEB_PORT)."
  echo "   Other devices on this Wi-Fi network CANNOT connect."
  echo "   To test on a phone on the same Wi-Fi, run: ./dev.sh --lan"
  echo "======================================================================="
fi

SCHEME="http"
API_EXTRA_ARGS=()

if [ "$HTTPS" = true ]; then
  SCHEME="https"
  if [ ! -f "$root/certs/dev.crt" ] || [ ! -f "$root/certs/dev.key" ]; then
    echo "No TLS certificates found. Run first:"
    echo "  bash scripts/make-dev-cert.sh"
    exit 1
  fi
  API_EXTRA_ARGS+=(--ssl-keyfile "$root/certs/dev.key" --ssl-certfile "$root/certs/dev.crt")
  WEB_SCRIPT="dev:https"
fi

echo "Starting SilentVoice..."
echo "API -> ${SCHEME}://${BIND}:${API_PORT}"
echo "Web -> ${SCHEME}://${BIND}:${WEB_PORT}"
echo

( cd "$root/api" && "$python_bin" -m uvicorn app.main:app --host "$BIND" --port "$API_PORT" --reload "${API_EXTRA_ARGS[@]}" ) &
( cd "$root/web" && npm run "$WEB_SCRIPT" ) &

if [ "$LAN" = true ]; then
  echo
  echo "Open on your phone (same Wi-Fi):"
  if command -v ip >/dev/null 2>&1; then
    ip -4 addr show | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | grep -v '127.0.0.1' | while read -r ip; do
      echo "  ${SCHEME}://${ip}:${WEB_PORT}"
    done
  elif command -v ifconfig >/dev/null 2>&1; then
    ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | while read -r ip; do
      echo "  ${SCHEME}://${ip}:${WEB_PORT}"
    done
  fi
  echo
  if [ "$HTTPS" = false ]; then
    echo "Microphone note: getUserMedia only runs in a secure context."
    echo "A plain http:// LAN address is NOT secure, so Live Scan and recording"
    echo "will not work on a phone. Re-run with --https (see README)."
  else
    echo "Accept the certificate on the phone at ${SCHEME}://<ip>:${API_PORT}/health FIRST,"
    echo "then open the web app."
  fi
fi

echo
echo "Press Ctrl+C to stop both servers."
wait
