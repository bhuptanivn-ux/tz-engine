// DTF BAR THEORY -- a DTF-only theory built on the SAME event vocabulary as
// lib/dtfBar.ts (TZ GREEN, RED1/RED2, TZ BUY, BAR1 / BAR ENTRY, REAR) but with a
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
// Phase 1 (TZ level), stage 1 = TZ BUY (or REAR A), stage 2 = TZ BUY ENTRY:
//   TZ BUY ENTRY: breakout over TZ BUY's high (or over REAR A's high).
//   Bare TZ BUY SL (no TZ BUY ENTRY yet): TZ BUY again on the next green candle.
//   TZ BUY ENTRY SL, TZ BUY active: TZ BUY ENTRY again on the next green
//     candle. Meanwhile every new high above the highest high since the
//     earlier TZ BUY ENTRY is INVALID TZ BUY ENTRY HH.
//   TZ BUY SL (TZ BUY ENTRY SL included) starts the race: this house's REAR A
//     above that highest high, then TZ BUY ENTRY above REAR A's high (REAR A
//     then acts as TZ BUY), vs a new house's TZ BUY -> TZ BUY ENTRY. The first
//     to reach its ENTRY wins (same day: this house). A REAR A SL before its
//     TZ BUY ENTRY: the next REAR must clear that REAR's running high.
//   RED2 arms BAR1 only while TZ BUY ENTRY is active.
// BAR level (only while TZ BUY ENTRY is active). RED1 -> RED2 -> BAR1 (green
//   candle) -> BAR ENTRY (above BAR1's high), in a loop; the previous BAR
//   ENTRY stays live until the next BAR ENTRY. While BAR1 is bare, RED1 / RED2
//   are not sought. Bare BAR1 SL: BAR1 again on the next green candle.
//   BAR ENTRY SL, BAR still active: BAR ENTRY again on the next green candle;
//     if a RED2 has completed (before, on or after the SL day), the next green
//     candle is a new BAR1 instead (BAR 2 of a new cycle, ending the earlier),
//     and the earlier BAR can no longer re-enter BAR ENTRY.
//   BAR SL (of a BAR that reached BAR ENTRY; BAR ENTRY SL included): from the
//     anchor BAR1's low. No REAR. The BAR SL candle sets a BAR SL level: its
//     low (BAR SL LL lowers it) for BAR SL 2, its high as the running high
//     for INVALID BAR SL (H >= running high + 0.20, C >= running high;
//     hidden; once per BAR SL). Before INVALID BAR SL, a decisive close below
//     the low is BAR SL 2. After it, an SL below the low is BAR SL again
//     (reactivation: a new BAR SL candle and a new ghost cycle). The level is
//     dead after INVALID BAR SL AND a newer BAR -> BAR ENTRY (normal or
//     ghost), in either order. Several levels can be live. BAR SL 2 happens
//     once: the race starts, the ghost cycle ends, no INVALID BAR SL.
//   Ghost BAR cycle (hidden, in `dayHidden`; the same BAR theory, it only
//     follows a BAR SL): ghost BAR on the next green candle -> ghost BAR ENTRY
//     above its high -> RED1 -> RED2 -> the next green candle is a shown BAR
//     (provided the ghost BAR has not SL'd), and the normal loop resumes.
//     Bare ghost BAR SL: ghost BAR again on the next green candle (no level).
//     Ghost BAR ENTRY SL: ghost BAR ENTRY again on the next green candle
//     (hidden) unless the RED2 has completed. Ghost BAR SL after its ghost
//     BAR ENTRY is a BAR SL: a new level and a new ghost cycle. INVALID BAR
//     SL does not change the ghost status.
//   BAR SL 2 (a decisive close below a live level): the race -- REAR B
//     above BAR ENTRY's running high, then BAR ENTRY above that REAR, vs a new
//     house's TZ BUY -> TZ BUY ENTRY, same rules as above. Until then no new
//     BAR1 and the RED gate pauses.
//   A TZ BUY ENTRY SL during that race drops REAR B; the race goes on while
//     TZ BUY is active: TZ BUY ENTRY again (next green candle) vs the new
//     house's TZ BUY ENTRY. TZ BUY SL as well: the TZ BUY SL race (REAR A).
// Race: decided at the ENTRY level. The new house is shown while the race is
//   open. This house's ENTRY first (or the same day): the new house
//   terminates. The new house's TZ BUY ENTRY first: this house goes dormant
//   (keeps running in the background, nothing of it is shown).

