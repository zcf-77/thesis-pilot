#!/usr/bin/env bash
# 开发期自检：构建后对一个路由截四套方案。用法：scripts/dev-shots.sh /components [height] [extra shot args...]
set -euo pipefail
export PATH=/opt/node26/bin:$PATH
cd "$(dirname "$0")/.."
route="${1:-/}"; height="${2:-1000}"; shift || true; shift || true
name=$(echo "$route" | tr -d '/' ); name="${name:-home}"
for t in zhumo yingguang yehang chenwu; do
  node scripts/shot.ts --route "$route" --theme "$t" --height "$height" --out "/tmp/shots/$name-$t.jpg" "$@" &
done
wait
