// PRIME TREND 1.2 -- an experimental variant of PRIME TREND
// (lib/primeTrend.ts), NOT part of the shipped theory. Redefines BOTH the
// WTF-side and DTF-side escalation within a WTF TZ BUY 2 (or REAR 2 / REAR
// RE-ENTER 2) window:
//
// WTF side (within the anchor's own window):
//   anchor forms -> a SINGLE RED1 (no RED2 needed) pulls back against the
//   anchor's own reference -> the moment RED1 forms, watch for BAR1 (the
//   same plain day-over-day breakout the base engine's own BAR1 uses) ->
//   BAR1 escalates to BAR ENTRY (same shape BAR2 uses: clear BAR1's own
//   reference high by >=0.20 with the full breakout shape). BAR ENTRY's
//   own SL requires reactivation IN PLACE above BAR ENTRY's own frozen
//   reference high (not a fresh BAR1 reforming with a new generation
//   number, unlike dtf_bar.py's BAR1/BAR2 -- explicitly "reactivation ...
//   above the reference high", not a new lineage). The anchor's own SL (or
//   its parent tier's SL) still requires reactivation above the anchor's
//   own reference high, same standing rule used everywhere else.
//
// DTF side (within the same window, renamed to match PRIME TREND's own
// Stage 1/Stage 2 naming -- DTF TZ BUY / DTF TZ BUY ENTRY, NOT "BAR"/"BAR
// ENTRY"): structurally symmetric to the WTF side above -- a single RED1
// (standard pullback shape, no reference dependency) gates the watch; a
// RED2 afterward (if it happens) is incidental price action, not a
// separate/additional gate. DTF TZ BUY then confirms via the SAME plain
// day-over-day breakout shape dtf_bar.py's own TZ BUY uses (explicitly
// confirmed: same as BAR1/BAR2, "yesterday's high along with the low and
// close conditions") -- NOT gated on clearing the WTF anchor's own
// reference high, unlike the shipped PRIME TREND's Stage 1. DTF TZ BUY
// escalates to DTF TZ BUY ENTRY the same way (clear DTF TZ BUY's own
// reference high by the full breakout shape). DTF TZ BUY ENTRY's own SL
// requires reactivation in place above its own frozen reference high.
//
// Once the WTF side's own BAR ENTRY confirms, DTF-side tracking is
// SUPERSEDED: the WTF BAR ENTRY event/price becomes the authoritative
// entry for this window from that point on, and the DTF tier's own status
// stops being updated or reported as live.
//
// Reuses lib/primeTrend.ts's own WTF-trace/instance machinery (`prepare`)
// to detect each anchor instance's own formation/end -- that part is
// completely unchanged from the shipped theory. Does NOT modify
// computePrimeTrend, computePrimeTrendLive, or any other shipped
// behavior.
//
// SCOPE OF THIS FIRST PASS (NOT yet verified against real data):
//   - A single BAR/BAR ENTRY (WTF) and single TZ BUY/TZ BUY ENTRY (DTF)
//     lineage per anchor window -- no concurrent/racing lineages, no
//     multiple generations (mirrors "reactivation in place", not a fresh
//     lineage reforming).
//   - Same "parent tier's own SL wins over a same-candle child dip"
//     precedence used throughout this codebase is NOT specially
//     re-derived here; the anchor's own SL/RED1/BAR sequencing is
//     evaluated in that order every candle, same structural precedence.
//
// INFERRED (confirmed explicitly only for Tier2's own SL -- flagged for
// review): Tier1's own SL (BAR1's own SL before ever escalating to BAR
// ENTRY, or DTF TZ BUY's own SL before ever escalating to TZ BUY ENTRY)
// is treated the same way -- reactivation in place above Tier1's own
// frozen reference high -- since "in case of SL, the reference high will
// be considered" was stated once, generally, before the confirmed
// question narrowed to Tier2's own SL specifically.
//
// INFERRED: the DTF side starts watching for its own RED1 the day AFTER
// the anchor's own formation date (not after that whole WTF week closes,
// unlike the shipped PRIME TREND's Stage 1 anchor). Not explicitly
// specified either way for this variant.

