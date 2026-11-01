#!/usr/bin/env bash
# Serve a checkout (or built site) over HTTP and run its browser regression
# pages in headless Chromium.
#
# Usage: tests/browser-tests.sh [site-dir]
#
# site-dir must contain index.html and tests/; it defaults to this checkout.
# Tools are taken from PATH or the CHROMIUM/NODE/PYTHON environment variables,
# so both `nix develop -c tests/browser-tests.sh` and `nix flake check` work.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
site=$(cd "${1:-$here/..}" && pwd)

chromium=${CHROMIUM:-chromium}
node=${NODE:-node}
python=${PYTHON:-python3}
http_port=${HTTP_PORT:-8765}
cdp_port=${CDP_PORT:-9222}

pages=(
  tests/swipe.html
  tests/theme.html
  tests/tom.html
)

tmp=$(mktemp -d)
cleanup() {
  kill "${chromium_pid:-}" "${server_pid:-}" 2>/dev/null || true
  wait "${chromium_pid:-}" "${server_pid:-}" 2>/dev/null || true
  rm -rf "$tmp"
}
trap cleanup EXIT

"$python" -m http.server "$http_port" --bind 127.0.0.1 --directory "$site" \
  >"$tmp/http.log" 2>&1 &
server_pid=$!

for _ in $(seq 1 100); do
  if (exec 3<>"/dev/tcp/127.0.0.1/$http_port") 2>/dev/null; then break; fi
  sleep 0.1
done

"$chromium" \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --remote-debugging-port="$cdp_port" \
  --user-data-dir="$tmp/profile" \
  about:blank \
  >"$tmp/chromium.log" 2>&1 &
chromium_pid=$!

CDP_PORT="$cdp_port" "$node" "$here/browser-tests.mjs" \
  "http://127.0.0.1:$http_port/" "${pages[@]}" || status=$?

if [[ ${status:-0} -ne 0 && -s "$tmp/chromium.log" ]]; then
  echo "\nChromium log (last 40 lines):" >&2
  tail -n 40 "$tmp/chromium.log" >&2
fi
exit "${status:-0}"
