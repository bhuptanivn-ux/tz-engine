#!/usr/bin/env node
// Fetches fresh daily OHLCV bars from Yahoo Finance for every ticker
// already present in Blob storage's daily chunks, and appends only the
// rows newer than what's already stored -- existing historical rows are
// NEVER modified or removed, so a bad Yahoo ticker mapping (see
// otherMarketsYahooMap.mjs) can at worst fail to add new rows for that one
// instrument, never corrupt what's already there.
//
// Meant to run on a daily schedule shortly after all relevant markets
// have closed for the day (see .github/workflows/refresh-blob-data.yml).
// Weekly/monthly/yearly bars are NOT fetched from Yahoo at all -- they're
// derived from this same daily data by scripts/rollup-period.mjs, which
// runs on its own schedule once each period actually closes.
//
// Usage:
//   node scripts/refresh-daily.mjs

import fs from "node:fs";
import path from "node:path";
import { put } from "@vercel/blob";
import { fetchRecentDaily } from "./yahooDaily.mjs";
import { yahooSymbolForOtherMarket } from "./otherMarketsYahooMap.mjs";

// Must match lib/blobHistory.ts and bulk-upload-consolidated.mjs exactly.
const CHUNK_PLAN = {
  nse: { daily: 20, weekly: 4, monthly: 1, yearly: 1 },
  sme: { daily: 1, weekly: 1, monthly: 1, yearly: 1 },
  commodity: { daily: 1, weekly: 1, monthly: 1, yearly: 1 },
  crypto: { daily: 1, weekly: 1, monthly: 1, yearly: 1 },
  forex: { daily: 1, weekly: 1, monthly: 1, yearly: 1 },
  indexes: { daily: 1, weekly: 1, monthly: 1, yearly: 1 },
  "international-indexes": { daily: 1, weekly: 1, monthly: 1, yearly: 1 },
};

const CONCURRENCY = 8;
const LOOKBACK_DAYS = 10; // covers weekends/holidays/a missed run or two

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

async function runPool(tasks, limit, worker) {
  let idx = 0;
  async function next() {
    while (idx < tasks.length) {
      const current = idx++;
      await worker(tasks[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, next));
}

function yahooSymbolFor(segment, ticker) {
  if (segment === "nse" || segment === "sme") return `${ticker}.NS`;
  return yahooSymbolForOtherMarket(segment, ticker);
}

async function main() {
  loadEnvLocal();
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const storeId = process.env.BLOB_STORE_ID;
  if (!token || !storeId) {
    console.error("BLOB_READ_WRITE_TOKEN and BLOB_STORE_ID must both be set.");
    process.exit(1);
  }

  // Load every daily chunk for every segment up front, and build the flat
  // list of per-ticker fetch tasks against them.
  const bundles = new Map(); // `${segment}/${chunkIndex}` -> bundle object
  const tasks = []; // { segment, chunkIndex, ticker, yahooSymbol }
  let skippedNoMapping = 0;

  for (const [segment, plan] of Object.entries(CHUNK_PLAN)) {
    const chunkCount = plan.daily;
    for (let i = 0; i < chunkCount; i++) {
      const pathname = `data/${segment}/daily/chunk-${i}.json`;
      const bundle = await downloadBundle(storeId, pathname);
      bundles.set(`${segment}/${i}`, bundle);
      for (const ticker of Object.keys(bundle)) {
        const yahooSymbol = yahooSymbolFor(segment, ticker);
        if (!yahooSymbol) {
          skippedNoMapping++;
          continue;
        }
        tasks.push({ segment, chunkIndex: i, ticker, yahooSymbol });
      }
    }
  }

  console.log(`Loaded ${bundles.size} daily chunks. ${tasks.length} tickers to refresh (${skippedNoMapping} skipped -- no Yahoo mapping).\n`);

  const changedChunks = new Set();
  const failures = [];
  let updated = 0;
  let unchanged = 0;
  let done = 0;

  await runPool(tasks, CONCURRENCY, async (task) => {
    const { segment, chunkIndex, ticker, yahooSymbol } = task;
    const bundleKey = `${segment}/${chunkIndex}`;
    try {
      const fresh = await fetchRecentDaily(yahooSymbol, LOOKBACK_DAYS);
      const bundle = bundles.get(bundleKey);
      const existing = bundle[ticker] || [];
      const lastDate = existing.length > 0 ? existing[existing.length - 1][0] : null;
      const newRows = lastDate ? fresh.filter((r) => r[0] > lastDate) : fresh;
      if (newRows.length > 0) {
        bundle[ticker] = existing.concat(newRows);
        changedChunks.add(bundleKey);
        updated++;
      } else {
        unchanged++;
      }
    } catch (err) {
      failures.push(`${segment}/${ticker} (${yahooSymbol}): ${err instanceof Error ? err.message : "fetch failed"}`);
    } finally {
      done++;
      if (done % 200 === 0) console.log(`  ...${done}/${tasks.length} tickers processed`);
    }
  });

  console.log(`\n${updated} tickers got new rows, ${unchanged} already up to date, ${failures.length} failed.`);

  let uploaded = 0;
  for (const bundleKey of changedChunks) {
    const [segment, chunkIndexStr] = bundleKey.split("/");
    const chunkIndex = Number(chunkIndexStr);
    const pathname = `data/${segment}/daily/chunk-${chunkIndex}.json`;
    const body = JSON.stringify(bundles.get(bundleKey));
    await putWithRetry(pathname, body, token);
    uploaded++;
    console.log(`  Re-uploaded ${pathname}`);
    await sleep(300);
  }

  console.log(`\nDone. ${uploaded} chunk(s) updated.`);
  if (failures.length > 0) {
    console.log(`\nFailures (${failures.length}):`);
    for (const f of failures.slice(0, 50)) console.log(`  - ${f}`);
    if (failures.length > 50) console.log(`  ...and ${failures.length - 50} more`);
  }
}

main().catch((err) => {
  console.error("Daily refresh failed:", err.message || err);
  process.exit(1);
});
