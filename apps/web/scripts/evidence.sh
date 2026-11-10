#!/usr/bin/env bash
# 生成交付用截图与规范 PDF（对 dist/ 运行，先执行 vp build）。
# 产物：docs/design/screens/*.jpg、docs/design/DESIGN-SPEC.pdf
set -euo pipefail
cd "$(dirname "$0")/.."
out=docs/design/screens
rm -rf "$out" && mkdir -p "$out"
export SHOT_QUALITY=86
shot() { node scripts/shot.ts "$@" > /dev/null; }
themes="zhumo yingguang yehang chenwu"

for t in $themes; do
  shot --route / --theme "$t" --height 900 --wait 1600 --out "$out/00-cover-$t.jpg" &
  shot --route /directions --theme zhumo --element "#$t" --wait 900 --hideDock --out "$out/01-direction-$t-write.jpg" &
  wait
  shot --route /directions --theme zhumo --click 'role=radio[name="看今日页"]' --element "#$t" --wait 1800 --hideDock --out "$out/01-direction-$t-today.jpg" &
  shot --route /components --theme "$t" --height 1560 --wait 900 --hideDock --out "$out/04-components-$t.jpg" &
  wait
done

shot --route / --theme zhumo --height 900 --motion reduced --click 'role=button[name=/采纳所选/]' --wait 1200 --out "$out/00-cover-zhumo-adopted.jpg" &
shot --route /grammar --theme zhumo --full --hideDock --out "$out/02-grammar-zhumo.jpg" &
shot --route /tokens --theme zhumo --full --hideDock --out "$out/03-tokens-zhumo.jpg" &
shot --route /domain --theme zhumo --full --hideDock --out "$out/05-domain-zhumo.jpg" &
wait
shot --route /domain --theme yingguang --full --hideDock --out "$out/05-domain-yingguang.jpg" &
shot --route /motion --theme zhumo --full --hideDock --out "$out/06-motion-zhumo.jpg" &
shot --route /layouts --theme zhumo --full --hideDock --out "$out/07-layouts-zhumo.jpg" &
shot --route /motion --theme zhumo --element "#persona" --wait 1500 --hideDock --out "$out/06-motion-four-personas.jpg" &
shot --route /grammar --theme zhumo --element "#matrix" --scale 2 --wait 900 --hideDock --out "$out/02-grammar-materials-x-themes.jpg" &
wait
node scripts/shot.ts --route /spec --theme zhumo --motion reduced --pdf --out docs/design/DESIGN-SPEC.pdf
ls -la "$out" docs/design/DESIGN-SPEC.pdf
