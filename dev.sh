#!/usr/bin/env bash
# Start both halves of SuaraSah (macOS / Linux / Git Bash).
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

python_bin="$root/api/.venv/bin/python"
[ -x "$python_bin" ] || python_bin="$root/api/.venv/Scripts/python.exe"
if [ ! -x "$python_bin" ]; then
  echo "Backend venv missing. Run: cd api && python -m venv .venv && .venv/bin/pip install -r requirements.txt"
  exit 1
fi

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

( cd "$root/api" && "$python_bin" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload ) &
( cd "$root/web" && npm run dev:lan ) &

echo
echo "API http://localhost:8000   docs http://localhost:8000/docs"
echo "Web http://localhost:3000"
echo "Phone: http://<this-machine-ip>:3000 on the same Wi-Fi"
wait
