#!/usr/bin/env bash
# Installs the deploy scripts on the server as root-owned COPIES (not symlinks): the scripts
# `git reset` the checkout they live in, and bash reads a running script incrementally.
#   /usr/local/bin/slaydx-deploy        ← deploy/deploy-pull.sh   (normal path)
#   /usr/local/bin/slaydx-deploy-build  ← deploy/deploy-build.sh  (fallback, builds on the box)
# Re-run after every change to deploy/*.sh. Idempotent. Touches nothing outside these paths,
# the deploy state dir and the slaydx registry-auth dir.
#
# Registry login (once, by the owner; the token is typed/piped, never echoed or stored elsewhere):
#   DOCKER_CONFIG=/etc/slaydx/docker docker login ghcr.io -u <github-user> --password-stdin
set -euo pipefail
umask 077

SRC_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
BIN_DIR=${SLAYDX_BIN_DIR:-/usr/local/bin}
STATE_DIR=${SLAYDX_STATE_DIR:-/var/lib/slaydx-deploy}
DOCKER_CONFIG_DIR=${SLAYDX_DOCKER_CONFIG:-/etc/slaydx/docker}

install -d -m 0755 "$BIN_DIR"
install -m 0750 "$SRC_DIR/deploy-pull.sh" "$BIN_DIR/slaydx-deploy"
install -m 0750 "$SRC_DIR/deploy-build.sh" "$BIN_DIR/slaydx-deploy-build"
install -d -m 0700 "$STATE_DIR" "$DOCKER_CONFIG_DIR"
echo "installed: $BIN_DIR/slaydx-deploy, $BIN_DIR/slaydx-deploy-build"

# The CLI looks for plugins (compose) under $DOCKER_CONFIG/cli-plugins too. If compose was
# installed per-user (~/.docker/cli-plugins) it disappears once DOCKER_CONFIG is redirected —
# COPY it (root-owned source only — root must never execute a user-writable binary, e.g. under
# `sudo` with a preserved HOME) so `docker compose` keeps working inside slaydx-deploy.
if ! DOCKER_CONFIG=$DOCKER_CONFIG_DIR docker compose version >/dev/null 2>&1; then
  user_plugin="$HOME/.docker/cli-plugins/docker-compose"
  if [ -x "$user_plugin" ]; then
    if [ "$(stat -L -c %u "$user_plugin")" != 0 ]; then
      echo "ERROR: $user_plugin is not owned by root — refusing to copy it into $DOCKER_CONFIG_DIR" >&2
      exit 1
    fi
    install -d -m 0700 "$DOCKER_CONFIG_DIR/cli-plugins"
    install -m 0755 "$user_plugin" "$DOCKER_CONFIG_DIR/cli-plugins/docker-compose"
    echo "copied $user_plugin into $DOCKER_CONFIG_DIR/cli-plugins"
  fi
  DOCKER_CONFIG=$DOCKER_CONFIG_DIR docker compose version >/dev/null 2>&1 \
    || { echo "ERROR: 'docker compose' does not work with DOCKER_CONFIG=$DOCKER_CONFIG_DIR" >&2; exit 1; }
fi

if [ ! -f "$DOCKER_CONFIG_DIR/config.json" ]; then
  echo "next: log in to the registry (read:packages token):"
  echo "  DOCKER_CONFIG=$DOCKER_CONFIG_DIR docker login ghcr.io -u <github-user> --password-stdin"
fi
