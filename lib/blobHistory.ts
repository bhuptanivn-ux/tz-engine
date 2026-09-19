// Reads OHLC history for symbols already bulk-uploaded to Vercel Blob
// storage (see the separate "Market Data Vault" tool and its
// scripts/bulk-upload.mjs, which populate data/<segment>/<timeframe>/<TICKER>.csv).
// Checked first by lib/marketData.ts for symbols we have -- it's faster and
// doesn't depend on Yahoo Finance's undocumented, rate-limited endpoints.

import { list } from "@vercel/blob";
import type { HistoryRow, Interval } from "./yahoo";

// Only NSE is wired up for now -- the other uploaded segments (Commodity,
// Crypto, Forex, Indexes, International Indexes, SME) use different Yahoo
// suffix conventions (or none) that this app doesn't request symbols under
// yet. Extend this map if/when those become relevant here.
const SEGMENT_FOR_SUFFIX: Record<string, string> = {
  NS: "nse",
};

const TIMEFRAME_SLUG: Record<Interval, string> = {
  "1d": "daily",
  "1wk": "weekly",
  "1mo": "monthly",
};

export function blobLocationForSymbol(
  symbol: string
): { segment: string; ticker: string } | null {
  const idx = symbol.lastIndexOf(".");
  if (idx === -1) return null;
  const suffix = symbol.slice(idx + 1).toUpperCase();
  const segment = SEGMENT_FOR_SUFFIX[suffix];
  if (!segment) return null;
  const ticker = symbol.slice(0, idx).toUpperCase();
  if (!ticker) return null;
  return { segment, ticker };
}

async function findBlobUrl(pathname: string): Promise<string> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not set in this environment.");
  }
  const { blobs } = await list({ prefix: pathname, token, limit: 10 });
  const match = blobs.find((b) => b.pathname === pathname);
  if (!match) {
    const nearby = blobs.map((b) => b.pathname).join(", ");
    throw new Error(
      `No blob at path "${pathname}" (token present, list() returned ${blobs.length} result(s)` +
        (nearby ? `: ${nearby}` : "") +
        ").",
    );
  }
  return match.url;
}

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

function findColumn(header: string[], aliases: string[]): number {
  const lower = header.map((h) => h.toLowerCase().trim());
  for (const alias of aliases) {
    const idx = lower.indexOf(alias);
    if (idx !== -1) return idx;
  }
  return -1;
}

function toIsoDate(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const dmy = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) {
    const day = dmy[1].padStart(2, "0");
    const month = dmy[2].padStart(2, "0");
    return `${dmy[3]}-${month}-${day}`;
  }
  return null;
}

function parseCsvToHistory(text: string): HistoryRow[] {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const rows = lines.map(splitCsvLine);
  const header = rows[0];
  const dateIdx = findColumn(header, ["date", "time", "datetime"]);
  const openIdx = findColumn(header, ["open"]);
  const highIdx = findColumn(header, ["high"]);
  const lowIdx = findColumn(header, ["low"]);
  const closeIdx = findColumn(header, ["close", "adj close", "adjclose"]);

  if (dateIdx === -1 || openIdx === -1 || highIdx === -1 || lowIdx === -1 || closeIdx === -1) {
    return [];
  }

  const out: HistoryRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const date = toIsoDate(row[dateIdx] ?? "");
    if (!date) continue;
    const open = Number(row[openIdx]);
    const high = Number(row[highIdx]);
    const low = Number(row[lowIdx]);
    const close = Number(row[closeIdx]);
    out.push({
      date,
      open: Number.isNaN(open) ? null : open,
      high: Number.isNaN(high) ? null : high,
      low: Number.isNaN(low) ? null : low,
      close: Number.isNaN(close) ? null : close,
    });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/**
 * Returns history for `symbol` from Blob storage if we have it there, or
 * `null` only for the one expected non-error case: the symbol's suffix
 * isn't mapped to a Blob segment (e.g. not ".NS"). Every other failure
 * (missing token, path not found, empty/unreadable file) throws with a
 * specific message so the caller (lib/marketData.ts) can surface exactly
 * why Blob was skipped, instead of a generic "no data" message.
 */
export async function fetchHistoryFromBlob(
  symbol: string,
  start: string,
  end: string,
  interval: Interval
): Promise<HistoryRow[] | null> {
  const location = blobLocationForSymbol(symbol);
  if (!location) return null;

  const timeframe = TIMEFRAME_SLUG[interval];
  const pathname = `data/${location.segment}/${timeframe}/${location.ticker}.csv`;

  const url = await findBlobUrl(pathname);

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Blob file fetch failed with status ${res.status} for "${pathname}".`);
  }

  const text = await res.text();
  const rows = parseCsvToHistory(text);
  if (rows.length === 0) {
    throw new Error(`Blob file "${pathname}" had no parseable OHLC rows (length ${text.length}).`);
  }

  return rows.filter((r) => r.date >= start && r.date <= end);
}
