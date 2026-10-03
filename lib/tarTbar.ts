// TAR / TBAR -- the WTF BAR cross-timeframe follow-up theory (part of
// PRIME TREND 1.2's "BAR theory" track). NOT the same as the TAR/TBAR
// spec in WTF_RULEBOOK.md (written independently, in a concurrent
// session) -- this is a from-scratch derivation, worked out across an
// extensive round of real-data verification against KALYANKJIL.NS. The
// two specs genuinely disagree (notably: this one DOES have a REAR
// escalation; the WTF_RULEBOOK.md one explicitly doesn't). Intended to
// replace that section once this is confirmed, not to coexist with it.
//
// Anchors on the base WTF engine's own top-level "BAR(label)" milestone
// (tz_engine_wtf.py / lib/tzEngineWtf.ts's own RED1->RED2->BAR1 cascade,
// run on WEEKLY candles) -- reuses lib/primeTrend.ts's own `runWtfTrace`
// to get the real event trace, exactly like every PRIME TREND variant.
//
// WINDOW: a WTF BAR's own governing window runs from its formation
// until EITHER (a) that specific top-level BAR gets its own explicit
// "BAR SL(label)" (not "BAR 2 SL(", not "BAR SL2(", not "BAR SL LL(" --
// those are the WTF engine's own NESTED BAR2 tier events, which do NOT
// end this window), or (b) a fresh "BAR(" formation line appears (same
// label reformed, or a new label) -- whichever comes first. Confirmed:
// nested BAR2 SL/reactivation cycling under a still-alive top-level BAR
// does NOT end the window.
//
// DTF starts watching from the day after the WTF BAR's own formation
// DATE (string label comparison, matching every other PRIME TREND
// variant's `> formationDate` convention) -- can be within the same
// calendar week, since TAR's formation isn't reference-gated so there's
// no look-ahead risk to guard against.
//
// THE CONTINUOUS RED1->RED2 TRACKER (the central correction found
// during real-data verification): there is ONE tracked pullback per
// window, not a separate "loose initial gate" and "separate later
// mandatory gate". The moment RED1 ever forms, DTF TAR-seeking unlocks
// permanently for the rest of the window (RED2 is NOT required to
// unlock it) -- but the SAME red object keeps being evaluated in
// parallel with whatever TAR/TBAR/BAR formation is happening,
// independently watching for RED2. The moment it EVER confirms RED2
// (whether before TAR forms, while TAR is active, while TBAR is
// active, or during the nested BAR1/BAR2 phase), `doorOpen` becomes
// permanently true for the rest of the window. Once open, it never
// closes again, and every later SL -- of any kind -- reforms
// unrestricted (no reference gate, no further RED gating).
//
// Confirmed bug found and fixed during verification: the "first
// formation gate" classification (single-RED1 vs RED1-RED2) that
// decides TAR SL2's eventual effect is locked in at the moment TAR
// ITSELF forms (not TBAR's later escalation) -- real KALYANKJIL.NS data
// showed RED2 confirming (10/02/2025) before TAR even formed
// (13/02/2025), which must count as "formed via RED1-RED2", not
// "single RED1", even though RED1 alone would have been sufficient to
// unlock TAR-seeking.
//
// TAR (tier1): forms via the plain, unrestricted day-over-day breakout
// once seeking is unlocked. TAR's own pre-escalation SL (TBAR never
// having formed for this specific TAR instance) ALWAYS reforms
// unrestricted -- no reference gate, regardless of door status,
// regardless of what preceded it. TAR keeps tracking its own reference
// even after escalating to TBAR (the parent/child dependency, same
// shape as shipped PRIME TREND's Stage1/Stage2): if TAR's own
// (continuing) reference is independently breached while TBAR is
// active, that's a decisive "TAR SL" that wipes TBAR outright,
// regardless of TBAR's own state.
//
// TBAR (tier2): escalates from TAR by clearing TAR's own reference
// high, resetting its OWN reference fresh to the escalation candle's
// high/low (bug found and fixed: must not inherit TAR's stale
// reference). TBAR's own clean SL (TAR still otherwise valid, no
// same-candle combined breach) forks on the three-condition rule:
//   - doorOpen already true at that point -> unrestricted reform (a
//     fresh TAR can reform anywhere via the plain breakout).
//   - doorOpen still false -> TAR alone reforms above the running top
//     reference (whichever is higher between TAR's own and TBAR's own)
//     -- same "whichever is higher" principle used everywhere else in
//     this codebase. TBAR only escalates from that fresh TAR later, on
//     a later candle, via the ordinary TAR->TBAR path -- TAR and TBAR
//     can never form on the same candle (only an SL/exit can be a
//     combined event).
//
// COMBINED SAME-CANDLE BREACH (TAR's threshold AND TBAR's threshold
// both breached on the exact same candle): always reforms unrestricted,
// regardless of door status -- treated like a routine BAR1-style deep
// failure, confirmed via a real worked example.
//
// TAR SL2 (TAR's own SL, with TBAR already having formed under it at
// some point, failing a SECOND time after a reactivation attempt --
// same two-strike shape as dtf_bar.py's real TZ BUY SL/SL2): the effect
// depends on how THIS window's very first TAR ever formed --
//   - first formation via single RED1 -> direct fresh reform remains
//     possible, as long as RED1-RED2 has confirmed anywhere in the
//     window's life (before OR after the SL2).
//   - first formation via RED1-RED2 -> requires escalation: REAR forms
//     above the running top reference, REAR must stay active, and the
//     exact same rules recurse beneath it (REAR plays TAR's role, one
//     level up, exactly like WTF TZ BUY 2 does for the outer window --
//     collapsing level 2+ into "REAR RE-ENTER").
//
// NESTED BAR1/BAR2 "routine" phase: gated by its OWN fresh, dedicated
// RED1->RED2 confirming specifically while THIS TBAR instance is already
// active (`nestedDoorOpen`) -- not the general `doorOpen` flag, which can
// go true from a RED1-RED2 that confirmed well before TBAR (or even TAR)
// ever formed. Same shape as the WTF engine's own TZ BUY2 -> RED1-RED2
// -> BAR1 cascade. Once that fresh gate opens, a nested BAR1/BAR2 cascade
// becomes available underneath TBAR -- BAR1 forms via the plain
// breakout, escalates to BAR2 by clearing its own reference, BAR1's own
// pre-escalation SL reforms unrestricted (unlimited generations), and
// BAR2's own (harder) SL reports as "PRIME TREND SL" and keeps the
// structure open (confirmed via 6+ real consecutive cycles in
// KALYANKJIL.NS -- that verification predates the nestedDoorOpen fix,
// so worth re-checking that those specific cycles still read the same).
//
// SCOPE OF THIS PASS: verified against real KALYANKJIL.NS data for the
// mechanics that data actually exercised -- TAR formation (flexible
// gate), TAR's pre-escalation SL/unrestricted reform, TAR->TBAR
// escalation (with the reference-reset fix), TBAR's clean SL under both
// door states, and the nested BAR1/BAR2 routine phase repeating many
// times. NOT yet exercised by any real data found so far: TAR's own SL
// while TBAR was independently still healthy (the decisive
// parent-wipes-child case), the same-candle combined breach, TAR SL2
// itself, and REAR formation -- all implemented per the derived spec,
// but unverified against real price action.

