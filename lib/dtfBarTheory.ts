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
// Rules (user-confirmed unless marked "default", which are flagged per day in
// `dayDoubts` so a report can show them):
//
// House: TZ GREEN (green candle) -> RED1 -> RED2 -> TZ BUY (green candle).
//   TZ GREEN SL (SL of TZ GREEN's reference low) is possible every day the
//   house is live and ends it. TZ GREEN HH is tracked, not recorded.
// Two levels, each with a stage 1 and a stage 2:
//   TZ level:  stage 1 = TZ BUY (or REAR A), stage 2 = TZ BUY ENTRY.
//   BAR level: stage 1 = BAR1 (or REAR B),   stage 2 = BAR ENTRY (BAR2).
// TZ BUY ENTRY: breakout over TZ BUY's high, or over a REAR's high. Required
//   before RED1 -> RED2 -> BAR1 -> BAR ENTRY, which then repeats.
// Bare stage 1 SL (no stage 2 yet): TZ BUY / BAR1 re-forms on the next green
//   candle.
// TZ BUY ENTRY SL with TZ BUY still active: REAR C on the next green candle,
//   then TZ BUY ENTRY above REAR C's high. REAR C SL -> REAR C again on the
//   next green candle; REAR C stops being tracked once TZ BUY ENTRY forms above
//   it. BAR is not considered unless TZ BUY ENTRY is active:
//   TZ BUY ENTRY SL ends the BAR stage (the RED gate keeps running, and BAR1
//   can only form once TZ BUY ENTRY is active again). While TZ BUY ENTRY sits
//   SL'd, every new high above TZ BUY ENTRY's running reference high (highest
//   high since the original TZ BUY ENTRY) is INVALID TZ BUY ENTRY HH; the REAR
//   after a TZ BUY SL must clear that high.
// BAR level (only while TZ BUY ENTRY is active). RED1 -> RED2 keeps running;
//   BAR1 (green candle after RED2) -> BAR ENTRY only while BAR ENTRY is
//   active (or before the first one). Bare BAR1 SL: BAR1 again on the next
//   green candle. The previous BAR ENTRY stays live until the next BAR ENTRY.
//   BAR ENTRY SL: REAR above BAR ENTRY's running reference high (INVALID BAR
//     ENTRY HH raises it), then BAR ENTRY above that REAR's high.
//   Anchor BAR SL (BAR ENTRY SL included): REAR above the BAR SL candle's high
//     (BAR SL HH raises it), then BAR ENTRY above that REAR's high. No race.
//   BAR SL 2 (old rule: BAR SL LL lowers the BAR SL low; a decisive close
//     below it is BAR SL 2): opens the race; REAR above BAR ENTRY's running
//     reference high, then BAR ENTRY above that REAR's high.
//   REAR SL (REAR does not act as BAR1): the next REAR must clear the earlier
//     REAR's running high (INVALID REAR HH raises it).
// TZ level stage 1 SL after TZ BUY ENTRY (both SLs recorded): REAR A above
//   TZ BUY ENTRY's running reference high, then TZ BUY ENTRY above REAR A's
//   high; REAR A then acts as stage 1. A REAR A SL before its TZ BUY ENTRY:
//   the next REAR must clear that REAR's own high; after it: acts as TZ BUY SL.
// Race (TZ BUY SL after TZ BUY ENTRY, or BAR SL 2): this house's REAR vs a new
//   house's TZ BUY. REAR first, or on the same day: REAR wins and the new
//   house stops. New house's TZ BUY first: this house goes dormant (nothing
//   shown) and is terminated once the new house reaches BAR ENTRY.

import { THRESH, EPS, type Day, type HistoryRowLike } from "./tzEngineWtf";

function breaksRef(prev: Day, cur: Day, ref: number): boolean {
  return cur.l >= prev.l && cur.h > ref && cur.h - ref >= THRESH - EPS && cur.c >= ref;
}

/** The green candle: TZ GREEN / TZ BUY / BAR1 / REAR C all use it. */
function green(prev: Day, cur: Day): boolean {
  return breaksRef(prev, cur, prev.h);
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
  /** BAR SL 2 has fired (opens the race). */
  sl2 = false;
  /** The REAR waiting for BAR ENTRY to re-form above it. */
  rear: Tier | null = null;
  /** After a REAR SL: the earlier REAR's running high the next REAR must clear. */
  rearHigh: number | null = null;
  constructor(public label: string, public refHigh: number, public refLow: number) {}
}

