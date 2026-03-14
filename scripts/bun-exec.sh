#!/bin/sh
set -eu

if [ "${BUN_BIN:-}" != "" ]; then
  BUN="$BUN_BIN"
elif command -v bun >/dev/null 2>&1; then
  BUN="$(command -v bun)"
elif [ -x "$HOME/.bun/bin/bun" ]; then
  BUN="$HOME/.bun/bin/bun"
else
  echo "bun executable not found. Install Bun or set BUN_BIN to the Bun binary path." >&2
  exit 127
fi

exec "$BUN" "$@"
