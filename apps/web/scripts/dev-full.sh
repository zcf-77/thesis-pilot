#!/usr/bin/env bash
# 开发期自检：整页截图并按 1700px 切片。用法：scripts/dev-full.sh /domain zhumo
set -euo pipefail
export PATH=/opt/node26/bin:$PATH
cd "$(dirname "$0")/.."
route="${1:-/}"; theme="${2:-zhumo}"
name=$(echo "$route" | tr -d '/'); name="${name:-home}"
mkdir -p /tmp/shots
node scripts/shot.ts --route "$route" --theme "$theme" --full --height 1000 --out "/tmp/shots/$name-$theme-full.png" "${@:3}"
python3 - "$name" "$theme" <<'PY'
import sys
from PIL import Image
name, theme = sys.argv[1], sys.argv[2]
im = Image.open(f"/tmp/shots/{name}-{theme}-full.png").convert("RGB")
w, h = im.size
step = 1700
n = 0
for y in range(0, h, step):
    part = im.crop((0, y, w, min(y + step, h)))
    part.save(f"/tmp/shots/{name}-{theme}-{n:02d}.jpg", quality=70)
    n += 1
print("parts", n, "size", w, h)
PY
