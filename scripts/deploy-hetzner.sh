#!/usr/bin/env bash
set -euo pipefail
EXPECTED_ASSET=${1:?Missing expected JavaScript asset}
EXPECTED_HASH=${2:?Missing expected JavaScript hash}
[[ "$EXPECTED_ASSET" =~ ^/assets/index-[A-Za-z0-9_-]+[.]js$ && "$EXPECTED_HASH" =~ ^[0-9a-f]{64}$ ]] || exit 1

CADDY_CONTAINER=$(docker ps --filter name=^/fahrschulpilot-caddy-1$ --format '{{.Names}}' | head -n 1)
[ -n "$CADDY_CONTAINER" ] || { echo 'Kein aktiver Caddy-Container gefunden.'; exit 1; }
# Inspect the routing structure without writing shared configuration.
route_type=$(docker exec "$CADDY_CONTAINER" caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile 2>/dev/null |
  python3 -c '
import json, sys

def upstreams(route):
    for handler in route.get("handle", []):
        if handler.get("handler") == "reverse_proxy":
            for target in handler.get("upstreams", []):
                yield target.get("dial")
        for child in handler.get("routes", []):
            yield from upstreams(child)

def routes_for_host(routes):
    for route in routes:
        if any("app.tariq-fahrdienst.de" in group.get("host", []) for group in route.get("match", [])):
            yield route
        for handler in route.get("handle", []):
            yield from routes_for_host(handler.get("routes", []))

data = json.load(sys.stdin)
servers = data.get("apps", {}).get("http", {}).get("servers", {})
targets = {
    target
    for server in servers.values()
    for route in routes_for_host(server.get("routes", []))
    for target in upstreams(route)
}
dedicated = bool({"tariq-fahrdienst-app:80", "tariq-fahrdienst-app"}.intersection(targets))
shared = bool({"tariq-frontend:80", "tariq-websites:80", "tariq-frontend", "tariq-websites"}.intersection(targets))
if dedicated == shared:
    sys.exit("Die Fahrdienst-Route konnte keinem eindeutigen Deployment-Ziel zugeordnet werden.")
print("dedicated" if dedicated else "shared")
')

if [[ "$route_type" == shared ]]; then
  frontend=tariq-frontend
  if ! docker inspect --format '{{.State.Running}}' "$frontend" 2>/dev/null | grep -Fxq true; then
    frontend=tariq-websites
  fi
  domain=app.tariq-fahrdienst.de
  root=/srv/public-sites
  test "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/srv/public-sites"}}{{.Name}}{{end}}{{end}}' "$frontend")" = tariq-websites-public
  if ! docker exec "$frontend" nginx -T 2>/dev/null | python3 -c '
import re, sys
host = "app.tariq-fahrdienst.de"
expected = "/srv/public-sites/" + host
text = sys.stdin.read()
for match in re.finditer(r"(?m)^\s*server\s*\{", text):
    depth = 1
    end = match.end()
    while depth and end < len(text):
        depth += (text[end] == "{") - (text[end] == "}")
        end += 1
    block = text[match.end():end]
    if not re.search(r"(?m)^\s*server_name\s+" + re.escape(host) + r"\s*;", block):
        continue
    roots = re.findall(r"(?m)^\s*root\s+([^;]+);", block)
    sys.exit(0 if roots and all(root.rstrip("/") == expected for root in roots) else 1)
