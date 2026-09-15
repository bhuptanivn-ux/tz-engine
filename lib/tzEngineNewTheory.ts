// Direct TypeScript port of tz_engine_new_theory.py (branch
// claude/epic-darwin-pxs5s3). Ported faithfully line-for-line, not
// reinterpreted — every condition, ordering, and judgment call matches the
// Python original exactly. See NEW_THEORY_RULEBOOK.md ("v3") for the
// rationale behind each one.
//
// STATUS (inherited from the Python original): provisional, NOT yet
// verified against real OHLC data. This port doesn't change that — it just
// lets the same unverified logic run against real data fetched by this site
// instead of requiring a manually-prepared CSV/XLSX file and a Python
// runtime (which Vercel's Node.js deployment doesn't have).
//
// One piece of the Python source was deliberately NOT ported:
// `_eval_rear_reenter_tracking`. It's dead code in the original — never
// called anywhere, and it references Cycle fields (`rear_reenter_sl`,
// `rear_reenter_ref_low`, `rear_reenter_ref_high`) that don't exist on the
// Cycle dataclass, so calling it would throw in Python too. The actual
// post-confirmation REAR RE-ENTER tracking is handled correctly elsewhere
// (step 11 of _eval_cycle, via the shared Tier2 HH/LL/SL machinery on
// `rear_reenter`).

const THRESH = 0.2;
const ANY = 0.01;
const EPS = 1e-9;

export interface Day {
  date: string;
  o: number;
  h: number;
  l: number;
  c: number;
}

function branchLabel(nIn: number): string {
  let n = nIn;
  let s = "";
  while (n > 0) {
    n -= 1;
    const r = n % 26;
    n = Math.floor(n / 26);
    s = String.fromCharCode(65 + r) + s;
  }
  return s;
}

class RedTracker {
  red2Fired = false;
  constructor(public refHigh: number, public refLow: number) {}
}

interface HasRed {
  red: RedTracker | null;
}

function evalRedTracker(
  holder: HasRed | null,
  parentTerminated: boolean,
  prev: Day,
  cur: Day
): string | null {
  if (holder === null || parentTerminated) return null;
  const red = holder.red;
  if (red === null) {
    if (cur.h <= prev.h && prev.l - cur.l >= THRESH - EPS && cur.c <= prev.l) {
      holder.red = new RedTracker(cur.h, cur.l);
      return "RED1";
    }
    return null;
  }
  if (red.red2Fired) return null;
  if (cur.h - red.refHigh >= THRESH - EPS && cur.c >= red.refHigh) {
    holder.red = null;
    return "INVALID_RED1";
  }
  const gap = red.refLow - cur.l;
  if (cur.l < red.refLow && cur.h <= prev.h && gap >= THRESH - EPS && cur.c <= red.refLow + EPS) {
    red.red2Fired = true;
    return "RED2";
  }
  if (cur.l < red.refLow) {
    red.refLow = cur.l;
    return "RED1_LL";
  }
  if (cur.h - red.refHigh >= ANY - EPS) {
    red.refHigh = cur.h;
    return "RED1_HH";
  }
  return null;
}

class Tier2SL {
  constructor(public refHigh: number, public refLow: number) {}
}

class Tier2 implements HasRed {
  sl: Tier2SL | null = null;
  red: RedTracker | null = null;
  constructor(public refHigh: number, public refLow: number) {}
  get active(): boolean {
    return this.sl === null;
  }
}

function tryFormTier2(parentRefHigh: number, prev: Day, cur: Day): Tier2 | null {
  if (cur.l >= prev.l && cur.h - parentRefHigh >= THRESH - EPS && cur.c >= parentRefHigh) {
    return new Tier2(cur.h, cur.l);
  }
  return null;
}

function evalTier2HhLl(t2: Tier2, _prev: Day, cur: Day): string[] {
  const events: string[] = [];
  if (t2.sl === null) {
    if (cur.h - t2.refHigh >= ANY - EPS) {
      t2.refHigh = cur.h;
      events.push("HH");
    }
    if (cur.l < t2.refLow) {
      t2.refLow = cur.l;
      events.push("LL");
    }
  }
  return events;
}

