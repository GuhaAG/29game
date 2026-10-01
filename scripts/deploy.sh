#!/usr/bin/env bash
# Build locally and ship to the droplet. Idempotent; safe to run repeatedly.
#
#   ./scripts/deploy.sh
#
# Overridable: DEPLOY_HOST, DEPLOY_USER, DEPLOY_KEY, DEPLOY_URL
set -euo pipefail

HOST="${DEPLOY_HOST:-134.209.100.100}"
USER="${DEPLOY_USER:-deploy}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/twentynine_deploy}"
URL="${DEPLOY_URL:-https://134-209-100-100.sslip.io}"
SSH_OPTS="-i $KEY -o StrictHostKeyChecking=accept-new -o BatchMode=yes"

echo "==> building"
npm run build >/dev/null

echo "==> shipping to $USER@$HOST"
# Only the runtime artefacts: compiled server, client bundle, text, manifests.
rsync -az --delete -e "ssh $SSH_OPTS" \
  dist public locales package.json package-lock.json \
  "$USER@$HOST:/srv/twentynine/"

echo "==> installing runtime dependencies and restarting"
# shellcheck disable=SC2029
ssh $SSH_OPTS "$USER@$HOST" \
  'cd /srv/twentynine && npm ci --omit=dev --silent && sudo systemctl restart twentynine'

echo "==> waiting for health"
# node rather than curl: the toolchain is guaranteed present, curl is not.
for attempt in $(seq 1 20); do
  if node -e "fetch('$URL/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "==> live at $URL"
    exit 0
  fi
  sleep 2
done

echo "!! did not come back healthy; service status:" >&2
ssh $SSH_OPTS "$USER@$HOST" 'sudo systemctl is-active twentynine' >&2 || true
exit 1