/** TZ level of a house: stage 1 (TZ BUY or REAR A) + stage 2 (TZ BUY ENTRY),
 * plus the RED gate and BAR stage under TZ BUY ENTRY. */
export class TzLevel {
  s1Kind: "TZ BUY" | "REAR A" = "TZ BUY";
  s1Alive = true;
  bareSl = false;
  entry: Tier | null = null;
  /** TZ BUY ENTRY's running reference high: the highest high since the
   * stage 1's first TZ BUY ENTRY, across REAR -> TZ BUY ENTRY reactivations
   * and INVALID TZ BUY ENTRY HH raises. The REAR after a TZ BUY SL must clear
   * it (user-confirmed). Reset when a new stage 1 (REAR A) gets its own TZ
   * BUY ENTRY. */
  entryTop = 0;
  rearC: Tier | null = null;
  seek: RearSeek | null = null;
  red: Red | null = null;
  redSeek = false;
  barPending = false;
  barLineages: BarLineage[] = [];
  barGen = 0;
  barDeadLabels = new Set<number>();
  barEntryEver = false;
  constructor(public refHigh: number, public refLow: number) {}

  resetBarStage(): void {
    this.red = null;
    this.redSeek = false;
    this.barPending = false;
    this.barLineages = [];
    this.barEntryEver = false;
  }
}

export class Race {
  won = false;
  lost = false;
  rearToday = false;
}

/** One house: TZ GREEN -> ... */
export class Cycle {
  active = true;
  red: Red | null = null;
  tz: TzLevel | null = null;
  race: Race | null = null;
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
    const hadBuy = new Set(this.cycles.filter((c) => c.active && c.tz !== null).map((c) => c.seq));
    for (const c of this.cycles) if (c.race) c.race.rearToday = false;

    for (const cyc of this.cycles) {
      if (!cyc.active) continue;
      this.cur = cyc;
      byCycle.set(cyc, this.evalHouse(cyc, prev, cur));
    }

    // Resolve races, oldest racing house first.
    for (const old of this.cycles) {
      const race = old.race;
      if (!old.active || race === null || race.won || race.lost) continue;
      const younger = this.cycles.filter((c) => c.seq > old.seq && c.active);
      const newBuyBefore = younger.some((c) => hadBuy.has(c.seq));
      const newBuyToday = younger.some((c) => c.tz !== null && !hadBuy.has(c.seq));
      if (newBuyBefore || (newBuyToday && !race.rearToday)) {
        race.lost = true;
      } else if (race.rearToday) {
        race.won = true;
        for (const c of younger) {
          c.active = false;
          byCycle.delete(c);
        }
      }
    }

    const ev: TaggedEvent[] = [];
    for (const [cyc, texts] of byCycle) {
      if (cyc.race?.lost) continue; // dormant: nothing of it is shown
      for (const text of texts) ev.push({ seq: cyc.seq, text });
    }
    this.dayDoubts = this.dayDoubts.filter((d) => !this.cycles.find((c) => c.seq === d.seq)?.race?.lost);