function evalTier2SlCycle(t2: Tier2, _prev: Day, cur: Day): string[] {
  const events: string[] = [];
  if (t2.sl === null) {
    const gap = t2.refLow - cur.l;
    if (cur.l <= t2.refLow && gap >= THRESH - EPS && cur.c <= t2.refLow) {
      t2.sl = new Tier2SL(t2.refHigh, cur.l);
      events.push("SL");
    }
  } else {
    if (cur.h - t2.sl.refHigh >= THRESH - EPS && cur.c >= t2.sl.refHigh) {
      t2.refHigh = cur.h;
      t2.refLow = cur.l;
      t2.red = null;
      t2.sl = null;
      events.push("RECOVER");
    } else if (cur.l < t2.sl.refLow) {
      t2.sl.refLow = cur.l;
      events.push("SL_LL");
    }
  }
  return events;
}

class BarSL {
  sl2 = false;
  constructor(public refHigh: number, public refLow: number) {}
}

class BarGen {
  bar2: Tier2 | null = null;
  sl: BarSL | null = null;
  superseded = false;
  constructor(public label: string, public refHigh: number, public refLow: number) {}
}

class Tier1SL {
  constructor(public refLow: number) {}
}

class Cycle implements HasRed {
  red: RedTracker | null = null;
  dead = false;
  red2Ever = false;

  buyRefHigh = 0;
  buyRefLow = 0;
  buyActive = false;
  buySlFired = false;
  buy2: Tier2 | null = null;

  barGens: BarGen[] = [];
  barSubCounter = 0;

  terminated = false;

  rearRefHigh = 0;
  rearRefLow = 0;
  rearSl: Tier1SL | null = null;
  rear2: Tier2 | null = null;

  rearReenter: Tier2 | null = null;

  constructor(public seq: number, public greenRefHigh: number, public greenRefLow: number) {}
}

function currentTopRef(c: Cycle): number {
  for (let i = c.barGens.length - 1; i >= 0; i--) {
    const gen = c.barGens[i];
    if (!gen.superseded) {
      return gen.bar2 !== null ? gen.bar2.refHigh : gen.refHigh;
    }
  }
  if (c.barGens.length > 0) {
    const newest = c.barGens[c.barGens.length - 1];
    return newest.bar2 !== null ? newest.bar2.refHigh : newest.refHigh;
  }
  if (c.buy2 !== null) return c.buy2.refHigh;
  if (c.buyActive || c.buySlFired) return c.buyRefHigh;
  return c.greenRefHigh;
}

export class TzNewTheoryEngine {
  cycles: Cycle[] = [];
  private nextSeq = 1;
  private pendingRef: number | null = null;
  private pendingOwner: Cycle | null = null;
  private pendingKind: "REAR" | "REAR_REENTER" | null = null;

  private spawnEligible(): boolean {
    return this.cycles.length === 0 || this.cycles[this.cycles.length - 1].terminated;
  }

  private trySpawn(prev: Day, cur: Day): string | null {
    if (!this.spawnEligible()) return null;
    if (cur.l >= prev.l && cur.h - prev.h >= THRESH - EPS && cur.c >= prev.h) {
      const c = new Cycle(this.nextSeq, cur.h, cur.l);
      this.nextSeq += 1;
      this.cycles.push(c);
      return `TZ GREEN(${branchLabel(c.seq)})`;
    }
    return null;
  }

  private queuePending(owner: Cycle, ref: number, kind: "REAR" | "REAR_REENTER") {
    this.pendingRef = ref;
    this.pendingOwner = owner;
    this.pendingKind = kind;
  }

