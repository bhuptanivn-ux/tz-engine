#!/usr/bin/env node
// Follow-up to verify-yahoo-coverage.mjs: for every NSE/SME ticker that
// doesn't resolve on Yahoo Finance under its plain ".NS" form, figures out
// WHY, instead of just reporting a bare miss. For each one this checks:
//
//   1. If the ticker contains an underscore, whether a hyphenated variant
//      resolves on Yahoo instead (e.g. "BAJAJ_AUTO" stored, but the real
//      symbol is "BAJAJ-AUTO") -- a naming artifact, not a real gap.
//   2. Whether the ticker is still present on NSE's own LIVE, current
//      equity listing (fetched fresh from NSE's archives, not our
//      possibly-stale uploaded copy) -- distinguishes "still actively
//      traded, Yahoo just doesn't bother indexing this illiquid stock"
//      from "no longer listed at all (renamed/delisted/merged)".
//
// Read-only throughout -- doesn't touch Blob storage or change anything.
//
// Usage:
//   node scripts/investigate-unmatched.mjs

import fs from "node:fs";
import path from "node:path";

const CHUNK_PLAN = {
  nse: { daily: 20 },
  sme: { daily: 1 },
};

const CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const CONCURRENCY = 8;

const NSE_HOMEPAGE = "https://www.nseindia.com/";
const LIVE_LIST_URLS = {
  nse: [
    "https://nsearchives.nseindia.com/content/equity/EQUITY_L.csv",
    "https://archives.nseindia.com/content/equity/EQUITY_L.csv",
  ],
  sme: [
    "https://nsearchives.nseindia.com/content/equity/SME_EQUITY_L.csv",
    "https://archives.nseindia.com/content/equity/SME_EQUITY_L.csv",
  ],
};

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

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
      res = await fetch(url.toString(), { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" });
    } catch {
      if (attempt === maxAttempts) return false;
      await sleep(2000 * attempt);
      continue;
    }
    if (res.status === 404) return false;
    if (res.status === 429 || res.status >= 500) {
      if (attempt === maxAttempts) return false;
      await sleep(3000 * attempt);
      continue;
    }
    if (!res.ok) return false;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (data?.chart?.error || !result) return false;
    const closes = result.indicators?.quote?.[0]?.close || [];
    return closes.some((c) => typeof c === "number" && !Number.isNaN(c));
  }
  return false;
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

async function fetchLiveSymbolSet(segment) {
  let cookie = "";
  try {
    const homeRes = await fetch(NSE_HOMEPAGE, { headers: BROWSER_HEADERS, cache: "no-store" });
    const setCookie =
      typeof homeRes.headers.getSetCookie === "function"
        ? homeRes.headers.getSetCookie()
        : homeRes.headers.get("set-cookie")
        ? [homeRes.headers.get("set-cookie")]
        : [];
    cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  } catch {
    // proceed without cookies; some NSE archive paths don't require them
  }

  for (const url of LIVE_LIST_URLS[segment]) {
    try {
      const res = await fetch(url, {
        headers: { ...BROWSER_HEADERS, Referer: NSE_HOMEPAGE, ...(cookie ? { Cookie: cookie } : {}) },
        cache: "no-store",
      });
      if (!res.ok) continue;
      const text = await res.text();
      if (!text.trim() || text.trim().startsWith("<")) continue;
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      const header = lines[0].split(",").map((h) => h.trim().toUpperCase());
      const symIdx = header.indexOf("SYMBOL");
      if (symIdx === -1) continue;
      const set = new Set();
      for (let i = 1; i < lines.length; i++) {
        const sym = lines[i].split(",")[symIdx]?.trim().toUpperCase();
        if (sym) set.add(sym);
      }
      return { url, set };
    } catch {
      continue;
    }
  }
  return { url: null, set: null };
}

