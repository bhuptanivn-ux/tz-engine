// Builds the merged WTF/DTF events table (PRIME TREND + BAR THEORY,
// bare event names only, no letters) for one stock from its daily and
// weekly OHLC CSVs. Permanent, repo-saved version of the ad-hoc script
// used to answer "share the events" requests -- lives here instead of
// a scratchpad precisely so it is not rebuilt (and re-broken) from
// scratch every time. Any future fix to this file is a real commit,
// same as a fix to lib/primeTrend.ts or lib/tarTbar.ts.
//
// Usage: npx tsx scripts/eventsTable.ts <dailyCsv> <weeklyCsv> [outTsv]
// CSV columns expected: Date,Open,High,Low,Close[,Volume] -- Date in
// ISO (YYYY-MM-DD) format, header row required.

import fs from "fs";
import path from "path";
import { computeTarTbar } from "../lib/tarTbar";
import {
  runWtfTrace,
  computePrimeTrend,
  computePrimeTrendCheckpoints,
  computeStage1Checkpoints,
  type OhlcRow,
} from "../lib/primeTrend";
import type { Day } from "../lib/tzEngineWtf";

function loadCsv(csvPath: string): OhlcRow[] {
  const text = fs.readFileSync(csvPath, "utf8").trim();
  const lines = text.split("\n");
  const rows: OhlcRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const [date, o, h, l, c] = lines[i].split(",");
    if (!date) continue;
    rows.push({ date, o: parseFloat(o), h: parseFloat(h), l: parseFloat(l), c: parseFloat(c) });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows;
}

function isNoise(base: string): boolean {
  return base.endsWith("HH") || base.endsWith("LL");
}

function letterOf(ev: string): string {
  const paren = ev.indexOf("(");
  if (paren < 0) return "";
  const inside = ev.slice(paren + 1, ev.indexOf(")", paren));
  return inside.split(".")[0];
}

function baseLabel(ev: string): string {
  const paren = ev.indexOf("(");
  return paren >= 0 ? ev.slice(0, paren) : ev;
}

// Per the user's own rule: letters/naming never matter, only the real
// event itself. Strip every letter/theory annotation down to the bare
// event name (and fold "DTF X" down to plain "X" -- same underlying
// event, just PRIME TREND's own exitType naming vs. the checkpoint
// ladder's).
function bareLabel(ev: string): string {
  return ev.split("(")[0].trim().replace(/\bDTF /g, "");
}

function dedupeBare(arr: string[]): string[] {
  return Array.from(new Set(arr.map(bareLabel)));
}

