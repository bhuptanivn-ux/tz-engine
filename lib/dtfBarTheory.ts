// DTF BAR THEORY -- a DTF-only theory built on the SAME event vocabulary as
// lib/dtfBar.ts (TZ GREEN, RED1/RED2, TZ BUY, BAR1/BAR2, REAR) but with a
// different hierarchy, confirmed against real data (PAYTM daily) rather than
// ported from the WTF/PRIME TREND rulebook. Kept as its own file per
// DTF_THEORIES_RULEBOOK.md's own convention: a related but structurally
// different theory gets its own file, not a patch onto another one.
// lib/dtfBar.ts itself is untouched by this file.
//
// Terms: a "green candle" is the plain day-over-day breakout (low >= previous
// low, high >= previous high + 0.20, close >= previous high). "Breakout over
// X" is the same test against a level X instead of the previous high.
//
// Rules (user-confirmed; anything still unconfirmed is flagged per day in
// `dayDoubts` so a report can show it):
//
// House: TZ GREEN (green candle) -> RED1 -> RED2 -> TZ BUY (green candle).
//   Before RED2, TZ GREEN SL ends the house and a new TZ GREEN may start.
//   After RED2, TZ GREEN SL (SL of TZ GREEN's reference low) does not: the
//   SL candle's low becomes the reference (TZ GREEN SL LL lowers it), and only
//   TZ GREEN SL 2 (a decisive close below it) ends the house, after which a
//   new TZ GREEN may start. TZ GREEN HH is tracked, not recorded.
// Phase 1 (TZ level), stage 1 = TZ BUY (or a REAR), stage 2 = TZ BUY ENTRY:
//   TZ BUY ENTRY: breakout over TZ BUY's high (or over a REAR's high).
//   Bare TZ BUY SL (no TZ BUY ENTRY yet): TZ BUY again on the next green candle.
//   TZ BUY ENTRY SL, TZ BUY still active: REAR C on the next green candle, then
//     TZ BUY ENTRY above REAR C's high (RED1 / RED2 do not matter). REAR C stays
//     tracked after that TZ BUY ENTRY; REAR C SL -> REAR C again on the next
//     green candle. Every new high above the highest high since the earlier
//     TZ BUY ENTRY is INVALID TZ BUY ENTRY HH.
//   TZ BUY SL (TZ BUY ENTRY SL included): the SL candle's high / low become the
//     reference (TZ BUY SL HH / LL). TZ BUY reactivates on a breakout over that
//     high, then TZ BUY ENTRY above the reactivated TZ BUY's high.
//   Anchor: the latest TZ BUY / REAR (raw or reactivated) formed after a RED1 ->
//     RED2 that completed after TZ BUY ENTRY (the first TZ BUY is one). Each
//     stage 1 SLs at its own low; SL 2 is a decisive close below the ANCHOR's
//     SL low (old SL -> SL 2 rule) and starts the race: a new house vs this
//     house's REAR above the highest high since the earlier TZ BUY ENTRY, then
//     TZ BUY ENTRY above that REAR. A REAR after SL 2 is never an anchor; its
//     SL only reactivates it above its SL high.
//   RED2 arms BAR1 only while TZ BUY ENTRY is active.
// BAR level (only while TZ BUY ENTRY is active). RED1 -> RED2 keeps running
//   and always arms BAR1 (green candle). BAR1 then becomes BAR ENTRY (above
//   BAR1's high) while the earlier BAR ENTRY is active, or BAR 2 of a new BAR
//   cycle while it is not; either way the earlier BAR cycle ends there. Bare
//   BAR1 SL: BAR1 again on the next green candle.
//   BAR ENTRY SL: REAR above BAR ENTRY's running reference high (INVALID BAR
//     ENTRY HH raises it), then BAR ENTRY above that REAR's high.
//   BAR SL (BAR ENTRY SL included): first from the anchor BAR1's low; after
//     BAR ENTRY has re-formed, again from the earlier BAR SL candle's low
//     (moved down by BAR SL LL). REAR above the BAR SL candle's high (BAR SL
//     HH raises it), then BAR ENTRY above that REAR's high. No race.
//   BAR SL 2 (old rule: BAR SL LL lowers the BAR SL low; a decisive close
//     below it is BAR SL 2): opens the race; REAR above BAR ENTRY's running
//     reference high, then BAR ENTRY above that REAR's high. Until then the
//     house moves only via REAR -> BAR ENTRY (no new BAR1, RED gate stopped).
//   REAR SL (REAR does not act as BAR1): the next REAR must clear the earlier
//     REAR's running high (INVALID REAR HH raises it).
// Race (TZ BUY / REAR SL 2, or BAR SL 2): this house vs a new house
//   (TZ GREEN -> RED1 -> RED2 -> TZ BUY -> ...). The first to reach BAR ENTRY
//   wins and is shown; on the same day the earlier house wins. The other goes
//   dormant: it keeps running in the background and nothing of it is shown.