    const blocking = this.cycles.some((c) => c.active && !(c.race !== null && !c.race.won));
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
    if (cyc.race === null || cyc.race.won) {
      if (cyc.race?.won) this.doubt("race re-opens after REAR had won it");
      cyc.race = new Race();
    }
  }

  private rearFormed(cyc: Cycle): void {
    if (cyc.race !== null && !cyc.race.won && !cyc.race.lost) cyc.race.rearToday = true;
  }

  // -----------------------------------------------------------------
  private evalHouse(cyc: Cycle, prev: Day, cur: Day): string[] {
    // Dormant house: terminated once the new house reaches BAR ENTRY.
    if (cyc.race?.lost && this.cycles.some((c) => c.seq > cyc.seq && c.active && c.tz?.barEntryEver)) {
      cyc.active = false;
      return [];
    }

    const ev: string[] = [];
    const tz = cyc.tz;
    if (cur.h > cyc.refHigh) cyc.refHigh = cur.h; // TZ GREEN HH: not recorded
    if (isSl(cur, cyc.refLow)) {
      if (cyc.race !== null && !cyc.race.won) this.doubt("TZ GREEN SL while the race is open ends the house");
      cyc.active = false;
      return ["TZ GREEN SL"];
    }
    const low = quietLl(cur, cyc.refLow);
    if (low !== null) {
      cyc.refLow = low;
      if (tz === null || !tz.s1Alive) ev.push("TZ GREEN LL");
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
      tz.barPending = true;
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

    // Bare TZ BUY SL: TZ BUY again on the next green candle.
    if (tz.bareSl) {
      if (green(prev, cur)) {
        tz.bareSl = false;
        tz.s1Alive = true;
        tz.refHigh = cur.h;
        tz.refLow = cur.l;
        ev.push("TZ BUY");
      }
      return ev;
    }

    // Waiting for REAR A (stage 1 SL'd after TZ BUY ENTRY).
    if (tz.seek !== null) {
      const s = tz.seek;
      if (s.rear !== null) {
        if (breaksRef(prev, cur, s.rear.refHigh)) {
          // TZ BUY ENTRY above REAR A; REAR A becomes stage 1.
          tz.s1Kind = "REAR A";
          tz.s1Alive = true;
          tz.refHigh = s.rear.refHigh;
          tz.refLow = s.rear.refLow;
          tz.entry = new Tier(cur.h, cur.l);
          tz.entryTop = cur.h;
          tz.seek = null;
          tz.redSeek = true;
          return ["TZ BUY ENTRY"];
        }
        if (this.evalRearTier(s.rear, "REAR A", cur, ev)) {
          s.target = s.rear.refHigh;
          s.afterRearSl = true;
          s.rear = null;
          if (cyc.race?.won) this.openRace(cyc);
        }
        return ev;
      }
      if (breaksRef(prev, cur, s.target)) {
        if (s.afterRearSl) this.doubt("REAR after a REAR SL: must clear that REAR's own high");
        s.rear = new Tier(cur.h, cur.l);
        this.rearFormed(cyc);
        return ["REAR A"];
      }
      if (cur.h > s.target) {
        s.target = cur.h;
        if (s.afterRearSl) this.doubt("REAR after a REAR SL: must clear that REAR's own high");
        return [s.afterRearSl ? "INVALID REAR A HH" : "INVALID TZ BUY ENTRY HH"];
      }
      return ev;
    }

    // First TZ BUY ENTRY: above TZ BUY's high.
    if (tz.entry === null && breaksRef(prev, cur, tz.refHigh)) {
      tz.entry = new Tier(cur.h, cur.l);
      tz.entryTop = cur.h;
      tz.refHigh = cur.h;
      tz.redSeek = true;
      tz.red = null;
      return ["TZ BUY ENTRY"];
    }

    // Stage 1: TZ BUY (or REAR A) HH / LL / SL.
    const s1Name = tz.s1Kind;
    const s1Sl = isSl(cur, tz.refLow);
    if (cur.h > tz.refHigh) {
      tz.refHigh = cur.h;
      if (!s1Sl && tz.entry === null) ev.push("TZ BUY HH");
    }
    const l1 = quietLl(cur, tz.refLow);
    if (l1 !== null) {
      tz.refLow = l1;
      ev.push(`${s1Name} LL`);
    }
    if (s1Sl) {
      tz.s1Alive = false;
      tz.rearC = null;
      if (tz.entry === null) {
        tz.bareSl = true;
        ev.push("TZ BUY SL");
      } else {
        if (!tz.entry.sl) ev.push("TZ BUY ENTRY SL");
        ev.push(`${s1Name} SL`);
        if (cyc.race !== null && !cyc.race.won && !cyc.race.lost)
          this.doubt("TZ BUY SL while this house's BAR SL race is still open");
        // TZ BUY SL, or REAR A SL acting as TZ BUY SL: the next REAR must
        // clear the reference high of the latest TZ BUY ENTRY (user-confirmed).
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
        tz.rearC = null;
        ev.push("TZ BUY ENTRY SL");
        // BAR is not considered unless TZ BUY ENTRY is active (user-
        // confirmed): the BAR stage ends here. The RED gate keeps running.
        if (tz.barLineages.length > 0)
          this.doubt("TZ BUY ENTRY SL ends the live BAR stage (BAR not considered while TZ BUY ENTRY is SL'd)");
        tz.barLineages = [];
        tz.barPending = false;
        tz.barEntryEver = false;
        if (s1Name === "REAR A") this.doubt("TZ BUY ENTRY SL under REAR (a): REAR (c) logic applied");
      }
    } else if (e !== null && e.sl) {
      let reformed = false;
      {
        if (tz.rearC !== null && !tz.rearC.sl) {
          if (breaksRef(prev, cur, tz.rearC.refHigh)) {
            tz.entry = new Tier(cur.h, cur.l);
            if (cur.h > tz.entryTop) tz.entryTop = cur.h;
            tz.rearC = null;
            tz.redSeek = true;
            ev.push("TZ BUY ENTRY");
            reformed = true;
          } else {
            this.evalRearTier(tz.rearC, "REAR C", cur, ev);
          }
        } else if (green(prev, cur)) {
          tz.rearC = new Tier(cur.h, cur.l);
          ev.push("REAR C");
        }
      }
      // Every new high above TZ BUY ENTRY's running reference high is
      // INVALID TZ BUY ENTRY HH and raises it (user-confirmed).
      if (!reformed && cur.h > tz.entryTop) {
        tz.entryTop = cur.h;
        ev.push("INVALID TZ BUY ENTRY HH");
      }
      if (reformed) return ev;
    }

    // BAR stage (only while TZ BUY ENTRY is active) and RED gate.
    const bar = tz.entry !== null && !tz.entry.sl ? this.evalBarLineages(cyc, tz, prev, cur) : [];
    if (!tz.barEntryEver && bar.some((x) => /^BAR2\(/.test(x))) {
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
    // A new BAR1 only while BAR ENTRY is active (or before the first one).
    const anchor = tz.barLineages.find((l) => l.bar2 !== null);
    const bar2Active = anchor === undefined || !anchor.bar2!.sl;
    if (tz.barPending && bar2Active && green(prev, cur)) {
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

  /** BAR ENTRY is no longer active: a newer BAR1 in progress, or a RED2 that
   * armed one, is dropped (BAR is only considered while BAR ENTRY is active). */
  private dropNewerBar(tz: TzLevel, lin: BarLineage): void {
    if (tz.barLineages.length > 1 || tz.barPending)
      this.doubt("BAR ENTRY SL drops the newer BAR 1 in progress / the RED 2 that armed it");
    tz.barLineages = [lin];
    tz.barPending = false;
  }

  /** Returns true when the lineage set was replaced (stop iterating). */
  private evalLineage(cyc: Cycle, tz: TzLevel, lin: BarLineage, prev: Day, cur: Day, ev: string[]): boolean {
    const L = lin.label;

    // Fresh BAR1 (no BAR ENTRY yet).
    if (lin.bar2 === null) {
      if (breaksRef(prev, cur, lin.refHigh)) {
        lin.bar2 = new Tier(cur.h, cur.l);
        lin.barTop = cur.h;
        tz.barLineages = [lin]; // the next BAR ENTRY supersedes the previous one
        tz.redSeek = true;
        ev.push(`BAR2(${L})`);
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

    // Stage 1: the anchor BAR1, until its own BAR SL (BAR ENTRY SL included).
    if (lin.barSl === null && !lin.sl2) {
      if (isSl(cur, lin.refLow)) {
        if (!b2.sl) {
          b2.sl = true;
          ev.push(`BAR2 SL(${L})`);
        }
        lin.barSl = new Tier(cur.h, cur.l);
        lin.rear = null;
        lin.rearHigh = null;
        ev.push(`BAR SL(${L})`);
        this.dropNewerBar(tz, lin);
        return true;
      }
      if (cur.h > lin.refHigh) lin.refHigh = cur.h;
      const l1 = quietLl(cur, lin.refLow);
      if (l1 !== null) {
        lin.refLow = l1;
        ev.push(`BAR1 LL(${L})`);
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
        this.dropNewerBar(tz, lin);
      }
      return false;
    }

    // BAR ENTRY sits SL'd. After a BAR SL: BAR SL LL, or BAR SL 2 (old rule).
    if (lin.barSl !== null && !lin.sl2) {
      if (isSl(cur, lin.barSl.refLow)) {
        lin.sl2 = true;
        lin.rear = null;
        lin.rearHigh = null;
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
        lin.barSl = null;
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
    } else if (lin.barSl !== null && !lin.sl2) {
      kind = "barsl";
      target = lin.barSl.refHigh;
    } else {
      kind = "bar2";
      target = lin.barTop;
    }
    if (breaksRef(prev, cur, target)) {
      lin.rear = new Tier(cur.h, cur.l);
      if (lin.sl2) this.rearFormed(cyc);
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