import { THRESH, EPS, type Day } from "./tzEngineWtf";
import { runWtfTrace, type OhlcRow } from "./primeTrend";

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

class RedGate {
  constructor(public refHigh: number, public refLow: number) {}
}
function stepRed(red: RedGate, prev: Day, cur: Day): "confirmed" | "invalid" | "continuing" {
  if (cur.h > red.refHigh && cur.h - red.refHigh >= THRESH - EPS && cur.c >= red.refHigh) return "invalid";
  if (cur.h > red.refHigh) red.refHigh = cur.h;
  if (cur.l < red.refLow) {
    const red2Holds = cur.h <= prev.h && red.refLow - cur.l >= THRESH - EPS && cur.c <= red.refLow + EPS;
    if (red2Holds) return "confirmed";
    red.refLow = cur.l;
  }
  return "continuing";
}

export interface TarTbarWindow {
  wtfLabel: string;
  formationDate: string;
  endDate: string | null;
  endReason: "BAR SL" | "new BAR" | null;
}

export interface TarTbarResult {
  wtfLabel: string;
  wtfFormationDate: string;
  level: number; // 0 = TBAR itself, 1 = REAR ENTRY, 2+ = REAR RE-ENTER (collapsed)
  // "BAR2" rows are the nested BAR1->BAR2 cycle's own row (confirmed:
  // gets its own visible row) -- they OVERLAP the enclosing
  // TBAR/REAR-ENTRY/REAR-RE-ENTER row rather than replacing it, since
  // nested BAR2's own harder SL doesn't end the outer row at all (it
  // reforms unrestricted, same level, per the confirmed TAR/TBAR rules).
  side: "TBAR" | "REAR ENTRY" | "REAR RE-ENTER" | "BAR2";
  entryDate: string;
  entryPrice: number;
  exitType: string;
  exitDate: string;
  exitPrice: number | null;
  highestHigh: number | null;
  highestHighDate: string | null;
}