  private evalPending(prev: Day, cur: Day, events: string[]) {
    if (this.pendingRef === null) return;
    const ref = this.pendingRef;
    const owner = this.pendingOwner as Cycle;
    const label = branchLabel(owner.seq);
    if (cur.l >= prev.l && cur.h - ref >= THRESH - EPS && cur.c >= ref) {
      if (this.pendingKind === "REAR") {
        owner.rearRefHigh = cur.h;
        owner.rearRefLow = cur.l;
        events.push(`REAR(${label})`);
      } else {
        owner.rearReenter = new Tier2(cur.h, cur.l);
        events.push(`REAR RE-ENTER(${label})`);
      }
      this.pendingRef = null;
      this.pendingOwner = null;
      this.pendingKind = null;
    } else if (cur.h - ref >= ANY - EPS) {
      this.pendingRef = cur.h;
    }
  }

  private evalCycle(c: Cycle, prev: Day, cur: Day): string[] {
    const events: string[] = [];
    const label = branchLabel(c.seq);
    if (c.terminated && !c.rearRefHigh) {
      return events;
    }

    if (!c.dead && !c.buySlFired) {
      const gap = c.greenRefLow - cur.l;
      if (cur.l <= c.greenRefLow && gap >= THRESH - EPS && cur.c <= c.greenRefLow) {
        c.dead = true;
        c.terminated = true;
        events.push(`TZ GREEN SL(${label})`);
        if (c.red2Ever) {
          this.queuePending(c, currentTopRef(c), "REAR");
        }
        return events;
      }

      const greenRefPre = c.greenRefHigh;

      if (cur.h - c.greenRefHigh >= ANY - EPS) {
        c.greenRefHigh = cur.h;
        events.push(`TZ GREEN HH(${label})`);
      }
      if (cur.l < c.greenRefLow) {
        c.greenRefLow = cur.l;
        events.push(`TZ GREEN LL(${label})`);
      }

      const tag = evalRedTracker(c, c.dead, prev, cur);
      if (tag) {
        events.push(`${tag.replace(/_/g, " ")}(${label})`);
        if (tag === "RED2") c.red2Ever = true;
      }

      if (!c.buyActive && !c.buySlFired && c.red !== null && c.red.red2Fired) {
        const ref = greenRefPre;
        if (cur.l >= prev.l && cur.h - ref >= THRESH - EPS && cur.c >= ref) {
          c.buyActive = true;
          c.buyRefHigh = cur.h;
          c.buyRefLow = cur.l;
          events.push(`TZ BUY(${label})`);
        }
      }
    }

    if (c.buyActive && c.buy2 === null) {
      const gap = c.buyRefLow - cur.l;
      if (cur.l <= c.buyRefLow && gap >= THRESH - EPS && cur.c <= c.buyRefLow) {
        c.buyActive = false;
        c.buySlFired = true;
        c.terminated = true;
        events.push(`TZ BUY SL(${label})`);
        return events;
      }

      const buyRefPre = c.buyRefHigh;
      const t2 = tryFormTier2(buyRefPre, prev, cur);
      if (t2 !== null) {
        c.buy2 = t2;
        events.push(`TZ BUY 2(${label})`);
      } else if (cur.h - buyRefPre >= ANY - EPS) {
        c.buyRefHigh = cur.h;
        events.push(`TZ BUY HH(${label})`);
      }
      if (cur.l < c.buyRefLow) {
        c.buyRefLow = cur.l;
        events.push(`TZ BUY LL(${label})`);
      }
    } else if (c.buy2 !== null) {
      const buy2RefPre = c.buy2.refHigh;
      for (const tag of evalTier2HhLl(c.buy2, prev, cur)) {
        events.push(`TZ BUY 2 ${tag}(${label})`);
      }
      for (const tag of evalTier2SlCycle(c.buy2, prev, cur)) {
        events.push(`TZ BUY 2 ${tag}(${label})`);
      }
      if (cur.l < c.buyRefLow) {
        c.buyRefLow = cur.l;
        events.push(`TZ BUY LL(${label})`);
      }

      if (c.barGens.length === 0) {
        const tag = evalRedTracker(c.buy2, c.buy2.sl !== null, prev, cur);
        if (tag) {
          events.push(`${tag.replace(/_/g, " ")}(${label})`);
        }
      }

      if (
        c.barGens.length === 0 &&
        c.buy2.active &&
        c.buy2.red !== null &&
        c.buy2.red.red2Fired
      ) {
        const ref = buy2RefPre;
        if (cur.l >= prev.l && cur.h - ref >= THRESH - EPS && cur.c >= ref) {
          c.barSubCounter += 1;
          const gen = new BarGen(`${label}.${c.barSubCounter}`, cur.h, cur.l);
          c.barGens.push(gen);
          events.push(`BAR(${gen.label})`);
        }
      }
    }

    if (!c.terminated) {
      this.evalBarChain(c, prev, cur, events);
    }

    if (c.rearRefHigh && c.rearReenter === null) {
      this.evalRearTracking(c, prev, cur, events);
    }

    if (c.rearReenter !== null) {
      for (const tag of evalTier2HhLl(c.rearReenter, prev, cur)) {
        events.push(`REAR RE-ENTER ${tag}(${label})`);
      }
      for (const tag of evalTier2SlCycle(c.rearReenter, prev, cur)) {
        events.push(`REAR RE-ENTER ${tag}(${label})`);
      }
    }

    return events;
  }