import { THRESH, EPS, type Day } from "./tzEngineWtf";
import { prepare, type OhlcRow, type PrimeTrendFamily, type WtfInstance } from "./primeTrend";

function bar1Shape(prev: Day, cur: Day): boolean {
  return cur.l >= prev.l && cur.h > prev.h && cur.h - prev.h >= THRESH - EPS && cur.c >= prev.h;
}

function breaksRef(prev: Day, cur: Day, ref: number): boolean {
  return cur.l >= prev.l && cur.h > ref && cur.h - ref >= THRESH - EPS && cur.c >= ref;
}

function isSl(cur: Day, refLow: number): boolean {
  return cur.l <= refLow && refLow - cur.l >= THRESH - EPS && cur.c <= refLow + EPS;
}

function isRed1Shape(prev: Day, cur: Day): boolean {
  return cur.h <= prev.h && cur.l < prev.l && prev.l - cur.l >= THRESH - EPS && cur.c <= prev.l;
}

/** One two-tier (Tier1 -> Tier2) lineage: RED1-gated Tier1 (BAR1 / DTF TZ
 * BUY), escalating to Tier2 (BAR ENTRY / DTF TZ BUY ENTRY), with
 * in-place reactivation above whichever tier most recently failed. */
class Lineage {
  red1Formed = false; // the single RED1 gate has fired -- watch for Tier1
  t1Active = false;
  t1RefHigh = 0;
  t1RefLow = 0;
  t1Since: string | null = null;
  t1EntryPrice: number | null = null;
  t1FrozenRef: number | null = null; // Tier1's own frozen ref_high, for in-place reactivation after its own SL
  t2Active = false;
  t2RefHigh = 0;
  t2RefLow = 0;
  t2Since: string | null = null;
  t2EntryPrice: number | null = null;
  t2FrozenRef: number | null = null; // Tier2's own frozen ref_high, for in-place reactivation after its own SL
  hh1 = 0;
  hh1Date: string | null = null;
  hh2 = 0;
  hh2Date: string | null = null;
}

export interface PrimeTrend12LiveStatus {
  family: PrimeTrendFamily;
  letter: string;
  wtfBarEntryActive: boolean;
  wtfBarEntrySince: string | null;
  wtfBarEntryActivationPrice: number | null;
  wtfBarEntryStopLoss: number | null;
  wtfBarEntryHighestHigh: number | null;
  wtfBarEntryHighestHighDate: string | null;
  // DTF fields are null/false once dtfSuperseded is true.
  dtfSuperseded: boolean;
  dtfTzBuyEntryActive: boolean;
  dtfTzBuyEntrySince: string | null;
  dtfTzBuyEntryActivationPrice: number | null;
  dtfTzBuyEntryStopLoss: number | null;
  dtfTzBuyEntryHighestHigh: number | null;
  dtfTzBuyEntryHighestHighDate: string | null;
}

export interface PrimeTrend12Result {
  family: PrimeTrendFamily;
  letter: string;
  side: "WTF BAR ENTRY" | "DTF TZ BUY ENTRY";
  wtfFormationDate: string;
  entryDate: string;
  entryPrice: number;
  exitType: string;
  exitDate: string;
  exitPrice: number | null;
  highestHigh: number | null;
  highestHighDate: string | null;
}

/** Advances one Lineage by one candle. `prevAnchorRef` seeds the reference
 * used for RED1 detection is NOT needed -- RED1 is a pure prev-day
 * pullback shape with no reference dependency, same as everywhere else in
 * this codebase (dtf_bar.py's own RED1, tzEngineWtf.ts's own RED1). Emits
 * a caller-facing event string for Tier2 formation/reactivation/SL so the
 * historical-rows function can build entry/exit cycles. */
