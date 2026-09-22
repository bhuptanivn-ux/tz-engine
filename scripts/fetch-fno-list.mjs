#!/usr/bin/env node
// One-off diagnostic: fetches NSE's own official F&O (Futures & Options)
// underlying securities list live from NSE's public archives, then
// cross-references it against the NSE tickers already in Blob storage.
// Read-only -- doesn't touch Blob storage or generate any app code yet.
// This is step 1 (confirm we can fetch + parse the real list correctly)
// before step 2 (generate the actual "F&O Stocks" segment in the app).
//
// NSE's site sits behind a WAF that blocks bare scripted requests, so
// this first visits the homepage to pick up the session cookies it sets,
// then reuses them for the actual CSV request -- the same thing a normal
// browser visit does.
//
// Usage:
//   node scripts/fetch-fno-list.mjs

import fs from "node:fs";
import path from "node:path";

const HOMEPAGE_URL = "https://www.nseindia.com/";
const FNO_LIST_URLS = [
  "https://nsearchives.nseindia.com/content/fo/fo_mktlots.csv",
  "https://archives.nseindia.com/content/fo/fo_mktlots.csv",
];

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

function extractCookies(setCookieHeaders) {
  // fetch's Headers only exposes one combined "set-cookie" string in
  // Node's undici unless getSetCookie() is available -- use it when
  // present, fall back to splitting the combined header otherwise.
  if (!setCookieHeaders) return "";
  const pairs = setCookieHeaders.map((c) => c.split(";")[0]);
  return pairs.join("; ");
}

async function fetchWithCookies(url, cookie, extraHeaders = {}) {
  return fetch(url, {
    headers: { ...BROWSER_HEADERS, ...extraHeaders, ...(cookie ? { Cookie: cookie } : {}) },
    cache: "no-store",
  });
}

async function main() {
  loadEnvLocal();
  const storeId = process.env.BLOB_STORE_ID;

  console.log("Step 1: visiting NSE homepage to pick up session cookies...");
  let cookie = "";
  try {
    const homeRes = await fetchWithCookies(HOMEPAGE_URL, "");
    console.log(`  Homepage status: ${homeRes.status}`);
    const setCookie =
      typeof homeRes.headers.getSetCookie === "function"
        ? homeRes.headers.getSetCookie()
        : homeRes.headers.get("set-cookie")
        ? [homeRes.headers.get("set-cookie")]
        : [];
    cookie = extractCookies(setCookie);
    console.log(`  Got ${setCookie.length} cookie(s).`);
  } catch (err) {
    console.log(`  Homepage fetch failed: ${err.message || err}`);
  }

  console.log("\nStep 2: fetching the F&O market-lots CSV...");
  let csvText = null;
  let usedUrl = null;
  for (const url of FNO_LIST_URLS) {
    try {
      const res = await fetchWithCookies(url, cookie, { Referer: HOMEPAGE_URL, Accept: "text/csv,*/*" });
      console.log(`  ${url} -> status ${res.status}`);
      if (res.ok) {
        const text = await res.text();
        if (text.trim().length > 0 && !text.trim().startsWith("<")) {
          csvText = text;
          usedUrl = url;
          break;
        }
        console.log(`  Response doesn't look like CSV (starts with: ${text.slice(0, 80).replace(/\n/g, " ")}...)`);
      }
    } catch (err) {
      console.log(`  ${url} -> failed: ${err.message || err}`);
    }
  }

  if (!csvText) {
    console.error("\nCould not fetch the F&O list from any known NSE URL. Bailing out -- see statuses above.");
    process.exit(1);
  }

  console.log(`\nFetched from: ${usedUrl}`);
  console.log(`Raw size: ${csvText.length} chars, ${csvText.split("\n").length} lines.`);
  console.log("\nFirst 5 lines (to sanity-check the format):");
  for (const line of csvText.split("\n").slice(0, 5)) console.log(`  ${line}`);

  // Parse: column 1 (0-indexed) is the actual ticker ("SYMBOL", e.g.
  // "BANKNIFTY"); column 0 ("UNDERLYING") is just the full display name
  // (e.g. "NIFTY BANK") and isn't a usable ticker. Confirmed from a real
  // fetch's header row: "UNDERLYING ,SYMBOL ,SEP-26 ,...". Includes both
  // equity underlyings and index futures (NIFTY, BANKNIFTY, etc.) in the
  // same column -- we don't try to distinguish them here; that happens
  // naturally in step 2 by only keeping symbols that also exist in our
  // own NSE stock list.
  const lines = csvText.split("\n").map((l) => l.trim()).filter(Boolean);
  const symbols = new Set();
  for (const line of lines) {
    const cols = line.split(",");
    const symbolCol = cols[1]?.replace(/"/g, "").trim().toUpperCase();
    if (!symbolCol) continue;
    if (["SYMBOL", "UNDERLYING"].includes(symbolCol)) continue; // header row
    if (!/^[A-Z0-9&-]+$/.test(symbolCol)) continue; // skip stray/garbage rows
    symbols.add(symbolCol);
  }
  console.log(`\nParsed ${symbols.size} unique symbol(s) from the F&O list.`);
  console.log("Sample:", Array.from(symbols).slice(0, 20).join(", "));

  if (!storeId) {
    console.log("\nBLOB_STORE_ID not set -- skipping cross-reference against uploaded NSE tickers.");
    return;
  }

  console.log("\nStep 3: cross-referencing against NSE tickers already in Blob storage...");
  const ourNseTickers = new Set();
  for (let i = 0; i < 20; i++) {
    const bundle = await downloadBundle(storeId, `data/nse/daily/chunk-${i}.json`);
    for (const ticker of Object.keys(bundle)) ourNseTickers.add(ticker);
  }
  console.log(`  We have ${ourNseTickers.size} NSE tickers uploaded.`);

  const matched = Array.from(symbols).filter((s) => ourNseTickers.has(s));
  const fnoNotInOurs = Array.from(symbols).filter((s) => !ourNseTickers.has(s));

  console.log(`\n${matched.length} F&O symbols matched our uploaded NSE tickers.`);
  console.log(`${fnoNotInOurs.length} F&O symbols did NOT match (likely index futures like NIFTY/BANKNIFTY, or a naming mismatch) -- sample:`);
  console.log("  " + fnoNotInOurs.slice(0, 30).join(", "));

  const sortedMatched = matched.sort();
  fs.writeFileSync("fno-matched-symbols.json", JSON.stringify(sortedMatched, null, 2));
  console.log(`\nWrote ${matched.length} matched symbols to fno-matched-symbols.json (uploaded as a workflow artifact).`);
  console.log(`\n=== Full matched list (${sortedMatched.length}) ===`);
  console.log(sortedMatched.join(","));
}

main().catch((err) => {
  console.error("F&O list fetch failed:", err.message || err);
  process.exit(1);
});
