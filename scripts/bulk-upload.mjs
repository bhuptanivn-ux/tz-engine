#!/usr/bin/env node
// Run this ON YOUR LAPTOP to push your existing local data folder into Vercel Blob storage
// so the deployed web app can serve it. It mirrors your existing folder layout:
//   <dataRoot>/<Segment>/<Timeframe>/<Instrument>.csv
//
// Usage:
//   1. In this project folder, run:  npm install
//   2. Copy your BLOB_READ_WRITE_TOKEN into .env.local (see .env.local.example),
//      or set it as an environment variable before running.
//   3. node scripts/bulk-upload.mjs "C:\path\to\Data"
//      (or just `node scripts/bulk-upload.mjs` if your folder is named "Data" next to this script)

import fs from "node:fs";
import path from "node:path";
import { put } from "@vercel/blob";

const SEGMENTS = [
  { slug: "nse", folderName: "NSE" },
  { slug: "commodity", folderName: "Commodities" },
  { slug: "crypto", folderName: "CRYPTO" },
  { slug: "forex", folderName: "FOREX" },
  { slug: "indexes", folderName: "INDEXES" },
  { slug: "international-indexes", folderName: "INTERNATIONAL INDEXES" },
  { slug: "sme", folderName: "SME" },
];

const TIMEFRAMES = [
  { slug: "daily", folderName: "DAILY" },
  { slug: "weekly", folderName: "WEEKLY" },
  { slug: "monthly", folderName: "MONTHLY" },
  { slug: "yearly", folderName: "YEARLY" },
];

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

function findFolderCaseInsensitive(parent, name) {
  if (!fs.existsSync(parent)) return null;
  const exact = path.join(parent, name);
  if (fs.existsSync(exact)) return exact;
  const entries = fs.readdirSync(parent, { withFileTypes: true });
  const match = entries.find(
    (e) => e.isDirectory() && e.name.toLowerCase() === name.toLowerCase()
  );
  return match ? path.join(parent, match.name) : null;
}

async function main() {
  loadEnvLocal();
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.error(
      "BLOB_READ_WRITE_TOKEN is not set. Add it to .env.local (see .env.local.example) or set it as an environment variable."
    );
    process.exit(1);
  }

  const dataRoot = path.resolve(process.argv[2] || "./Data");
  if (!fs.existsSync(dataRoot)) {
    console.error(`Data folder not found: ${dataRoot}`);
    process.exit(1);
  }

  console.log(`Scanning ${dataRoot} ...\n`);

  let total = 0;
  let ok = 0;
  let failed = 0;
  const jobs = [];

  for (const segment of SEGMENTS) {
    const segDir = findFolderCaseInsensitive(dataRoot, segment.folderName);
    if (!segDir) continue;

    for (const timeframe of TIMEFRAMES) {
      const tfDir = findFolderCaseInsensitive(segDir, timeframe.folderName);
      if (!tfDir) continue;

      const files = fs.readdirSync(tfDir).filter((f) => f.toLowerCase().endsWith(".csv"));
      for (const file of files) {
        const instrument = file.replace(/\.csv$/i, "");
        const fullPath = path.join(tfDir, file);
        const blobPath = `data/${segment.slug}/${timeframe.slug}/${instrument}.csv`;
        jobs.push({ fullPath, blobPath, label: `${segment.folderName}/${timeframe.folderName}/${file}` });
      }
    }
  }

  total = jobs.length;
  if (total === 0) {
    console.log(
      "No CSV files found. Check that your folder structure matches: Data/<Segment>/<Timeframe>/<Instrument>.csv"
    );
    return;
  }

  console.log(`Found ${total} files. Uploading...\n`);

  const CONCURRENCY = 5;
  let cursor = 0;

  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      try {
        const content = fs.readFileSync(job.fullPath);
        await put(job.blobPath, content, {
          access: "public",
          contentType: "text/csv",
          addRandomSuffix: false,
          token,
        });
        ok++;
        console.log(`[${ok + failed}/${total}] OK    ${job.label}`);
      } catch (err) {
        failed++;
        console.log(`[${ok + failed}/${total}] FAIL  ${job.label} -- ${err.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`\nDone. ${ok} uploaded, ${failed} failed, out of ${total}.`);
}

main();
