// Display-only date formatting. Every date stays stored/keyed internally as
// ISO "YYYY-MM-DD" (lookups, sort keys, <input type="date"> values, CSV
// exports) -- this only reformats it for on-screen display, to dd/mm/yyyy.
export function formatDDMMYYYY(iso: string): string {
  const match = /^(\d{4})[-/](\d{2})[-/](\d{2})/.exec(iso);
  if (!match) return iso;
  const [, y, m, d] = match;
  return `${d}/${m}/${y}`;
}

// Same dd/mm/yyyy convention for a full timestamp (e.g. "scanned at ..."
// labels) -- Date#toLocaleString() follows the viewer's browser locale
// (often mm/dd/yyyy), which would silently break the sitewide format.
export function formatTimestampDDMMYYYY(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy}, ${hh}:${min}:${ss}`;
}
