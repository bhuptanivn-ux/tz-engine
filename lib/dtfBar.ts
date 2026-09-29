// DTF BAR -- a DTF-only theory, NOT the same theory as TZ BUY
// (tz_engine_wtf.py / lib/tzEngineWtf.ts) run on daily candles: it
// restructures the top-level skeleton itself --
//
//   - no TZ BUY 2 tier at all
//   - a mandatory RED1->RED2 cascade (not a single RED) before TZ BUY can
//     ever form
//   - TZ BUY forms via a plain day-over-day breakout (the same shape BAR1
//     uses in the base engine), NOT by clearing TZ GREEN's or RED2's own
//     reference high
//   - a new TZ BUY SL 2 concept, playing the exact role BAR SL2 plays in
//     the base engine: it's what opens the door to REAR
//   - if a post-TZ-BUY (or post-REAR) RED2 dip is also deep enough to
//     breach the parent tier's own SL threshold on the same candle, the
//     parent tier's own SL wins outright -- not RED2, not both
//
// Direct, faithful line-for-line TypeScript port of dtf_bar.py -- every
// condition, ordering, and mutation matches the Python original exactly.
// Reuses THRESH/EPS/Day from lib/tzEngineWtf.ts so every numeric rule
// (0.20 pt clearance, Close confirmation, quiet-climb/quiet-drop updates)
// stays identical to the rest of the codebase. Does NOT import, modify,
// or depend on TZEngine -- fully separate, self-contained state machine,
// same "separate file" precedent as lib/primeTrend.ts.
//
// INFERRED (not literally spelled out, flagged in dtf_bar.py's own module
// docstring for review): a BAR SL2 that happens under REAR's own BAR
// lineage is treated the same way REAR's own SL is treated -- it opens
// REAR RE-ENTER, one level down, the same way a top-level BAR SL2 opens
// REAR itself. REAR RE-ENTER, once formed, reactivates in place (same
// object) above its own frozen reference high after each subsequent SL.
//
// SCOPE OF THIS FIRST PASS (NOT yet verified against real data):
//   - Single lineage only -- no concurrent sibling TZ GREEN cycles (the
//     base engine's A/B/C branch racing, dormancy, milestone-achiever
//     collateral termination) are reproduced here. Only one cycle is ever
//     "live" at a time.
//   - BAR generations are unlimited but SEQUENTIAL only -- no
//     concurrent/racing lineages.

import { THRESH, EPS, type Day, type HistoryRowLike } from "./tzEngineWtf";

function breaksRef(prev: Day, cur: Day, ref: number): boolean {
  return cur.l >= prev.l && cur.h > ref && cur.h - ref >= THRESH - EPS && cur.c >= ref;
}

/** The plain day-over-day breakout BAR1 uses in the base engine -- no
 * fixed reference to clear beyond yesterday's own high. Also what TZ BUY
 * itself uses in DTF BAR (once RED1->RED2 has completed). */
function bar1Shape(prev: Day, cur: Day): boolean {
  return cur.l >= prev.l && cur.h > prev.h && cur.h - prev.h >= THRESH - EPS && cur.c >= prev.h;
}

function isSl(cur: Day, refLow: number): boolean {
  return cur.l <= refLow && refLow - cur.l >= THRESH - EPS && cur.c <= refLow + EPS;
}

function quietHh(cur: Day, refHigh: number): number | null {
  return cur.h > refHigh ? cur.h : null;
}

function quietLl(cur: Day, refLow: number): number | null {
  if (cur.l >= refLow) return null;
  const gap = refLow - cur.l;
  if ((gap >= THRESH - EPS && cur.c > refLow + EPS) || gap < THRESH - EPS) return cur.l;
  return null;
}

interface RefPair {
  refHigh: number;
  refLow: number;
}

// ---------------------------------------------------------------------
// State objects
// ---------------------------------------------------------------------

/** RED1/RED2, reused identically at every tier that needs a mandatory
 * pullback-then-confirm gate (pre-TZ-BUY, post-TZ-BUY, post-REAR). */
export class Red {
  active = true;
  constructor(public refHigh: number, public refLow: number) {}
}

export class BarSL {
  sl2 = false; // the SL's own recovery attempt failed again -> BAR SL2
  constructor(public refHigh: number, public refLow: number) {}
}

export class Bar2 {
  constructor(public refHigh: number, public refLow: number) {}
}

export class BarLineage {
  bar2: Bar2 | null = null;
  sl: BarSL | null = null;
  constructor(public label: string, public refHigh: number, public refLow: number) {}
}