import { THRESH, EPS, type Day, type HistoryRowLike } from "./tzEngineWtf";

function breaksRef(prev: Day, cur: Day, ref: number): boolean {
  return cur.l >= prev.l && cur.h > ref && cur.h - ref >= THRESH - EPS && cur.c >= ref;
}

/** The green candle: TZ GREEN / TZ BUY / BAR1 / REAR C all use it. */
function green(prev: Day, cur: Day): boolean {
  return breaksRef(prev, cur, prev.h);
}

/** BAR ENTRY ("BAR2(n)"), or BAR 2 of a new BAR cycle ("BAR 2(n)"). */
function isBarEntryEvent(text: string): boolean {
  return /^BAR ?2\(/.test(text);
}

function isRed1(prev: Day, cur: Day): boolean {
  return cur.h <= prev.h && cur.l < prev.l && prev.l - cur.l >= THRESH - EPS && cur.c <= prev.l;
}

function isSl(cur: Day, refLow: number): boolean {
  return cur.l <= refLow && refLow - cur.l >= THRESH - EPS && cur.c <= refLow + EPS;
}

function quietLl(cur: Day, refLow: number): number | null {
  if (cur.l >= refLow) return null;
  const gap = refLow - cur.l;
  if ((gap >= THRESH - EPS && cur.c > refLow + EPS) || gap < THRESH - EPS) return cur.l;
  return null;
}

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------

/** A level pair with an SL flag: stage 2 tiers and the REARs. */
export class Tier {
  sl = false;
  constructor(public refHigh: number, public refLow: number) {}
}

export class Red {
  active = true;
  constructor(public refHigh: number, public refLow: number) {}
}

/** Waiting for a REAR (A or B) above `target`. */
export class RearSeek {
  rear: Tier | null = null; // formed, stage 2 not yet re-formed above it
  constructor(public target: number, public afterRearSl: boolean) {}
}

/** BAR level: stage 1 (BAR1 or REAR B) + stage 2 (BAR ENTRY). */
export class BarLineage {
  bar2: Tier | null = null;
  /** BAR ENTRY's running reference high since this lineage's first BAR
   * ENTRY (BAR ENTRY HH, INVALID BAR ENTRY HH, re-formed BAR ENTRYs). */
  barTop = 0;
  /** The anchor BAR1's own SL ("BAR SL"): the BAR SL candle's high and low
   * (BAR SL HH raises the high, BAR SL LL lowers the low). */
  barSl: Tier | null = null;
  /** The BAR SL is live (not yet followed by BAR ENTRY re-forming). After BAR
   * ENTRY re-forms, a later BAR SL is measured from barSl.refLow. */
  barSlLive = false;
  /** BAR SL 2 has fired (opens the race). */
  sl2 = false;
  /** The REAR waiting for BAR ENTRY to re-form above it. */
  rear: Tier | null = null;
  /** After a REAR SL: the earlier REAR's running high the next REAR must clear. */
  rearHigh: number | null = null;
  constructor(public label: string, public refHigh: number, public refLow: number) {}
}

/** A stage 1 at the TZ level: TZ BUY (first or reactivated), REAR A (the
 * race REAR after SL 2, once TZ BUY ENTRY formed above it), or REAR C (after a
 * TZ BUY ENTRY SL while TZ BUY is active). */
export class Stage1 {
  alive = true;
  /** Its SL candle's high and low (SL HH raises the high, SL LL lowers the
   * low). Reactivation is a breakout over the high; for the anchor, SL 2 is a
   * decisive close below the low. */
  sl: Tier | null = null;
  constructor(
    public kind: "TZ BUY" | "REAR A" | "REAR C",
    public refHigh: number,
    public refLow: number,
    /** Formed after a completed RED1 -> RED2 (user-confirmed anchor rule). */
    public anchor: boolean
  ) {}
}

/** TZ level of a house: stage 1 (TZ BUY / REAR A) + stage 2 (TZ BUY ENTRY),
 * REAR C, plus the RED gate and BAR stage under TZ BUY ENTRY. */
export class TzLevel {
  s1: Stage1;
  /** A bare TZ BUY SL (no TZ BUY ENTRY yet): TZ BUY again on the next green
   * candle. */
  bareSl = false;
  entry: Tier | null = null;
  /** Highest high since the earlier TZ BUY ENTRY (INVALID TZ BUY ENTRY HH
   * raises it): the race REAR after SL 2 must clear it. */
  entryTop = 0;
  /** The latest REAR C, and whether TZ BUY ENTRY has yet to re-form above it. */
  rearC: Stage1 | null = null;
  rearCPending = false;
  /** The latest stage 1 formed after a completed RED1 -> RED2: SL 2 is
   * measured below its SL low. */
  anchor: Stage1 | null;
  /** A RED1 -> RED2 has completed since the last TZ BUY ENTRY / stage 1. */
  red2Since = false;
  seek: RearSeek | null = null;
  red: Red | null = null;
  redSeek = false;
  barPending = false;
  barLineages: BarLineage[] = [];
  barGen = 0;
  barDeadLabels = new Set<number>();
  barEntryEver = false;
  constructor(refHigh: number, refLow: number) {
    // The first TZ BUY follows RED1 -> RED2: it is the anchor.
    this.s1 = new Stage1("TZ BUY", refHigh, refLow, true);
    this.anchor = this.s1;
  }

  resetBarStage(): void {
    this.red = null;
    this.redSeek = false;
    this.barPending = false;
    this.barLineages = [];
    this.barEntryEver = false;
  }

  /** BAR is not considered while TZ BUY ENTRY is not active. */
  endBarStage(): void {
    this.barLineages = [];
    this.barPending = false;
    this.barEntryEver = false;
  }
}

/** An open race: decided by the first house to reach BAR ENTRY. */
export class Race {
  open = true;
}

/** One house: TZ GREEN -> ... */
export class Cycle {
  active = true;
  red: Red | null = null;
  tz: TzLevel | null = null;
  race: Race | null = null;
  /** TZ GREEN SL: the SL candle's low becomes the reference (TZ GREEN SL LL
   * lowers it). The house carries on; only TZ GREEN SL 2 ends it. */
  greenSl: Tier | null = null;
  /** Lost a race: keeps running in the background, nothing of it is shown. */
  dormant = false;
  constructor(public seq: number, public refHigh: number, public refLow: number) {}
}

/** One event, attributed to the house (Cycle.seq) that produced it. */
export interface TaggedEvent {
  seq: number;
  text: string;
}

// ---------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------

export class DtfBarTheoryEngine {
  cycles: Cycle[] = [];
  /** Defaults the day's events relied on (keyed by house seq). */
  dayDoubts: { seq: number; doubt: string }[] = [];
  private seq = 0;
  private cur: Cycle | null = null;

  process(prev: Day, cur: Day): string[] {
    return this.processTagged(prev, cur).map((e) => e.text);
  }

  processTagged(prev: Day, cur: Day): TaggedEvent[] {
    this.dayDoubts = [];
    const byCycle = new Map<Cycle, string[]>();
    for (const cyc of this.cycles) {
      if (!cyc.active) continue;
      this.cur = cyc;
      byCycle.set(cyc, this.evalHouse(cyc, prev, cur));
    }

    // Races: decided by the first house to reach BAR ENTRY; on the same day
    // the earlier house wins. The loser goes dormant.
    const reached = (c: Cycle): boolean => (byCycle.get(c) ?? []).some(isBarEntryEvent);
    for (const old of this.cycles) {
      if (!old.active || old.dormant || !old.race?.open) continue;
      const younger = this.cycles.filter((c) => c.seq > old.seq && c.active && !c.dormant);
      if (reached(old)) {
        old.race.open = false;
        for (const c of younger) c.dormant = true;
      } else if (younger.some(reached)) {
        old.race.open = false;
        old.dormant = true;
      }
    }

    const ev: TaggedEvent[] = [];
    for (const [cyc, texts] of byCycle) {
      if (cyc.dormant) continue; // dormant: nothing of it is shown
      for (const text of texts) ev.push({ seq: cyc.seq, text });
    }
    this.dayDoubts = this.dayDoubts.filter((d) => !this.cycles.find((c) => c.seq === d.seq)?.dormant);

    // A new house may start when no shown house is live outside an open race.
    const blocking = this.cycles.some((c) => c.active && !c.dormant && !c.race?.open);
    if (!blocking && green(prev, cur)) {
      this.seq += 1;
      const fresh = new Cycle(this.seq, cur.h, cur.l);
      this.cycles.push(fresh);
      ev.push({ seq: fresh.seq, text: "TZ GREEN" });
    }
    return ev;
  }

  private doubt(text: string): void {
    if (this.cur !== null) this.dayDoubts.push({ seq: this.cur.seq, doubt: text });
  }

  private openRace(cyc: Cycle): void {
    if (cyc.race === null || !cyc.race.open) cyc.race = new Race();
  }

  // -----------------------------------------------------------------
  private evalHouse(cyc: Cycle, prev: Day, cur: Day): string[] {
    const ev: string[] = [];
    const tz = cyc.tz;
    if (cur.h > cyc.refHigh) cyc.refHigh = cur.h; // TZ GREEN HH: not recorded
    if (cyc.greenSl === null) {
      if (isSl(cur, cyc.refLow)) {
        // Before RED2 (bare TZ GREEN, or RED1 only) TZ GREEN SL ends the house
        // and a new one may start. After RED2 it does not; only TZ GREEN SL 2
        // does (user-confirmed).
        const red2Done = tz !== null || (cyc.red !== null && !cyc.red.active);
        if (!red2Done) {
          cyc.active = false;
          return ["TZ GREEN SL"];
        }
        cyc.greenSl = new Tier(cur.h, cur.l);
        ev.push("TZ GREEN SL");
      } else {
        const low = quietLl(cur, cyc.refLow);
        if (low !== null) {
          cyc.refLow = low;
          if (tz === null || !tz.s1.alive) ev.push("TZ GREEN LL");
        }
      }
    } else {
      // TZ GREEN SL 2 (same old SL -> SL 2 rule): ends the house, and a new
      // TZ GREEN may start.
      if (isSl(cur, cyc.greenSl.refLow)) {
        cyc.active = false;
        return ["TZ GREEN SL2"];
      }
      const low = quietLl(cur, cyc.greenSl.refLow);
      if (low !== null) {
        cyc.greenSl.refLow = low;
        ev.push("TZ GREEN SL LL");
      }
    }

    if (tz === null) {
      if (cyc.red === null) {
        if (isRed1(prev, cur)) {
          cyc.red = new Red(cur.h, cur.l);
          ev.push("RED1");
        }
      } else if (cyc.red.active) {
        const r = this.evalRed(cyc.red, prev, cur);
        ev.push(...r);
        if (r.includes("INVALID RED1")) cyc.red = null;
      } else if (green(prev, cur)) {
        cyc.tz = new TzLevel(cur.h, cur.l);
        ev.push("TZ BUY");
      }
      return ev;
    }

    ev.push(...this.evalTz(cyc, tz, prev, cur));
    return ev;
  }

  // -----------------------------------------------------------------
  private evalRed(red: Red, prev: Day, cur: Day): string[] {
    const ev: string[] = [];
    if (cur.h > red.refHigh && cur.h - red.refHigh >= THRESH - EPS && cur.c >= red.refHigh) {
      red.active = false;
      return ["INVALID RED1"];
    }
    if (cur.h > red.refHigh) {
      red.refHigh = cur.h;
      ev.push("RED1 HH");
    }
    if (cur.l < red.refLow) {
      if (cur.h <= prev.h && red.refLow - cur.l >= THRESH - EPS && cur.c <= red.refLow + EPS) {
        red.active = false;
        ev.push("RED2");
      } else {
        red.refLow = cur.l;
        ev.push("RED1 LL");
      }
    }
    return ev;
  }

  private evalRedGate(tz: TzLevel, prev: Day, cur: Day): string[] {
    if (!tz.redSeek) return [];
    if (tz.red === null) {
      if (isRed1(prev, cur)) {
        tz.red = new Red(cur.h, cur.l);
        return ["RED1"];
      }
      return [];
    }
    const r = this.evalRed(tz.red, prev, cur);
    if (r.includes("RED2")) {
      // RED2 makes the next TZ BUY / REAR an anchor; it arms BAR1 only while
      // TZ BUY ENTRY is active (user-confirmed).
      tz.red2Since = true;
      if (tz.entry !== null && !tz.entry.sl) tz.barPending = true;
      tz.redSeek = false;
      tz.red = null;
    } else if (r.includes("INVALID RED1")) {
      tz.red = null;
    }
    return r;
  }

  // -----------------------------------------------------------------
  /** HH/LL/SL of a REAR (A, B or C) still waiting for its stage 2. */
  private evalRearTier(r: Tier, name: string, cur: Day, ev: string[]): boolean {
    const slNow = isSl(cur, r.refLow);
    if (cur.h > r.refHigh) {
      r.refHigh = cur.h;
      if (!slNow) ev.push(`${name} HH`);
    }
    const l = quietLl(cur, r.refLow);
    if (l !== null) {
      r.refLow = l;
      ev.push(`${name} LL`);
    }
    if (slNow) {
      r.sl = true;
      ev.push(`${name} SL`);
    }
    return slNow;
  }

  // -----------------------------------------------------------------
  private evalTz(cyc: Cycle, tz: TzLevel, prev: Day, cur: Day): string[] {
    let ev: string[] = [];

    // Bare TZ BUY SL (no TZ BUY ENTRY yet): TZ BUY again on the next green candle.
    if (tz.bareSl) {
      if (green(prev, cur)) {
        tz.bareSl = false;
        tz.s1 = new Stage1("TZ BUY", cur.h, cur.l, true);
        tz.anchor = tz.s1;
        ev.push("TZ BUY");
      }
      return ev;
    }

    // After SL 2: the race REAR, until TZ BUY ENTRY forms above it.
    if (tz.seek !== null) {
      const s = tz.seek;
      if (s.rear !== null) {
        if (breaksRef(prev, cur, s.rear.refHigh)) {
          // TZ BUY ENTRY above REAR; REAR now acts as TZ BUY, but a REAR
          // after SL 2 is never an anchor.
          tz.s1 = new Stage1("REAR A", s.rear.refHigh, s.rear.refLow, false);
          tz.anchor = null;
          tz.entry = new Tier(cur.h, cur.l);
          tz.entryTop = cur.h;
          tz.seek = null;
          tz.redSeek = true;
          tz.red = null;
          tz.red2Since = false;
          return ["TZ BUY ENTRY"];
        }
        if (this.evalRearTier(s.rear, "REAR A", cur, ev)) {
          s.target = s.rear.refHigh;
          s.afterRearSl = true;
          s.rear = null;
        }
        return ev;
      }
      if (breaksRef(prev, cur, s.target)) {
        s.rear = new Tier(cur.h, cur.l);
        return ["REAR A"];
      }
      if (cur.h > s.target) {
        s.target = cur.h;
        return [s.afterRearSl ? "INVALID REAR A HH" : "INVALID TZ BUY ENTRY HH"];
      }
      return ev;
    }

    // SL 2: a decisive close below the anchor's SL low (old SL -> SL 2 rule).
    // Starts the race: a new house vs this house's REAR above the highest
    // high since the earlier TZ BUY ENTRY.
    const anc = tz.anchor;
    if (anc !== null && anc.sl !== null) {
      if (isSl(cur, anc.sl.refLow)) {
        if (tz.entry !== null && !tz.entry.sl) ev.push("TZ BUY ENTRY SL");
        if (tz.s1.alive && tz.s1 !== anc && isSl(cur, tz.s1.refLow)) ev.push(`${tz.s1.kind} SL`);
        ev.push(`${anc.kind} SL2`);
        if (cur.h > tz.entryTop) tz.entryTop = cur.h;
        tz.seek = new RearSeek(tz.entryTop, false);
        tz.s1.alive = false;
        tz.rearC = null;
        tz.rearCPending = false;
        tz.anchor = null;
        tz.red2Since = false;
        tz.resetBarStage();
        this.openRace(cyc);
        return ev;
      }
      if (anc !== tz.s1) {
        const l = quietLl(cur, anc.sl.refLow);
        if (l !== null) {
          anc.sl.refLow = l;
          ev.push(`${anc.kind} SL LL`);
        }
      }
    }

    const s1 = tz.s1;
    if (tz.entry !== null && cur.h > tz.entryTop && !(tz.entry.sl && s1.alive)) tz.entryTop = cur.h;

    if (s1.alive && tz.entry === null && breaksRef(prev, cur, s1.refHigh)) {
      // TZ BUY ENTRY above the (first or reactivated) TZ BUY's high.
      tz.entry = new Tier(cur.h, cur.l);
      if (cur.h > tz.entryTop) tz.entryTop = cur.h;
      s1.refHigh = cur.h;
      tz.redSeek = true;
      tz.red = null;
      tz.red2Since = false;
      return ["TZ BUY ENTRY"];
    }

    if (s1.alive) {
      // Stage 1 HH / LL / SL.
      const slNow = isSl(cur, s1.refLow);
      if (cur.h > s1.refHigh) {
        s1.refHigh = cur.h;
        if (!slNow && tz.entry === null) ev.push(`${s1.kind} HH`);
      }
      const l1 = quietLl(cur, s1.refLow);
      if (l1 !== null) {
        s1.refLow = l1;
        ev.push(`${s1.kind} LL`);
      }
      if (slNow) {
        s1.alive = false;
        if (tz.entry === null) {
          tz.bareSl = true;
          ev.push("TZ BUY SL");
          tz.resetBarStage();
          return ev;
        }
        // Stage 1 SL: stage 2 SL is included. Reactivation above the SL
        // candle's high; SL 2 (anchor only) below its low.
        if (!tz.entry.sl) {
          tz.entry.sl = true;
          ev.push("TZ BUY ENTRY SL");
        }
        ev.push(`${s1.kind} SL`);
        s1.sl = new Tier(cur.h, cur.l);
        tz.rearC = null;
        tz.rearCPending = false;
        tz.endBarStage();
      } else {
        ev = this.evalEntry(tz, prev, cur, ev);
      }
    } else if (s1.sl !== null) {
      // Stage 1 sits SL'd: reactivation on a breakout over its SL high.
      if (breaksRef(prev, cur, s1.sl.refHigh)) {
        const n = new Stage1(s1.kind, cur.h, cur.l, tz.red2Since);
        if (n.anchor) {
          tz.anchor = n;
          tz.red2Since = false;
        }
        tz.s1 = n;
        tz.entry = null;
        ev.push(s1.kind);
      } else {
        if (cur.h > s1.sl.refHigh) {
          s1.sl.refHigh = cur.h;
          ev.push(`${s1.kind} SL HH`);
        }
        const l = quietLl(cur, s1.sl.refLow);
        if (l !== null) {
          s1.sl.refLow = l;
          if (s1 === tz.anchor) ev.push(`${s1.kind} SL LL`);
        }
      }
    }

    // BAR stage (only while TZ BUY ENTRY is active) and RED gate.
    const bar = tz.entry !== null && !tz.entry.sl && tz.s1.alive ? this.evalBarLineages(cyc, tz, prev, cur) : [];
    if (!tz.barEntryEver && bar.some(isBarEntryEvent)) {
      tz.barEntryEver = true;
      ev = ev.filter((x) => x !== "TZ BUY ENTRY HH");
    }
    ev.push(...bar);
    ev.push(...this.evalRedGate(tz, prev, cur));
    return ev;
  }

  /** Stage 2 (TZ BUY ENTRY) and REAR C, while stage 1 is alive. */
  private evalEntry(tz: TzLevel, prev: Day, cur: Day, ev: string[]): string[] {
    const e = tz.entry;
    if (e === null) return ev;
    if (!e.sl) {
      const eSl = isSl(cur, e.refLow);
      if (cur.h > e.refHigh) {
        e.refHigh = cur.h;
        if (cur.h > tz.entryTop) tz.entryTop = cur.h;
        if (!eSl && !tz.barEntryEver) ev.push("TZ BUY ENTRY HH");
      }
      const el = quietLl(cur, e.refLow);
      if (el !== null) {
        e.refLow = el;
        ev.push("TZ BUY ENTRY LL");
      }
      this.trackRearC(tz, cur, ev);
      if (eSl) {
        e.sl = true;
        tz.rearCPending = false;
        ev.push("TZ BUY ENTRY SL");
        if (tz.barLineages.length > 0)
          this.doubt("TZ BUY ENTRY SL ends the live BAR stage (BAR not considered while TZ BUY ENTRY is SL'd)");
        tz.endBarStage();
      }
      return ev;
    }

    // TZ BUY ENTRY sits SL'd, TZ BUY active: REAR C on the next green candle,
    // then TZ BUY ENTRY above REAR C's high (RED1 / RED2 do not matter).
    const r = tz.rearC;
    if (r !== null && r.alive && tz.rearCPending) {
      if (breaksRef(prev, cur, r.refHigh)) {
        tz.entry = new Tier(cur.h, cur.l);
        if (cur.h > tz.entryTop) tz.entryTop = cur.h;
        tz.rearCPending = false;
        tz.redSeek = true;
        ev.push("TZ BUY ENTRY");
        return ev;
      }
      this.trackRearC(tz, cur, ev);
    } else {
      this.trackRearC(tz, cur, ev);
      if ((tz.rearC === null || !tz.rearC.alive) && green(prev, cur)) {
        const n = new Stage1("REAR C", cur.h, cur.l, tz.red2Since);
        if (n.anchor) {
          tz.anchor = n;
          tz.red2Since = false;
        }
        tz.rearC = n;
        tz.rearCPending = true;
        ev.push("REAR C");
      }
    }
    // Every new high above the highest high since the earlier TZ BUY ENTRY.
    if (cur.h > tz.entryTop) {
      tz.entryTop = cur.h;
      ev.push("INVALID TZ BUY ENTRY HH");
    }
    return ev;
  }

  /** REAR C's own HH (only while TZ BUY ENTRY has yet to re-form above it),
   * LL and SL. It stays tracked after TZ BUY ENTRY re-forms above it. */
  private trackRearC(tz: TzLevel, cur: Day, ev: string[]): void {
    const r = tz.rearC;
    if (r === null || !r.alive) return;
    const slNow = isSl(cur, r.refLow);
    if (cur.h > r.refHigh) {
      r.refHigh = cur.h;
      if (!slNow && tz.rearCPending) ev.push("REAR C HH");
    }
    const l = quietLl(cur, r.refLow);
    if (l !== null) {
      r.refLow = l;
      ev.push("REAR C LL");
    }
    if (slNow) {
      r.alive = false;
      r.sl = new Tier(cur.h, cur.l);
      tz.rearCPending = false;
      ev.push("REAR C SL");
    }
  }

  // -----------------------------------------------------------------
  private nextBarLabel(tz: TzLevel): string {
    let n: number;
    if (tz.barDeadLabels.size > 0) {
      n = Math.min(...tz.barDeadLabels);
      tz.barDeadLabels.delete(n);
    } else {
      tz.barGen += 1;
      n = tz.barGen;
    }
    return String(n);
  }

  private evalBarLineages(cyc: Cycle, tz: TzLevel, prev: Day, cur: Day): string[] {
    // RED2 arms BAR1 whether or not BAR ENTRY is active.
    // After BAR SL 2 the house only moves via REAR -> BAR ENTRY: no new BAR1.
    const inSl2 = tz.barLineages.some((l) => l.sl2);
    if (tz.barPending && !inSl2 && green(prev, cur)) {
      tz.red2Since = false;
      const label = this.nextBarLabel(tz);
      tz.barLineages = tz.barLineages.filter((l) => l.bar2 !== null);
      tz.barLineages.push(new BarLineage(label, cur.h, cur.l));
      tz.barPending = false;
      return [`BAR1(${label})`];
    }
    const ev: string[] = [];
    // Newest first: a BAR ENTRY superseded today by the next one has no events.
    for (const lin of [...tz.barLineages].reverse()) {
      if (!tz.barLineages.includes(lin)) continue;
      const stop = this.evalLineage(cyc, tz, lin, prev, cur, ev);
      if (stop) break;
    }
    return ev;
  }

  /** Returns true when the lineage set was replaced (stop iterating). */
  private evalLineage(cyc: Cycle, tz: TzLevel, lin: BarLineage, prev: Day, cur: Day, ev: string[]): boolean {
    const L = lin.label;

    // Fresh BAR1 (no BAR ENTRY yet).
    if (lin.bar2 === null) {
      if (breaksRef(prev, cur, lin.refHigh)) {
        // With the earlier BAR ENTRY active this is BAR ENTRY; with it not
        // active it is BAR 2 of a new BAR cycle. Either way the earlier BAR
        // cycle ends here.
        const earlier = tz.barLineages.find((x) => x !== lin && x.bar2 !== null);
        const name = earlier !== undefined && earlier.bar2!.sl ? "BAR 2" : "BAR2";
        lin.bar2 = new Tier(cur.h, cur.l);
        lin.barTop = cur.h;
        tz.barLineages = [lin];
        tz.redSeek = true;
        ev.push(`${name}(${L})`);
        return true;
      }
      const slNow = isSl(cur, lin.refLow);
      if (cur.h > lin.refHigh) {
        lin.refHigh = cur.h;
        if (!slNow) ev.push(`BAR1 HH(${L})`);
      }
      const l = quietLl(cur, lin.refLow);
      if (l !== null) {
        lin.refLow = l;
        ev.push(`BAR1 LL(${L})`);
      }
      if (slNow) {
        // Bare BAR1 SL: BAR1 again on the next green candle.
        tz.barDeadLabels.add(parseInt(L, 10));
        tz.barLineages = tz.barLineages.filter((x) => x !== lin);
        tz.barPending = true;
        ev.push(`BAR SL(${L})`);
      }
      return false;
    }

    const b2 = lin.bar2;

    // Stage 1: BAR SL (BAR ENTRY SL included). The first is measured from
    // the anchor BAR1's low; after BAR ENTRY has re-formed, a later one from
    // the earlier BAR SL candle's low (moved down by BAR SL LL).
    if (!lin.barSlLive && !lin.sl2) {
      const level = lin.barSl !== null ? lin.barSl.refLow : lin.refLow;
      if (isSl(cur, level)) {
        if (!b2.sl) {
          b2.sl = true;
          ev.push(`BAR2 SL(${L})`);
        }
        lin.barSl = new Tier(cur.h, cur.l);
        lin.barSlLive = true;
        lin.rear = null;
        lin.rearHigh = null;
        ev.push(`BAR SL(${L})`);
        return false;
      }
      if (lin.barSl === null && cur.h > lin.refHigh) lin.refHigh = cur.h;
      const l1 = quietLl(cur, level);
      if (l1 !== null) {
        if (lin.barSl !== null) {
          lin.barSl.refLow = l1;
          ev.push(`BAR SL LL(${L})`);
        } else {
          lin.refLow = l1;
          ev.push(`BAR1 LL(${L})`);
        }
      }
    }

    // Stage 2: BAR ENTRY active.
    if (!b2.sl) {
      const slNow = isSl(cur, b2.refLow);
      if (cur.h > b2.refHigh) {
        b2.refHigh = cur.h;
        if (cur.h > lin.barTop) lin.barTop = cur.h;
        if (!slNow) ev.push(`BAR2 HH(${L})`);
      }
      const l = quietLl(cur, b2.refLow);
      if (l !== null) {
        b2.refLow = l;
        ev.push(`BAR2 LL(${L})`);
      }
      if (slNow) {
        b2.sl = true;
        ev.push(`BAR2 SL(${L})`);
      }
      return false;
    }

    // BAR ENTRY sits SL'd. After a BAR SL: BAR SL LL, or BAR SL 2 (old rule).
    if (lin.barSlLive && lin.barSl !== null && !lin.sl2) {
      if (isSl(cur, lin.barSl.refLow)) {
        lin.sl2 = true;
        lin.rear = null;
        lin.rearHigh = null;
        // From BAR SL 2 the house only moves via REAR -> BAR ENTRY (user-
        // confirmed): other BAR rounds and the RED gate stop until then.
        tz.barLineages = [lin];
        tz.barPending = false;
        tz.redSeek = false;
        tz.red = null;
        ev.push(`BAR SL2(${L})`);
        this.openRace(cyc);
        if (cur.h > lin.barTop) lin.barTop = cur.h;
        return false;
      }
      const l = quietLl(cur, lin.barSl.refLow);
      if (l !== null) {
        lin.barSl.refLow = l;
        ev.push(`BAR SL LL(${L})`);
      }
    }

    // A REAR is waiting: BAR ENTRY re-forms above its high.
    if (lin.rear !== null) {
      const r = lin.rear;
      if (breaksRef(prev, cur, r.refHigh)) {
        lin.bar2 = new Tier(cur.h, cur.l);
        if (cur.h > lin.barTop) lin.barTop = cur.h;
        lin.rear = null;
        lin.rearHigh = null;
        lin.barSlLive = false;
        lin.sl2 = false;
        tz.redSeek = true;
        ev.push(`BAR2(${L})`);
        return false;
      }
      const before = ev.length;
      if (this.evalRearTier(r, "REAR B", cur, ev)) {
        // REAR SL: the next REAR must clear this REAR's running high.
        lin.rearHigh = r.refHigh;
        lin.rear = null;
      }
      for (let i = before; i < ev.length; i++) ev[i] = `${ev[i]}(${L})`;
      if (cur.h > lin.barTop) lin.barTop = cur.h;
      return false;
    }

    // Seek REAR. Above: the earlier REAR's running high after a REAR SL; else
    // BAR ENTRY's running high after BAR SL 2 or a plain BAR ENTRY SL; else
    // (after BAR SL) the BAR SL candle's high.
    let kind: "rear" | "bar2" | "barsl";
    let target: number;
    if (lin.rearHigh !== null) {
      kind = "rear";
      target = lin.rearHigh;
    } else if (lin.barSlLive && lin.barSl !== null && !lin.sl2) {
      kind = "barsl";
      target = lin.barSl.refHigh;
    } else {
      kind = "bar2";
      target = lin.barTop;
    }
    if (breaksRef(prev, cur, target)) {
      lin.rear = new Tier(cur.h, cur.l);
      ev.push(`REAR B(${L})`);
    } else if (cur.h > target) {
      if (kind === "rear") {
        lin.rearHigh = cur.h;
        ev.push(`INVALID REAR B HH(${L})`);
      } else if (kind === "barsl") {
        lin.barSl!.refHigh = cur.h;
        ev.push(`BAR SL HH(${L})`);
      } else {
        lin.barTop = cur.h;
        ev.push(`INVALID BAR2 HH(${L})`);
      }
    }
    if (cur.h > lin.barTop) lin.barTop = cur.h;
    return false;
  }
}

function toDays(rows: HistoryRowLike[]): Day[] {
  return rows
    .filter((r) => r.open !== null && r.high !== null && r.low !== null && r.close !== null)
    .map((r) => ({
      date: r.date,
      o: r.open as number,
      h: r.high as number,
      l: r.low as number,
      c: r.close as number,
    }));
}

/** Runs a fresh DtfBarTheoryEngine over a sequence of OHLC rows (ascending
 * by date) and produces a date -> comma-joined-event-string map, same shape
 * as lib/dtfBar.ts's own computeDtfBarEvents. */
export function computeDtfBarTheoryEvents(rows: HistoryRowLike[]): Map<string, string> {
  const days = toDays(rows);
  const engine = new DtfBarTheoryEngine();
  const map = new Map<string, string>();
  for (let i = 1; i < days.length; i++) {
    const events = engine.process(days[i - 1], days[i]);
    if (events.length > 0) map.set(days[i].date, events.join(", "));
  }
  return map;
}

/** Same as computeDtfBarTheoryEvents, but keeps each event's originating
 * house `seq` (see DtfBarTheoryEngine.processTagged). */
export function computeDtfBarTheoryTaggedEvents(rows: HistoryRowLike[]): Map<string, TaggedEvent[]> {
  const days = toDays(rows);
  const engine = new DtfBarTheoryEngine();
  const map = new Map<string, TaggedEvent[]>();
  for (let i = 1; i < days.length; i++) {
    const events = engine.processTagged(days[i - 1], days[i]);
    if (events.length > 0) map.set(days[i].date, events);
  }
  return map;
}
