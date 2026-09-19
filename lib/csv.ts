import ExcelJS from "exceljs";

export type OhlcRow = {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

// Minimal RFC4180-ish CSV line splitter (handles quoted fields containing commas).
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function parseCsv(text: string): string[][] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map(splitCsvLine);
}

const COLUMN_ALIASES: Record<string, string[]> = {
  date: ["date", "time", "datetime", "timestamp"],
  open: ["open", "o"],
  high: ["high", "h"],
  low: ["low", "l"],
  close: ["close", "c", "adj close", "adjclose"],
  volume: ["volume", "vol", "v"],
};

function findColumn(header: string[], field: keyof typeof COLUMN_ALIASES): number {
  const aliases = COLUMN_ALIASES[field];
  const lower = header.map((h) => h.toLowerCase().trim());
  for (const alias of aliases) {
    const idx = lower.indexOf(alias);
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseDateValue(raw: string): Date | null {
  const value = raw.trim();
  if (!value) return null;

  // Unix timestamp (seconds or milliseconds)
  if (/^\d{9,13}$/.test(value)) {
    const num = Number(value);
    const ms = value.length > 10 ? num : num * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }

  // ISO-like: YYYY-MM-DD
  let m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }

  // DD/MM/YYYY or DD-MM-YYYY
  m = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    return new Date(Date.UTC(year, month - 1, day));
  }

  const fallback = new Date(value);
  return isNaN(fallback.getTime()) ? null : fallback;
}

// Parses OHLC(V) rows from a CSV file's raw text. Column order/names may vary
// (yfinance-style "Date,Open,High,Low,Close,Volume", TradingView exports, etc.)
export function parseOhlcCsv(text: string): OhlcRow[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const header = rows[0];
  const dateIdx = findColumn(header, "date");
  const openIdx = findColumn(header, "open");
  const highIdx = findColumn(header, "high");
  const lowIdx = findColumn(header, "low");
  const closeIdx = findColumn(header, "close");
  const volumeIdx = findColumn(header, "volume");

  if (dateIdx === -1 || openIdx === -1 || highIdx === -1 || lowIdx === -1 || closeIdx === -1) {
    throw new Error(
      "Could not find Date/Open/High/Low/Close columns in this file. Check the header row."
    );
  }

  const out: OhlcRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length < 4) continue;
    const date = parseDateValue(row[dateIdx]);
    if (!date) continue;
    const open = Number(row[openIdx]);
    const high = Number(row[highIdx]);
    const low = Number(row[lowIdx]);
    const close = Number(row[closeIdx]);
    if ([open, high, low, close].some((n) => Number.isNaN(n))) continue;
    const volume = volumeIdx !== -1 ? Number(row[volumeIdx]) || 0 : 0;
    out.push({ date, open, high, low, close, volume });
  }

  out.sort((a, b) => a.date.getTime() - b.date.getTime());
  return out;
}

function formatDdMmYyyy(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export async function buildWorkbookBuffer(
  rows: OhlcRow[],
  meta: { instrument: string; segment: string; timeframe: string }
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(`${meta.instrument} ${meta.timeframe}`.slice(0, 31));

  const headerFill: ExcelJS.Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F4E79" },
  };
  const headerFont: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" } };
  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: "thin", color: { argb: "FFD9D9D9" } },
    bottom: { style: "thin", color: { argb: "FFD9D9D9" } },
    left: { style: "thin", color: { argb: "FFD9D9D9" } },
    right: { style: "thin", color: { argb: "FFD9D9D9" } },
  };

  sheet.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Open", key: "open", width: 12 },
    { header: "High", key: "high", width: 12 },
    { header: "Low", key: "low", width: 12 },
    { header: "Close", key: "close", width: 12 },
    { header: "Volume", key: "volume", width: 16 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = headerFill;
    cell.font = headerFont;
    cell.alignment = { horizontal: "center" };
    cell.border = thinBorder;
  });

  for (const r of rows) {
    const row = sheet.addRow({
      date: formatDdMmYyyy(r.date),
      open: Number(r.open.toFixed(2)),
      high: Number(r.high.toFixed(2)),
      low: Number(r.low.toFixed(2)),
      close: Number(r.close.toFixed(2)),
      volume: Math.round(r.volume),
    });
    row.getCell("date").alignment = { horizontal: "center" };
    for (const key of ["open", "high", "low", "close"] as const) {
      row.getCell(key).numFmt = "0.00";
      row.getCell(key).alignment = { horizontal: "right" };
    }
    row.getCell("volume").numFmt = "#,##0";
    row.getCell("volume").alignment = { horizontal: "right" };
    row.eachCell((cell) => (cell.border = thinBorder));
  }

  sheet.autoFilter = { from: "A1", to: `F${rows.length + 1}` };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const info = wb.addWorksheet("Info");
  info.columns = [
    { header: "Field", key: "field", width: 20 },
    { header: "Value", key: "value", width: 60 },
  ];
  info.getRow(1).eachCell((cell) => {
    cell.fill = headerFill;
    cell.font = headerFont;
  });
  const first = rows[0];
  const last = rows[rows.length - 1];
  info.addRows([
    { field: "Instrument", value: meta.instrument },
    { field: "Segment", value: meta.segment },
    { field: "Timeframe", value: meta.timeframe },
    { field: "First date in file", value: first ? formatDdMmYyyy(first.date) : "" },
    { field: "Last date in file", value: last ? formatDdMmYyyy(last.date) : "" },
    { field: "Rows", value: rows.length },
    { field: "Source", value: "Uploaded data file (Market Data Vault)" },
  ]);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