function buildEventsTable(dailyCsv: string, weeklyCsv: string): string[] {
  const dtfRows = loadCsv(dailyCsv);
  const wtfRows = loadCsv(weeklyCsv);
  const wtfDays: Day[] = wtfRows.map((r) => ({ date: r.date, o: r.o, h: r.h, l: r.l, c: r.c }));
  const dtfDays: Day[] = dtfRows.map((r) => ({ date: r.date, o: r.o, h: r.h, l: r.l, c: r.c }));

  console.error(`daily rows: ${dtfRows.length} (${dtfRows[0].date} .. ${dtfRows[dtfRows.length - 1].date})`);
  console.error(`weekly rows: ${wtfRows.length} (${wtfRows[0].date} .. ${wtfRows[wtfRows.length - 1].date})`);

  const wtfEvents = new Map<string, string[]>();
  function addWtf(date: string, label: string) {
    const arr = wtfEvents.get(date);
    if (arr) arr.push(label);
    else wtfEvents.set(date, [label]);
  }
  const dtfEvents = new Map<string, string[]>();
  function addDtf(date: string, label: string) {
    const arr = dtfEvents.get(date);
    if (arr) arr.push(label);
    else dtfEvents.set(date, [label]);
  }

  // --- WTF ledger: race-aware trace (the same one computePrimeTrend
  // itself uses by default), so the WTF-level race mechanism is
  // reflected. ---
  const wtfTrace = runWtfTrace(wtfDays, undefined, undefined, dtfDays);
  for (const entry of wtfTrace) {
    for (const ev of entry.events) {
      const paren = ev.indexOf("(");
      const base = paren >= 0 ? ev.slice(0, paren) : ev;
      if (isNoise(base)) continue;
      addWtf(entry.day.date, ev);
    }
  }

  // --- BAR THEORY / misclassified-letter machinery: computeTarTbar's
  // own fields require these suppressions/substitutions to build a
  // correct WTF ledger -- see the field comments in tarTbar.ts. ---
  const ctt = computeTarTbar(wtfRows, dtfRows);

  for (const [date, evs] of Array.from(wtfEvents.entries())) {
    const kept = evs.filter((ev) => {
      const letter = letterOf(ev);
      if (!letter) return true;
      const misclassified = ctt.misclassifiedLetters.some(
        (m) => m.letter === letter && date >= m.sinceDate && (m.untilDate === null || date < m.untilDate)
      );
      if (misclassified) return false;
      // letterLineageConcludedWindows' own contract: drop this letter's
      // own RED1/RED2/BAR-family text for this stretch, but NEVER REAR
      // -- REAR is the real, legitimate reengagement event this whole
      // mechanism exists to let back through. Confirmed real-data
      // (ICICIBANK.NS, letter C): REAR(C) 2010-04-05 / REAR SL(C)
      // 2010-04-12 must not be dropped here.
      if (!ev.startsWith("REAR")) {
        const concluded = ctt.letterLineageConcludedWindows.some(
          (c) => c.letter === letter && date >= c.sinceDate && (c.untilDate === null || date < c.untilDate)
        );
        if (concluded) return false;
      }
      if (ev.startsWith("REAR")) {
        const invalidRear = ctt.invalidRearWindows.some(
          (iv) => iv.letter === letter && date >= iv.sinceDate && (iv.untilDate === null || date < iv.untilDate)
        );
        if (invalidRear) return false;
      }
      return true;
    });
    if (kept.length === 0) wtfEvents.delete(date);
    else wtfEvents.set(date, kept);
  }

  // Only fill a date with a RECONSTRUCTED (backend-shadow) event when
  // nothing real already happened that date for the same step -- these
  // fields exist to fill genuine gaps (no live branch covers that
  // letter any more), not to re-announce something a real, live branch
  // (any letter) already shows for that date.
  function alreadyRealFor(date: string, label: string): boolean {
    const existing = wtfEvents.get(date);
    if (!existing) return false;
    return existing.some((ev) => baseLabel(ev) === label);
  }
  for (const { date, label } of ctt.hiddenPassthroughEvents) {
    if (alreadyRealFor(date, baseLabel(label))) continue;
    addWtf(date, label);
  }
  for (const { letter, date, label } of ctt.letterLineageConcludedSimEvents) {
    if (alreadyRealFor(date, label)) continue;
    addWtf(date, `${label}(${letter})`);
  }

  // --- DTF ledger ---

  // PRIME TREND (BAR/BAR ENTRY ladder, WTF-anchored, Stage 2)
  const ptResults = computePrimeTrend(wtfRows, dtfRows);
  for (const r of ptResults) {
    // Skip "INVALID SAR ENTRY" rows here -- the RED2-anchored checkpoint
    // ladder below (computePrimeTrendCheckpoints) already covers this
    // entire sub-cycle (INVALID SAR/INVALID SAR ENTRY/its SL/its
    // REACTIVATED/SAR 2) with more precise, consistent names; this
    // row's own generic entry/exit naming just duplicates it.
    if (r.side === "INVALID SAR ENTRY") continue;
    addDtf(r.entryDate, `${r.side} (PRIME TREND, ${r.letter})`);
    if (r.exitType !== "still open") addDtf(r.exitDate, `${r.exitType} (PRIME TREND, ${r.letter})`);
  }

  // RED2-anchored SAR family (SAR/INVALID SAR/.../SAR 2)
  const ptCheckpoints = computePrimeTrendCheckpoints(wtfRows, dtfRows);
  for (const { letter, checkpoints } of ptCheckpoints) {
    for (const cp of checkpoints) {
      if (isNoise(cp.label)) continue;
      addDtf(cp.date, `${cp.label} (RED2, ${letter})`);
    }
  }

  // Stage 1 (DTF TZ BUY / TZ BUY SL)
  const stage1Checkpoints = computeStage1Checkpoints(wtfRows, dtfRows);
  for (const { letter, checkpoints } of stage1Checkpoints) {
    for (const cp of checkpoints) {
      addDtf(cp.date, `${cp.label} (STAGE 1, ${letter})`);
    }
  }

  // BAR THEORY's own TAR/TAR ENTRY ladder + nested BAR1->BAR2 route
  for (const r of ctt.results) {
    if (r.displaySuppressed) continue;
    addDtf(r.entryDate, `${r.side} (BAR THEORY, ${r.wtfLabel})`);
    if (r.exitType !== "still open") addDtf(r.exitDate, `${r.exitType} (BAR THEORY, ${r.wtfLabel})`);
  }
  for (const cp of ctt.barTheoryCheckpoints) {
    // displaySuppressed governs the TAR-vs-BAR-ENTRY route rivalry for
    // ctt.results, not whether the bare formation itself is a real
    // event -- the bare "TAR" formation shows even when the TAR-ENTRY
    // route goes on to be the one with its own entry/exit row (e.g.
    // 2006-07-31 TAR -> 2006-08-08 TAR ENTRY, ICICIBANK letter C).
    addDtf(cp.date, `${cp.label} (BAR THEORY, ${cp.wtfLabel})`);
  }
  for (const cp of ctt.hiddenRed2SarCheckpoints) {
    if (isNoise(cp.label)) continue;
    addDtf(cp.date, `${cp.label} (RED2 ${cp.red2Date}, hidden ${cp.letter})`);
  }

  // --- merge + print ---
  const allDates = new Set<string>([...wtfEvents.keys(), ...dtfEvents.keys()]);
  const sortedDates = Array.from(allDates).sort();

  const out: string[] = [];
  out.push("DATE\tWTF EVENT\tDTF EVENT");
  for (const date of sortedDates) {
    const w = dedupeBare(wtfEvents.get(date) ?? []).join(", ");
    const d = dedupeBare(dtfEvents.get(date) ?? []).join(", ");
    out.push(`${date}\t${w}\t${d}`);
  }
  console.error(`total rows with events: ${sortedDates.length}`);
  return out;
}

function main() {
  const [dailyCsv, weeklyCsv, outTsv] = process.argv.slice(2);
  if (!dailyCsv || !weeklyCsv) {
    console.error("Usage: npx tsx scripts/eventsTable.ts <dailyCsv> <weeklyCsv> [outTsv]");
    process.exit(1);
  }
  const out = buildEventsTable(dailyCsv, weeklyCsv);
  if (outTsv) {
    fs.writeFileSync(outTsv, out.join("\n"));
    console.error(`written to ${path.resolve(outTsv)}`);
  } else {
    console.log(out.join("\n"));
  }
}

main();
