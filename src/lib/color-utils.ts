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
