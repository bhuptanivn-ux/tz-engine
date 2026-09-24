#!/usr/bin/env node
// Removes the 7 confirmed stray duplicate NSE tickers (underscore-named,
// e.g. "BAJAJ_AUTO") from Blob storage, across all four timeframes. Each
// one has a correctly-named hyphenated twin already present and working
// (e.g. "BAJAJ-AUTO") -- confirmed via scripts/investigate-unmatched.mjs
// (all 7 resolve on Yahoo under the hyphenated form) and cross-checked
// against lib/screenerUniverse.ts (the app's own NSE reference list,
// generated from NSE's official EQUITY_L.csv). The underscore versions
// are never referenced anywhere in the app -- only the hyphenated ones
// are used for search, the screener, and the F&O Stocks list -- so this
// is pure dead-data cleanup, not a change in app behavior.
//
// Safety: for each pair, this VERIFIES the hyphenated replacement
// actually has real data in Blob storage before removing the
// underscore duplicate. If a replacement can't be confirmed, that one
// pair is skipped (not deleted) and reported, rather than risking a
// silent data loss.
//
// Usage:
//   node scripts/remove-duplicate-nse-tickers.mjs

import fs from "node:fs";
import path from "node:path";
import { put } from "@vercel/blob";

const CHUNK_PLAN = { daily: 20, weekly: 4, monthly: 1, yearly: 1 };

// [duplicate (underscore, to remove), replacement (hyphenated, to keep)]
const DUPLICATE_PAIRS = [
  ["BAJAJ_AUTO", "BAJAJ-AUTO"],
  ["NAM_INDIA", "NAM-INDIA"],
  ["HCL_INSYS", "HCL-INSYS"],
  ["BOSCH_HCIL", "BOSCH-HCIL"],
  ["MCCHRLS_B", "MCCHRLS-B"],
  ["KLBRENG_B", "KLBRENG-B"],
  ["UMIYA_MRO", "UMIYA-MRO"],
];

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
  if (!res.ok) throw new Error(`Failed to download ${pathname}: status ${res.status}`);
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

async function main() {
  loadEnvLocal();
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const storeId = process.env.BLOB_STORE_ID;
  if (!token || !storeId) {
    console.error("BLOB_READ_WRITE_TOKEN and BLOB_STORE_ID must both be set.");
    process.exit(1);
  }

  let removedCount = 0;
  let skippedCount = 0;

  for (const timeframe of Object.keys(CHUNK_PLAN)) {
    const chunkCount = CHUNK_PLAN[timeframe];
    console.log(`\n=== ${timeframe} ===`);

    // Group pairs by which chunk the DUPLICATE lives in, for this timeframe.
    const byChunk = new Map();
    for (const [duplicate, replacement] of DUPLICATE_PAIRS) {
      const chunkIndex = chunkIndexFor(duplicate, chunkCount);
      if (!byChunk.has(chunkIndex)) byChunk.set(chunkIndex, []);
      byChunk.get(chunkIndex).push([duplicate, replacement]);
    }

    for (const [chunkIndex, pairs] of byChunk.entries()) {
      const pathname = `data/nse/${timeframe}/chunk-${chunkIndex}.json`;
      const bundle = await downloadBundle(storeId, pathname);
      let changed = false;

      for (const [duplicate, replacement] of pairs) {
        if (!(duplicate in bundle)) {
          console.log(`  ${duplicate}: not present in ${pathname} (nothing to remove)`);
          continue;
        }

        // Safety check: confirm the replacement has real data somewhere
        // in Blob storage before removing the duplicate. The replacement
        // may live in the SAME chunk (same hash bucket) or a different
        // one -- check both.
        const replacementChunkIndex = chunkIndexFor(replacement, chunkCount);
        let replacementRows;
        if (replacementChunkIndex === chunkIndex) {
          replacementRows = bundle[replacement];
        } else {
          const replacementBundle = await downloadBundle(
            storeId,
            `data/nse/${timeframe}/chunk-${replacementChunkIndex}.json`
          );
          replacementRows = replacementBundle[replacement];
        }

        if (!replacementRows || replacementRows.length === 0) {
          console.log(
            `  SKIPPING ${duplicate}: replacement "${replacement}" not found with data in ${timeframe} -- leaving duplicate in place to avoid data loss`
          );
          skippedCount++;
          continue;
        }

        delete bundle[duplicate];
        changed = true;
        removedCount++;
        console.log(`  Removed ${duplicate} from ${pathname} (replacement "${replacement}" confirmed present)`);
      }

      if (changed) {
        await putWithRetry(pathname, JSON.stringify(bundle), token);
        console.log(`  Re-uploaded ${pathname}`);
        await sleep(300);
      }
    }
  }

  console.log(`\nDone. ${removedCount} duplicate entries removed, ${skippedCount} skipped (replacement not confirmed).`);
}

main().catch((err) => {
  console.error("Cleanup failed:", err.message || err);
  process.exit(1);
});
