export function hexToRgb(hexColor: string) {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hexColor.trim());
  if (!match) {
    return null;
  }

  const intValue = Number.parseInt(match[1], 16);
  return {
    r: (intValue >> 16) & 255,
    g: (intValue >> 8) & 255,
    b: intValue & 255,
  };
}

export function withAlpha(hexColor: string, alpha: number) {
  const rgb = hexToRgb(hexColor);
  if (!rgb) {
    return `rgba(13, 121, 191, ${alpha})`;
  }
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

export function getContrastTextColor(hexColor: string) {
  const rgb = hexToRgb(hexColor);
  if (!rgb) {
    return "#123047";
  }
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.6 ? "#10263a" : "#ffffff";
}

function relativeLuminance(r: number, g: number, b: number) {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * The soft tinted pill used for Case Status — and Compliance — everywhere: the color at 20%
 * over white as the background, and the SAME color darkened until the text is readable on that
 * tint (WCAG AA, 4.5:1 with a small margin for rounding). Before, text was white/near-black picked from the raw color, so a
 * mid-tone color (green, blue…) came out white-on-pale and nearly invisible.
 * One function so the two columns can never drift apart.
 */
export function softPillStyle(hexColor: string): { backgroundColor: string; color: string } {
  const rgb = hexToRgb(hexColor) ?? { r: 13, g: 121, b: 191 };
  const bg = [rgb.r, rgb.g, rgb.b].map((v) => 255 + (v - 255) * 0.2);
  const bgLum = relativeLuminance(bg[0], bg[1], bg[2]);
  let text = [rgb.r, rgb.g, rgb.b];
  for (let step = 0; step <= 20; step += 1) {
    const k = 1 - step * 0.05; // 1 = the color itself … 0 = black
    text = [rgb.r * k, rgb.g * k, rgb.b * k];
    const textLum = relativeLuminance(text[0], text[1], text[2]);
    if ((bgLum + 0.05) / (textLum + 0.05) >= 4.7) break;
  }
  const hex = text.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  return { backgroundColor: withAlpha(hexColor, 0.2), color: `#${hex}` };
}
