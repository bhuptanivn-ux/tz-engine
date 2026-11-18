// Regression safety net: regenerates the full WTF/DTF events table from the
// checked-in ICICIBANK data and compares it, line for line, against the
// checked-in "golden" snapshot (data/ICICIBANK_golden_events.tsv). The golden
// file captures a state of the engine that was walked through and confirmed
// correct, date by date, against the actual rules (see the project's own
// conversation history for the walkthrough this snapshot was taken from).
//
// This catches REGRESSIONS -- any future change to lib/tzEngineWtf.ts,
// lib/primeTrend.ts, or lib/tarTbar.ts that silently changes a
// previously-confirmed-correct result. It does NOT by itself prove the
// golden file is correct for every single date in ICICIBANK's 24-year
// history -- only the dates actually walked through and confirmed carry
// that weight. A change that is EXPECTED to alter output (a real, intended
// fix) will fail this test too -- that is not a bug in the test, it is the
// test doing its job. When that happens: re-verify the new output is
// correct (the same way every fix in this project has been verified, one
// event at a time against the actual rules), then regenerate the golden
// file (see "Updating the golden file" below) as part of that same commit,
// with the reason recorded in the commit message.
//
// Usage:
//   npx tsx scripts/regressionTest.ts
//
// Updating the golden file after a confirmed, intentional change:
//   npx tsx scripts/eventsTable.ts data/ICICIBANK_daily.csv data/ICICIBANK_weekly.csv data/ICICIBANK_golden_events.tsv

import fs from "fs";
import path from "path";
import { buildEventsTable } from "./eventsTable";

const DAILY_CSV = path.join(__dirname, "..", "data", "ICICIBANK_daily.csv");
const WEEKLY_CSV = path.join(__dirname, "..", "data", "ICICIBANK_weekly.csv");
const GOLDEN_FILE = path.join(__dirname, "..", "data", "ICICIBANK_golden_events.tsv");

function main() {
  if (!fs.existsSync(GOLDEN_FILE)) {
    console.error(`FAIL: golden file not found at ${GOLDEN_FILE}`);
    process.exit(1);
  }
  const golden = fs.readFileSync(GOLDEN_FILE, "utf8").split("\n");
  const current = buildEventsTable(DAILY_CSV, WEEKLY_CSV);

  const diffs: string[] = [];
  const maxLen = Math.max(golden.length, current.length);
  for (let i = 0; i < maxLen; i++) {
    const g = golden[i];
    const c = current[i];
    if (g !== c) {
      diffs.push(`  line ${i + 1}: golden=${JSON.stringify(g ?? "<missing>")}  current=${JSON.stringify(c ?? "<missing>")}`);
    }
  }

  if (diffs.length === 0) {
    console.log(`PASS: ICICIBANK regression test -- ${current.length} rows match the golden file exactly.`);
    process.exit(0);
  }

  console.error(`FAIL: ICICIBANK regression test -- ${diffs.length} line(s) differ from the golden file.`);
  console.error(diffs.slice(0, 40).join("\n"));
  if (diffs.length > 40) console.error(`  ... and ${diffs.length - 40} more`);
  console.error("");
  console.error("If this change is a confirmed, intentional fix (verified against the actual");
  console.error("rules, not just accepted because the test complained), regenerate the golden");
  console.error("file and commit it alongside the fix:");
  console.error("  npx tsx scripts/eventsTable.ts data/ICICIBANK_daily.csv data/ICICIBANK_weekly.csv data/ICICIBANK_golden_events.tsv");
  process.exit(1);
}

main();
