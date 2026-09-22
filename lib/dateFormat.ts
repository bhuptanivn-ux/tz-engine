// Display-only date formatting. Every date stays stored/keyed internally as
// ISO "YYYY-MM-DD" (lookups, sort keys, <input type="date"> values, CSV
// exports) -- this only reformats it for on-screen display, to dd/mm/yyyy.
export function formatDDMMYYYY(iso: string): string {
  const match = /^(\d{4})[-/](\d{2})[-/](\d{2})/.exec(iso);
  if (!match) return iso;
  const [, y, m, d] = match;
  return `${d}/${m}/${y}`;
}
