#!/bin/sh
set -eu

media_pattern='\\.(png|jpe?g|mp4)$'
allowed_media_pattern='^architecture\\.png$'

list_history_hits() {
  git log --all --name-only --format='' | awk 'NF' | rg "$media_pattern" | rg -v "$allowed_media_pattern" || true
}

list_staged_hits() {
  git diff --cached --name-only --diff-filter=ACMR | awk 'NF' | rg "$media_pattern" | rg -v "$allowed_media_pattern" || true
}

mode="${1:-history}"

case "$mode" in
  --staged)
    hits="$(list_staged_hits)"
    if [ -n "$hits" ]; then
      printf '%s\n' "Media files cannot be committed to this repository." >&2
      printf '%s\n' "$hits" >&2
      exit 1
    fi
    ;;
  history)
    hits="$(list_history_hits)"
    if [ -n "$hits" ]; then
      printf '%s\n' "Media files were found in git history." >&2
      printf '%s\n' "$hits" >&2
      exit 1
    fi
    ;;
  *)
    printf '%s\n' "Usage: scripts/check-no-media.sh [--staged]" >&2
    exit 2
    ;;
esac
