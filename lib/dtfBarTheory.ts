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
//   next green candle. BAR is not considered unless TZ BUY ENTRY is active:
//   TZ BUY ENTRY SL ends the BAR stage (the RED gate keeps running, and BAR1
//   can only form once TZ BUY ENTRY is active again). While TZ BUY ENTRY sits SL'd, a higher high
//   is INVALID TZ BUY ENTRY HH and raises its frozen high (default).
// BAR ENTRY SL with its BAR1 still alive: INVALID BAR ENTRY HH raises its
//   frozen high; RED2 (before or after) -> BAR1 -> BAR ENTRY; BAR ENTRY re-forms
//   directly above its frozen high (default).
// Stage 1 SL after (or with) stage 2 -- both SLs recorded:
//   TZ level: REAR A above TZ BUY ENTRY's frozen high, then TZ BUY ENTRY above
//     REAR A's high. REAR A then acts as stage 1.
//   BAR level: REAR B above BAR ENTRY's frozen high, then BAR ENTRY above
//     REAR B's high. REAR B then acts as stage 1.
//   A REAR A/B SL before its stage 2 re-forms: the next REAR must clear that
//   REAR's own high (INVALID REAR HH raises it) (default for REAR B). A REAR A
//   SL after its TZ BUY ENTRY acts as TZ BUY SL: the next REAR must clear that
//   TZ BUY ENTRY's reference high, and the race re-opens.
// Race: a stage 1 SL after stage 2 opens a race between this house's REAR
//   (A or B) and a new house's TZ BUY (default for the BAR level). REAR first,
//   or on the same day: REAR wins and the new house stops. New house's TZ BUY
//   first: this house goes dormant (nothing shown) and is terminated once the
//   new house reaches BAR ENTRY. A later stage 1 SL after a won race re-opens
//   the race (default).

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
  s1Kind: "BAR1" | "REAR B" = "BAR1";
  bar2: Tier | null = null;
  seek: RearSeek | null = null;
  constructor(public label: string, public refHigh: number, public refLow: number) {}
}

/** TZ level of a house: stage 1 (TZ BUY or REAR A) + stage 2 (TZ BUY ENTRY),
 * plus the RED gate and BAR stage under TZ BUY ENTRY. */
export class TzLevel {
  s1Kind: "TZ BUY" | "REAR A" = "TZ BUY";
  s1Alive = true;
  bareSl = false;
  entry: Tier | null = null;
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
        tz.seek = new RearSeek(tz.entry.refHigh, false);
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
      let rearCToday = false;
      {
        if (tz.rearC !== null && !tz.rearC.sl) {
          if (breaksRef(prev, cur, tz.rearC.refHigh)) {
            tz.entry = new Tier(cur.h, cur.l);
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
          rearCToday = true;
        }
      }
      if (!reformed && cur.h > e.refHigh) {
        e.refHigh = cur.h;
        if (!rearCToday && (tz.rearC === null || tz.rearC.sl)) {
          ev.push("INVALID TZ BUY ENTRY HH");
          this.doubt("INVALID TZ BUY ENTRY HH recorded while TZ BUY is still active");
        }
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
    if (tz.barPending && green(prev, cur)) {
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
        lin.bar2 = new Tier(cur.h, cur.l);
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

    // Waiting for REAR B (stage 1 SL'd after BAR ENTRY).
    if (lin.seek !== null) {
      const s = lin.seek;
      if (s.rear !== null) {
        if (breaksRef(prev, cur, s.rear.refHigh)) {
          lin.s1Kind = "REAR B";
          lin.refHigh = s.rear.refHigh;
          lin.refLow = s.rear.refLow;
          lin.bar2 = new Tier(cur.h, cur.l);
          lin.seek = null;
          tz.redSeek = true;
          ev.push(`BAR2(${L})`);
          return false;
        }
        if (this.evalRearTier(s.rear, `REAR B`, cur, ev)) {
          s.target = s.rear.refHigh;
          s.afterRearSl = true;
          s.rear = null;
          if (cyc.race?.won) this.openRace(cyc);
        }
        for (let i = ev.length - 1; i >= 0 && /^REAR B/.test(ev[i]) && !ev[i].includes("("); i--)
          ev[i] = `${ev[i]}(${L})`;
        return false;
      }
      if (breaksRef(prev, cur, s.target)) {
        if (s.afterRearSl) this.doubt("REAR after a REAR SL: must clear that REAR's own high");
        s.rear = new Tier(cur.h, cur.l);
        this.rearFormed(cyc);
        ev.push(`REAR B(${L})`);
      } else if (cur.h > s.target) {
        s.target = cur.h;
        if (s.afterRearSl) this.doubt("REAR after a REAR SL: must clear that REAR's own high");
        ev.push(s.afterRearSl ? `INVALID REAR B HH(${L})` : `INVALID BAR2 HH(${L})`);
      }
      return false;
    }

    // Stage 1 of the BAR level (anchor BAR1, or REAR B): its own SL.
    if (isSl(cur, lin.refLow)) {
      if (!b2.sl) ev.push(`BAR2 SL(${L})`);
      ev.push(lin.s1Kind === "BAR1" ? `BAR SL(${L})` : `REAR B SL(${L})`);
      lin.seek =
        lin.s1Kind === "REAR B" ? new RearSeek(lin.refHigh, true) : new RearSeek(b2.refHigh, false);
      // Only REAR B is sought from here: no further BAR rounds or RED gate.
      tz.barLineages = [lin];
      tz.barPending = false;
      tz.redSeek = false;
      tz.red = null;
      this.doubt("BAR SL after BAR ENTRY opens a race with a new house");
      this.openRace(cyc);
      return true;
    }
    if (cur.h > lin.refHigh) lin.refHigh = cur.h;
    const l1 = quietLl(cur, lin.refLow);
    if (l1 !== null) {
      lin.refLow = l1;
      ev.push(lin.s1Kind === "BAR1" ? `BAR1 LL(${L})` : `REAR B LL(${L})`);
    }

    // Stage 2: BAR ENTRY.
    if (!b2.sl) {
      const slNow = isSl(cur, b2.refLow);
      if (cur.h > b2.refHigh) {
        b2.refHigh = cur.h;
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
    if (breaksRef(prev, cur, b2.refHigh)) {
      lin.bar2 = new Tier(cur.h, cur.l);
      tz.redSeek = true;
      ev.push(`BAR2(${L})`);
      this.doubt("BAR ENTRY re-formed directly above its frozen high (no REAR)");
      return false;
    }
    if (cur.h > b2.refHigh) {
      b2.refHigh = cur.h;
      ev.push(`INVALID BAR2 HH(${L})`);
    }
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