export class RearSL {
  constructor(public refLow: number) {}
}

export class RearReenter {
  sl: RearSL | null = null;
  constructor(public refHigh: number, public refLow: number) {}
}

export class Rear {
  active = true;
  rear2: Bar2 | null = null; // optional escalation above REAR's own reference, mirrors BAR2
  sl: RearSL | null = null;
  reenter: RearReenter | null = null;
  // Post-REAR RED1/RED2, pulling back directly against REAR's (or REAR
  // RE-ENTER's) own reference -- mandatory before a fresh BAR1 can form.
  red: Red | null = null;
  redEver = false;
  barLineages: BarLineage[] = [];
  barPending = false;
  barGen = 0;
  barDeadLabels = new Set<number>();
  constructor(public refHigh: number, public refLow: number) {}
}

export class TzBuySL {
  sl2 = false; // TZ BUY's own reactivation failed again -> TZ BUY SL 2, opens REAR
  constructor(public refHigh: number, public refLow: number) {}
}

export class TzBuy {
  active = true;
  sl: TzBuySL | null = null;
  // Post-TZ-BUY RED1/RED2, pulling back directly against TZ BUY's own
  // reference (there is no TZ BUY 2 tier in this theory).
  red: Red | null = null;
  redEver = false;
  barLineages: BarLineage[] = [];
  barPending = false;
  barGen = 0;
  barDeadLabels = new Set<number>();
  rear: Rear | null = null;
  rearGateOpen = false; // TZ BUY SL 2 fired -- REAR may now form
  constructor(public refHigh: number, public refLow: number) {}
}

/** One full TZ GREEN -> ... lineage. A fresh Cycle starts once the
 * previous one is fully done (no live TZ BUY). */
export class Cycle {
  active = true;
  redEver = false; // pre-TZ-BUY RED1/RED2 mandatory gate
  red: Red | null = null;
  buy: TzBuy | null = null;
  constructor(public seq: number, public refHigh: number, public refLow: number) {}
}

type BarHost = TzBuy | Rear;

// ---------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------

export class DtfBarEngine {
  cycles: Cycle[] = [];
  private seq = 0;

  private curCycle(): Cycle | null {
    return this.cycles.length > 0 ? this.cycles[this.cycles.length - 1] : null;
  }

  process(prev: Day, cur: Day): string[] {
    const ev: string[] = [];
    const cyc = this.curCycle();

    const canSpawn = cyc === null || !cyc.active;
    if (canSpawn && bar1Shape(prev, cur)) {
      this.seq += 1;
      const newCyc = new Cycle(this.seq, cur.h, cur.l);
      this.cycles.push(newCyc);
      ev.push("TZ GREEN");
      return ev; // freshly spawned cycle isn't evaluated same-candle
    }

    if (cyc !== null && cyc.active) {
      ev.push(...this.evalCycle(cyc, prev, cur));
    }
    return ev;
  }

  // -----------------------------------------------------------------
  private evalCycle(cyc: Cycle, prev: Day, cur: Day): string[] {
    const ev: string[] = [];
    const isSlNow = isSl(cur, cyc.refLow);
    const hasLiveBuy = cyc.buy !== null && cyc.buy.active;

    const newHigh = quietHh(cur, cyc.refHigh);
    if (newHigh !== null) {
      cyc.refHigh = newHigh;
      if (!hasLiveBuy && !isSlNow) ev.push("TZ GREEN HH");
    }
    const newLow = quietLl(cur, cyc.refLow);
    if (newLow !== null) {
      cyc.refLow = newLow;
      if (!hasLiveBuy) ev.push("TZ GREEN LL");
    }

    if (cyc.buy !== null && cyc.buy.refHigh > cyc.refHigh) {
      cyc.refHigh = cyc.buy.refHigh;
    }

    if (isSlNow) {
      ev.push("TZ GREEN SL");
      cyc.active = false;
      return ev;
    }

    // Pre-TZ-BUY RED1 -> RED2 (mandatory -- no direct TZ GREEN -> TZ BUY
    // path in this theory). TZ BUY itself only watches for the plain
    // BAR1-style breakout once RED2 has confirmed.
    if (cyc.buy === null) {
      if (cyc.red === null) {
        if (cur.h <= prev.h && cur.l < prev.l && prev.l - cur.l >= THRESH - EPS && cur.c <= prev.l) {
          cyc.redEver = true;
          cyc.red = new Red(cur.h, cur.l);
          ev.push("RED1");
        }
      } else if (cyc.red.active) {
        ev.push(...this.evalRed(cyc.red, prev, cur, "RED1", "RED2", "RED1 HH"));
      } else if (bar1Shape(prev, cur)) {
        cyc.buy = new TzBuy(cur.h, cur.l);
        ev.push("TZ BUY");
      }
    }

    if (cyc.buy !== null) {
      ev.push(...this.evalBuy(cyc.buy, prev, cur));
    }
    return ev;
  }

