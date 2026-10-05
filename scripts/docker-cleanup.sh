#!/usr/bin/env bash
#
# scripts/docker-cleanup.sh — removes old SlaydX images only (docs/ops/O3-robustness-ops.md §2,
# item 3). The box is shared with other projects: this script NEVER runs a global prune and never
# touches an image whose repository name does not start with `slaydx-` (local `slaydx-web`,
# `slaydx-worker`, or registry `ghcr.io/<owner>/slaydx-web` …).
#
# For each slaydx repository it keeps
#   - every image used by any container (running or stopped), and
#   - the newest CLEANUP_KEEP_ROLLBACK (default 2) other images — the rollback candidates,
# and removes the remaining tags with a plain `docker rmi <repo>:<tag>` (no -f: Docker itself
# refuses to delete an image a container still uses). Untagged (dangling) images are pruned only
# when they carry the compose label of the `slaydx` project.
#
# Dry run by default — prints the plan. Run after a successful deploy health check:
#   /opt/slaydx/scripts/docker-cleanup.sh            # show what would be removed
#   /opt/slaydx/scripts/docker-cleanup.sh --apply    # remove it
set -euo pipefail

APPLY=0
KEEP="${CLEANUP_KEEP_ROLLBACK:-2}"
PROJECT="${CLEANUP_COMPOSE_PROJECT:-slaydx}"
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --dry-run) APPLY=0 ;;
    --keep)
      [ $# -ge 2 ] || { echo "docker-cleanup: --keep needs a number" >&2; exit 2; }
      KEEP="$2"
      shift
      ;;
    -h | --help) sed -n '2,/^set -euo/p' "$0" | sed -e '/^set -euo/d' -e 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "docker-cleanup: unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done
if ! [[ "$KEEP" =~ ^[0-9]+$ ]] || [ "$KEEP" -lt 1 ]; then
  echo "docker-cleanup: the number of rollback images to keep must be >= 1" >&2
  exit 2
fi

mode="dry-run"
[ "$APPLY" = 0 ] || mode="apply"
echo "docker-cleanup: $mode, keeping the newest $KEEP unused image(s) per slaydx repository"

# Image IDs used by any container on the box (all projects — an in-use image is never touched).
declare -A used=()
while IFS= read -r id; do
  [ -z "$id" ] || used[$id]=1
done < <(docker ps -aq --no-trunc | xargs -r docker inspect -f '{{.Image}}')

# Tagged slaydx images: "<created>\t<repo>\t<tag>\t<id>".
declare -A created=() repos=()
rows=()
while IFS=$'\t' read -r repo tag id; do
  base=${repo##*/}
  case "$base" in slaydx-*) ;; *) continue ;; esac
  [ "$tag" != "<none>" ] || continue
  if [ -z "${created[$id]:-}" ]; then
    created[$id]=$(docker image inspect -f '{{.Created}}' "$id")
  fi
  repos[$repo]=1
  rows+=("${created[$id]}"$'\t'"$repo"$'\t'"$tag"$'\t'"$id")
done < <(docker images --no-trunc --format '{{.Repository}}\t{{.Tag}}\t{{.ID}}')

removed=0
failed=0
for repo in "${!repos[@]}"; do
  declare -A keep_id=()
  kept=0
  # Newest first (Docker reports Created in UTC RFC 3339, so text order is time order).
  while IFS=$'\t' read -r _ r tag id; do
    if [ -n "${used[$id]:-}" ]; then
      echo "  keep   $r:$tag (in use)"
    elif [ -n "${keep_id[$id]:-}" ]; then
      echo "  keep   $r:$tag (rollback)"
    elif [ "$kept" -lt "$KEEP" ]; then
      keep_id[$id]=1
      kept=$((kept + 1))
      echo "  keep   $r:$tag (rollback)"
    elif [ "$APPLY" = 1 ]; then
      if docker rmi "$r:$tag" >/dev/null; then
        echo "  remove $r:$tag"
        removed=$((removed + 1))
      else
        echo "  FAILED $r:$tag (left in place)" >&2
        failed=$((failed + 1))
      fi
    else
      echo "  would remove $r:$tag"
      removed=$((removed + 1))
    fi
  done < <(printf '%s\n' "${rows[@]}" | awk -F'\t' -v r="$repo" '$2 == r' | sort -r)
  unset keep_id
done

# Dangling layers left by `docker compose build` of this project only.
if [ "$APPLY" = 1 ]; then
  docker image prune -f --filter "label=com.docker.compose.project=$PROJECT" >/dev/null
  echo "docker-cleanup: pruned dangling images labelled com.docker.compose.project=$PROJECT"
else
  n=$(docker images -q --filter dangling=true --filter "label=com.docker.compose.project=$PROJECT" | wc -l)
  echo "docker-cleanup: would prune $n dangling image(s) labelled com.docker.compose.project=$PROJECT"
fi

if [ "$APPLY" = 1 ]; then
  echo "docker-cleanup: removed $removed tag(s), $failed failed"
else
  echo "docker-cleanup: would remove $removed tag(s) (run with --apply)"
fi
[ "$failed" -eq 0 ]