export interface TarTbarLiveStatus {
  wtfLabel: string;
  wtfFormationDate: string;
  level: number;
  side: "TAR" | "TBAR" | "REAR" | "REAR ENTRY" | "REAR RE-ENTER";
  since: string;
  activationPrice: number;
  highestHigh: number | null;
  highestHighDate: string | null;
}

type Mode =
  | "SEEK_LEVEL_ENTRY" // level >=1 only: must clear the inherited top reference before seeking starts
  | "SEEK_TAR" // watching for TAR's own plain breakout
  | "TAR_ACTIVE" // TAR alone (tier1), tracking its own ref, watching escalation or its own pre-escalation SL
  | "TBAR_ACTIVE" // TBAR active; TAR continues tracking its own ref in parallel (parent/child dependency)
  | "SEEK_REACTIVATION"; // door-not-open reactivation: watch breaksRef(topRef) to reform TAR alone; TBAR escalates later, on a later candle

function sideForLevel(level: number): "TBAR" | "REAR ENTRY" | "REAR RE-ENTER" {
  return level === 0 ? "TBAR" : level === 1 ? "REAR ENTRY" : "REAR RE-ENTER";
}

class LevelState {
  mode: Mode;
  level: number;
  doorOpen = false;
  // Separate from `doorOpen`: whether a FRESH RED1->RED2 has confirmed
  // specifically while THIS TBAR instance was already active -- the
  // nested BAR1/BAR2 cascade needs its own dedicated post-formation
  // RED1-RED2, not just reliance on `doorOpen` possibly having gone true
  // earlier (even before TAR itself formed). Same shape as the WTF
  // engine's own TZ BUY2 -> RED1-RED2 -> BAR1 cascade. Reset to false
  // every time a fresh TBAR forms.
  nestedDoorOpen = false;
  red: RedGate | null = null;
  everSawRed1 = false; // persists even after `red` resolves (confirmed/invalid) -- unlocks TAR-seeking permanently
  firstFormationGate: "RED1" | "RED1-RED2" | null = null;
  topRef: number;

  tarRefHigh = 0;
  tarRefLow = 0;
  tarActivationPrice: number | null = null; // fixed snapshot at TAR's own formation (matches Stage1's s1ActivationPrice)
  tbarRefHigh = 0;
  tbarRefLow = 0;
  tbarActive = false; // only meaningful once mode === TBAR_ACTIVE
  tarParentFailedOnce = false; // TAR-SL -> TAR-SL2 two-strike tracker (post-escalation only)

  rowEntryDate: string | null = null;
  rowEntryPrice: number | null = null;
  rowHH = 0;
  rowHHDate: string | null = null;

  nestedMode: "NONE" | "SEEK_BAR1" | "BAR1_ACTIVE" | "BAR2_ACTIVE" = "NONE";
  nestedRefHigh = 0;
  nestedRefLow = 0;
  nestedEntryDate: string | null = null;
  nestedEntryPrice: number | null = null;
  nestedHH = 0;
  nestedHHDate: string | null = null;

  constructor(level: number, topRefFloor: number | null) {
    this.level = level;
    this.topRef = topRefFloor ?? 0;
    this.mode = topRefFloor === null ? "SEEK_TAR" : "SEEK_LEVEL_ENTRY";
  }
}

function trackHH(s: LevelState, cur: Day) {
  if (cur.h > s.rowHH) {
    s.rowHH = cur.h;
    s.rowHHDate = cur.date;
  }
}