  // -----------------------------------------------------------------
  /** RED1 -> RED2, reused identically at every tier. */
  private evalRed(red: Red, prev: Day, cur: Day, label1: string, label2: string, hhLabel: string): string[] {
    const ev: string[] = [];
    if (cur.h > red.refHigh && cur.h - red.refHigh >= THRESH - EPS && cur.c >= red.refHigh) {
      ev.push(`INVALID ${label1}`);
      red.active = false;
      return ev;
    }
    if (cur.h > red.refHigh) {
      red.refHigh = cur.h;
      ev.push(hhLabel);
    }
    if (cur.l < red.refLow) {
      const red2Holds = cur.h <= prev.h && red.refLow - cur.l >= THRESH - EPS && cur.c <= red.refLow + EPS;
      if (red2Holds) {
        red.active = false;
        ev.push(label2);
      } else {
        red.refLow = cur.l;
        ev.push(`${label1} LL`);
      }
    }
    return ev;
  }

  // -----------------------------------------------------------------
  private evalBuy(buy: TzBuy, prev: Day, cur: Day): string[] {
    let ev: string[] = [];

    if (buy.rearGateOpen) {
      // TZ BUY SL 2 already fired -- the "TZ BUY reactivates in place"
      // pathway is permanently retired (same "door closes" principle as
      // BAR1/BAR2); only REAR can progress from here.
      if (buy.rear === null) {
        const ref = this.currentTopRef(buy);
        if (breaksRef(prev, cur, ref)) {
          buy.rear = new Rear(cur.h, cur.l);
          return ["REAR"];
        }
        return ev;
      }
      return this.evalRear(buy, buy.rear, prev, cur);
    }

    if (buy.active) {
      // Confirmed rule: if a post-TZ-BUY RED2 dip on this candle is also
      // deep enough to breach TZ BUY's OWN SL threshold, TZ BUY's own SL
      // wins outright -- not RED2, not both. Enforced structurally: is_sl
      // is checked here, before the post-TZ-BUY RED1/RED2 block below,
      // and returns immediately when it fires, so RED1/RED2 is never even
      // evaluated on that candle.
      const isSlNow = isSl(cur, buy.refLow);
      const newHigh = quietHh(cur, buy.refHigh);
      if (newHigh !== null) {
        buy.refHigh = newHigh;
        if (!isSlNow) ev.push("TZ BUY HH");
      }
      const newLow = quietLl(cur, buy.refLow);
      if (newLow !== null) {
        buy.refLow = newLow;
        ev.push("TZ BUY LL");
      }

      if (isSlNow) {
        if (buy.sl === null) {
          buy.sl = new TzBuySL(buy.refHigh, cur.l);
          ev.push("TZ BUY SL");
        } else {
          buy.sl.sl2 = true;
          buy.rearGateOpen = true;
          ev.push("TZ BUY SL 2");
        }
        buy.active = false;
        buy.red = null;
        buy.barLineages = [];
        buy.barPending = false;
        return ev;
      }
    } else if (buy.sl !== null) {
      // Reactivation: above TZ BUY's own (frozen at SL time) reference high.
      if (breaksRef(prev, cur, buy.sl.refHigh)) {
        buy.active = true;
        buy.refHigh = cur.h;
        buy.refLow = cur.l;
        buy.sl = null;
        ev.push("TZ BUY");
      }
      return ev;
    } else {
      return ev;
    }

    // Post-TZ-BUY RED1 -> RED2, pulling back directly against TZ BUY's own
    // reference (no TZ BUY 2 tier in this theory).
    if (buy.red === null) {
      if (cur.h <= prev.h && cur.l < prev.l && prev.l - cur.l >= THRESH - EPS && cur.c <= prev.l) {
        buy.redEver = true;
        buy.red = new Red(cur.h, cur.l);
        ev.push("RED1");
      }
    } else if (buy.red.active) {
      const redEv = this.evalRed(buy.red, prev, cur, "RED1", "RED2", "RED1 HH");
      ev.push(...redEv);
      if (redEv.includes("RED2")) buy.barPending = true;
    }

    ev.push(...this.evalBarLineages(buy, prev, cur));
    return ev;
  }

