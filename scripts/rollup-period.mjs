#!/usr/bin/env node
// Derives a weekly/monthly/yearly OHLCV bar for the most recently
// COMPLETED period from the (already up to date) daily chunks in Blob
// storage, and writes just that one new bar into the matching
// weekly/monthly/yearly chunk -- never re-fetches or re-derives older
// bars, and never touches the daily data itself.
//
// Deriving from daily (instead of fetching weekly/monthly candles from
// Yahoo directly) keeps every timeframe consistent with the same source
// data, and avoids Yahoo's own period-boundary quirks entirely.
//
// Meant to run once each period actually closes (see
// .github/workflows/refresh-blob-data.yml): Saturday for weekly, the 1st
// of the month for monthly, Jan 1st for yearly -- always AFTER that
// day's daily refresh has already run, so the last trading day's data is
// already in the daily chunks this reads from.
//
// Usage:
//   node scripts/rollup-period.mjs --period weekly|monthly|yearly

import fs from "node:fs";
import path from "node:path";
import { put } from "@vercel/blob";

const CHUNK_PLAN = {
  nse: { daily: 20, weekly: 4, monthly: 1, yearly: 1 },
  sme: { daily: 1, weekly: 1, monthly: 1, yearly: 1 },
  commodity: { daily: 1, weekly: 1, monthly: 1, yearly: 1 },
  crypto: { daily: 1, weekly: 1, monthly: 1, yearly: 1 },
  forex: { daily: 1, weekly: 1, monthly: 1, yearly: 1 },
  indexes: { daily: 1, weekly: 1, monthly: 1, yearly: 1 },
  "international-indexes": { daily: 1, weekly: 1, monthly: 1, yearly: 1 },
};

function chunkIndexFor(ticker, chunkCount) {
  if (chunkCount <= 1) return 0;
  let h = 0;
  for (let i = 0; i < ticker.length; i++) {
    h = (h * 31 + ticker.charCodeAt(i)) >>> 0;
  }
  return h % chunkCount;
}

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key] && value) process.env[key] = value;
  }
}

function blobUrlFor(storeId, pathname) {
  const hostPrefix = storeId.replace(/^store_/, "").toLowerCase();
  return `https://${hostPrefix}.public.blob.vercel-storage.com/${pathname}`;
}

async function downloadBundle(storeId, pathname) {
  const res = await fetch(blobUrlFor(storeId, pathname), { cache: "no-store" });
  if (res.status === 404) return {};
  if (!res.ok) {
    throw new Error(`Failed to download ${pathname}: status ${res.status}`);
  }
  return res.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function putWithRetry(blobPath, body, token, maxAttempts = 6) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await put(blobPath, body, {
        access: "public",
        contentType: "application/json",
        addRandomSuffix: false,
        token,
      });
    } catch (err) {
      const message = err?.message || String(err);
      const isRateLimit = /too many requests/i.test(message);
      if (isRateLimit && attempt < maxAttempts) {
        console.log(`  Rate limited, waiting 65s before retry (attempt ${attempt}/${maxAttempts})...`);
        await sleep(65000);
        continue;
      }
      throw err;
    }
  }
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

// Returns [periodStart, periodEnd, labelDate] (all YYYY-MM-DD) for the
// most recently COMPLETED period as of `now`, labeled by its start date
// (matching the existing weekly/monthly/yearly data's own convention --
// see app/page.tsx's ENGINE_HISTORY_FLOOR comment).
function periodRange(period, now) {
  if (period === "weekly") {
    const dayOfWeek = now.getUTCDay(); // 0 = Sunday
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() - mondayOffset);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return [isoDate(monday), isoDate(sunday), isoDate(monday)];
  }
  if (period === "monthly") {
    const firstOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const lastOfPrevMonth = new Date(firstOfThisMonth);
    lastOfPrevMonth.setUTCDate(0);
    const firstOfPrevMonth = new Date(
      Date.UTC(lastOfPrevMonth.getUTCFullYear(), lastOfPrevMonth.getUTCMonth(), 1)
    );
    return [isoDate(firstOfPrevMonth), isoDate(lastOfPrevMonth), isoDate(firstOfPrevMonth)];
  }
  if (period === "yearly") {
    const prevYear = now.getUTCFullYear() - 1;
    return [`${prevYear}-01-01`, `${prevYear}-12-31`, `${prevYear}-01-01`];
  }
  throw new Error(`Unknown period "${period}"`);
}

