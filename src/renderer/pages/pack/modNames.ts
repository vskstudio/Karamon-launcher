export function modDisplayName(fileName: string): string {
  const base = fileName.replace(/\.jar(\.disabled)?$/i, '');
  const withoutVersion = base.split(/[-_+](?=v?\d)/)[0] ?? base;
  const words = withoutVersion.replace(/[-_]+/g, ' ').trim();
  if (!words) return base;
  return words.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

export function modInitial(fileName: string): string {
  return (fileName.match(/\p{L}|\d/u)?.[0] ?? '?').toUpperCase();
}
