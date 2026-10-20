#!/usr/bin/env bash
# Make a self-signed TLS certificate for demoing on a phone over the venue LAN.
#
#   ./scripts/make-dev-cert.sh            # auto-detects this machine's LAN IPs
#   ./scripts/make-dev-cert.sh 192.168.0.12 suarasah.local
#
# Why this is needed at all: getUserMedia() only works in a secure context.
# localhost counts as secure, a plain http://192.168.x.x does NOT - so the
# microphone (and therefore Live Scan and recording) is dead over the LAN
# unless both the web app and the API are served over HTTPS.
#
# The certificate covers localhost, 127.0.0.1 and every LAN IP found, so the
# same pair works for Next.js on :3000 and uvicorn on :8000.
set -euo pipefail

# Git Bash/MSYS rewrites arguments that look like paths, which turns
# openssl's "/CN=..." subject into a Windows directory. Exclude just that
# argument, so real file paths are still converted correctly.
export MSYS2_ARG_CONV_EXCL="/CN="

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$root/certs"
mkdir -p "$out"

extra=("$@")
ips=()
if command -v ipconfig >/dev/null 2>&1; then
  while read -r ip; do ips+=("$ip"); done < <(
    ipconfig 2>/dev/null | tr -d '\r' | grep -oE 'IPv4[^:]*: *[0-9.]+' | grep -oE '[0-9.]+$' |
      grep -vE '^(127\.|169\.254\.)' || true
  )
elif command -v hostname >/dev/null 2>&1; then
  while read -r ip; do ips+=("$ip"); done < <(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9.]+$' || true)
fi

san="DNS:localhost,IP:127.0.0.1"
for ip in "${ips[@]}"; do san="$san,IP:$ip"; done
for item in "${extra[@]}"; do
  if [[ "$item" =~ ^[0-9.]+$ ]]; then san="$san,IP:$item"; else san="$san,DNS:$item"; fi
done

echo "Subject alternative names: $san"

openssl req -x509 -nodes -newkey rsa:2048 -sha256 -days 365 \
  -keyout "$out/dev.key" -out "$out/dev.crt" \
  -subj "/CN=SuaraSah dev" \
  -addext "subjectAltName=$san" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth" 2>"$out/.openssl.log" || {
    echo "openssl failed:" >&2; cat "$out/.openssl.log" >&2; exit 1;
  }
rm -f "$out/.openssl.log"

chmod 600 "$out/dev.key" 2>/dev/null || true

cat <<MSG

Wrote $out/dev.crt and $out/dev.key

Start both halves over HTTPS:

  cd api && .venv/Scripts/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 \\
      --ssl-keyfile ../certs/dev.key --ssl-certfile ../certs/dev.crt
  cd web && npm run dev:https

On the phone, visit BOTH of these once and accept the warning:
MSG
for ip in "${ips[@]}"; do
  echo "  https://$ip:8000/health     <- accept the certificate here FIRST"
  echo "  https://$ip:3000            <- then open the app"
done
echo
echo "The API must be accepted first, otherwise the app's fetches fail silently."