  // -----------------------------------------------------------------
  private currentTopRef(host: BarHost): number {
    let top = host.refHigh;
    for (const lin of host.barLineages) {
      top = Math.max(top, lin.refHigh);
      if (lin.bar2 !== null) top = Math.max(top, lin.bar2.refHigh);
    }
    return top;
  }

  private nextBarLabel(host: BarHost): string {
    let n: number;
    if (host.barDeadLabels.size > 0) {
      n = Math.min(...host.barDeadLabels);
      host.barDeadLabels.delete(n);
    } else {
      host.barGen += 1;
      n = host.barGen;
    }
    return String(n);
  }

  private evalBarLineages(host: BarHost, prev: Day, cur: Day): string[] {
    const ev: string[] = [];

    if (host.barPending && host.barLineages.length === 0 && bar1Shape(prev, cur)) {
      const label = this.nextBarLabel(host);
      host.barLineages.push(new BarLineage(label, cur.h, cur.l));
      host.barPending = false;
      ev.push(`BAR1(${label})`);
      return ev;
    }

    if (host.barLineages.length === 0) return ev;

    const lin = host.barLineages[host.barLineages.length - 1];
    if (lin.sl !== null) {
      return this.evalBarSl(host, lin, prev, cur);
    }

    const tier: RefPair = lin.bar2 !== null ? lin.bar2 : lin;
    const tierName = lin.bar2 !== null ? "BAR2" : "BAR1";

    // Escalation is checked BEFORE any quiet-climb update: a candle that
    // fully confirms the breakout above `tier.refHigh` is the BAR2
    // escalation itself, not a quiet climb of the pre-escalation tier --
    // checking in the other order would let the quiet-climb update
    // silently consume the same candle first, making the escalation test
    // always fail.
    if (lin.bar2 === null && breaksRef(prev, cur, tier.refHigh)) {
      lin.bar2 = new Bar2(cur.h, cur.l);
      ev.push(`BAR2(${lin.label})`);
      return ev;
    }

    const isSlNow = isSl(cur, tier.refLow);
    const newHigh = quietHh(cur, tier.refHigh);
    if (newHigh !== null) {
      tier.refHigh = newHigh;
      if (!isSlNow) ev.push(`${tierName} HH(${lin.label})`);
    }
    const newLow = quietLl(cur, tier.refLow);
    if (newLow !== null) {
      tier.refLow = newLow;
      ev.push(`${tierName} LL(${lin.label})`);
    }

    if (isSlNow) {
      lin.sl = new BarSL(tier.refHigh, cur.l);
      ev.push(`BAR SL(${lin.label})`);
      return ev;
    }

    return ev;
  }

  private evalBarSl(host: BarHost, lin: BarLineage, prev: Day, cur: Day): string[] {
    const ev: string[] = [];
    const sl = lin.sl as BarSL;
    if (breaksRef(prev, cur, sl.refHigh)) {
      // Recovery: a fresh BAR1 reforms in place using a freed generation number.
      const n = parseInt(lin.label, 10);
      host.barDeadLabels.add(n);
      const idx = host.barLineages.indexOf(lin);
      if (idx !== -1) host.barLineages.splice(idx, 1);
      const newLabel = this.nextBarLabel(host);
      host.barLineages.push(new BarLineage(newLabel, cur.h, cur.l));
      ev.push(`BAR1(${newLabel})`);
      return ev;
    }
    if (cur.l < sl.refLow) {
      if (isSl(cur, sl.refLow)) {
        sl.sl2 = true;
        ev.push(`BAR SL2(${lin.label})`);
        // Snapshot the highest reference this lineage ever reached into
        // host.refHigh BEFORE clearing barLineages -- once cleared,
        // currentTopRef would otherwise lose it (same "whichever occurred
        // last" snapshot principle used throughout tzEngineWtf.ts).
        host.refHigh = this.currentTopRef(host);
        if (host instanceof TzBuy) {
          host.rearGateOpen = true;
          host.red = null;
          host.barLineages = [];
          host.barPending = false;
        } else {
          // Under REAR's own BAR lineage: a second-level BAR SL2 is
          // treated the same as REAR's own SL -- it opens REAR RE-ENTER
          // (inferred, see module comment above).
          host.active = false;
          host.sl = new RearSL(sl.refLow);
          host.red = null;
          host.barLineages = [];
          host.barPending = false;
        }
      } else {
        sl.refLow = cur.l;
        ev.push(`BAR SL LL(${lin.label})`);
      }
    }
    return ev;
  }

