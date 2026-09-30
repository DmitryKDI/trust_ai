#!/usr/bin/env bash
# Скачивает планы из bench/sources.txt в bench/plans/<имя>/plan.<ext>.
# Нужен интернет (на ПК — Git Bash). truth.json к новым планам заполняется отдельно (bench/README.md).
set -u
cd "$(dirname "$0")"
grep -v '^#' sources.txt | while read -r name url; do
  [ -z "$name" ] && continue
  ext="${url%%\?*}"; ext="${ext##*.}"; [ "$ext" = "jpeg" ] && ext=jpg
  mkdir -p "plans/$name"
  if ls "plans/$name"/plan.* >/dev/null 2>&1; then echo "есть: $name"; continue; fi
  if curl -sfL -m 30 -A "Mozilla/5.0" -o "plans/$name/plan.$ext" "$url"; then echo "скачан: $name"
  else echo "НЕ скачан: $name ($url)"; rm -f "plans/$name/plan.$ext"; rmdir "plans/$name" 2>/dev/null; fi
done
