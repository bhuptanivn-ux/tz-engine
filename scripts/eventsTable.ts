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
  barEntryActiveIntervals,
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
// User's naming rule: there is no separate "REAR RE-ENTER" event. A
// re-activation above the REAR reference high after REAR SL is shown as
// REAR again (REAR RE-ENTER 2 -> REAR 2, REAR RE-ENTER SL -> REAR SL).
// The engine keeps its own internal tier names; only the shown name changes.
function bareLabel(ev: string): string {
  return ev.split("(")[0].trim().replace(/\bDTF /g, "").replace(/\bREAR RE-ENTER\b/g, "REAR");
}

function dedupeBare(arr: string[]): string[] {
  return Array.from(new Set(arr.map(bareLabel)));
}

export function buildEventsTable(dailyCsv: string, weeklyCsv: string, withLetters = false): string[] {
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

  // Per letter, every "TZ GREEN(letter)" spawn date, sorted -- lets a
  // displayed event (which only ever carries a bare letter, never the
  // spawn date) be attributed to the specific spawn instance that owns
  // it, the same way ctt.wtfJuniorTerminations itself is keyed (letter
  // is recycled across decades, so bare letter alone is not identity --
  // see this whole file's own "letters never required" convention).
  const bornDatesByLetter = new Map<string, string[]>();
  for (const entry of wtfTrace) {
    for (const ev of entry.events) {
      const m = /^TZ GREEN\(([A-Za-z0-9]+)\)$/.exec(ev);
      if (!m) continue;
      const arr = bornDatesByLetter.get(m[1]) ?? [];
      arr.push(entry.day.date);
      bornDatesByLetter.set(m[1], arr);
    }
  }
  function ownerBornDate(letter: string, date: string): string | null {
    const dates = bornDatesByLetter.get(letter);
    if (!dates) return null;
    let owner: string | null = null;
    for (const d of dates) {
      if (d <= date) owner = d;
      else break;
    }
    return owner;
  }

  // Per the user's own rule: "RED 1 in WTF will not be recorded in the
  // front end, unless PRIME TREND stays active ... Prime trend IS not
  // active whenever BAR ENTRY is not active" -- RED1/INVALID RED1 (the
  // BAR-THEORY branch-level tracker's own first step) only ever
  // displays while that letter's own BAR ENTRY (Stage 2) is currently
  // active; same bornDate-exclusion as runWtfTrace's own `activeAt`
  // (letters recycle, so an interval under this letter from before its
  // own bornDate belongs to an earlier, unrelated branch).
  const barEntryIntervals = barEntryActiveIntervals(wtfRows, dtfRows);
  function primeTrendActive(letter: string, date: string, bornDate: string): boolean {
    const ivs = (barEntryIntervals.get(letter) ?? []).filter((iv) => iv.sinceDate >= bornDate);
    return ivs.some((iv) => date >= iv.sinceDate && (iv.untilDate === null || date < iv.untilDate));
  }

  for (const [date, evs] of Array.from(wtfEvents.entries())) {
    // Per the user's own rules: "RED1-RED2 is used once PRIME TREND is
    // active for BAR THEORY", and one RED per escalation -- a RED shows
    // only when it is the RED that opens the door to a new junior. Before
    // PRIME TREND (BAR ENTRY) activates, a RED1 is therefore hidden: a
    // RED1 candle has the same shape as the engine's own RED candle, so
    // whenever it would open the door the engine's RED already fires (and
    // shows) that same week; otherwise the door is already open (an
    // earlier RED, a DTF SL or a PRIME TREND pause) and no second RED is
    // shown. Confirmed real-data (ICICIBANK.NS): RED1(D) 12/11/2012 after
    // RED(D) 08/10/2012; RED1(E) 27/11/2017 after E's DTF TZ BUY SL
    // 20/11/2017 -- both hidden.
    const relabeled = evs.filter((ev) => {
      if (!ev.startsWith("RED1(")) return true;
      const letter = letterOf(ev);
      if (!letter) return true;
      const bornDate = ownerBornDate(letter, date);
      return bornDate === null || primeTrendActive(letter, date, bornDate);
    });
    const kept = relabeled.filter((ev) => {
      const letter = letterOf(ev);
      if (!letter) return true;
      const misclassified = ctt.misclassifiedLetters.some(
        (m) => m.letter === letter && date >= m.sinceDate && (m.untilDate === null || date < m.untilDate)
      );
      if (misclassified) return false;
      const bornDate = ownerBornDate(letter, date);
      if (bornDate !== null) {
        const terminated = ctt.wtfJuniorTerminations.some(
          (t) => t.letter === letter && t.bornDate === bornDate && date >= t.terminatedAt
        );
        if (terminated) return false;
        // Per the user's own rule: "Without Active PRIME TREND, WTF
        // RED1-RED2-BAR1-BAR2 should not occur ... After TZ BUY DTF,
        // it will either look for TZ BUY SL or RED in DTF FOLLOWED BY
        // BAR -> BAR ENTRY" -- the WHOLE branch-level BAR-THEORY family
        // (not just RED1, which the earlier fix already relabels)
        // stays backend-only until that letter's own PRIME TREND (BAR
        // ENTRY) has genuinely activated; the real race toward BAR
        // ENTRY runs on the DTF side instead.
        const barTheoryFamily =
          ev.startsWith("INVALID RED1(") ||
          ev.startsWith("RED2(") ||
          ev.startsWith("BAR(") ||
          ev.startsWith("BAR 2(") ||
          ev.startsWith("BAR SL(");
        if (barTheoryFamily && !primeTrendActive(letter, date, bornDate)) {
          return false;
        }
      }
      // letterLineageConcludedWindows' own contract: drop this letter's
      // own RED1/RED2/BAR-family text for this stretch, but NEVER REAR
      // -- REAR is the real, legitimate reengagement event this whole
      // mechanism exists to let back through. Confirmed real-data
      // (ICICIBANK.NS, letter C): REAR(C) 2010-04-05 / REAR SL(C)
      // 2010-04-12 must not be dropped here.
      if (!ev.startsWith("REAR") && !ev.startsWith("RED(")) {
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
  // Per the user's own finding: this simulation is an independent,
  // from-scratch rerun with no memory of the concluded letter it's meant
  // to stand in for, so its own internal branches can land on an EXTERNAL
  // letter that is, coincidentally, ALSO a real, currently-live letter
  // with its own real event already displayed that same date (confirmed
  // real-data, ICICIBANK.NS: a "RED1" from this simulation gets mapped to
  // external letter F on 2017-11-27, the SAME date F's own real TZ GREEN
  // SL already displays -- that collision is fabrication, not a gap to
  // fill). Only skip on that specific collision (this external letter
  // already has ITS OWN real event that date) -- NOT on "some other
  // letter already used this bare label", which would also block the
  // mechanism's genuine, still-needed use (letter G has been
  // misclassified, hence silent, since 2022-05-30; this simulation is
  // currently the only display for G's own live, ongoing cycle, under a
  // DIFFERENT external letter that has nothing else real that date).
  function letterAlreadyRealFor(date: string, letter: string): boolean {
    const existing = wtfEvents.get(date);
    if (!existing) return false;
    return existing.some((ev) => letterOf(ev) === letter);
  }
  for (const { letter, date, label } of ctt.letterLineageConcludedSimEvents) {
    if (alreadyRealFor(date, label)) continue;
    if (letterAlreadyRealFor(date, letter)) continue;
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

  // BAR-SL2-anchored SAR family (SAR/.../SAR 2, terminal at SAR 2) --
  // the backend's own single ladder (ctt.barSl2SarCheckpoints), shown only
  // for a BAR SL2 whose own WTF row is itself displayed above (a BAR SL2
  // suppressed from the WTF ledger, e.g. inside a concluded-lineage
  // window, is noise and so is its ladder).
  const shownBarSl2Labels = new Set<string>();
  for (const evs of wtfEvents.values()) {
    for (const ev of evs) {
      const m = /^BAR SL2\(([^)]+)\)$/.exec(ev);
      if (m) shownBarSl2Labels.add(m[1]);
    }
  }
  // Per the user's own rule: when RED2 and BAR SL2 confirm for the same
  // letter on the same day, that SAR/SAR 2 belongs to BAR SL2 -- so a
  // RED2-ladder row identical to a BAR-SL2-ladder row (same letter, date,
  // event) is the same event and is shown once, as BAR SL 2.
  const barSl2RowKeys = new Set<string>();
  for (const c of ctt.barSl2SarCheckpoints) {
    if (!shownBarSl2Labels.has(c.barSl2Label) || isNoise(c.label)) continue;
    addDtf(c.date, `${c.label} (BAR SL 2, ${c.letter})`);
    barSl2RowKeys.add(`${c.letter}|${c.date}|${c.label}`);
  }

  // RED2-anchored SAR family (SAR/INVALID SAR/.../SAR 2)
  const ptCheckpoints = computePrimeTrendCheckpoints(wtfRows, dtfRows);
  for (const { letter, checkpoints } of ptCheckpoints) {
    for (const cp of checkpoints) {
      if (isNoise(cp.label)) continue;
      if (barSl2RowKeys.has(`${letter}|${cp.date}|${cp.label}`)) continue;
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

  // Cross-mechanism precedence: INVALID SAR ENTRY wins over BAR THEORY
  // (TAR/TAR ENTRY/BAR/BAR ENTRY) -- per the user's own rule, already
  // quoted verbatim in tarTbar.ts's own invalidSarEntryActiveWindows
  // comment but never wired to display until now: "once INVALID SAR
  // ENTRY IS CONFIRMED THEN TAR ENTRY CANNOT OCCUR FOR THE BAR that has
  // occurred after the RED 2 for which SAR-INVALID SAR-INVALID SAR
  // ENTRY IS ACTIVE... it is important to record. But at the backend."
  // Confirmed real-data (ICICIBANK.NS, letter C): INVALID SAR
  // 2006-07-25, INVALID SAR ENTRY opens 2006-07-31 (same day TAR
  // forms) -- TAR goes backend, INVALID SAR ENTRY stays front end.
  // Scoped to the SPECIFIC RED2 that governs each BAR-theory window
  // (the latest RED2(letter) dated before that window's own formation),
  // never by letter alone -- a letter can have several sequential RED2
  // cycles, and one cycle's own active INVALID SAR ENTRY must only mute
  // the ONE BAR-theory window that formed after THAT RED2.
  // Keyed by window, not by label alone: a wtfLabel (e.g. "C.3") is
  // recycled across decades, and a later window under the same label
  // must not overwrite an earlier one's governing RED2. Confirmed
  // real-data (ICICIBANK.NS): a 2022 "C.3" window overwrote the 2006
  // C.3 window's RED2, which wrongly lifted 2006's INVALID SAR ENTRY
  // suppression of TAR/TAR ENTRY. A row belongs to the latest window
  // with its label formed on or before the row's date.
  function governingRed2For(wtfLabel: string, date: string): string | null | undefined {
    let found: { formationDate: string; red2Date: string | null } | undefined;
    for (const w of ctt.windowGoverningRed2) {
      if (w.wtfLabel !== wtfLabel || w.formationDate > date) continue;
      if (found === undefined || w.formationDate >= found.formationDate) found = w;
    }
    return found?.red2Date;
  }
  function barTheorySuppressedByInvalidSar(wtfLabel: string, date: string): boolean {
    const red2Date = governingRed2For(wtfLabel, date);
    if (red2Date === null || red2Date === undefined) return false;
    const letter = wtfLabel.split(".")[0];
    return ctt.invalidSarEntryActiveWindows.some(
      (w) => w.letter === letter && w.red2Date === red2Date && date >= w.sinceDate && (w.untilDate === null || date < w.untilDate)
    );
  }

  // BAR THEORY's own TAR/TAR ENTRY ladder + nested BAR1->BAR2 route
  for (const r of ctt.results) {
    if (r.displaySuppressed) continue;
    if (!barTheorySuppressedByInvalidSar(r.wtfLabel, r.entryDate)) addDtf(r.entryDate, `${r.side} (BAR THEORY, ${r.wtfLabel})`);
    if (r.exitType !== "still open" && !barTheorySuppressedByInvalidSar(r.wtfLabel, r.exitDate)) {
      addDtf(r.exitDate, `${r.exitType} (BAR THEORY, ${r.wtfLabel})`);
    }
  }
  for (const cp of ctt.barTheoryCheckpoints) {
    // displaySuppressed governs the TAR-vs-BAR-ENTRY route rivalry for
    // ctt.results, not whether the bare formation itself is a real
    // event -- the bare "TAR" formation shows even when the TAR-ENTRY
    // route goes on to be the one with its own entry/exit row (e.g.
    // 2006-07-31 TAR -> 2006-08-08 TAR ENTRY, ICICIBANK letter C).
    if (barTheorySuppressedByInvalidSar(cp.wtfLabel, cp.date)) continue;
    addDtf(cp.date, `${cp.label} (BAR THEORY, ${cp.wtfLabel})`);
  }
  for (const cp of ctt.hiddenRed2SarCheckpoints) {
    if (isNoise(cp.label)) continue;
    if (barSl2RowKeys.has(`${cp.letter}|${cp.date}|${cp.label}`)) continue;
    addDtf(cp.date, `${cp.label} (RED2 ${cp.red2Date}, hidden ${cp.letter})`);
  }

  // --- merge + print ---
  const allDates = new Set<string>([...wtfEvents.keys(), ...dtfEvents.keys()]);
  const sortedDates = Array.from(allDates).sort();

  const out: string[] = [];
  out.push("DATE\tWTF EVENT\tDTF EVENT");
  const fmt = withLetters ? withLettersBare : dedupeBare;
  for (const date of sortedDates) {
    const w = fmt(wtfEvents.get(date) ?? []).join(", ");
    const d = fmt(dtfEvents.get(date) ?? []).join(", ");
    out.push(`${date}\t${w}\t${d}`);
  }
  console.error(`total rows with events: ${sortedDates.length}`);
  return out;
}

// Same rows and same bare event names as dedupeBare -- only appends the
// cycle letter(s) each event already carried internally. Never adds,
// drops or merges anything dedupeBare wouldn't.
function withLettersBare(arr: string[]): string[] {
  const letters = new Map<string, Set<string>>();
  const anchors = new Map<string, Set<string>>();
  for (const ev of arr) {
    const bare = bareLabel(ev);
    if (!letters.has(bare)) {
      letters.set(bare, new Set());
      anchors.set(bare, new Set());
    }
    const open = ev.lastIndexOf("(");
    const close = ev.lastIndexOf(")");
    if (open < 0 || close < open) continue;
    const inside = ev.slice(open + 1, close);
    if (/\bBAR SL 2\b/.test(inside)) anchors.get(bare)!.add("BAR SL 2");
    else if (/\bRED2\b/.test(inside)) anchors.get(bare)!.add("RED 2");
    const letter = inside.split(",").pop()!.trim().replace(/^hidden\s+/, "");
    if (letter) letters.get(bare)!.add(letter);
  }
  return Array.from(letters.entries()).map(([bare, ls]) => {
    const l = Array.from(ls).join("/");
    const a = Array.from(anchors.get(bare)!).join(" + ");
    if (a) return `${bare} (${a}${l ? `, ${l}` : ""})`;
    return l ? `${bare}(${l})` : bare;
  });
}

function main() {
  const args = process.argv.slice(2);
  const withLetters = args.includes("--letters");
  const [dailyCsv, weeklyCsv, outTsv] = args.filter((a) => a !== "--letters");
  if (!dailyCsv || !weeklyCsv) {
    console.error("Usage: npx tsx scripts/eventsTable.ts <dailyCsv> <weeklyCsv> [outTsv] [--letters]");
    process.exit(1);
  }
  const out = buildEventsTable(dailyCsv, weeklyCsv, withLetters);
  if (outTsv) {
    fs.writeFileSync(outTsv, out.join("\n"));
    console.error(`written to ${path.resolve(outTsv)}`);
  } else {
    console.log(out.join("\n"));
  }
}

if (require.main === module) main();
