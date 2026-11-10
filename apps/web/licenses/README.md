# 第三方字体与图标许可

本目录收录交付包随附的字体与图标许可文本。字体许可标注为 SIL Open Font License 1.1；下列来源信息来自原交付，具体修改与再分发须同时满足附带条款。

## 字体

| 字体 | 用途 | 来源与版本 | 许可 | 许可文本 |
|---|---|---|---|---|
| 思源宋体 / Noto Serif CJK SC | 朱墨的展示字体；稿纸正文 | Debian `fonts-noto-cjk-extra» 1:20230817（字体版本 2.002），子集化 | OFL-1.1 | `fonts/Noto-Serif-CJK-OFL.txt» |
| 得意黑 Smiley Sans | 荧光笔记的展示字体 | github.com/atelier-anchor/smiley-sans v2.0.1，子集化 | OFL-1.1 | `fonts/Smiley-Sans-OFL.txt» |
| 霞鹜文楷 LXGW WenKai | 铅笔批注、便签（全部方案） | github.com/lxgw/LxgwWenKai v1.530（Medium），子集化 | OFL-1.1 | `fonts/LXGW-WenKai-OFL.txt» |
| IBM Plex Sans / Mono | 朱墨、夜航的拉丁与等宽 | `@fontsource-variable/ibm-plex-sans» 5.3.0、`@fontsource/ibm-plex-mono» 5.3.0（latin 子集） | OFL-1.1 | `fonts/ibm-plex-*-LICENSE.txt» |
| Space Grotesk | 荧光笔记的拉丁 | `@fontsource-variable/space-grotesk» 5.3.0 | OFL-1.1 | `fonts/space-grotesk-LICENSE.txt» |
| JetBrains Mono | 等宽；夜航的标签 | `@fontsource-variable/jetbrains-mono» 5.3.0 | OFL-1.1 | `fonts/jetbrains-mono-LICENSE.txt» |
| Outfit | 晨雾的拉丁 | `@fontsource-variable/outfit» 5.3.0 | OFL-1.1 | `fonts/outfit-LICENSE.txt» |
| Chakra Petch | 夜航的展示拉丁 | `@fontsource/chakra-petch» 5.3.0 | OFL-1.1 | `fonts/chakra-petch-LICENSE.txt» |

**关于子集化与保留字体名**

- 三种中文字体由 `scripts/subset-fonts.py» 子集化为 woff2，仅用于网页显示，不作为可安装字体分发。
- 得意黑保留名为 “Smiley” 与 “得意黑”；随包许可未附 Web 子集保留名豁免，本次导入尚未核验产物内部字体名称与额外授权，发布前须补充依据或调整子集名称。不能沿用原交付对其豁免的断言。
- 霞鹜文楷保留名为 “霞鹜” “LXGW” 等，随包许可附有仅为 Web 字体投放而子集化和格式转换的保留名豁免；进一步修改仍须检查适用条件。
- 中文界面正文使用用户系统自带字体，不随项目分发。

## 图标

| 图标 | 来源与版本 | 许可 | 许可文本 |
|---|---|---|---|
| Phosphor Icons | `@phosphor-icons/vue» 2.2.1 | MIT | `icons/phosphor-icons-MIT.txt» |

## 其他运行时依赖

| 包 | 版本 | 许可 |
|---|---|---|
| vue | 3.5.45 | MIT |
| vue-router | 5.4.0 | MIT |
| pinia | 4.1.0 | MIT |
| @vueuse/core | 15.0.0 | MIT |
| @tiptap/vue-3、@tiptap/pm、@tiptap/starter-kit、@tiptap/extension-table | 3.33.1 | MIT |
| marked | 18.2.0 | MIT |
| tailwindcss、@tailwindcss/vite | 4.3.5 | MIT |
| daisyui | 5.7.50 | MIT |

Tiptap 仅使用需求指定的四个开源包，没有使用付费扩展或云服务。

## 未随项目分发

随需求提供的 Muffin Office Server 0.1.1 及其授权文件、镜像**没有**被复制进本仓库，也没有被调用。
