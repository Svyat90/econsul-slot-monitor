#!/usr/bin/env bash
# Validates docs/brainstorm/ideas.md: duplicate IDs, dangling references, next_id,
# draft banner, size. Prints one problem per line; exit 1 if any.
# Usage: validate.sh [path]   (default: docs/brainstorm/ideas.md from the repo root)
set -u

root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
file="${1:-$root/docs/brainstorm/ideas.md}"
archive="$(dirname "$file")/archive.md"
fail=0
problem() { echo "PROBLEM: $*"; fail=1; }

[ -f "$file" ] || { echo "PROBLEM: $file not found"; exit 1; }

# Ignore HTML comments (the template keeps an example entry inside one).
strip() { sed '/<!--/,/-->/d' "$@"; }

grep -q 'НЕ вимоги' "$file" || problem "draft banner missing at the top"

# Defined IDs: only entry headings ("### IDEA-NNN:"), in file and archive.
defined="$( { { strip "$file"; [ -f "$archive" ] && strip "$archive"; } | grep -hoE '^### IDEA-[0-9]+' 2>/dev/null || true; } | sed 's/^### //' )"

dups="$(printf '%s\n' "$defined" | sort | uniq -d)"
for id in $dups; do problem "duplicate ID $id"; done

# next_id must exceed every defined ID.
next="$(grep -E '^next_id:' "$file" | head -1 | sed 's/[^0-9]//g')"
if [ -z "$next" ]; then
  problem "next_id missing"
else
  max=0
  for id in $defined; do
    n=$((10#${id#IDEA-}))
    [ "$n" -gt "$max" ] && max=$n
  done
  [ "$next" -gt "$max" ] || problem "next_id ($next) must be greater than the highest ID (IDEA-$max)"
fi

# Dangling references in relation fields and superseded statuses.
refs="$( { strip "$file" | grep -hE '^- (Depends on|Conflicts with|Supersedes):|^- Status: superseded-by' 2>/dev/null || true; } | grep -oE 'IDEA-[0-9]+' | sort -u )"
for id in $refs; do
  printf '%s\n' "$defined" | grep -qx "$id" || problem "reference to unknown $id"
done

# Index rows must point at defined IDs.
idx="$( { strip "$file" | grep -hE '^\| IDEA-[0-9]+' || true; } | grep -oE '^\| IDEA-[0-9]+' | grep -oE 'IDEA-[0-9]+' )"
for id in $idx; do
  printf '%s\n' "$defined" | grep -qx "$id" || problem "Index lists $id but no entry exists"
done

lines="$(wc -l < "$file" | tr -d ' ')"
[ "$lines" -le 200 ] || echo "WARNING: $lines lines (target <= ~200 active); run review mode to archive closed ideas"

[ "$fail" -eq 0 ] && echo "OK: $file"
exit "$fail"
