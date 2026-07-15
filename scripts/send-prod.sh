#!/usr/bin/env bash
# Send a signed fake inbound SMS to the DEPLOYED bot (Fly.io), signing with the
# REAL QUO_WEBHOOK_SECRET so it passes the production signature check — lets you
# test the live bot end-to-end WITHOUT a phone.
#
# Reads QUO_WEBHOOK_SECRET from .env.local (never printed).
#
# Usage:
#   ./scripts/send-prod.sh "+15105551234" "95 Accord front bumper"
#   URL=https://sms-chatbot.fly.dev ./scripts/send-prod.sh "+15105551234" "yes"

set -euo pipefail

FROM="${1:-+15105551234}"
BODY="${2:-hello}"
KIND="${3:-}"

BASE_URL="${URL:-https://sms-chatbot.fly.dev}"
ENDPOINT="${BASE_URL%/}/webhooks/quo"
TO="+15104512800"

# Load the real webhook secret from .env.local (base64-encoded, as Quo issues it).
ENV_FILE="$(dirname "$0")/../.env.local"
if [ ! -f "$ENV_FILE" ]; then
  echo "✖ .env.local not found at $ENV_FILE" >&2
  exit 1
fi
B64_SECRET="$(grep -E '^QUO_WEBHOOK_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')"
if [ -z "$B64_SECRET" ]; then
  echo "✖ QUO_WEBHOOK_SECRET missing in .env.local" >&2
  exit 1
fi

TS="1700000000000"
ID="probe-$(date +%s)-$RANDOM"

if [ "$KIND" = "media" ]; then
  MEDIA='[{"url":"https://example.com/photo.jpg","type":"image/jpeg"}]'
  BODY=""
else
  MEDIA='[]'
fi

read -r -d '' PAYLOAD <<JSON || true
{"type":"message.received","data":{"object":{"id":"${ID}","object":"message","from":"${FROM}","to":"${TO}","direction":"incoming","body":"${BODY}","media":${MEDIA},"userId":null}}}
JSON
PAYLOAD=$(printf '%s' "$PAYLOAD" | tr -d '\n')

# The server base64-DECODES its stored secret to raw key bytes, then HMACs
# "<ts>.<rawbody>". We must sign with those same decoded bytes: decode the
# base64 secret to a binary key file and HMAC with it.
KEYFILE="$(mktemp)"
trap 'rm -f "$KEYFILE"' EXIT
printf '%s' "$B64_SECRET" | openssl base64 -d -A > "$KEYFILE"

SIG=$(printf '%s.%s' "$TS" "$PAYLOAD" \
  | openssl dgst -sha256 -mac HMAC -macopt "hexkey:$(xxd -p -c 256 "$KEYFILE" | tr -d '\n')" -binary \
  | openssl base64 -A)
HEADER="hmac;1;${TS};${SIG}"

echo "→ POST ${ENDPOINT}"
echo "  from=${FROM}  body=\"${BODY}\"${KIND:+  (${KIND})}"
curl -s -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "openphone-signature: ${HEADER}" \
  -d "$PAYLOAD"
echo
