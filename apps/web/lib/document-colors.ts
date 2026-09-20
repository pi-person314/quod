const COLORS = ["#DB935F", "#6CACE4", "#80BD98", "#BC99DD", "#E0B45A", "#E58DA0", "#67C4C3", "#B3BF75"];
/** Stable within a document set, independent of title and current page/order. */
export function documentColor(id: string, documents: readonly { id: string }[]): string {
  const ids = [...new Set(documents.map(doc => doc.id))].sort();
  const first = ids[0] ?? id;
  let hash = 0;
  for (const char of first) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  const index = Math.max(0, ids.indexOf(id));
  if (index >= COLORS.length) return `hsl(${(hash % 360 + index * 137.508) % 360} 50% 68%)`;
  return COLORS[(hash + index) % COLORS.length];
}
