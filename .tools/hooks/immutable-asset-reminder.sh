#!/usr/bin/env bash
# PostToolUse advisory hook: after Edit/Write of an immutable-cached asset
# (svg/css/js/png/jpg/woff2 per _headers), remind about the ?v=N version-query
# rule in CLAUDE.md. Advisory only — always exits 0, prints to stdout.

python3 -c '
import json, sys

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

path = (data.get("tool_input") or {}).get("file_path") or ""
exts = (".svg", ".css", ".js", ".png", ".jpg", ".woff2")
if path.lower().endswith(exts):
    print(
        f"Reminder: {path} is served immutable (max-age=31536000 per _headers). "
        "Bump the ?v=N query in every file that references it — see "
        "\"Immutable caching + version queries\" in CLAUDE.md."
    )
'
exit 0