/** Advances one level by one candle. Returns `opened`/`closed` for the
 * outer (TBAR/REAR-ENTRY/REAR-RE-ENTER) row lifecycle, `nestedClosed`
 * for the nested BAR1->BAR2 cycle's own row (confirmed: gets its own
 * visible row, overlapping the outer row rather than replacing it,
 * since it reforms unrestricted rather than promoting), and `promoted`
 * when TAR SL2 (RED1-RED2 first formation) requires escalating to the
 * next level. */
function stepLevel(
  s: LevelState,
  prev: Day,
  cur: Day
): {
  opened: { price: number } | null;
  closed: { exitType: string; exitPrice: number } | null;
  nestedClosed: { entryDate: string; entryPrice: number; exitPrice: number; hh: number; hhDate: string } | null;
  promoted: boolean;
} {
  let opened: { price: number } | null = null;
  let closed: { exitType: string; exitPrice: number } | null = null;
  let nestedClosed: { entryDate: string; entryPrice: number; exitPrice: number; hh: number; hhDate: string } | null = null;
  let promoted = false;

  if (s.mode === "SEEK_LEVEL_ENTRY") {
    if (breaksRef(prev, cur, s.topRef)) {
      s.topRef = Math.max(s.topRef, cur.h);
      s.mode = "SEEK_TAR";
    }
    return { opened, closed, nestedClosed, promoted };
  }

  // --- the one continuous RED1->RED2 tracker, independent of TAR/TBAR state ---
  if (s.red === null) {
    if (isRed1Shape(prev, cur)) {
      s.red = new RedGate(cur.h, cur.l);
      s.everSawRed1 = true; // unlocks TAR-seeking permanently, regardless of how this red resolves
    }
  } else {
    const result = stepRed(s.red, prev, cur);
    if (result === "confirmed") {
      s.red = null;
      s.doorOpen = true;
      if (s.mode === "TBAR_ACTIVE") s.nestedDoorOpen = true;
    } else if (result === "invalid") {
      s.red = null;
    }
  }

  switch (s.mode) {
    case "SEEK_TAR": {
      if (!s.everSawRed1) break;
      if (bar1Shape(prev, cur)) {
        s.tarRefHigh = cur.h;
        s.tarRefLow = cur.l;
        s.tarActivationPrice = cur.h; // fixed at formation; tarRefHigh keeps climbing afterward
        if (s.firstFormationGate === null) s.firstFormationGate = s.doorOpen ? "RED1-RED2" : "RED1";
        s.mode = "TAR_ACTIVE";
      }
      break;
    }
    case "TAR_ACTIVE": {
      // Escalation checked before quiet climb (standard ordering fix).
      if (breaksRef(prev, cur, s.tarRefHigh)) {
        // Entry price is the ladder threshold itself (ref + THRESH), not
        // the candle's own actual High -- same convention shipped PRIME
        // TREND's own Stage 2 uses (`ref2 + THRESH`), confirmed against
        // real KALYANKJIL.NS numbers: TAR's ref climbed to 523.95 by
        // 15/04/2025 (the day before escalation), so TBAR's entry price
        // is 523.95 + 0.20 = 524.15 -- not 16/04's own High of 529.
        const entryPrice = s.tarRefHigh + THRESH;
        s.topRef = Math.max(s.topRef, cur.h);
        s.tbarRefHigh = cur.h;
        s.tbarRefLow = cur.l;
        s.tbarActive = true;
        s.rowHH = cur.h;
        s.rowHHDate = cur.date;
        s.mode = "TBAR_ACTIVE";
        // Fresh TBAR instance -- the nested cascade needs its own
        // dedicated post-formation RED1-RED2, not a stale doorOpen from
        // possibly before TAR itself even formed.
        s.nestedDoorOpen = false;
        s.nestedMode = "NONE";
        opened = { price: entryPrice };
        break;
      }
      const slNow = isSl(cur, s.tarRefLow);
      if (!slNow && cur.h > s.tarRefHigh) s.tarRefHigh = cur.h;
      if (!slNow && cur.l < s.tarRefLow) s.tarRefLow = cur.l;
      if (slNow) {
        s.topRef = Math.max(s.topRef, s.tarRefHigh);
        s.mode = "SEEK_TAR"; // pre-escalation SL: always unrestricted, no gate needed again
      }
      break;
    }
    case "TBAR_ACTIVE": {
      trackHH(s, cur);
      const tarSlNow = isSl(cur, s.tarRefLow);
      const tbarSlNow = isSl(cur, s.tbarRefLow);
      if (!tarSlNow && cur.h > s.tarRefHigh) s.tarRefHigh = cur.h;
      if (!tarSlNow && cur.l < s.tarRefLow) s.tarRefLow = cur.l;
      if (!tbarSlNow && cur.h > s.tbarRefHigh) s.tbarRefHigh = cur.h;
      if (!tbarSlNow && cur.l < s.tbarRefLow) s.tbarRefLow = cur.l;

      if (tarSlNow && tbarSlNow) {
        // Combined same-candle breach: always unrestricted, regardless of door.
        // TAR is decisive in a combined breach, same as the standalone case --
        // exit price is TAR's own tracked reference low, not the raw candle low.
        s.topRef = Math.max(s.topRef, s.tarRefHigh, s.tbarRefHigh);
        closed = { exitType: "TAR SL + TBAR SL", exitPrice: s.tarRefLow };
        s.mode = "SEEK_TAR";
        s.nestedMode = "NONE";
        s.tarParentFailedOnce = false;
        break;
      }
      if (tarSlNow) {
        // Decisive: TAR's own SL wipes TBAR regardless of TBAR's own state.
        // Exit price is TAR's own tracked reference low, not the raw candle low.
        s.topRef = Math.max(s.topRef, s.tarRefHigh, s.tbarRefHigh);
        closed = { exitType: s.tarParentFailedOnce ? "TAR SL2" : "TAR SL", exitPrice: s.tarRefLow };
        if (s.tarParentFailedOnce) {
          if (s.firstFormationGate === "RED1") {
            s.mode = "SEEK_TAR";
            s.tarParentFailedOnce = false;
          } else {
            s.mode = "SEEK_TAR"; // caller promotes to next level
            promoted = true;
          }
        } else if (s.doorOpen) {
          s.mode = "SEEK_TAR";
          s.tarParentFailedOnce = true;
        } else {
          s.mode = "SEEK_REACTIVATION";
          s.tarParentFailedOnce = true;
        }
        s.nestedMode = "NONE";
        break;
      }
      if (tbarSlNow) {
        // Exit price is TBAR's own tracked reference low, not the raw candle low.
        s.topRef = Math.max(s.topRef, s.tbarRefHigh);
        closed = { exitType: "TBAR SL", exitPrice: s.tbarRefLow };
        s.mode = s.doorOpen ? "SEEK_TAR" : "SEEK_REACTIVATION";
        s.nestedMode = "NONE";
        break;
      }

      // --- nested BAR1/BAR2 "routine" phase, once THIS TBAR's own fresh
      // post-formation RED1-RED2 has confirmed (not just doorOpen, which
      // may have gone true earlier, even before TAR formed) ---
      if (s.nestedDoorOpen && s.nestedMode === "NONE") s.nestedMode = "SEEK_BAR1";
      if (s.nestedMode === "SEEK_BAR1") {
        if (bar1Shape(prev, cur)) {
          s.nestedRefHigh = cur.h;
          s.nestedRefLow = cur.l;
          s.nestedMode = "BAR1_ACTIVE";
        }
      } else if (s.nestedMode === "BAR1_ACTIVE") {
        if (breaksRef(prev, cur, s.nestedRefHigh)) {
          // Ladder entry price: the ref as it stood before this candle, + THRESH --
          // not the escalation candle's own actual High (same convention as TAR->TBAR).
          const nestedEntryPrice = s.nestedRefHigh + THRESH;
          s.nestedRefHigh = cur.h;
          s.nestedRefLow = cur.l;
          s.nestedEntryDate = cur.date;
          s.nestedEntryPrice = nestedEntryPrice;
          s.nestedHH = cur.h;
          s.nestedHHDate = cur.date;
          s.nestedMode = "BAR2_ACTIVE";
        } else {
          const nSlNow = isSl(cur, s.nestedRefLow);
          if (!nSlNow && cur.h > s.nestedRefHigh) s.nestedRefHigh = cur.h;
          if (!nSlNow && cur.l < s.nestedRefLow) s.nestedRefLow = cur.l;
          if (nSlNow) s.nestedMode = "SEEK_BAR1";
        }
      } else if (s.nestedMode === "BAR2_ACTIVE") {
        if (cur.h > s.nestedHH) {
          s.nestedHH = cur.h;
          s.nestedHHDate = cur.date;
        }
        const nSlNow = isSl(cur, s.nestedRefLow);
        if (!nSlNow && cur.h > s.nestedRefHigh) s.nestedRefHigh = cur.h;
        if (!nSlNow && cur.l < s.nestedRefLow) s.nestedRefLow = cur.l;
        if (nSlNow) {
          // "PRIME TREND SL" -- door already open, unrestricted reform at
          // the SAME level (confirmed: does not promote). Gets its own
          // visible row, overlapping the still-open outer TBAR/REAR-ENTRY row.
          nestedClosed = {
            entryDate: s.nestedEntryDate as string,
            entryPrice: s.nestedEntryPrice as number,
            exitPrice: s.nestedRefLow,
            hh: s.nestedHH,
            hhDate: s.nestedHHDate as string,
          };
          s.nestedMode = "SEEK_BAR1";
        }
      }
      break;
    }
    case "SEEK_REACTIVATION": {
      // Reactivation reforms TAR alone -- TAR and TBAR can never form on
      // the same candle (only an SL/exit can be a combined event). This
      // just clears the running top reference and drops back into the
      // ordinary TAR_ACTIVE state; TBAR only escalates later, on a later
      // candle, via TAR_ACTIVE's own already-correct escalation path --
      // same two-step shape as every other BAR->BAR ENTRY /
      // TAR->TBAR / BAR->BAR 2 formation in this codebase.
      if (breaksRef(prev, cur, s.topRef)) {
        s.topRef = Math.max(s.topRef, cur.h);
        s.tarRefHigh = cur.h;
        s.tarRefLow = cur.l;
        s.tarActivationPrice = cur.h;
        s.mode = "TAR_ACTIVE";
      } else if (cur.h > s.topRef) {
        s.topRef = cur.h;
      }
      break;
    }
  }

  return { opened, closed, nestedClosed, promoted };
}