  private evalBarChain(c: Cycle, prev: Day, cur: Day, events: string[]) {
    const activeGens = c.barGens.filter((g) => !g.superseded);
    if (activeGens.length === 0) return;
    const gen = activeGens[activeGens.length - 1];

    if (gen.bar2 !== null) {
      if (gen.sl === null) {
        const gap = gen.refLow - cur.l;
        if (cur.l <= gen.refLow && gap >= THRESH - EPS && cur.c <= gen.refLow) {
          gen.sl = new BarSL(gen.refHigh, cur.l);
          events.push(`BAR SL(${gen.label})`);
          return;
        }
      } else if (!gen.sl.sl2) {
        const gap2 = gen.sl.refLow - cur.l;
        if (cur.l <= gen.sl.refLow && gap2 >= THRESH - EPS && cur.c <= gen.sl.refLow) {
          gen.sl.sl2 = true;
          c.terminated = true;
          events.push(`BAR SL2(${gen.label})`);
          this.queuePending(c, currentTopRef(c), "REAR");
          return;
        }
        if (cur.l < gen.sl.refLow) {
          gen.sl.refLow = cur.l;
          events.push(`BAR SL LL(${gen.label})`);
        }
      }
    }

    if (gen.sl !== null) return;

    const preBarRefHigh = gen.refHigh;
    const bar2RefPre = gen.bar2 !== null ? gen.bar2.refHigh : null;
    if (gen.bar2 === null) {
      const t2 = tryFormTier2(preBarRefHigh, prev, cur);
      if (t2 !== null) {
        gen.bar2 = t2;
        events.push(`BAR 2(${gen.label})`);
      } else if (cur.h - preBarRefHigh >= ANY - EPS) {
        gen.refHigh = cur.h;
        events.push(`BAR HH(${gen.label})`);
      }
    } else {
      for (const tag of evalTier2HhLl(gen.bar2, prev, cur)) {
        events.push(`BAR 2 ${tag}(${gen.label})`);
      }
      for (const tag of evalTier2SlCycle(gen.bar2, prev, cur)) {
        events.push(`BAR 2 ${tag}(${gen.label})`);
      }
    }
    if (cur.l < gen.refLow) {
      gen.refLow = cur.l;
      events.push(`BAR LL(${gen.label})`);
    }

    if (gen.bar2 !== null) {
      const tag = evalRedTracker(gen.bar2, gen.bar2.sl !== null, prev, cur);
      if (tag) {
        events.push(`${tag.replace(/_/g, " ")}(${gen.label})`);
      }
    }

    if (
      c.buy2 !== null &&
      c.buy2.active &&
      gen.bar2 !== null &&
      gen.bar2.red !== null &&
      gen.bar2.red.red2Fired &&
      bar2RefPre !== null
    ) {
      const ref = bar2RefPre;
      if (cur.l >= prev.l && cur.h - ref >= THRESH - EPS && cur.c >= ref) {
        gen.superseded = true;
        c.barSubCounter += 1;
        const newGen = new BarGen(`${branchLabel(c.seq)}.${c.barSubCounter}`, cur.h, cur.l);
        c.barGens.push(newGen);
        events.push(`BAR(${newGen.label})`);
      }
    }
  }

