/** 颜色工具：解析、对比度（WCAG 2.x）、弹簧曲线求解。运行期与构建脚本共用。 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseColor(input: string): Rgba {
  const s = input.trim();
  if (s.startsWith("#")) {
    const h = s.slice(1);
    const full =
      h.length === 3
        ? h
            .split("")
            .map((c) => c + c)
            .join("")
        : h;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
    };
  }
  const m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1]
      .split(/[,/\s]+/)
      .filter(Boolean)
      .map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
  }
  throw new Error("无法解析的颜色：" + input);
}

export function toHex({ r, g, b }: Rgba): string {
  const h = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return ("#" + h(r) + h(g) + h(b)).toUpperCase();
}

/** 将半透明前景叠到不透明背景上 */
export function composite(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(c: Rgba): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

export function contrast(fg: string, bg: string, under = "#FFFFFF"): number {
  const base = parseColor(under);
  const b = composite(parseColor(bg), base);
  const f = composite(parseColor(fg), b);
  const l1 = luminance(f);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export function bestOn(bg: string, dark = "#111114", light = "#FFFFFF"): string {
  return contrast(dark, bg) >= contrast(light, bg) ? dark : light;
}

/**
 * 求解阻尼弹簧并采样为 CSS linear() 曲线。
 * 返回曲线字符串与建议时长（毫秒，位移收敛到 0.1% 内）。
 */
export function springToLinear(spec: { stiffness: number; damping: number; mass: number }, samples = 36) {
  const { stiffness: k, damping: c, mass: m } = spec;
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  const x = (t: number): number => {
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
    }
    return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  };
  let settle = 0;
  for (let t = 0; t < 4; t += 0.001) {
    if (Math.abs(x(t) - 1) > 0.001) settle = t;
  }
  const duration = Math.min(Math.max(settle + 0.02, 0.18), 1.4);
  const points: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const v = i === samples ? 1 : x((duration * i) / samples);
    points.push(String(Math.round(v * 1000) / 1000));
  }
  return { easing: "linear(" + points.join(", ") + ")", ms: Math.round(duration * 1000), zeta: Math.round(zeta * 100) / 100 };
}
