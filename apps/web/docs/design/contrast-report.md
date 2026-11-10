# 对比度契约 · 实测报告

由 `scripts/build-tokens.ts` 按 WCAG 2.x 相对亮度公式计算。半透明令牌按 `contrastAs` 给出的等效不透明色参与计算。

## 朱墨 · Vermilion & Ink

| 组合 | 前景 | 背景 | 实测 | 要求 | 结果 |
|---|---|---|---:|---:|:---:|
| 正文 / 画布 | `text` | `canvas` | 15.01 | 7 | 通过 |
| 正文 / 纸面 | `text` | `surface` | 16.43 | 7 | 通过 |
| 正文 / 凹面 | `text` | `surface-sunken` | 13.92 | 7 | 通过 |
| 次要文字 / 画布 | `text-muted` | `canvas` | 6.10 | 4.5 | 通过 |
| 次要文字 / 纸面 | `text-muted` | `surface` | 6.67 | 4.5 | 通过 |
| 弱文字 / 纸面（仅装饰与占位） | `text-faint` | `surface` | 3.30 | 3 | 通过 |
| 反相文字 / 反相面 | `text-inverse` | `surface-inverse` | 15.57 | 7 | 通过 |
| 主按钮文字 / 主按钮 | `action-content` | `action` | 16.12 | 4.5 | 通过 |
| 主按钮文字 / 悬停 | `action-content` | `action-hover` | 11.40 | 4.5 | 通过 |
| 强调文字 / 纸面 | `accent` | `surface` | 5.41 | 4.5 | 通过 |
| 强调文字 / 画布 | `accent` | `canvas` | 4.94 | 4.5 | 通过 |
| 强调浅底文字 | `accent-soft-content` | `accent-soft` | 6.75 | 4.5 | 通过 |
| 焦点环 / 纸面 | `focus` | `surface` | 6.29 | 3 | 通过 |
| 铅笔线与图标 / 纸面 | `pencil` | `surface` | 5.41 | 3 | 通过 |
| 铅笔文字 / 铅笔浅底 | `pencil-content` | `pencil-soft` | 7.65 | 4.5 | 通过 |
| 铅笔文字 / 纸面 | `pencil-content` | `surface` | 8.75 | 4.5 | 通过 |
| 印章文字 / 印章 | `seal-content` | `seal` | 5.29 | 4.5 | 通过 |
| 空心印章 / 纸面 | `seal` | `surface` | 5.41 | 3 | 通过 |
| 旧稿文字 / 纸面（已降级） | `stale` | `surface` | 3.77 | 3 | 通过 |
| 成功文字 / 浅底 | `success-content` | `success-soft` | 6.65 | 4.5 | 通过 |
| 成功文字 / 纸面 | `success-content` | `surface` | 7.69 | 4.5 | 通过 |
| 注意文字 / 浅底 | `warning-content` | `warning-soft` | 6.27 | 4.5 | 通过 |
| 注意文字 / 纸面 | `warning-content` | `surface` | 7.18 | 4.5 | 通过 |
| 危险文字 / 浅底 | `danger-content` | `danger-soft` | 7.38 | 4.5 | 通过 |
| 危险文字 / 纸面 | `danger-content` | `surface` | 8.97 | 4.5 | 通过 |
| 信息文字 / 浅底 | `info-content` | `info-soft` | 6.94 | 4.5 | 通过 |
| 信息文字 / 纸面 | `info-content` | `surface` | 8.13 | 4.5 | 通过 |
| 中性文字 / 浅底 | `neutral-content` | `neutral-soft` | 7.77 | 4.5 | 通过 |
| 新增文字 / 新增底 | `ins-text` | `ins-bg` | 6.65 | 4.5 | 通过 |
| 删除文字 / 删除底 | `del-text` | `del-bg` | 7.38 | 4.5 | 通过 |

## 荧光笔记 · Highlighter Notes