function aggregate(rows) {
  // rows: [date, open, high, low, close, volume][], already ascending.
  let high = -Infinity;
  let low = Infinity;
  let volume = 0;
  for (const [, , h, l, , v] of rows) {
    if (h > high) high = h;
    if (l < low) low = l;
    volume += v || 0;
  }
  const open = rows[0][1];
  const close = rows[rows.length - 1][4];
  return [open, high, low, close, volume];
}

async function main() {
  loadEnvLocal();
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const storeId = process.env.BLOB_STORE_ID;
  if (!token || !storeId) {
    console.error("BLOB_READ_WRITE_TOKEN and BLOB_STORE_ID must both be set.");
    process.exit(1);
  }

  const periodArgIdx = process.argv.indexOf("--period");
  const period = periodArgIdx !== -1 ? process.argv[periodArgIdx + 1] : null;
  if (!["weekly", "monthly", "yearly"].includes(period)) {
    console.error('Usage: node scripts/rollup-period.mjs --period weekly|monthly|yearly');
    process.exit(1);
  }

  const [periodStart, periodEnd, labelDate] = periodRange(period, new Date());
  console.log(`Rolling up ${period} bar for ${labelDate} (daily rows ${periodStart}..${periodEnd})\n`);

  let barsWritten = 0;
  let tickersWithNoData = 0;

  for (const [segment, plan] of Object.entries(CHUNK_PLAN)) {
    const dailyChunkCount = plan.daily;
    const periodChunkCount = plan[period];

    // Load every daily chunk for this segment, aggregate each ticker's
    // bar for this period, then bucket by which period-chunk it belongs
    // in (independent of which daily chunk it came from).
    const barsByPeriodChunk = new Map(); // chunkIndex -> { ticker: bar }
    for (let i = 0; i < dailyChunkCount; i++) {
      const bundle = await downloadBundle(storeId, `data/${segment}/daily/chunk-${i}.json`);
      for (const [ticker, rows] of Object.entries(bundle)) {
        const inPeriod = rows.filter((r) => r[0] >= periodStart && r[0] <= periodEnd);
        if (inPeriod.length === 0) {
          tickersWithNoData++;
          continue;
        }
        const [open, high, low, close, volume] = aggregate(inPeriod);
        const chunkIndex = chunkIndexFor(ticker, periodChunkCount);
        if (!barsByPeriodChunk.has(chunkIndex)) barsByPeriodChunk.set(chunkIndex, {});
        barsByPeriodChunk.get(chunkIndex)[ticker] = [labelDate, open, high, low, close, volume];
      }
    }

    for (const [chunkIndex, newBars] of barsByPeriodChunk.entries()) {
      if (Object.keys(newBars).length === 0) continue;
      const pathname = `data/${segment}/${period}/chunk-${chunkIndex}.json`;
      const existing = await downloadBundle(storeId, pathname);
      for (const [ticker, bar] of Object.entries(newBars)) {
        const rows = existing[ticker] || [];
        const sameLabelIdx = rows.findIndex((r) => r[0] === labelDate);
        if (sameLabelIdx !== -1) {
          rows[sameLabelIdx] = bar; // idempotent re-run: replace, don't duplicate
        } else {
          rows.push(bar);
          rows.sort((a, b) => a[0].localeCompare(b[0]));
        }
        existing[ticker] = rows;
        barsWritten++;
      }
      await putWithRetry(pathname, JSON.stringify(existing), token);
      console.log(`  Updated ${pathname} (${Object.keys(newBars).length} tickers)`);
      await sleep(300);
    }
  }

  console.log(`\nDone. ${barsWritten} ${period} bars written for ${labelDate}.`);
}

main().catch((err) => {
  console.error("Period roll-up failed:", err.message || err);
  process.exit(1);
});
