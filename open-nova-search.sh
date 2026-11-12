#!/bin/sh
# Nova Search — opens the single-file app. No install, no npm, no server.
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if command -v xdg-open >/dev/null 2>&1; then xdg-open "$DIR/Nova Search.html"
elif command -v open >/dev/null 2>&1; then open "$DIR/Nova Search.html"
else echo "Open this file in your browser: $DIR/Nova Search.html"; fi