import { THRESH, EPS, type Day, type HistoryRowLike } from "./tzEngineWtf";

function breaksRef(prev: Day, cur: Day, ref: number): boolean {
  return cur.l >= prev.l && cur.h > ref && cur.h - ref >= THRESH - EPS && cur.c >= ref;
}

/** The green candle: TZ GREEN / TZ BUY / BAR1 / REAR C all use it. */
function green(prev: Day, cur: Day): boolean {
  return breaksRef(prev, cur, prev.h);
}

/** BAR ENTRY ("BAR ENTRY(n)"), or BAR 2 of a new BAR cycle ("BAR 2(n)"). */
function isBarEntryEvent(text: string): boolean {
  return /^(BAR ENTRY|BAR 2)\(/.test(text);
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
  /** The BAR SL candle behind a BAR SL 2 race (cleared when REAR B takes
   * over as BAR1). */
  barSl: Tier | null = null;
  /** In a BAR SL 2 race (cleared when BAR ENTRY re-forms above REAR B). */
  barSlLive = false;
  /** BAR SL 2 has fired (opens the race). */
  sl2 = false;
  /** BAR ENTRY SL + RED2: no BAR ENTRY again for this BAR (user-confirmed);
   * only the new BAR1 -> BAR ENTRY counts. */
  noReentry = false;
  /** The REAR waiting for BAR ENTRY to re-form above it. */
  rear: Tier | null = null;
  /** After a REAR SL: the earlier REAR's running high the next REAR must clear. */
  rearHigh: number | null = null;
  constructor(public label: string, public refHigh: number, public refLow: number) {}
}

/** A BAR SL level: the BAR SL candle's low (BAR SL LL lowers it) for BAR SL
 * 2, and its high as the running high for INVALID BAR SL. */
export class BarSlLevel {
  /** INVALID BAR SL has occurred (once per BAR SL): no BAR SL 2 from it; an
   * SL below its low is BAR SL again (reactivation). */
  invalid = false;
  /** A newer BAR -> BAR ENTRY (normal or ghost) has confirmed. With `invalid`
   * the level (the earlier lineage) is dead. */
  newerEntry = false;
  constructor(
    public label: string,
    public refHigh: number,
    public refLow: number,
    /** BAR ENTRY's running high (the race REAR after BAR SL 2 must clear it). */
    public barTop: number,
    /** Set by a ghost BAR SL: its LL events stay hidden. */
    public ghostBorn: boolean,
  ) {}
}

/** The ghost BAR cycle after a BAR SL: kept in the back end, not shown. */
export class Ghost {
  /** The ghost BAR (null / SL'd: the next green candle forms one). */
  bar: Tier | null = null;
  /** This ghost BAR has reached ghost BAR ENTRY (its SL is then a BAR SL). */
  entryEver = false;
  /** The ghost BAR ENTRY (breakout over the ghost BAR's reference high). */
  entry: Tier | null = null;
  /** Ghost BAR ENTRY's running high. */
  top = 0;
  /** RED1 -> RED2 has completed after the ghost BAR ENTRY. */
  red2 = false;
  constructor(public label: string) {}
}

/** Stage 1 at the TZ level: TZ BUY, or REAR A (the race REAR after TZ BUY
 * SL, once TZ BUY ENTRY has formed above it; it then acts as TZ BUY). */
export class Stage1 {
  alive = true;
  constructor(public kind: "TZ BUY" | "REAR A", public refHigh: number, public refLow: number) {}
}

/** TZ level of a house: stage 1 (TZ BUY / REAR A) + stage 2 (TZ BUY ENTRY),
 * plus the RED gate and BAR stage under TZ BUY ENTRY. */
export class TzLevel {
  s1: Stage1;
  /** A bare TZ BUY SL (no TZ BUY ENTRY yet): TZ BUY again on the next green
   * candle. */
  bareSl = false;
  entry: Tier | null = null;
  /** Highest high since the earlier TZ BUY ENTRY (INVALID TZ BUY ENTRY HH
   * raises it): the race REAR after TZ BUY SL must clear it. */
  entryTop = 0;
  seek: RearSeek | null = null;
  red: Red | null = null;
  redSeek = false;
  barPending = false;
  barLineages: BarLineage[] = [];
  barGen = 0;
  barDeadLabels = new Set<number>();
  barEntryEver = false;
  /** The ghost BAR cycle after a BAR SL, if any. */
  ghost: Ghost | null = null;
  /** Live BAR SL levels (BAR SL 2 / INVALID BAR SL). */
  barSlLevels: BarSlLevel[] = [];
  constructor(refHigh: number, refLow: number) {
    this.s1 = new Stage1("TZ BUY", refHigh, refLow);
  }

  resetBarStage(): void {
    this.red = null;
    this.redSeek = false;
    this.barPending = false;
    this.barLineages = [];
    this.barEntryEver = false;
    this.ghost = null;
    this.barSlLevels = [];
  }

  /** BAR is not considered while TZ BUY ENTRY is not active. */
  endBarStage(): void {
    this.barLineages = [];
    this.barPending = false;
    this.barEntryEver = false;
    this.ghost = null;
    this.barSlLevels = [];
  }
}

/** An open race: this house's REAR -> ENTRY vs a new house's TZ BUY ->
 * TZ BUY ENTRY. The first to reach its ENTRY wins. */
export class Race {
  open = true;
  /** Set on the day this house's ENTRY above its REAR forms (reset daily). */
  entryToday = false;
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
  /** The day's hidden (back-end) events, e.g. the ghost BAR cycle. */
  dayHidden: TaggedEvent[] = [];
  private seq = 0;
  private cur: Cycle | null = null;

  process(prev: Day, cur: Day): string[] {
    return this.processTagged(prev, cur).map((e) => e.text);
  }

  processTagged(prev: Day, cur: Day): TaggedEvent[] {
    this.dayDoubts = [];
    this.dayHidden = [];
    const byCycle = new Map<Cycle, string[]>();
    for (const c of this.cycles) if (c.race) c.race.entryToday = false;
    for (const cyc of this.cycles) {
      if (!cyc.active) continue;
      this.cur = cyc;
      byCycle.set(cyc, this.evalHouse(cyc, prev, cur));
    }

    // Races (after TZ BUY SL or BAR SL 2): decided at the ENTRY level (user-
    // confirmed). This house's ENTRY above its REAR (TZ BUY ENTRY above REAR
    // A, BAR ENTRY above REAR B) first, or on the same day: this house wins
    // and the new house terminates. The new house's TZ BUY ENTRY first: this
    // house goes dormant (keeps running in the background, nothing shown).
    for (const old of this.cycles) {
      if (!old.active || old.dormant || !old.race?.open) continue;
      const younger = this.cycles.filter((c) => c.seq > old.seq && c.active && !c.dormant);
      if (old.race.entryToday) {
        old.race.open = false;
        for (const c of younger) {
          c.active = false;
          byCycle.delete(c);
        }
      } else if (younger.some((c) => c.tz !== null && c.tz.entry !== null)) {
        old.race.open = false;
        old.dormant = true;
      }
    }

    const ev: TaggedEvent[] = [];
    for (const [cyc, texts] of byCycle) {
      if (cyc.dormant) continue; // dormant: nothing of it is shown
      for (const text of texts) ev.push({ seq: cyc.seq, text });
    }
    // A dormant house shows nothing, not even its back-end (hidden) events; a
    // house terminated today by a race shows nothing either.
    const silent = (seq: number) => {
      const c = this.cycles.find((x) => x.seq === seq);
      return c === undefined || c.dormant || !byCycle.has(c);
    };
    this.dayDoubts = this.dayDoubts.filter((d) => !silent(d.seq));
    this.dayHidden = this.dayHidden.filter((d) => !silent(d.seq));

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

  private hidden(text: string): void {
    if (this.cur !== null) this.dayHidden.push({ seq: this.cur.seq, text });
  }

  private doubt(text: string): void {
    if (this.cur !== null) this.dayDoubts.push({ seq: this.cur.seq, doubt: text });
  }

  private openRace(cyc: Cycle): void {
    if (cyc.race === null || !cyc.race.open) cyc.race = new Race();
  }

  /** This house reached its ENTRY above the race REAR. */
  private raceEntry(cyc: Cycle): void {
    if (cyc.race !== null && cyc.race.open) cyc.race.entryToday = true;
  }

  // -----------------------------------------------------------------
  private evalHouse(cyc: Cycle, prev: Day, cur: Day): string[] {
    const ev: string[] = [];
    const tz = cyc.tz;
    if (cur.h > cyc.refHigh) cyc.refHigh = cur.h; // TZ GREEN HH: not recorded
    // The live RED1 is evaluated first, so a RED2 on the TZ GREEN SL candle
    // counts (TZ GREEN SL after RED2 does not end the house).
    let redEv: string[] | null = null;
    if (tz === null && cyc.red !== null && cyc.red.active) {
      redEv = this.evalRed(cyc.red, prev, cur);
      if (redEv.includes("INVALID RED1")) cyc.red = null;
    }
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
      if (redEv !== null) {
        ev.push(...redEv); // the live RED1, evaluated above
      } else if (cyc.red === null) {
        if (isRed1(prev, cur)) {
          cyc.red = new Red(cur.h, cur.l);
          ev.push("RED1");
        }
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
      // RED2 arms BAR1 only while TZ BUY ENTRY is active (user-confirmed). In
      // the ghost cycle, a RED2 after the ghost BAR ENTRY (ghost BAR alive)
      // makes the next green candle a shown BAR.
      const g = tz.ghost;
      if (g !== null) {
        if (g.entryEver && g.bar !== null && !g.bar.sl) g.red2 = true;
      } else if (tz.entry !== null && !tz.entry.sl) tz.barPending = true;
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
        tz.s1 = new Stage1("TZ BUY", cur.h, cur.l);
        ev.push("TZ BUY");
      }
      return ev;
    }

    // After TZ BUY SL: the race REAR, until TZ BUY ENTRY forms above it.
    if (tz.seek !== null) {
      const s = tz.seek;
      if (s.rear !== null) {
        if (breaksRef(prev, cur, s.rear.refHigh)) {
          // TZ BUY ENTRY above REAR; REAR now acts as TZ BUY.
          tz.s1 = new Stage1("REAR A", s.rear.refHigh, s.rear.refLow);
          tz.entry = new Tier(cur.h, cur.l);
          tz.entryTop = cur.h;
          tz.seek = null;
          tz.redSeek = true;
          tz.red = null;
          this.raceEntry(cyc);
          return ["TZ BUY ENTRY"];
        }
        if (this.evalRearTier(s.rear, "REAR A", cur, ev)) {
          // REAR SL: the next REAR must clear this REAR's running high.
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

    const s1 = tz.s1;

    // First TZ BUY ENTRY: breakout over TZ BUY's high.
    if (tz.entry === null && breaksRef(prev, cur, s1.refHigh)) {
      tz.entry = new Tier(cur.h, cur.l);
      tz.entryTop = cur.h;
      s1.refHigh = cur.h;
      tz.redSeek = true;
      tz.red = null;
      return ["TZ BUY ENTRY"];
    }

    // Stage 1 (TZ BUY / REAR A) HH / LL / SL.
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
      } else {
        // Stage 1 SL (TZ BUY ENTRY SL included) starts the race: this house's
        // REAR above the highest high since the earlier TZ BUY ENTRY vs a new
        // house's TZ BUY (user-confirmed).
        if (!tz.entry.sl) ev.push("TZ BUY ENTRY SL");
        ev.push(`${s1.kind} SL`);
        if (cur.h > tz.entryTop) tz.entryTop = cur.h;
        tz.seek = new RearSeek(tz.entryTop, false);
        this.openRace(cyc);
      }
      tz.resetBarStage();
      return ev;
    }

    // Stage 2: TZ BUY ENTRY.
    const e = tz.entry;
    if (e !== null && !e.sl) {
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
      if (eSl) {
        e.sl = true;
        ev.push("TZ BUY ENTRY SL");
        // BAR is not considered while TZ BUY ENTRY is SL'd: a pending BAR SL 2
        // race REAR B is dropped, but the race stays open at the TZ level
        // (user-confirmed): TZ BUY ENTRY again vs the new house's TZ BUY ENTRY.
        tz.endBarStage();
      }
    } else if (e !== null && e.sl) {
      // TZ BUY ENTRY SL, TZ BUY active: TZ BUY ENTRY again on the next green
      // candle (user-confirmed).
      if (green(prev, cur)) {
        tz.entry = new Tier(cur.h, cur.l);
        if (cur.h > tz.entryTop) tz.entryTop = cur.h;
        tz.redSeek = true;
        this.raceEntry(cyc); // an open race (after BAR SL 2): this house's ENTRY
        ev.push("TZ BUY ENTRY");
      } else if (cur.h > tz.entryTop) {
        tz.entryTop = cur.h;
        ev.push("INVALID TZ BUY ENTRY HH");
      }
    }

    // BAR stage (only while TZ BUY ENTRY is active) and RED gate.
    const bar = tz.entry !== null && !tz.entry.sl ? this.evalBarLineages(cyc, tz, prev, cur) : [];
    if (!tz.barEntryEver && bar.some(isBarEntryEvent)) {
      tz.barEntryEver = true;
      ev = ev.filter((x) => x !== "TZ BUY ENTRY HH");
    }
    ev.push(...bar);
    ev.push(...this.evalRedGate(tz, prev, cur));
    return ev;
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
    const ev: string[] = [];
    if (this.evalBarSlLevels(cyc, tz, cur, ev)) return ev;
    // RED2 arms BAR1 (outside the ghost cycle). After BAR SL 2 the house only
    // moves via REAR -> BAR ENTRY: no new BAR1.
    const inSl2 = tz.barLineages.some((l) => l.sl2 || l.barSlLive);
    if (tz.ghost === null && tz.barPending && !inSl2 && green(prev, cur)) {
      const label = this.nextBarLabel(tz);
      tz.barLineages = tz.barLineages.filter((l) => l.bar2 !== null);
      for (const l of tz.barLineages) if (l.bar2!.sl) l.noReentry = true;
      tz.barLineages.push(new BarLineage(label, cur.h, cur.l));
      tz.barPending = false;
      ev.push(`BAR1(${label})`);
      return ev;
    }
    const start = ev.length;
    // Newest first: a BAR ENTRY superseded today by the next one has no events.
    for (const lin of [...tz.barLineages].reverse()) {
      if (!tz.barLineages.includes(lin)) continue;
      const stop = this.evalLineage(cyc, tz, lin, prev, cur, ev);
      if (stop) break;
    }
    if (ev.slice(start).some(isBarEntryEvent)) this.markBarEntry(tz);
    if (tz.ghost !== null && !ev.some((e) => /^BAR SL\(/.test(e))) ev.push(...this.evalGhost(tz, prev, cur));
    return ev;
  }

  /** A newer BAR -> BAR ENTRY (normal or ghost) confirmed: a level that also
   * has INVALID BAR SL is dead (user-confirmed). */
  private markBarEntry(tz: TzLevel): void {
    for (const lv of tz.barSlLevels) lv.newerEntry = true;
    tz.barSlLevels = tz.barSlLevels.filter((lv) => !(lv.invalid && lv.newerEntry));
  }

  /** The live BAR SL levels: BAR SL 2 (opens the race; returns true),
   * BAR SL LL, INVALID BAR SL (hidden) and the silent running high. */
  private evalBarSlLevels(cyc: Cycle, tz: TzLevel, cur: Day, ev: string[]): boolean {
    // BAR SL 2: a decisive close below a live BAR SL (no INVALID BAR SL on
    // it). It happens once: the race opens and every level is cleared.
    const hit = tz.barSlLevels.find((lv) => !lv.invalid && isSl(cur, lv.refLow));
    if (hit !== undefined) {
      // From BAR SL 2 the house only moves via REAR -> BAR ENTRY (user-
      // confirmed): other BAR rounds and the RED gate stop until then.
      const lin = new BarLineage(hit.label, hit.refHigh, hit.refLow);
      lin.bar2 = new Tier(hit.barTop, hit.refLow);
      lin.bar2.sl = true;
      lin.barTop = Math.max(hit.barTop, cur.h);
      lin.barSl = new Tier(hit.refHigh, hit.refLow);
      lin.barSlLive = true;
      lin.sl2 = true;
      tz.barLineages = [lin];
      tz.barSlLevels = [];
      tz.ghost = null;
      tz.barPending = false;
      tz.redSeek = false;
      tz.red = null;
      this.openRace(cyc);
      ev.push(`BAR SL2(${hit.label})`);
      return true;
    }
    // After INVALID BAR SL (once per BAR SL), the BAR SL reactivates: an SL
    // below the earlier BAR SL low is BAR SL again (a new BAR SL candle,
    // INVALID BAR SL / BAR SL 2 measured from it, and a new ghost cycle).
    const re = tz.barSlLevels.find((lv) => lv.invalid && isSl(cur, lv.refLow));
    let fresh: BarSlLevel | null = null;
    if (re !== undefined) {
      fresh = new BarSlLevel(re.label, cur.h, cur.l, Math.max(re.barTop, cur.h), re.ghostBorn);
      const f = fresh;
      tz.barSlLevels = tz.barSlLevels.map((lv) => (lv === re ? f : lv));
      tz.ghost = new Ghost(re.label);
      if (re.ghostBorn) this.hidden(`BAR SL(${re.label})`);
      else ev.push(`BAR SL(${re.label})`);
    }
    for (const lv of tz.barSlLevels) {
      if (cur.h > lv.barTop) lv.barTop = cur.h;
      if (lv === fresh) continue; // today's BAR SL candle
      const l = quietLl(cur, lv.refLow);
      if (l !== null) {
        lv.refLow = l;
        if (lv.ghostBorn || lv.invalid) this.hidden(`BAR SL LL(${lv.label})`);
        else ev.push(`BAR SL LL(${lv.label})`);
      }
      if (lv.invalid) continue;
      // INVALID BAR SL: once per BAR SL, above its running high.
      if (cur.h >= lv.refHigh + THRESH - EPS && cur.c >= lv.refHigh) {
        lv.invalid = true;
        this.hidden(`INVALID BAR SL(${lv.label})`);
      } else if (cur.h > lv.refHigh) lv.refHigh = cur.h;
    }
    tz.barSlLevels = tz.barSlLevels.filter((lv) => !(lv.invalid && lv.newerEntry));
    return false;
  }

  /** The ghost BAR cycle after a BAR SL (user-confirmed): the same BAR theory,
   * kept in the back end. Only the shown BAR that ends it is returned. */
  private evalGhost(tz: TzLevel, prev: Day, cur: Day): string[] {
    const g = tz.ghost!;

    // No live ghost BAR: the next green candle forms one.
    if (g.bar === null || g.bar.sl) {
      if (green(prev, cur)) {
        g.bar = new Tier(cur.h, cur.l);
        g.entry = null;
        g.entryEver = false;
        g.red2 = false;
        this.hidden("GHOST BAR");
      }
      return [];
    }

    // Ghost BAR ENTRY -> RED1 -> RED2, ghost BAR alive: the next green candle
    // is a shown BAR, and the normal BAR loop resumes.
    if (g.red2 && green(prev, cur)) {
      const label = this.nextBarLabel(tz);
      tz.barLineages = [new BarLineage(label, cur.h, cur.l)];
      tz.barPending = false;
      tz.ghost = null;
      return [`BAR1(${label})`];
    }

    const bar = g.bar;
    if (isSl(cur, bar.refLow)) {
      bar.sl = true;
      if (g.entryEver) {
        // A BAR SL (the ghost BAR had reached ghost BAR ENTRY): a new BAR SL
        // level and a new ghost cycle.
        if (g.entry !== null) g.entry.sl = true;
        tz.barSlLevels.push(new BarSlLevel(g.label, cur.h, cur.l, Math.max(g.top, cur.h), true));
        tz.ghost = new Ghost(g.label);
        this.hidden("GHOST BAR SL");
      } else {
        this.hidden("GHOST BAR SL (bare)");
      }
      return [];
    }
    const bl = quietLl(cur, bar.refLow);
    if (bl !== null) bar.refLow = bl;

    if (!g.entryEver) {
      if (breaksRef(prev, cur, bar.refHigh)) {
        g.entry = new Tier(cur.h, cur.l);
        g.entryEver = true;
        g.top = cur.h;
        // RED1 -> RED2 is sought after the ghost BAR ENTRY.
        tz.red = null;
        tz.redSeek = true;
        this.markBarEntry(tz);
        this.hidden("GHOST BAR ENTRY");
      } else if (cur.h > bar.refHigh) bar.refHigh = cur.h;
      return [];
    }
    if (cur.h > g.top) g.top = cur.h;
    const e = g.entry!;
    if (!e.sl) {
      if (cur.h > e.refHigh) e.refHigh = cur.h;
      const el = quietLl(cur, e.refLow);
      if (el !== null) e.refLow = el;
      if (isSl(cur, e.refLow)) {
        e.sl = true;
        this.hidden("GHOST BAR ENTRY SL");
      }
    } else if (green(prev, cur)) {
      // No RED2 yet: ghost BAR ENTRY again on the next green candle.
      g.entry = new Tier(cur.h, cur.l);
      this.markBarEntry(tz);
      this.hidden("GHOST BAR ENTRY");
    }
    return [];
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
        const name = earlier !== undefined && earlier.bar2!.sl ? "BAR 2" : "BAR ENTRY";
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

    // Stage 1: BAR SL (BAR ENTRY SL included), measured from the anchor
    // BAR1's low (or REAR B's low once REAR B acts as BAR1).
    if (!lin.barSlLive && !lin.sl2) {
      const level = lin.barSl !== null ? lin.barSl.refLow : lin.refLow;
      if (isSl(cur, level)) {
        if (!b2.sl) {
          b2.sl = true;
          ev.push(`BAR ENTRY SL(${L})`);
        }
        ev.push(`BAR SL(${L})`);
        // No REAR: a BAR SL level, and the ghost BAR cycle from the next green
        // candle. A newer BAR1 in progress is dropped (a new BAR needs the BAR
        // SL not to have triggered).
        tz.barSlLevels.push(new BarSlLevel(L, cur.h, cur.l, Math.max(lin.barTop, cur.h), false));
        tz.barLineages = [];
        tz.barPending = false;
        tz.ghost = new Ghost(L);
        return true;
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
        if (!slNow) ev.push(`BAR ENTRY HH(${L})`);
      }
      const l = quietLl(cur, b2.refLow);
      if (l !== null) {
        b2.refLow = l;
        ev.push(`BAR ENTRY LL(${L})`);
      }
      if (slNow) {
        b2.sl = true;
        ev.push(`BAR ENTRY SL(${L})`);
      }
      return false;
    }

    // BAR ENTRY sits SL'd.
    // A REAR is waiting: BAR ENTRY re-forms above its high.
    if (lin.rear !== null) {
      const r = lin.rear;
      if (breaksRef(prev, cur, r.refHigh)) {
        // BAR ENTRY above REAR B; REAR B now acts as BAR1 (same as REAR A
        // acting as TZ BUY): a later BAR SL is measured from its low.
        lin.refHigh = r.refHigh;
        lin.refLow = r.refLow;
        lin.barSl = null;
        lin.bar2 = new Tier(cur.h, cur.l);
        if (cur.h > lin.barTop) lin.barTop = cur.h;
        lin.rear = null;
        lin.rearHigh = null;
        lin.barSlLive = false;
        lin.sl2 = false;
        tz.redSeek = true;
        this.raceEntry(cyc);
        ev.push(`BAR ENTRY(${L})`);
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

    // Plain BAR ENTRY SL (BAR still active): BAR ENTRY again on the next green
    // candle -- unless a RED2 has armed a new BAR cycle (BAR1 on the next green
    // candle instead, see evalBarLineages) (user-confirmed).
    if (!lin.barSlLive && !lin.sl2 && lin.rearHigh === null) {
      // A newer BAR1 already exists (RED2 completed before this SL): no re-entry.
      if (tz.barLineages.indexOf(lin) < tz.barLineages.length - 1) lin.noReentry = true;
      if (lin.noReentry || tz.barPending) {
        // BAR ENTRY SL + RED2: this BAR cannot re-enter; its running high is
        // kept silently (the race REAR after a BAR SL 2 must clear it).
        if (cur.h > lin.barTop) lin.barTop = cur.h;
        return false;
      }
      if (green(prev, cur)) {
        lin.bar2 = new Tier(cur.h, cur.l);
        if (cur.h > lin.barTop) lin.barTop = cur.h;
        tz.redSeek = true;
        ev.push(`BAR ENTRY(${L})`);
        return false;
      }
      if (cur.h > lin.barTop) {
        lin.barTop = cur.h;
        ev.push(`INVALID BAR ENTRY HH(${L})`);
      }
      return false;
    }

    // After BAR SL 2: the race REAR above BAR ENTRY's running high (or, after a
    // REAR SL, above that REAR's running high), then BAR ENTRY above that REAR.
    const afterRearSl = lin.rearHigh !== null;
    const target = afterRearSl ? lin.rearHigh! : lin.barTop;
    if (breaksRef(prev, cur, target)) {
      lin.rear = new Tier(cur.h, cur.l);
      ev.push(`REAR B(${L})`);
    } else if (cur.h > target) {
      if (afterRearSl) {
        lin.rearHigh = cur.h;
        ev.push(`INVALID REAR B HH(${L})`);
      } else {
        lin.barTop = cur.h;
        ev.push(`INVALID BAR ENTRY HH(${L})`);
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
