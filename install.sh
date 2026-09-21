#!/usr/bin/env bash
#
# install.sh — deploy LiveWX Radar into a CloudTAK checkout.
#
# This plugin is a flat Vue/TS repo (index.ts at the root). CloudTAK's
# WEB_PLUGINS env var can also deploy it, but this installer matches the
# same operator flow as Quick Point Dropper: copy into
# api/web/plugins/<name>/, then rebuild + restart the API image.
#
# This script:
#   • copy plugin sources → <CloudTAK>/api/web/plugins/livewx-radar/
#   • rebuild + restart the CloudTAK API image so the plugin is baked in.
#
# Usage:
#   Install / update:  ./install.sh [/path/to/CloudTAK]
#   Remove:            ./install.sh --remove [/path/to/CloudTAK]
#
# Options:
#   /path/to/CloudTAK   CloudTAK checkout (the dir containing docker-compose.yml).
#                       Optional. If omitted (or the given path is missing), the
#                       script uses the first of: $CLOUDTAK, ~/CloudTAK,
#                       /home/takwerx/CloudTAK, /home/*/CloudTAK.
#   --no-pull           Skip git pull (deploy whatever is already in this checkout).
#   --pull              No-op; pull is the default on install/update.
#   --no-build          Copy/remove files only; skip the docker rebuild + restart.
#   --remove            Uninstall: delete the copied files, then rebuild.
#
# Requires: bash; git (unless --no-pull or --remove); and (unless --no-build) docker + docker compose.

set -euo pipefail

INSTALL_DIR_NAME="livewx-radar"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
    sed -n '/^# Usage:/,/^# Requires:/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

CT_DIR=""
DO_BUILD=1
DO_PULL=1
ACTION="install"
for arg in "$@"; do
    case "$arg" in
        --pull) DO_PULL=1 ;;
        --no-pull) DO_PULL=0 ;;
        --no-build) DO_BUILD=0 ;;
        --remove) ACTION="remove" ;;
        -h|--help) usage; exit 0 ;;
        -*) echo "Unknown option: $arg" >&2; echo >&2; usage >&2; exit 2 ;;
        *) CT_DIR="$arg" ;;
    esac
done

# A CloudTAK checkout is the dir that contains api/ (and usually docker-compose.yml).
looks_like_cloudtak() {
    [ -d "$1/api" ]
}

# First matching checkout. Prints the path or returns 1.
find_cloudtak() {
    local cand seen="|"
    local candidates=()

    [ -n "${CLOUDTAK:-}" ] && candidates+=("$CLOUDTAK")
    candidates+=("$HOME/CloudTAK")
    candidates+=("/home/takwerx/CloudTAK")
    for cand in /home/*/CloudTAK; do
        [ -d "$cand" ] && candidates+=("$cand")
    done

    for cand in "${candidates[@]}"; do
        case "$seen" in
            *"|$cand|"*) continue ;;
        esac
        seen="${seen}${cand}|"
        if looks_like_cloudtak "$cand"; then
            printf '%s\n' "$cand"
            return 0
        fi
    done
    return 1
}

REQUESTED="$CT_DIR"
if [ -n "$CT_DIR" ] && looks_like_cloudtak "$CT_DIR"; then
    :
elif [ -n "$CT_DIR" ] && [ -e "$CT_DIR" ]; then
    echo "ERROR: $CT_DIR does not look like a CloudTAK checkout (no api/ dir)." >&2
    exit 1
else
    FOUND="$(find_cloudtak || true)"
    if [ -z "$FOUND" ]; then
        if [ -n "$REQUESTED" ]; then
            echo "ERROR: CloudTAK dir not found: $REQUESTED" >&2
        else
            echo "ERROR: CloudTAK dir not found (tried \$CLOUDTAK, ~/CloudTAK, /home/takwerx/CloudTAK)." >&2
        fi
        echo "  Pass the path explicitly: ./install.sh /path/to/CloudTAK" >&2
        exit 1
    fi
    if [ -n "$REQUESTED" ] && [ "$FOUND" != "$REQUESTED" ]; then
        echo "Note: $REQUESTED not found; using $FOUND"
        echo
    fi
    CT_DIR="$FOUND"
fi
if [ "$DO_BUILD" -eq 1 ] && [ ! -f "$CT_DIR/docker-compose.yml" ]; then
    echo "ERROR: no docker-compose.yml in $CT_DIR — cannot rebuild." >&2
    echo "  Re-run with --no-build to copy files only, then rebuild yourself." >&2
    exit 1
fi

WEB_DEST="$CT_DIR/api/web/plugins/$INSTALL_DIR_NAME"

echo "CloudTAK: $CT_DIR"
echo "Plugin:   $REPO_DIR"
echo "Action:   $ACTION"
echo

if [ "$ACTION" = "remove" ]; then
    DO_PULL=0
fi

if [ "$DO_PULL" -eq 1 ]; then
    if [ ! -d "$REPO_DIR/.git" ]; then
        echo "Skipping git pull (not a git checkout)."
        echo
    else
        echo "Pulling latest plugin source..."
        git -C "$REPO_DIR" pull
        echo
    fi
fi

if [ "$ACTION" = "remove" ]; then
    if [ -d "$WEB_DEST" ]; then
        rm -rf "$WEB_DEST"
        echo "Removed web plugin: api/web/plugins/$INSTALL_DIR_NAME"
    fi
else
    if [ ! -f "$REPO_DIR/index.ts" ]; then
        echo "ERROR: $REPO_DIR/index.ts not found — run this from the plugin repo." >&2
        exit 1
    fi
    mkdir -p "$CT_DIR/api/web/plugins"

    rm -rf "$WEB_DEST"
    mkdir -p "$WEB_DEST/lib" "$WEB_DEST/data"
    cp "$REPO_DIR/index.ts" "$REPO_DIR/package.json" "$REPO_DIR/tsconfig.json" \
        "$REPO_DIR/eslint.config.js" "$REPO_DIR/env.d.ts" "$WEB_DEST/"
    cp -R "$REPO_DIR/lib/." "$WEB_DEST/lib/"
    cp -R "$REPO_DIR/data/." "$WEB_DEST/data/"
    echo "Installed web plugin: api/web/plugins/$INSTALL_DIR_NAME"
fi

echo

if [ "$DO_BUILD" -eq 0 ]; then
    echo "Skipped rebuild (--no-build). To apply, run in $CT_DIR:"
    echo "  docker compose build --no-cache api && docker compose up -d --force-recreate api"
    exit 0
fi

echo "Rebuilding CloudTAK API image — this takes 5–15 minutes..."
( cd "$CT_DIR" && docker compose build --no-cache api )
echo "Restarting CloudTAK API container..."
( cd "$CT_DIR" && docker compose up -d --force-recreate api )

echo
if [ "$ACTION" = "remove" ]; then
    echo "Plugin removed."
else
    echo "Plugin installed."
    echo "  → In CloudTAK: Settings → Refresh App to activate the new service worker."
    echo "    (Cmd+Shift+R does NOT work — the service worker intercepts requests.)"
    echo "    Or close all CloudTAK tabs and reopen. The plugin appears at the"
    echo "    bottom of the right-side menu."
fi