sys.exit(1)
'; then
    echo 'Die separate Fahrdienst-Veröffentlichungsmappe im gemeinsamen Frontend konnte nicht bestätigt werden.' >&2
    exit 1
  fi
  stage=$(mktemp -d)
  trap 'rm -rf "$stage"' EXIT
  tar -xzf /tmp/tariq-fahrdienst-app-dist.tar.gz -C "$stage"
  test "$(sha256sum "$stage$EXPECTED_ASSET" | cut -d ' ' -f 1)" = "$EXPECTED_HASH"
  grep -Fq "$EXPECTED_ASSET" "$stage/index.html"
  chmod -R a+rX "$stage"
  release=".fahrdienst-app-$(date -u +%Y%m%d%H%M%S%N)"
  docker exec "$frontend" mkdir "$root/$release"
  docker cp "$stage/." "$frontend:$root/$release/"
  docker exec "$frontend" sh -eu -c '
    cd "$1"
    site=$2
    release=$3
    previous="$release-previous"
    test -f "$site/index.html"
    if [ -L "$site" ]; then
      ln -s "$(readlink "$site")" "$previous"
    else
      mv "$site" "$previous"
    fi
    ln -s "$release" "$release-link"
    if ! mv -Tf "$release-link" "$site"; then
      mv -Tf "$previous" "$site"
      exit 1
    fi
  ' sh "$root" "$domain" "$release"
  if ! docker exec "$CADDY_CONTAINER" wget -qO- --header "Host: $domain" "http://$frontend/" 2>/dev/null | cmp -s "$stage/index.html" - ||
     ! docker exec "$CADDY_CONTAINER" wget -qO- --header "Host: $domain" "http://$frontend$EXPECTED_ASSET" 2>/dev/null | cmp -s "$stage$EXPECTED_ASSET" -; then
    docker exec "$frontend" sh -eu -c '
      cd "$1"
      if [ -L "$3" ]; then
        mv -Tf "$3" "$2"
      else
        rm "$2"
        mv "$3" "$2"
      fi
    ' sh "$root" "$domain" "$release-previous"
    echo 'Fahrdienst-Build im gemeinsamen Frontend nicht bestätigt. Vorherige Version wiederhergestellt.' >&2
    exit 1
  fi
  echo 'Fahrdienst-App im gemeinsamen Frontend veröffentlicht. HTML und JavaScript entsprechen dem geprüften Build.'
  exit 0
fi

APP_DIR=/home/fpadmin/sites/tariq-fahrdienst-app
mkdir -p "$APP_DIR"
tar -xzf /tmp/tariq-fahrdienst-app.tar.gz -C "$APP_DIR"
docker network inspect fahrschulpilot_web >/dev/null 2>&1 || docker network create fahrschulpilot_web
cd "$APP_DIR"
# Preserve the existing Compose project/service so the named app container can
# be updated without colliding with it or removing sibling API containers.
APP_PROJECT=tariq-fahrdienst-app
APP_SERVICE=app
if docker inspect tariq-fahrdienst-app >/dev/null 2>&1; then
  APP_PROJECT=$(docker inspect tariq-fahrdienst-app --format '{{index .Config.Labels "com.docker.compose.project"}}')
  APP_SERVICE=$(docker inspect tariq-fahrdienst-app --format '{{index .Config.Labels "com.docker.compose.service"}}')
  [[ "$APP_PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ && "$APP_SERVICE" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || {
    echo 'App-Container hat keine gültige Compose-Zuordnung. Deployment abgebrochen.'; exit 1;
  }
fi
APP_COMPOSE=$(mktemp /tmp/fahrdienst-compose.XXXXXX.json)
trap 'rm -f "$APP_COMPOSE"' EXIT
docker compose -f compose.production.yml config --format json | python3 -c '
import json,sys
config=json.load(sys.stdin)
config["name"]=sys.argv[1]
config["services"]={sys.argv[2]:config["services"]["app"]}
json.dump(config,sys.stdout)
' "$APP_PROJECT" "$APP_SERVICE" > "$APP_COMPOSE"
docker compose -p "$APP_PROJECT" -f "$APP_COMPOSE" up -d --build "$APP_SERVICE"

# Check the running app from Caddy's network without exposing it outside the VPN.
for attempt in $(seq 1 15); do
  if live_html=$(docker exec "$CADDY_CONTAINER" wget -qO- http://tariq-fahrdienst-app/ 2>/dev/null) &&
     [[ "$live_html" == *'id="root"'* && "$live_html" == *"$EXPECTED_ASSET"* ]] &&
     live_hash=$(docker exec "$CADDY_CONTAINER" wget -qO- "http://tariq-fahrdienst-app$EXPECTED_ASSET" 2>/dev/null | sha256sum) &&
     [[ "${live_hash%% *}" == "$EXPECTED_HASH" ]]; then
    echo 'Fahrdienst-App im Proxy-Netz erreichbar, JavaScript entspricht dem geprüften Build.'
    exit 0
  fi
  sleep 2
done
echo 'Der neue Build konnte im Proxy-Netz nicht bestätigt werden.' >&2
exit 1