  private evalRearTracking(c: Cycle, prev: Day, cur: Day, events: string[]) {
    const label = branchLabel(c.seq);
    if (c.rearSl === null) {
      const gap = c.rearRefLow - cur.l;
      if (cur.l <= c.rearRefLow && gap >= THRESH - EPS && cur.c <= c.rearRefLow) {
        c.rearSl = new Tier1SL(cur.l);
        events.push(`REAR SL(${label})`);
        this.queuePending(c, c.rearRefHigh, "REAR_REENTER");
        return;
      }
      const preRearRefHigh = c.rearRefHigh;
      if (c.rear2 === null) {
        const t2 = tryFormTier2(preRearRefHigh, prev, cur);
        if (t2 !== null) {
          c.rear2 = t2;
          events.push(`REAR 2(${label})`);
        } else if (cur.h - preRearRefHigh >= ANY - EPS) {
          c.rearRefHigh = cur.h;
          events.push(`REAR HH(${label})`);
        }
      } else {
        for (const tag of evalTier2HhLl(c.rear2, prev, cur)) {
          events.push(`REAR 2 ${tag}(${label})`);
        }
        for (const tag of evalTier2SlCycle(c.rear2, prev, cur)) {
          events.push(`REAR 2 ${tag}(${label})`);
        }
      }
      if (cur.l < c.rearRefLow) {
        c.rearRefLow = cur.l;
        events.push(`REAR LL(${label})`);
      }
    }
  }

  process(days: Day[]): { date: string; events: string[] }[] {
    const out: { date: string; events: string[] }[] = [];
    for (let i = 1; i < days.length; i++) {
      const prev = days[i - 1];
      const cur = days[i];
      const dayEvents: string[] = [];

      this.evalPending(prev, cur, dayEvents);

      const spawnEv = this.trySpawn(prev, cur);
      if (spawnEv) dayEvents.push(spawnEv);

      for (const c of [...this.cycles]) {
        const wasBuyActive = c.buyActive;
        const events = this.evalCycle(c, prev, cur);
        dayEvents.push(...events);
        if (!wasBuyActive && c.buyActive && this.pendingRef !== null) {
          this.pendingRef = null;
          this.pendingOwner = null;
          this.pendingKind = null;
        }
      }

      out.push({ date: cur.date, events: dayEvents });
    }
    return out;
  }
}

export interface HistoryRowLike {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
}

/**
 * Run the engine over a sequence of OHLC rows (ascending by date, the same
 * shape /api/history returns) and produce a date -> event-string map. Rows
 * with any null OHLC field are dropped first (the engine assumes clean
 * numeric data), so their dates simply won't appear in the map. The first
 * row in the sequence never gets an event — the engine compares each day
 * against the one before it, so day 0 has no "prev" to compare against.
 */
export function computeNewTheoryEvents(rows: HistoryRowLike[]): Map<string, string> {
  const days: Day[] = rows
    .filter((r) => r.open !== null && r.high !== null && r.low !== null && r.close !== null)
    .map((r) => ({
      date: r.date,
      o: r.open as number,
      h: r.high as number,
      l: r.low as number,
      c: r.close as number,
    }));

  const engine = new TzNewTheoryEngine();
  const result = engine.process(days);

  const map = new Map<string, string>();
  for (const { date, events } of result) {
    if (events.length > 0) {
      map.set(date, events.join(", "));
    }
  }
  return map;
}
