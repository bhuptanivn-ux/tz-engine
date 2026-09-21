#!/usr/bin/env node
// Run this ON YOUR LAPTOP to upload your Data/<Segment>/<Timeframe>/*.csv
// folder tree to Vercel Blob storage in CONSOLIDATED form: instead of one
// blob per instrument (12,776 objects -- what got the store blocked for
// exceeding the plan's object-count limit), this groups instruments into
// a small, fixed number of "chunk" files per segment+timeframe, based on
// measured data size (see CHUNK_PLAN below). Total objects: ~50.
//
// IMPORTANT: run scripts/cleanup-blob.mjs FIRST to clear the old
// per-instrument blobs, then run this script.
//
// Usage:
//   node scripts/bulk-upload-consolidated.mjs "C:\path\to\Data"

import fs from "node:fs";
import path from "node:path";
import { put } from "@vercel/blob";

// Chunk count per segment+timeframe, sized from actual measured data:
// NSE Daily (281MB) and Weekly (61MB) are split into several chunks so
// each file stays a manageable size to fetch/parse (roughly 10-15MB per
// chunk); everything else is small enough as a single file. This exact
// object (segment slug -> timeframe slug -> chunk count) is duplicated in
// lib/blobHistory.ts -- the read side needs the identical plan to know
// how many chunks exist per segment/timeframe. Keep them in sync if this
// changes.
const CHUNK_PLAN = {
  nse: { daily: 20, weekly: 4, monthly: 1, yearly: 1 },
  sme: { daily: 1, weekly: 1, monthly: 1, yearly: 1 },
  commodity: { daily: 1, weekly: 1, monthly: 1, yearly: 1 },
  crypto: { daily: 1, weekly: 1, monthly: 1, yearly: 1 },
  forex: { daily: 1, weekly: 1, monthly: 1, yearly: 1 },
  indexes: { daily: 1, weekly: 1, monthly: 1, yearly: 1 },
  "international-indexes": { daily: 1, weekly: 1, monthly: 1, yearly: 1 },
};

const SEGMENTS = [
  { slug: "nse", folderName: "NSE" },
  { slug: "commodity", folderName: "Commodities" },
  { slug: "crypto", folderName: "CRYPTO" },
  { slug: "forex", folderName: "Forex" },
  { slug: "indexes", folderName: "Indexes" },
  { slug: "international-indexes", folderName: "International Indexes" },
  { slug: "sme", folderName: "SME" },
];

const TIMEFRAMES = [
  { slug: "daily", folderName: "DAILY" },
  { slug: "weekly", folderName: "WEEKLY" },
  { slug: "monthly", folderName: "MONTHLY" },
  { slug: "yearly", folderName: "YEARLY" },
];

// Deterministic ticker -> chunk index, identical to the copy in
// lib/blobHistory.ts. Hash-based (not alphabetical) so it doesn't depend
// on knowing the full ticker list up front -- works the same for every
// segment, including ones without an embedded universe list.
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

function splitCsvLine(line) {
  const out = [];
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

function findColumn(header, aliases) {
  const lower = header.map((h) => h.toLowerCase().trim());
  for (const alias of aliases) {
    const idx = lower.indexOf(alias);
    if (idx !== -1) return idx;
  }
  return -1;
}

// Returns compact [date, open, high, low, close, volume] tuples (not
// objects with repeated key names) to keep the consolidated JSON small.
function parseCsvToTuples(text) {
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
  const volIdx = findColumn(header, ["volume", "vol"]);

  if (dateIdx === -1 || openIdx === -1 || highIdx === -1 || lowIdx === -1 || closeIdx === -1) {
    return [];
  }

  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const date = (row[dateIdx] || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const open = Number(row[openIdx]);
    const high = Number(row[highIdx]);
    const low = Number(row[lowIdx]);
    const close = Number(row[closeIdx]);
    if ([open, high, low, close].some((n) => Number.isNaN(n))) continue;
    const volume = volIdx !== -1 ? Number(row[volIdx]) || 0 : 0;
    out.push([date, open, high, low, close, volume]);
  }
  out.sort((a, b) => a[0].localeCompare(b[0]));
  return out;
}

async function main() {
  loadEnvLocal();
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.error("BLOB_READ_WRITE_TOKEN is not set. Add it to .env.local first.");
    process.exit(1);
  }

  const dataRoot = path.resolve(process.argv[2] || "./data");
  if (!fs.existsSync(dataRoot)) {
    console.error(`Data folder not found: ${dataRoot}`);
    process.exit(1);
  }

  console.log(`Scanning ${dataRoot} ...\n`);

  let totalUploaded = 0;
  let totalInstruments = 0;

  for (const segment of SEGMENTS) {
    const segDir = findFolderCaseInsensitive(dataRoot, segment.folderName);
    if (!segDir) continue;

    for (const timeframe of TIMEFRAMES) {
      const tfDir = findFolderCaseInsensitive(segDir, timeframe.folderName);
      if (!tfDir) continue;

      const files = fs.readdirSync(tfDir).filter((f) => f.toLowerCase().endsWith(".csv"));
      if (files.length === 0) continue;

      const chunkCount = CHUNK_PLAN[segment.slug]?.[timeframe.slug] ?? 1;
      const chunks = Array.from({ length: chunkCount }, () => ({}));

      for (const file of files) {
        const ticker = file.replace(/\.csv$/i, "").toUpperCase();
        const fullPath = path.join(tfDir, file);
        const text = fs.readFileSync(fullPath, "utf8");
        const tuples = parseCsvToTuples(text);
        if (tuples.length === 0) continue;
        const idx = chunkIndexFor(ticker, chunkCount);
        chunks[idx][ticker] = tuples;
        totalInstruments++;
      }

      for (let i = 0; i < chunkCount; i++) {
        const blobPath = `data/${segment.slug}/${timeframe.slug}/chunk-${i}.json`;
        const body = JSON.stringify(chunks[i]);
        const sizeMB = (Buffer.byteLength(body) / 1024 / 1024).toFixed(1);
        await put(blobPath, body, {
          access: "public",
          contentType: "application/json",
          addRandomSuffix: false,
          token,
        });
        totalUploaded++;
        console.log(
          `[${totalUploaded}] OK  ${blobPath}  (${Object.keys(chunks[i]).length} instruments, ${sizeMB} MB)`
        );
      }
    }
  }

  console.log(`\nDone. ${totalUploaded} blob objects uploaded, covering ${totalInstruments} instruments.`);
}

main().catch((err) => {
  console.error("Upload failed:", err.message || err);
  process.exit(1);
});
