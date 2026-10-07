#!/usr/bin/env bash
set -euo pipefail
APP_DIR=/home/fpadmin/sites/tariq-fahrdienst-app
mkdir -p "$APP_DIR"
tar -xzf /tmp/tariq-fahrdienst-app.tar.gz -C "$APP_DIR"
docker network inspect fahrschulpilot_web >/dev/null 2>&1 || docker network create fahrschulpilot_web
cd "$APP_DIR"
docker compose -f compose.production.yml up -d --build --remove-orphans
APP_IP=$(docker inspect tariq-fahrdienst-app --format '{{(index .NetworkSettings.Networks "fahrschulpilot_web").IPAddress}}')
for attempt in $(seq 1 15); do
  if curl --fail --silent --show-error "http://$APP_IP/" -o /tmp/fahrdienst-health.html; then break; fi
  if [ "$attempt" = 15 ]; then docker logs --tail 30 tariq-fahrdienst-app; exit 1; fi
  sleep 2
done
grep -q 'id="root"' /tmp/fahrdienst-health.html
CADDY_CONTAINER=$(docker ps --filter name=^/fahrschulpilot-caddy-1$ --format '{{.Names}}' | head -n 1)
[ -n "$CADDY_CONTAINER" ] || { echo 'Kein aktiver Caddy-Container gefunden.'; exit 1; }
# Use the actual mounted config, never guess a server path.
CADDY_CONFIG=$(docker inspect "$CADDY_CONTAINER" --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}')
[ -f "$CADDY_CONFIG" ] || { echo 'Caddyfile-Mount nicht gefunden. Serverkonfiguration muss geprüft werden.'; exit 1; }
# Shared routing belongs to fahrschulpilot. App deployment is read-only here.
python3 - "$CADDY_CONFIG" <<'ROUTES'
import re, sys
from pathlib import Path
text = Path(sys.argv[1]).read_text()
block = re.search(r'(?ms)^app\.tariq-fahrdienst\.de\s*\{(.*?)^\}', text)
if not block or not re.search(r'(?m)^\s*reverse_proxy\s+tariq-fahrdienst-app:80\s*$', block.group(1)):
    raise SystemExit('Geschützte Fahrdienst-Route fehlt. Zentrales Routing-Deployment erforderlich.')
ROUTES
for attempt in $(seq 1 15); do
  if curl --fail --silent --show-error --max-time 15 https://app.tariq-fahrdienst.de/ -o /tmp/fahrdienst-public.html && grep -q 'id="root"' /tmp/fahrdienst-public.html; then
    echo 'Fahrdienst-App öffentlich erreichbar.'
    exit 0
  fi
  sleep 2
done
echo 'App intern erreichbar; öffentlicher TLS-/Proxy-Check noch fehlgeschlagen.'
exit 1