function simulateWindow(dtfDays: Day[], startIdx: number, endIdxExclusive: number, wtfLabel: string, wtfFormationDate: string, rows: TarTbarResult[]): TarTbarLiveStatus[] {
  const liveStatuses: TarTbarLiveStatus[] = [];
  let level = 0;
  let topRefFloor: number | null = null;
  let i = startIdx;

  while (i < endIdxExclusive) {
    const s = new LevelState(level, topRefFloor);
    let promotedAt: number | null = null;
    let promotedFloor = 0;

    for (; i < endIdxExclusive; i++) {
      const prev = dtfDays[i - 1];
      const cur = dtfDays[i];
      const { opened, closed, nestedClosed, promoted } = stepLevel(s, prev, cur);
      if (opened) {
        s.rowEntryDate = cur.date;
        s.rowEntryPrice = opened.price;
      }
      if (closed) {
        rows.push({
          wtfLabel,
          wtfFormationDate,
          level: s.level,
          side: sideForLevel(s.level),
          entryDate: s.rowEntryDate as string,
          entryPrice: s.rowEntryPrice as number,
          exitType: closed.exitType,
          exitDate: cur.date,
          exitPrice: closed.exitPrice,
          highestHigh: s.rowHHDate ? s.rowHH : null,
          highestHighDate: s.rowHHDate,
        });
      }
      if (nestedClosed) {
        // Own visible row for the nested BAR1->BAR2 cycle, overlapping
        // the still-open outer row rather than replacing it (confirmed:
        // this reforms at the same level rather than promoting).
        rows.push({
          wtfLabel,
          wtfFormationDate,
          level: s.level,
          side: "BAR2",
          entryDate: nestedClosed.entryDate,
          entryPrice: nestedClosed.entryPrice,
          exitType: "PRIME TREND SL",
          exitDate: cur.date,
          exitPrice: nestedClosed.exitPrice,
          highestHigh: nestedClosed.hh,
          highestHighDate: nestedClosed.hhDate,
        });
      }
      if (promoted) {
        promotedAt = i + 1;
        promotedFloor = s.topRef;
        break;
      }
    }

    if (promotedAt !== null) {
      level += 1;
      topRefFloor = promotedFloor;
      i = promotedAt;
      continue;
    }

    // Window ended (not promoted) -- report still-open row/live status, if any.
    if (s.mode === "TBAR_ACTIVE" && s.rowEntryDate !== null) {
      liveStatuses.push({
        wtfLabel,
        wtfFormationDate,
        level: s.level,
        side: s.level === 0 ? "TBAR" : s.level === 1 ? "REAR ENTRY" : "REAR RE-ENTER",
        since: s.rowEntryDate,
        activationPrice: s.rowEntryPrice as number,
        highestHigh: s.rowHHDate ? s.rowHH : null,
        highestHighDate: s.rowHHDate,
      });
    } else if (s.mode === "TAR_ACTIVE") {
      liveStatuses.push({
        wtfLabel,
        wtfFormationDate,
        level: s.level,
        side: s.level === 0 ? "TAR" : s.level === 1 ? "REAR" : "REAR RE-ENTER",
        since: s.rowEntryDate ?? wtfFormationDate,
        activationPrice: s.tarActivationPrice as number,
        highestHigh: null,
        highestHighDate: null,
      });
    }
    break;
  }

  return liveStatuses;
}