| 组合 | 前景 | 背景 | 实测 | 要求 | 结果 |
|---|---|---|---:|---:|:---:|
| 正文 / 画布 | `text` | `canvas` | 16.74 | 7 | 通过 |
| 正文 / 纸面 | `text` | `surface` | 18.54 | 7 | 通过 |
| 正文 / 凹面 | `text` | `surface-sunken` | 15.48 | 7 | 通过 |
| 次要文字 / 画布 | `text-muted` | `canvas` | 7.18 | 4.5 | 通过 |
| 次要文字 / 纸面 | `text-muted` | `surface` | 7.96 | 4.5 | 通过 |
| 弱文字 / 纸面（仅装饰与占位） | `text-faint` | `surface` | 3.64 | 3 | 通过 |
| 反相文字 / 反相面 | `text-inverse` | `surface-inverse` | 18.54 | 7 | 通过 |
| 主按钮文字 / 主按钮 | `action-content` | `action` | 14.53 | 4.5 | 通过 |
| 主按钮文字 / 悬停 | `action-content` | `action-hover` | 12.61 | 4.5 | 通过 |
| 强调文字 / 纸面 | `accent` | `surface` | 6.48 | 4.5 | 通过 |
| 强调文字 / 画布 | `accent` | `canvas` | 5.85 | 4.5 | 通过 |
| 强调浅底文字 | `accent-soft-content` | `accent-soft` | 7.72 | 4.5 | 通过 |
| 焦点环 / 纸面 | `focus` | `surface` | 6.48 | 3 | 通过 |
| 铅笔线与图标 / 纸面 | `pencil` | `surface` | 4.40 | 3 | 通过 |
| 铅笔文字 / 铅笔浅底 | `pencil-content` | `pencil-soft` | 7.18 | 4.5 | 通过 |
| 铅笔文字 / 纸面 | `pencil-content` | `surface` | 8.83 | 4.5 | 通过 |
| 印章文字 / 印章 | `seal-content` | `seal` | 6.02 | 4.5 | 通过 |
| 空心印章 / 纸面 | `seal` | `surface` | 3.08 | 3 | 通过 |
| 旧稿文字 / 纸面（已降级） | `stale` | `surface` | 4.24 | 3 | 通过 |
| 成功文字 / 浅底 | `success-content` | `success-soft` | 5.81 | 4.5 | 通过 |
| 成功文字 / 纸面 | `success-content` | `surface` | 6.81 | 4.5 | 通过 |
| 注意文字 / 浅底 | `warning-content` | `warning-soft` | 5.99 | 4.5 | 通过 |
| 注意文字 / 纸面 | `warning-content` | `surface` | 7.34 | 4.5 | 通过 |
| 危险文字 / 浅底 | `danger-content` | `danger-soft` | 6.19 | 4.5 | 通过 |
| 危险文字 / 纸面 | `danger-content` | `surface` | 7.98 | 4.5 | 通过 |
| 信息文字 / 浅底 | `info-content` | `info-soft` | 5.94 | 4.5 | 通过 |
| 信息文字 / 纸面 | `info-content` | `surface` | 7.22 | 4.5 | 通过 |
| 中性文字 / 浅底 | `neutral-content` | `neutral-soft` | 8.77 | 4.5 | 通过 |
| 新增文字 / 新增底 | `ins-text` | `ins-bg` | 5.81 | 4.5 | 通过 |
| 删除文字 / 删除底 | `del-text` | `del-bg` | 6.19 | 4.5 | 通过 |

## 夜航 · Night Flight

| 组合 | 前景 | 背景 | 实测 | 要求 | 结果 |
|---|---|---|---:|---:|:---:|
| 正文 / 画布 | `text` | `canvas` | 16.23 | 7 | 通过 |
| 正文 / 纸面 | `text` | `surface` | 15.17 | 7 | 通过 |
| 正文 / 凹面 | `text` | `surface-sunken` | 16.44 | 7 | 通过 |
| 次要文字 / 画布 | `text-muted` | `canvas` | 7.95 | 4.5 | 通过 |
| 次要文字 / 纸面 | `text-muted` | `surface` | 7.43 | 4.5 | 通过 |
| 弱文字 / 纸面（仅装饰与占位） | `text-faint` | `surface` | 3.78 | 3 | 通过 |
| 反相文字 / 反相面 | `text-inverse` | `surface-inverse` | 16.45 | 7 | 通过 |
| 主按钮文字 / 主按钮 | `action-content` | `action` | 14.70 | 4.5 | 通过 |
| 主按钮文字 / 悬停 | `action-content` | `action-hover` | 16.16 | 4.5 | 通过 |
| 强调文字 / 纸面 | `accent` | `surface` | 14.13 | 4.5 | 通过 |
| 强调文字 / 画布 | `accent` | `canvas` | 15.12 | 4.5 | 通过 |
| 强调浅底文字 | `accent-soft-content` | `accent-soft` | 12.47 | 4.5 | 通过 |
| 焦点环 / 纸面 | `focus` | `surface` | 14.13 | 3 | 通过 |
| 铅笔线与图标 / 纸面 | `pencil` | `surface` | 9.61 | 3 | 通过 |
| 铅笔文字 / 铅笔浅底 | `pencil-content` | `pencil-soft` | 10.47 | 4.5 | 通过 |
| 铅笔文字 / 纸面 | `pencil-content` | `surface` | 11.78 | 4.5 | 通过 |
| 印章文字 / 印章 | `seal-content` | `seal` | 7.46 | 4.5 | 通过 |
| 空心印章 / 纸面 | `seal` | `surface` | 7.07 | 3 | 通过 |
| 旧稿文字 / 纸面（已降级） | `stale` | `surface` | 4.79 | 3 | 通过 |
| 成功文字 / 浅底 | `success-content` | `success-soft` | 10.57 | 4.5 | 通过 |
| 成功文字 / 纸面 | `success-content` | `surface` | 12.62 | 4.5 | 通过 |
| 注意文字 / 浅底 | `warning-content` | `warning-soft` | 10.99 | 4.5 | 通过 |
| 注意文字 / 纸面 | `warning-content` | `surface` | 12.85 | 4.5 | 通过 |
| 危险文字 / 浅底 | `danger-content` | `danger-soft` | 8.56 | 4.5 | 通过 |
| 危险文字 / 纸面 | `danger-content` | `surface` | 9.32 | 4.5 | 通过 |
| 信息文字 / 浅底 | `info-content` | `info-soft` | 9.55 | 4.5 | 通过 |
| 信息文字 / 纸面 | `info-content` | `surface` | 10.55 | 4.5 | 通过 |
| 中性文字 / 浅底 | `neutral-content` | `neutral-soft` | 8.89 | 4.5 | 通过 |
| 新增文字 / 新增底 | `ins-text` | `ins-bg` | 10.57 | 4.5 | 通过 |
| 删除文字 / 删除底 | `del-text` | `del-bg` | 8.56 | 4.5 | 通过 |

