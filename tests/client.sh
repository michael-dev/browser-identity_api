#!/usr/bin/env bash
# Tests of the extension against a Roundcube with the identity_api plugin, run by the
# plugin's integration test (CLIENT_TEST, see its tests/integration.sh), which passes
# API_URL, CLIENT_TOKEN, RC_URL, RC_USER and WORK. Usually started with make integration-test.
#   E2E=1: also the end-to-end test of the real Chrome extension in Chromium
#          (needs Playwright: npm install --no-save playwright && npx playwright install chromium)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0

# the extension's API client (lib/api.js) incl. the automatic token rotation
node "$ROOT/tests/rotation-client.js" "$API_URL" "$CLIENT_TOKEN" || FAIL=1

if [ "${E2E:-0}" = 1 ]; then
  RC_PORT=$(node -p 'new URL(process.argv[1]).port' "$RC_URL")
  SHOP_PORT=$((RC_PORT + 2000))
  php -S "127.0.0.1:$SHOP_PORT" -t "$ROOT/tests/e2e" >"$WORK/shop.log" 2>&1 &
  SHOP=$!
  trap 'kill $SHOP 2>/dev/null || true' EXIT
  node "$ROOT/scripts/build-chrome.js" "$WORK/chrome" >/dev/null
  rm -rf "$WORK/chromium-profile"
  for _ in $(seq 50); do curl -s -o /dev/null "http://127.0.0.1:$SHOP_PORT/" && break; sleep 0.1; done
  node "$ROOT/tests/e2e/chromium-extension.test.js" "$WORK/chrome" "$RC_URL" "$SHOP_PORT" "$RC_USER" "$WORK" || FAIL=1
fi

exit $FAIL