async function main() {
  loadEnvLocal();
  const storeId = process.env.BLOB_STORE_ID;
  if (!storeId) {
    console.error("BLOB_STORE_ID must be set.");
    process.exit(1);
  }

  // Step 1: find current Yahoo failures (same check as verify-yahoo-coverage.mjs).
  const tasks = [];
  for (const [segment, plan] of Object.entries(CHUNK_PLAN)) {
    for (let i = 0; i < plan.daily; i++) {
      const bundle = await downloadBundle(storeId, `data/${segment}/daily/chunk-${i}.json`);
      for (const ticker of Object.keys(bundle)) tasks.push({ segment, ticker });
    }
  }
  console.log(`Re-checking ${tasks.length} NSE + SME tickers against Yahoo...\n`);

  const failures = [];
  let done = 0;
  await runPool(tasks, CONCURRENCY, async (task) => {
    const ok = await existsOnYahoo(`${task.ticker}.NS`);
    if (!ok) failures.push(task);
    done++;
    if (done % 500 === 0) console.log(`  ...${done}/${tasks.length} checked`);
  });
  console.log(`\n${failures.length} still not found under their plain ".NS" form.\n`);

  // Step 2: for failures with an underscore, try the hyphenated variant.
  console.log("Step 2: testing hyphenated variants for tickers with an underscore...");
  const hyphenFixable = [];
  const underscoreFailures = failures.filter((f) => f.ticker.includes("_"));
  await runPool(underscoreFailures, CONCURRENCY, async (task) => {
    const hyphenated = task.ticker.replace(/_/g, "-");
    const ok = await existsOnYahoo(`${hyphenated}.NS`);
    if (ok) hyphenFixable.push({ ...task, hyphenated });
  });
  console.log(`  ${hyphenFixable.length}/${underscoreFailures.length} underscore tickers resolve via a hyphenated variant.\n`);

  // Step 3: cross-reference remaining failures against NSE's LIVE listing.
  console.log("Step 3: fetching NSE's live current equity + SME listings...");
  const hyphenFixedTickers = new Set(hyphenFixable.map((f) => f.ticker));
  const stillUnexplained = failures.filter((f) => !hyphenFixedTickers.has(f.ticker));

  const liveNse = await fetchLiveSymbolSet("nse");
  const liveSme = await fetchLiveSymbolSet("sme");
  console.log(`  Live NSE list: ${liveNse.url ? `fetched (${liveNse.set.size} symbols) from ${liveNse.url}` : "COULD NOT FETCH"}`);
  console.log(`  Live SME list: ${liveSme.url ? `fetched (${liveSme.set.size} symbols) from ${liveSme.url}` : "COULD NOT FETCH"}`);

  const stillActive = [];
  const noLongerListed = [];
  const unknownLiveList = [];
  for (const f of stillUnexplained) {
    const liveSet = f.segment === "nse" ? liveNse.set : liveSme.set;
    if (!liveSet) {
      unknownLiveList.push(f);
      continue;
    }
    if (liveSet.has(f.ticker)) stillActive.push(f);
    else noLongerListed.push(f);
  }

  console.log("\n=== RESULTS ===\n");

  console.log(`(A) Fixable naming mismatch -- hyphenated variant works on Yahoo (${hyphenFixable.length}):`);
  for (const f of hyphenFixable) console.log(`  ${f.segment}/${f.ticker} -> ${f.hyphenated}.NS`);

  console.log(`\n(B) Still actively listed on NSE right now, Yahoo simply doesn't cover it (${stillActive.length}):`);
  console.log(`  ${stillActive.map((f) => `${f.segment}/${f.ticker}`).join(", ")}`);

  console.log(`\n(C) No longer on NSE's live list at all -- likely renamed, delisted, or merged (${noLongerListed.length}):`);
  console.log(`  ${noLongerListed.map((f) => `${f.segment}/${f.ticker}`).join(", ")}`);

  if (unknownLiveList.length > 0) {
    console.log(`\n(D) Could not check against a live list (fetch failed) -- unresolved (${unknownLiveList.length}):`);
    console.log(`  ${unknownLiveList.map((f) => `${f.segment}/${f.ticker}`).join(", ")}`);
  }

  const report = {
    hyphenFixable,
    stillActive: stillActive.map((f) => `${f.segment}/${f.ticker}`),
    noLongerListed: noLongerListed.map((f) => `${f.segment}/${f.ticker}`),
    unknownLiveList: unknownLiveList.map((f) => `${f.segment}/${f.ticker}`),
  };
  fs.writeFileSync("unmatched-investigation.json", JSON.stringify(report, null, 2));
  console.log("\nFull report written to unmatched-investigation.json (uploaded as a workflow artifact).");
}

main().catch((err) => {
  console.error("Investigation failed:", err.message || err);
  process.exit(1);
});