function stepLineage(lin: Lineage, prev: Day, cur: Day): { t2Formed: boolean; t2Closed: { exitType: string; exitPrice: number } | null } {
  let t2Formed = false;
  let t2Closed: { exitType: string; exitPrice: number } | null = null;

  if (!lin.red1Formed) {
    if (isRed1Shape(prev, cur)) lin.red1Formed = true;
    return { t2Formed, t2Closed };
  }

  // Tier1 (BAR1 / DTF TZ BUY)
  if (!lin.t1Active && !lin.t2Active && lin.t1Since === null) {
    if (bar1Shape(prev, cur)) {
      lin.t1Active = true;
      lin.t1RefHigh = cur.h;
      lin.t1RefLow = cur.l;
      lin.t1Since = cur.date;
      lin.t1EntryPrice = cur.h;
      lin.hh1 = cur.h;
      lin.hh1Date = cur.date;
    }
    return { t2Formed, t2Closed };
  }
  if (lin.t1Active && cur.h > lin.hh1) {
    lin.hh1 = cur.h;
    lin.hh1Date = cur.date;
  }

  if (lin.t1Active) {
    // Escalation checked before quiet climb (same ordering fix as
    // dtf_bar.py/dtfBar.ts's own BAR1->BAR2).
    if (breaksRef(prev, cur, lin.t1RefHigh)) {
      lin.t1Active = false;
      lin.t2Active = true;
      lin.t2RefHigh = cur.h;
      lin.t2RefLow = cur.l;
      lin.t2Since = cur.date;
      lin.t2EntryPrice = cur.h;
      lin.hh2 = cur.h;
      lin.hh2Date = cur.date;
      t2Formed = true;
      return { t2Formed, t2Closed };
    }
    const slNow = isSl(cur, lin.t1RefLow);
    if (cur.h > lin.t1RefHigh) lin.t1RefHigh = cur.h;
    if (!slNow && cur.l < lin.t1RefLow) lin.t1RefLow = cur.l;
    if (slNow) {
      lin.t1FrozenRef = lin.t1RefHigh;
      lin.t1Active = false;
    }
    return { t2Formed, t2Closed };
  }

  if (lin.t2Active) {
    if (cur.h > lin.hh2) {
      lin.hh2 = cur.h;
      lin.hh2Date = cur.date;
    }
    const slNow = isSl(cur, lin.t2RefLow);
    if (!slNow && cur.h > lin.t2RefHigh) lin.t2RefHigh = cur.h;
    if (!slNow && cur.l < lin.t2RefLow) lin.t2RefLow = cur.l;
    if (slNow) {
      lin.t2FrozenRef = lin.t2RefHigh;
      lin.t2Active = false;
      t2Closed = { exitType: "SL", exitPrice: cur.l };
    }
    return { t2Formed, t2Closed };
  }

  // Neither tier active -- watch for in-place reactivation above whichever
  // tier most recently failed (Tier2's own frozen ref if it ever formed,
  // else Tier1's own frozen ref).
  const frozenRef = lin.t2FrozenRef !== null ? lin.t2FrozenRef : (lin.t1FrozenRef as number);
  const wasTier2 = lin.t2FrozenRef !== null;
  if (breaksRef(prev, cur, frozenRef)) {
    if (wasTier2) {
      lin.t2Active = true;
      lin.t2RefHigh = cur.h;
      lin.t2RefLow = cur.l;
      lin.hh2 = cur.h;
      lin.hh2Date = cur.date;
      t2Formed = true;
    } else {
      lin.t1Active = true;
      lin.t1RefHigh = cur.h;
      lin.t1RefLow = cur.l;
      lin.hh1 = cur.h;
      lin.hh1Date = cur.date;
    }
  }
  return { t2Formed, t2Closed };
}