## 晨雾 · Morning Mist

| 组合 | 前景 | 背景 | 实测 | 要求 | 结果 |
|---|---|---|---:|---:|:---:|
| 正文 / 画布 | `text` | `canvas` | 14.03 | 7 | 通过 |
| 正文 / 纸面 | `text` | `surface` | 15.19 | 7 | 通过 |
| 正文 / 凹面 | `text` | `surface-sunken` | 12.79 | 7 | 通过 |
| 次要文字 / 画布 | `text-muted` | `canvas` | 5.79 | 4.5 | 通过 |
| 次要文字 / 纸面 | `text-muted` | `surface` | 6.27 | 4.5 | 通过 |
| 弱文字 / 纸面（仅装饰与占位） | `text-faint` | `surface` | 3.34 | 3 | 通过 |
| 反相文字 / 反相面 | `text-inverse` | `surface-inverse` | 14.93 | 7 | 通过 |
| 主按钮文字 / 主按钮 | `action-content` | `action` | 4.85 | 4.5 | 通过 |
| 主按钮文字 / 悬停 | `action-content` | `action-hover` | 6.15 | 4.5 | 通过 |
| 强调文字 / 纸面 | `accent` | `surface` | 5.11 | 4.5 | 通过 |
| 强调文字 / 画布 | `accent` | `canvas` | 4.72 | 4.5 | 通过 |
| 强调浅底文字 | `accent-soft-content` | `accent-soft` | 6.44 | 4.5 | 通过 |
| 焦点环 / 纸面 | `focus` | `surface` | 4.31 | 3 | 通过 |
| 铅笔线与图标 / 纸面 | `pencil` | `surface` | 3.38 | 3 | 通过 |
| 铅笔文字 / 铅笔浅底 | `pencil-content` | `pencil-soft` | 5.53 | 4.5 | 通过 |
| 铅笔文字 / 纸面 | `pencil-content` | `surface` | 6.20 | 4.5 | 通过 |
| 印章文字 / 印章 | `seal-content` | `seal` | 11.54 | 4.5 | 通过 |
| 空心印章 / 纸面 | `seal` | `surface` | 11.04 | 3 | 通过 |
| 旧稿文字 / 纸面（已降级） | `stale` | `surface` | 3.48 | 3 | 通过 |
| 成功文字 / 浅底 | `success-content` | `success-soft` | 6.16 | 4.5 | 通过 |
| 成功文字 / 纸面 | `success-content` | `surface` | 6.77 | 4.5 | 通过 |
| 注意文字 / 浅底 | `warning-content` | `warning-soft` | 5.95 | 4.5 | 通过 |
| 注意文字 / 纸面 | `warning-content` | `surface` | 6.43 | 4.5 | 通过 |
| 危险文字 / 浅底 | `danger-content` | `danger-soft` | 6.42 | 4.5 | 通过 |
| 危险文字 / 纸面 | `danger-content` | `surface` | 7.46 | 4.5 | 通过 |
| 信息文字 / 浅底 | `info-content` | `info-soft` | 6.30 | 4.5 | 通过 |
| 信息文字 / 纸面 | `info-content` | `surface` | 7.13 | 4.5 | 通过 |
| 中性文字 / 浅底 | `neutral-content` | `neutral-soft` | 7.61 | 4.5 | 通过 |
| 新增文字 / 新增底 | `ins-text` | `ins-bg` | 6.16 | 4.5 | 通过 |
| 删除文字 / 删除底 | `del-text` | `del-bg` | 6.42 | 4.5 | 通过 |

全部 120 组通过。