function findWindows(wtfDays: Day[]): TarTbarWindow[] {
  const trace = runWtfTrace(wtfDays);
  const formations: { date: string; label: string }[] = [];
  const sls: { date: string; label: string }[] = [];
  for (const entry of trace) {
    for (const e of entry.events) {
      const formMatch = /^BAR\(([^)]+)\)$/.exec(e);
      if (formMatch) formations.push({ date: entry.day.date, label: formMatch[1] });
      const slMatch = /^BAR SL\(([^)]+)\)$/.exec(e);
      if (slMatch) sls.push({ date: entry.day.date, label: slMatch[1] });
    }
  }

  const windows: TarTbarWindow[] = [];
  for (let i = 0; i < formations.length; i++) {
    const f = formations[i];
    const nextFormation = formations[i + 1] ?? null;
    const matchingSl = sls.find((sl) => sl.label === f.label && sl.date > f.date && (nextFormation === null || sl.date < nextFormation.date));
    if (matchingSl) {
      windows.push({ wtfLabel: f.label, formationDate: f.date, endDate: matchingSl.date, endReason: "BAR SL" });
    } else if (nextFormation) {
      windows.push({ wtfLabel: f.label, formationDate: f.date, endDate: nextFormation.date, endReason: "new BAR" });
    } else {
      windows.push({ wtfLabel: f.label, formationDate: f.date, endDate: null, endReason: null });
    }
  }
  return windows;
}