function simulateWindow(
  wtfDays: Day[],
  dtfDays: Day[],
  inst: WtfInstance
): { rows: PrimeTrend12Result[]; live: PrimeTrend12LiveStatus | null } {
  const rows: PrimeTrend12Result[] = [];

  // --- WTF side ---
  const wtfLin = new Lineage();
  let wtfStartIdx: number | null = null;
  for (let i = 0; i < wtfDays.length; i++) {
    if (wtfDays[i].date > inst.formationDate) {
      wtfStartIdx = i;
      break;
    }
  }
  let curEntryWtf: [string, number] | null = null;
  let wtfSuperseded = false;
  let wtfSupersededDate: string | null = null;
  if (wtfStartIdx !== null) {
    for (let i = wtfStartIdx; i < wtfDays.length && wtfDays[i].date <= inst.endDate; i++) {
      const prev = wtfDays[i - 1];
      const cur = wtfDays[i];
      const { t2Formed, t2Closed } = stepLineage(wtfLin, prev, cur);
      if (t2Formed) {
        curEntryWtf = [cur.date, cur.h];
        if (!wtfSuperseded) {
          wtfSuperseded = true;
          wtfSupersededDate = cur.date;
        }
      }
      if (t2Closed && curEntryWtf !== null) {
        rows.push({
          family: inst.family,
          letter: inst.letter,
          side: "WTF BAR ENTRY",
          wtfFormationDate: inst.formationDate,
          entryDate: curEntryWtf[0],
          entryPrice: curEntryWtf[1],
          exitType: "BAR ENTRY SL",
          exitDate: cur.date,
          exitPrice: t2Closed.exitPrice,
          highestHigh: wtfLin.hh2Date ? wtfLin.hh2 : null,
          highestHighDate: wtfLin.hh2Date,
        });
        curEntryWtf = null;
      }
    }
  }
  if (curEntryWtf !== null) {
    rows.push({
      family: inst.family,
      letter: inst.letter,
      side: "WTF BAR ENTRY",
      wtfFormationDate: inst.formationDate,
      entryDate: curEntryWtf[0],
      entryPrice: curEntryWtf[1],
      exitType: inst.endEvent !== null ? inst.endEvent : "still open",
      exitDate: inst.endDate,
      exitPrice: inst.endPrice,
      highestHigh: wtfLin.hh2Date ? wtfLin.hh2 : null,
      highestHighDate: wtfLin.hh2Date,
    });
  }

  // --- DTF side (frozen once WTF BAR ENTRY has ever fired) ---
  const dtfLin = new Lineage();
  let dtfStartIdx: number | null = null;
  for (let i = 0; i < dtfDays.length; i++) {
    if (dtfDays[i].date > inst.formationDate) {
      dtfStartIdx = i;
      break;
    }
  }
  let curEntryDtf: [string, number] | null = null;
  if (dtfStartIdx !== null) {
    for (let i = dtfStartIdx; i < dtfDays.length && dtfDays[i].date <= inst.endDate; i++) {
      if (wtfSuperseded && wtfSupersededDate !== null && dtfDays[i].date >= wtfSupersededDate) break;
      const prev = dtfDays[i - 1];
      const cur = dtfDays[i];
      const { t2Formed, t2Closed } = stepLineage(dtfLin, prev, cur);
      if (t2Formed) curEntryDtf = [cur.date, cur.h];
      if (t2Closed && curEntryDtf !== null) {
        rows.push({
          family: inst.family,
          letter: inst.letter,
          side: "DTF TZ BUY ENTRY",
          wtfFormationDate: inst.formationDate,
          entryDate: curEntryDtf[0],
          entryPrice: curEntryDtf[1],
          exitType: "DTF TZ BUY ENTRY SL",
          exitDate: cur.date,
          exitPrice: t2Closed.exitPrice,
          highestHigh: dtfLin.hh2Date ? dtfLin.hh2 : null,
          highestHighDate: dtfLin.hh2Date,
        });
        curEntryDtf = null;
      }
    }
  }
  if (curEntryDtf !== null && !wtfSuperseded) {
    rows.push({
      family: inst.family,
      letter: inst.letter,
      side: "DTF TZ BUY ENTRY",
      wtfFormationDate: inst.formationDate,
      entryDate: curEntryDtf[0],
      entryPrice: curEntryDtf[1],
      exitType: inst.endEvent !== null ? inst.endEvent : "still open",
      exitDate: inst.endDate,
      exitPrice: inst.endPrice,
      highestHigh: dtfLin.hh2Date ? dtfLin.hh2 : null,
      highestHighDate: dtfLin.hh2Date,
    });
  }

  if (inst.endEvent !== null) return { rows, live: null }; // this instance already failed -- not "right now"

  const wtfBarEntryActive = wtfLin.t2Active;
  const live: PrimeTrend12LiveStatus = {
    family: inst.family,
    letter: inst.letter,
    wtfBarEntryActive,
    wtfBarEntrySince: wtfBarEntryActive ? wtfLin.t2Since : null,
    wtfBarEntryActivationPrice: wtfBarEntryActive ? wtfLin.t2EntryPrice : null,
    wtfBarEntryStopLoss: wtfBarEntryActive ? wtfLin.t2RefLow : null,
    wtfBarEntryHighestHigh: wtfBarEntryActive ? (wtfLin.hh2Date ? wtfLin.hh2 : null) : null,
    wtfBarEntryHighestHighDate: wtfBarEntryActive ? wtfLin.hh2Date : null,
    dtfSuperseded: wtfSuperseded,
    dtfTzBuyEntryActive: !wtfSuperseded && dtfLin.t2Active,
    dtfTzBuyEntrySince: !wtfSuperseded && dtfLin.t2Active ? dtfLin.t2Since : null,
    dtfTzBuyEntryActivationPrice: !wtfSuperseded && dtfLin.t2Active ? dtfLin.t2EntryPrice : null,
    dtfTzBuyEntryStopLoss: !wtfSuperseded && dtfLin.t2Active ? dtfLin.t2RefLow : null,
    dtfTzBuyEntryHighestHigh: !wtfSuperseded && dtfLin.t2Active ? (dtfLin.hh2Date ? dtfLin.hh2 : null) : null,
    dtfTzBuyEntryHighestHighDate: !wtfSuperseded && dtfLin.t2Active ? dtfLin.hh2Date : null,
  };
  return { rows, live };
}

