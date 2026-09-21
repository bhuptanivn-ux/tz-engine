#!/usr/bin/env node
// Run this ON YOUR LAPTOP first, before re-uploading with the new
// consolidated format. Deletes every blob under the "data/" prefix --
// this is what got the store blocked (12,776 individual files vs. a
// ~2,000 object limit on the current plan). Safe to run: the original
// CSVs are untouched in the "cursor/nse-historical-prices-9439" GitHub
// branch, so nothing is lost -- we're only clearing Blob storage so the
// new, consolidated upload (scripts/bulk-upload-consolidated.mjs) has
// room to run.
//
// Usage:
//   node scripts/cleanup-blob.mjs

import fs from "node:fs";
import path from "node:path";
import { list, del } from "@vercel/blob";

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

async function main() {
  loadEnvLocal();
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.error("BLOB_READ_WRITE_TOKEN is not set. Add it to .env.local first.");
    process.exit(1);
  }

  console.log("Listing all blobs under 'data/' ...");
  const urls = [];
  let cursor;
  do {
    const page = await list({ prefix: "data/", token, cursor, limit: 1000 });
    for (const b of page.blobs) urls.push(b.url);
    cursor = page.hasMore ? page.cursor : undefined;
    console.log(`  found ${urls.length} so far...`);
  } while (cursor);

  console.log(`\nTotal to delete: ${urls.length}`);
  if (urls.length === 0) {
    console.log("Nothing to delete.");
    return;
  }

  const BATCH = 100;
  let deleted = 0;
  for (let i = 0; i < urls.length; i += BATCH) {
    const batch = urls.slice(i, i + BATCH);
    await del(batch, { token });
    deleted += batch.length;
    console.log(`Deleted ${deleted}/${urls.length}`);
  }

  console.log("\nDone. Store should now be well under any object-count limit.");
}

main().catch((err) => {
  console.error("Cleanup failed:", err.message || err);
  process.exit(1);
});
