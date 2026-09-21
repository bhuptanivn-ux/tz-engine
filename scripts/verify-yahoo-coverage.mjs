#!/usr/bin/env node
// One-off diagnostic: checks whether Yahoo Finance actually has data for
// every ticker already uploaded to Blob storage, across every segment
// (NSE, SME, Commodities, Crypto, Forex, Indexes, International Indexes).
// Doesn't change anything in Blob storage -- read-only, just reports.
//
// "Exists on Yahoo" here means: a chart request for that symbol over the
// last 3 months returns at least one real (non-null) daily bar. A longer
// window than the daily refresh's own 10-day lookback, specifically so an
// illiquid stock that simply hasn't traded in the last week or two isn't
// mistaken for "not on Yahoo at all."
//
// Usage:
//   node scripts/verify-yahoo-coverage.mjs

import fs from "node:fs";
import path from "node:path";
import { yahooSymbolForOtherMarket } from "./otherMarketsYahooMap.mjs";

const CHUNK_PLAN = {
  nse: { daily: 20 },
  sme: { daily: 1 },
  commodity: { daily: 1 },
  crypto: { daily: 1 },
  forex: { daily: 1 },
  indexes: { daily: 1 },
  "international-indexes": { daily: 1 },
};

const CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const CONCURRENCY = 8;

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
  if (!res.ok) throw new Error(`Failed to download ${pathname}: status ${res.status}`);
  return res.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function existsOnYahoo(symbol, maxAttempts = 3) {
  const url = new URL(`${CHART_BASE}/${encodeURIComponent(symbol)}`);
  url.searchParams.set("range", "3mo");
  url.searchParams.set("interval", "1d");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await fetch(url.toString(), {
        headers: { "User-Agent": "Mozilla/5.0" },
        cache: "no-store",
      });
    } catch {
      if (attempt === maxAttempts) return { ok: false, reason: "network error" };
      await sleep(2000 * attempt);
      continue;
    }
    if (res.status === 404) return { ok: false, reason: "404 not found" };
    if (res.status === 429 || res.status >= 500) {
      if (attempt === maxAttempts) return { ok: false, reason: `status ${res.status}` };
      await sleep(3000 * attempt);
      continue;
    }
    if (!res.ok) return { ok: false, reason: `status ${res.status}` };

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const chartError = data?.chart?.error;
    if (chartError) return { ok: false, reason: chartError.description || "chart error" };
    if (!result) return { ok: false, reason: "no result" };

    const closes = result.indicators?.quote?.[0]?.close || [];
    const hasRealBar = closes.some((c) => typeof c === "number" && !Number.isNaN(c));
    return hasRealBar
      ? { ok: true }
      : { ok: false, reason: "no non-null bars in last 3mo" };
  }
  return { ok: false, reason: "unknown" };
}

function yahooSymbolFor(segment, ticker) {
  if (segment === "nse" || segment === "sme") return `${ticker}.NS`;
  return yahooSymbolForOtherMarket(segment, ticker);
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

async function main() {
  loadEnvLocal();
  const storeId = process.env.BLOB_STORE_ID;
  if (!storeId) {
    console.error("BLOB_STORE_ID must be set.");
    process.exit(1);
  }

  const tasks = [];
  let skippedNoMapping = 0;
  for (const [segment, plan] of Object.entries(CHUNK_PLAN)) {
    for (let i = 0; i < plan.daily; i++) {
      const bundle = await downloadBundle(storeId, `data/${segment}/daily/chunk-${i}.json`);
      for (const ticker of Object.keys(bundle)) {
        const yahooSymbol = yahooSymbolFor(segment, ticker);
        if (!yahooSymbol) {
          skippedNoMapping++;
          continue;
        }
        tasks.push({ segment, ticker, yahooSymbol });
      }
    }
  }

  console.log(`Checking ${tasks.length} tickers against Yahoo Finance (${skippedNoMapping} skipped -- no mapping at all)...\n`);

  const bySegment = {};
  const failures = [];
  let done = 0;

  await runPool(tasks, CONCURRENCY, async (task) => {
    const { segment, ticker, yahooSymbol } = task;
    bySegment[segment] ??= { total: 0, ok: 0, failed: 0 };
    bySegment[segment].total++;
    const result = await existsOnYahoo(yahooSymbol);
    if (result.ok) {
      bySegment[segment].ok++;
    } else {
      bySegment[segment].failed++;
      failures.push(`${segment}/${ticker} (tried "${yahooSymbol}"): ${result.reason}`);
    }
    done++;
    if (done % 200 === 0) console.log(`  ...${done}/${tasks.length} checked`);
  });

  console.log("\n=== Summary by segment ===");
  for (const [segment, stats] of Object.entries(bySegment)) {
    console.log(`  ${segment}: ${stats.ok}/${stats.total} found on Yahoo (${stats.failed} missing/failed)`);
  }

  console.log(`\n=== ${failures.length} ticker(s) NOT found on Yahoo Finance ===`);
  for (const f of failures) console.log(`  - ${f}`);

  fs.writeFileSync("yahoo-coverage-failures.txt", failures.join("\n") + "\n");
  console.log(`\nFull failure list also written to yahoo-coverage-failures.txt (uploaded as a workflow artifact).`);
}

main().catch((err) => {
  console.error("Coverage check failed:", err.message || err);
  process.exit(1);
});