export function computePrimeTrend12(wtfRows: OhlcRow[], dtfRows: OhlcRow[]): PrimeTrend12Result[] {
  const { dtfDays, instances } = prepare(wtfRows, dtfRows);
  const wtfDays: Day[] = wtfRows.map((r) => ({ date: r.date, o: r.o, h: r.h, l: r.l, c: r.c }));
  const results: PrimeTrend12Result[] = [];
  for (const inst of instances) {
    const { rows } = simulateWindow(wtfDays, dtfDays, inst);
    results.push(...rows);
  }
  return results;
}

export function computePrimeTrendLive12(wtfRows: OhlcRow[], dtfRows: OhlcRow[]): PrimeTrend12LiveStatus[] {
  const { dtfDays, instances } = prepare(wtfRows, dtfRows);
  const wtfDays: Day[] = wtfRows.map((r) => ({ date: r.date, o: r.o, h: r.h, l: r.l, c: r.c }));
  const liveStatuses: PrimeTrend12LiveStatus[] = [];
  for (const inst of instances) {
    if (inst.endEvent !== null) continue;
    const { live } = simulateWindow(wtfDays, dtfDays, inst);
    if (live !== null && (live.wtfBarEntryActive || live.dtfTzBuyEntryActive)) {
      liveStatuses.push(live);
    }
  }
  return liveStatuses;
}