export function computeTarTbar(wtfRows: OhlcRow[], dtfRows: OhlcRow[]): { windows: TarTbarWindow[]; results: TarTbarResult[]; live: TarTbarLiveStatus[] } {
  const wtfDays: Day[] = wtfRows.map((r) => ({ date: r.date, o: r.o, h: r.h, l: r.l, c: r.c }));
  const dtfDays: Day[] = dtfRows.map((r) => ({ date: r.date, o: r.o, h: r.h, l: r.l, c: r.c }));
  const windows = findWindows(wtfDays);

  const results: TarTbarResult[] = [];
  const live: TarTbarLiveStatus[] = [];
  for (const w of windows) {
    let startIdx = dtfDays.findIndex((d) => d.date > w.formationDate);
    if (startIdx <= 0) continue;
    let endIdx = w.endDate === null ? dtfDays.length : dtfDays.findIndex((d) => d.date >= (w.endDate as string));
    if (endIdx === -1) endIdx = dtfDays.length;
    if (endIdx <= startIdx) continue;
    const windowLive = simulateWindow(dtfDays, startIdx, endIdx, w.wtfLabel, w.formationDate, results);
    // Live status only ever comes from a window that's still genuinely
    // open (the WTF BAR itself hasn't SL'd and no fresh BAR has reformed
    // yet) -- a window that already ended freezes, same principle as
    // "once WTF TZ BUY 2 fails, DTF tracking freezes" everywhere else.
    if (w.endDate === null) live.push(...windowLive);
  }
  return { windows, results, live };
}