  // -----------------------------------------------------------------
  private evalRear(buy: TzBuy, rear: Rear, prev: Day, cur: Day): string[] {
    const ev: string[] = [];

    if (rear.active) {
      let tier: RefPair = rear.reenter !== null ? rear.reenter : rear;
      let baseTierName = rear.reenter !== null ? "REAR RE-ENTER" : "REAR";

      // REAR2 is an optional escalation above REAR's own reference (not
      // compulsory before RED1-RED2-BAR can follow, but it can still
      // occur) -- mirrors BAR1 -> BAR2 exactly, same escalation-before-
      // quiet-climb ordering. Only checked while not already re-entered
      // (REAR RE-ENTER doesn't itself escalate to a further "2" tier).
      if (rear.reenter === null && rear.rear2 === null && breaksRef(prev, cur, tier.refHigh)) {
        rear.rear2 = new Bar2(cur.h, cur.l);
        ev.push("REAR2");
        return ev;
      }
      if (rear.rear2 !== null && rear.reenter === null) {
        tier = rear.rear2;
        baseTierName = "REAR2";
      }

      // Same confirmed rule as TZ BUY's own SL vs. post-TZ-BUY RED2: if a
      // post-REAR RED2 dip is also deep enough to breach REAR's (or
      // REAR2's) own SL threshold on the same candle, that SL wins
      // outright, not RED2 -- this check returns before the post-REAR
      // RED1/RED2 block below is ever reached.
      const isSlNow = isSl(cur, tier.refLow);
      const newHigh = quietHh(cur, tier.refHigh);
      if (newHigh !== null) {
        tier.refHigh = newHigh;
        if (!isSlNow) ev.push(`${baseTierName} HH`);
      }
      const newLow = quietLl(cur, tier.refLow);
      if (newLow !== null) {
        tier.refLow = newLow;
        ev.push(`${baseTierName} LL`);
      }

      if (isSlNow) {
        rear.sl = new RearSL(cur.l);
        rear.active = false;
        ev.push(`${baseTierName} SL`);
        rear.red = null;
        rear.barLineages = [];
        rear.barPending = false;
        return ev;
      }
    } else {
      let ref: number;
      if (rear.reenter !== null) {
        ref = rear.reenter.refHigh;
      } else {
        ref = Math.max(rear.refHigh, this.currentTopRef(buy));
        if (rear.rear2 !== null) ref = Math.max(ref, rear.rear2.refHigh);
      }
      if (breaksRef(prev, cur, ref)) {
        rear.active = true;
        if (rear.reenter === null) {
          rear.reenter = new RearReenter(cur.h, cur.l);
          ev.push("REAR RE-ENTER");
        } else {
          rear.reenter.refHigh = cur.h;
          rear.reenter.refLow = cur.l;
          ev.push("REAR RE-ENTER");
        }
        rear.sl = null;
      }
      return ev;
    }

    // Post-REAR RED1 -> RED2, pulling back directly against REAR's (or
    // REAR RE-ENTER's) own reference -- mandatory before a fresh BAR1 can
    // form again.
    if (rear.red === null) {
      if (cur.h <= prev.h && cur.l < prev.l && prev.l - cur.l >= THRESH - EPS && cur.c <= prev.l) {
        rear.redEver = true;
        rear.red = new Red(cur.h, cur.l);
        ev.push("RED1");
      }
    } else if (rear.red.active) {
      const redEv = this.evalRed(rear.red, prev, cur, "RED1", "RED2", "RED1 HH");
      ev.push(...redEv);
      if (redEv.includes("RED2")) rear.barPending = true;
    }

    ev.push(...this.evalBarLineages(rear, prev, cur));
    return ev;
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

/** Runs a fresh DtfBarEngine over a sequence of OHLC rows (ascending by
 * date) and produces a date -> comma-joined-event-string map, matching
 * lib/tzEngineWtf.ts's own computeWtfEvents / dtf_bar.py's own
 * run_series. Rows with any null OHLC field are dropped first. */
export function computeDtfBarEvents(rows: HistoryRowLike[]): Map<string, string> {
  const days = toDays(rows);
  const engine = new DtfBarEngine();
  const map = new Map<string, string>();
  for (let i = 1; i < days.length; i++) {
    const events = engine.process(days[i - 1], days[i]);
    if (events.length > 0) map.set(days[i].date, events.join(", "));
  }
  return map;
}
