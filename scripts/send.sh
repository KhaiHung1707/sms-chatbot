#!/usr/bin/env bash
# Send a fake inbound SMS webhook to the local dev server (npm run dev:local).
# Signs the request exactly like Quo does, so the middleware's signature check
# passes. Uses the same DEV_WEBHOOK_SECRET as src/dev/server.ts.
#
# Usage:
#   ./scripts/send.sh "<from-phone>" "<message body>"
#   ./scripts/send.sh "+15105551234" "95 Accord front bumper yes"
#
# Special: pass a 3rd arg "media" to simulate an MMS (photo) message.

set -euo pipefail

FROM="${1:-+15105551234}"
BODY="${2:-hello}"
KIND="${3:-}"

# Port matches the dev server. Override with PORT=3999 ./scripts/send.sh … if you
# started the server on a different port.
PORT="${PORT:-3000}"
URL="http://localhost:${PORT}/webhooks/quo"
TO="+15104512800"                      # the shop's Quo number
SECRET_RAW="dev-local-secret"          # must match DEV_WEBHOOK_SECRET source
TS="1700000000000"
ID="dev-$(date +%s)-$RANDOM"

# Build the JSON payload. A unique id each time avoids the dedupe guard.
if [ "$KIND" = "media" ]; then
  MEDIA='[{"url":"https://example.com/photo.jpg","type":"image/jpeg"}]'
  BODY=""
else
  MEDIA='[]'
fi

read -r -d '' PAYLOAD <<JSON || true
{"type":"message.received","data":{"object":{"id":"${ID}","object":"message","from":"${FROM}","to":"${TO}","direction":"incoming","body":"${BODY}","media":${MEDIA},"userId":null}}}
JSON
# Collapse to a single line (the signature is over exact bytes).
PAYLOAD=$(printf '%s' "$PAYLOAD" | tr -d '\n')

# Quo signs base64(HMAC-SHA256(key_bytes, "<ts>.<rawbody>")), key is base64 —
# but here we hold the RAW secret, so we base64-decode nothing: the server
# base64-DECODES its stored secret, so we must sign with those same raw bytes.
# DEV_WEBHOOK_SECRET = base64("dev-local-secret"), decoded back = "dev-local-secret".
SIG=$(printf '%s.%s' "$TS" "$PAYLOAD" \
  | openssl dgst -sha256 -hmac "$SECRET_RAW" -binary \
  | openssl base64 -A)
HEADER="hmac;1;${TS};${SIG}"

echo "→ POST ${URL}"
echo "  from=${FROM}  body=\"${BODY}\"${KIND:+  (${KIND})}"
curl -s -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "openphone-signature: ${HEADER}" \
  -d "$PAYLOAD"
echo
