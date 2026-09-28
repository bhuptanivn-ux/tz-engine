"""
DTF BAR -- specification in DTF_THEORIES_RULEBOOK.md. A DTF-only theory,
NOT the same theory as TZ BUY (tz_engine_wtf.py) run on daily candles: it
restructures the top-level skeleton itself --

  - no TZ BUY 2 tier at all
  - a mandatory RED1->RED2 cascade (not a single RED) before TZ BUY can
    ever form
  - TZ BUY forms via a plain day-over-day breakout (the same shape BAR1
    uses in the base engine), NOT by clearing TZ GREEN's or RED2's own
    reference high
  - a new TZ BUY SL 2 concept, playing the exact role BAR SL2 plays in
    the base engine: it's what opens the door to REAR

Reuses THRESH/EPS and the Day dataclass from tz_engine_wtf.py so every
numeric rule here (0.20 pt clearance, Close confirmation, quiet-climb/
quiet-drop updates) stays identical to the rest of the codebase. Does
NOT import, modify, or depend on TZEngine -- fully separate, self-
contained state machine, same "separate file" precedent as
prime_trend.py.

INFERRED (not literally spelled out by the user, but the natural
extension of confirmed rules -- flagged here for review): a BAR SL2 that
happens under REAR's own BAR lineage is treated the same way REAR's own
SL is treated -- it's what opens REAR RE-ENTER, one level down, the same
way a top-level BAR SL2 opens REAR itself. REAR RE-ENTER, once formed,
reactivates in place (same name, same object) above its own frozen
reference high after each of its own subsequent SLs -- mirroring how TZ
BUY reactivates in place under the same name elsewhere in this codebase,
since REAR RE-ENTER 2 was confirmed as "not required".

SCOPE OF THIS FIRST PASS (NOT yet verified against real data):
  - Single lineage only. DTF BAR hasn't been specified for concurrent
    sibling TZ GREEN cycles (the base engine's A/B/C branch racing,
    dormancy, milestone-achiever collateral termination) -- none of that
    is reproduced here. Once the current cycle's own TZ BUY is gone (SL'd
    and not yet reactivated, or never formed), a fresh TZ GREEN can start;
    only one cycle is ever "live" at a time.
  - BAR generations are unlimited but SEQUENTIAL only: a fresh BAR1 can
    form once the current lineage is done (its own SL is active), reusing
    freed generation numbers -- no concurrent/racing lineages (also not
    yet specified for DTF BAR).
Both are natural places to extend once real-data testing (the same
workflow that hardened tz_engine_wtf.py through many rounds of real bugs)
surfaces an actual need -- exactly like the base engine's own early
history (single-branch, sequential-only, before later versions added
multi-branch racing).
"""
from dataclasses import dataclass, field
from typing import Optional, Union

from tz_engine_wtf import Day, THRESH, EPS  # noqa: F401  (Day re-exported for callers)


# ---------------------------------------------------------------------------
# Shared shape/threshold helpers -- copy-identical to the ones used
# throughout tz_engine_wtf.py.
# ---------------------------------------------------------------------------

def _breaks_ref(prev: Day, cur: Day, ref: float) -> bool:
    """Standard reference-gated breakout shape: low holds at/above
    yesterday's low, high clears `ref` by >= THRESH, close confirms at/
    above `ref`. Used for every reactivation and every BAR2-style
    escalation."""
    return cur.l >= prev.l and cur.h > ref and (cur.h - ref) >= THRESH - EPS and cur.c >= ref


def _bar1_shape(prev: Day, cur: Day) -> bool:
    """The plain day-over-day breakout BAR1 uses in the base engine -- no
    fixed reference to clear beyond yesterday's own high. This is also
    what TZ BUY itself uses in DTF BAR (once RED1->RED2 has completed),
    per the user's explicit correction that TZ BUY does NOT need to clear
    TZ GREEN's or RED2's own reference high."""
    return cur.l >= prev.l and cur.h > prev.h and (cur.h - prev.h) >= THRESH - EPS and cur.c >= prev.h


def _is_sl(cur: Day, ref_low: float) -> bool:
    return cur.l <= ref_low and (ref_low - cur.l) >= THRESH - EPS and cur.c <= ref_low + EPS


def _quiet_hh(cur: Day, ref_high: float) -> Optional[float]:
    return cur.h if cur.h > ref_high else None


def _quiet_ll(cur: Day, ref_low: float) -> Optional[float]:
    if cur.l >= ref_low:
        return None
    gap = ref_low - cur.l
    if (gap >= THRESH - EPS and cur.c > ref_low + EPS) or gap < THRESH - EPS:
        return cur.l
    return None


# ---------------------------------------------------------------------------
# State objects
# ---------------------------------------------------------------------------

@dataclass
class Red:
    """RED1/RED2, reused identically at every tier that needs a mandatory
    pullback-then-confirm gate (pre-TZ-BUY, post-TZ-BUY, post-REAR)."""
    ref_high: float
    ref_low: float
    active: bool = True


@dataclass
class BarSL:
    ref_high: float
    ref_low: float
    sl2: bool = False  # the SL's own recovery attempt failed again -> BAR SL2


@dataclass
class Bar2:
    ref_high: float
    ref_low: float


@dataclass
class BarLineage:
    label: str
    ref_high: float
    ref_low: float
    bar2: Optional[Bar2] = None
    sl: Optional[BarSL] = None


@dataclass
class RearSL:
    ref_low: float


@dataclass
class RearReenter:
    ref_high: float
    ref_low: float
    sl: Optional[RearSL] = None


@dataclass
class Rear:
    ref_high: float
    ref_low: float
    active: bool = True
    rear2: Optional[Bar2] = None  # optional escalation above REAR's own reference, mirrors BAR2
    sl: Optional[RearSL] = None
    reenter: Optional[RearReenter] = None
    # Post-REAR RED1/RED2, pulling back directly against REAR's (or REAR
    # RE-ENTER's) own reference -- mandatory before a fresh BAR1 can form.
    red: Optional[Red] = None
    red_ever: bool = False
    bar_lineages: list = field(default_factory=list)
    bar_pending: bool = False
    bar_gen: int = 0
    bar_dead_labels: set = field(default_factory=set)


@dataclass
class TzBuySL:
    ref_high: float
    ref_low: float
    sl2: bool = False  # TZ BUY's own reactivation failed again -> TZ BUY SL 2, opens REAR


@dataclass
class TzBuy:
    ref_high: float
    ref_low: float
    active: bool = True
    sl: Optional[TzBuySL] = None
    # Post-TZ-BUY RED1/RED2, pulling back directly against TZ BUY's own
    # reference (there is no TZ BUY 2 tier in this theory).
    red: Optional[Red] = None
    red_ever: bool = False
    bar_lineages: list = field(default_factory=list)
    bar_pending: bool = False
    bar_gen: int = 0
    bar_dead_labels: set = field(default_factory=set)
    rear: Optional[Rear] = None
    rear_gate_open: bool = False  # TZ BUY SL 2 fired -- REAR may now form


@dataclass
class Cycle:
    """One full TZ GREEN -> ... lineage. A fresh Cycle starts once the
    previous one is fully done (no live TZ BUY)."""
    seq: int
    ref_high: float
    ref_low: float
    active: bool = True
    red_ever: bool = False  # pre-TZ-BUY RED1/RED2 mandatory gate
    red: Optional[Red] = None
    buy: Optional[TzBuy] = None


BarHost = Union[TzBuy, Rear]


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

class DtfBarEngine:
    def __init__(self):
        self.cycles: list = []
        self._seq = 0

    def _cur_cycle(self) -> Optional[Cycle]:
        return self.cycles[-1] if self.cycles else None

    def process(self, prev: Day, cur: Day):
        ev = []
        cyc = self._cur_cycle()

        can_spawn = cyc is None or not cyc.active
        if can_spawn and _bar1_shape(prev, cur):
            self._seq += 1
            new_cyc = Cycle(seq=self._seq, ref_high=cur.h, ref_low=cur.l)
            self.cycles.append(new_cyc)
            ev.append("TZ GREEN")
            return ev  # freshly spawned cycle isn't evaluated same-candle

        if cyc is not None and cyc.active:
            ev += self._eval_cycle(cyc, prev, cur)
        return ev

    # -----------------------------------------------------------------
    def _eval_cycle(self, cyc: Cycle, prev: Day, cur: Day):
        ev = []
        is_sl = _is_sl(cur, cyc.ref_low)
        has_live_buy = cyc.buy is not None and cyc.buy.active

        new_high = _quiet_hh(cur, cyc.ref_high)
        if new_high is not None:
            cyc.ref_high = new_high
            if not has_live_buy and not is_sl:
                ev.append("TZ GREEN HH")
        new_low = _quiet_ll(cur, cyc.ref_low)
        if new_low is not None:
            cyc.ref_low = new_low
            if not has_live_buy:
                ev.append("TZ GREEN LL")

        if cyc.buy is not None and cyc.buy.ref_high > cyc.ref_high:
            cyc.ref_high = cyc.buy.ref_high

        if is_sl:
            ev.append("TZ GREEN SL")
            cyc.active = False
            return ev

        # Pre-TZ-BUY RED1 -> RED2 (mandatory -- no direct TZ GREEN -> TZ
        # BUY path in this theory). TZ BUY itself only watches for the
        # plain BAR1-style breakout once RED2 has confirmed.
        if cyc.buy is None:
            if cyc.red is None:
                if (cur.h <= prev.h and cur.l < prev.l and
                        (prev.l - cur.l) >= THRESH - EPS and cur.c <= prev.l):
                    cyc.red_ever = True
                    cyc.red = Red(ref_high=cur.h, ref_low=cur.l)
                    ev.append("RED1")
            elif cyc.red.active:
                ev += self._eval_red(cyc.red, prev, cur, "RED1", "RED2", "RED1 HH")
            elif _bar1_shape(prev, cur):
                cyc.buy = TzBuy(ref_high=cur.h, ref_low=cur.l)
                ev.append("TZ BUY")

        if cyc.buy is not None:
            ev += self._eval_buy(cyc.buy, prev, cur)
        return ev

    # -----------------------------------------------------------------
    def _eval_red(self, red: Red, prev: Day, cur: Day, label1: str, label2: str, hh_label: str):
        """RED1 -> RED2, reused identically at every tier."""
        ev = []
        if cur.h > red.ref_high and (cur.h - red.ref_high) >= THRESH - EPS and cur.c >= red.ref_high:
            ev.append(f"INVALID {label1}")
            red.active = False
            return ev
        if cur.h > red.ref_high:
            red.ref_high = cur.h
            ev.append(hh_label)
        if cur.l < red.ref_low:
            red2_holds = (cur.h <= prev.h and (red.ref_low - cur.l) >= THRESH - EPS and cur.c <= red.ref_low + EPS)
            if red2_holds:
                red.active = False
                ev.append(label2)
            else:
                red.ref_low = cur.l
                ev.append(f"{label1} LL")
        return ev

    # -----------------------------------------------------------------
    def _eval_buy(self, buy: TzBuy, prev: Day, cur: Day):
        ev = []

        if buy.rear_gate_open:
            # TZ BUY SL 2 already fired -- the "TZ BUY reactivates in
            # place" pathway is permanently retired (same "door closes"
            # principle as BAR1/BAR2); only REAR can progress from here.
            if buy.rear is None:
                ref = self._current_top_ref(buy)
                if _breaks_ref(prev, cur, ref):
                    buy.rear = Rear(ref_high=cur.h, ref_low=cur.l)
                    return ["REAR"]
                return ev
            return self._eval_rear(buy, buy.rear, prev, cur)

        if buy.active:
            is_sl = _is_sl(cur, buy.ref_low)
            new_high = _quiet_hh(cur, buy.ref_high)
            if new_high is not None:
                buy.ref_high = new_high
                if not is_sl:
                    ev.append("TZ BUY HH")
            new_low = _quiet_ll(cur, buy.ref_low)
            if new_low is not None:
                buy.ref_low = new_low
                ev.append("TZ BUY LL")

            if is_sl:
                if buy.sl is None:
                    buy.sl = TzBuySL(ref_high=buy.ref_high, ref_low=cur.l)
                    ev.append("TZ BUY SL")
                else:
                    buy.sl.sl2 = True
                    buy.rear_gate_open = True
                    ev.append("TZ BUY SL 2")
                buy.active = False
                buy.red = None
                buy.bar_lineages = []
                buy.bar_pending = False
                return ev
        elif buy.sl is not None:
            # Reactivation: above TZ BUY's own (frozen at SL time) reference high.
            if _breaks_ref(prev, cur, buy.sl.ref_high):
                buy.active = True
                buy.ref_high = cur.h
                buy.ref_low = cur.l
                buy.sl = None
                ev.append("TZ BUY")
            return ev
        else:
            return ev

        # Post-TZ-BUY RED1 -> RED2, pulling back directly against TZ
        # BUY's own reference (no TZ BUY 2 tier in this theory).
        if buy.red is None:
            if (cur.h <= prev.h and cur.l < prev.l and
                    (prev.l - cur.l) >= THRESH - EPS and cur.c <= prev.l):
                buy.red_ever = True
                buy.red = Red(ref_high=cur.h, ref_low=cur.l)
                ev.append("RED1")
        elif buy.red.active:
            red_ev = self._eval_red(buy.red, prev, cur, "RED1", "RED2", "RED1 HH")
            ev += red_ev
            if "RED2" in red_ev:
                buy.bar_pending = True

        ev += self._eval_bar_lineages(buy, prev, cur)
        return ev

    # -----------------------------------------------------------------
    def _current_top_ref(self, host: BarHost) -> float:
        top = host.ref_high
        for lin in host.bar_lineages:
            top = max(top, lin.ref_high)
            if lin.bar2 is not None:
                top = max(top, lin.bar2.ref_high)
        return top

    def _next_bar_label(self, host: BarHost) -> str:
        if host.bar_dead_labels:
            n = min(host.bar_dead_labels)
            host.bar_dead_labels.discard(n)
        else:
            host.bar_gen += 1
            n = host.bar_gen
        return str(n)

    def _eval_bar_lineages(self, host: BarHost, prev: Day, cur: Day):
        ev = []

        if host.bar_pending and not host.bar_lineages and _bar1_shape(prev, cur):
            label = self._next_bar_label(host)
            host.bar_lineages.append(BarLineage(label=label, ref_high=cur.h, ref_low=cur.l))
            host.bar_pending = False
            ev.append(f"BAR1({label})")
            return ev

        if not host.bar_lineages:
            return ev

        lin = host.bar_lineages[-1]
        if lin.sl is not None:
            ev += self._eval_bar_sl(host, lin, prev, cur)
            return ev

        tier = lin.bar2 if lin.bar2 is not None else lin
        tier_name = "BAR2" if lin.bar2 is not None else "BAR1"

        # Escalation is checked BEFORE any quiet-climb update: a candle
        # that fully confirms the breakout above `tier.ref_high` is the
        # BAR2 escalation itself, not a quiet climb of the pre-escalation
        # tier -- checking in the other order would let the quiet-climb
        # update silently consume the same candle first (bumping
        # ref_high to cur.h), making the escalation test always fail.
        if lin.bar2 is None and _breaks_ref(prev, cur, tier.ref_high):
            lin.bar2 = Bar2(ref_high=cur.h, ref_low=cur.l)
            ev.append(f"BAR2({lin.label})")
            return ev

        is_sl = _is_sl(cur, tier.ref_low)
        new_high = _quiet_hh(cur, tier.ref_high)
        if new_high is not None:
            tier.ref_high = new_high
            if not is_sl:
                ev.append(f"{tier_name} HH({lin.label})")
        new_low = _quiet_ll(cur, tier.ref_low)
        if new_low is not None:
            tier.ref_low = new_low
            ev.append(f"{tier_name} LL({lin.label})")

        if is_sl:
            lin.sl = BarSL(ref_high=tier.ref_high, ref_low=cur.l)
            ev.append(f"BAR SL({lin.label})")
            return ev

        return ev

    def _eval_bar_sl(self, host: BarHost, lin: BarLineage, prev: Day, cur: Day):
        ev = []
        sl = lin.sl
        if _breaks_ref(prev, cur, sl.ref_high):
            # Recovery: a fresh BAR1 reforms in place using a freed generation number.
            n = int(lin.label)
            host.bar_dead_labels.add(n)
            host.bar_lineages.remove(lin)
            new_label = self._next_bar_label(host)
            host.bar_lineages.append(BarLineage(label=new_label, ref_high=cur.h, ref_low=cur.l))
            ev.append(f"BAR1({new_label})")
            return ev
        if cur.l < sl.ref_low:
            if _is_sl(cur, sl.ref_low):
                sl.sl2 = True
                ev.append(f"BAR SL2({lin.label})")
                # Snapshot the highest reference this lineage ever reached
                # into host.ref_high BEFORE clearing bar_lineages -- once
                # cleared, _current_top_ref would otherwise lose it (same
                # "whichever occurred last" snapshot principle used
                # throughout tz_engine_wtf.py, e.g. TZ BUY 2's own
                # reentry_threshold captured before its SL wipes
                # everything below it).
                host.ref_high = self._current_top_ref(host)
                if isinstance(host, TzBuy):
                    host.rear_gate_open = True
                    host.red = None
                    host.bar_lineages = []
                    host.bar_pending = False
                else:
                    # Under REAR's own BAR lineage: a second-level BAR SL2
                    # is treated the same as REAR's own SL -- it's what
                    # opens REAR RE-ENTER (inferred, see module docstring).
                    host.active = False
                    host.sl = RearSL(ref_low=sl.ref_low)
                    host.red = None
                    host.bar_lineages = []
                    host.bar_pending = False
            else:
                sl.ref_low = cur.l
                ev.append(f"BAR SL LL({lin.label})")
        return ev

    # -----------------------------------------------------------------
    def _eval_rear(self, buy: TzBuy, rear: Rear, prev: Day, cur: Day):
        ev = []

        if rear.active:
            base_tier_name = "REAR RE-ENTER" if rear.reenter is not None else "REAR"
            tier = rear.reenter if rear.reenter is not None else rear

            # REAR2 is an optional escalation above REAR's own reference
            # (not compulsory before RED1-RED2-BAR can follow, but it can
            # still occur) -- mirrors BAR1 -> BAR2 exactly, and needs the
            # same escalation-before-quiet-climb ordering. Only checked
            # while not already re-entered (REAR RE-ENTER doesn't itself
            # escalate to a further "2" tier -- confirmed not required).
            if rear.reenter is None and rear.rear2 is None and _breaks_ref(prev, cur, tier.ref_high):
                rear.rear2 = Bar2(ref_high=cur.h, ref_low=cur.l)
                ev.append("REAR2")
                return ev
            if rear.rear2 is not None and rear.reenter is None:
                tier = rear.rear2
                base_tier_name = "REAR2"

            is_sl = _is_sl(cur, tier.ref_low)
            new_high = _quiet_hh(cur, tier.ref_high)
            if new_high is not None:
                tier.ref_high = new_high
                if not is_sl:
                    ev.append(f"{base_tier_name} HH")
            new_low = _quiet_ll(cur, tier.ref_low)
            if new_low is not None:
                tier.ref_low = new_low
                ev.append(f"{base_tier_name} LL")

            if is_sl:
                rear.sl = RearSL(ref_low=cur.l)
                rear.active = False
                ev.append(f"{base_tier_name} SL")
                rear.red = None
                rear.bar_lineages = []
                rear.bar_pending = False
                return ev
        else:
            if rear.reenter is not None:
                ref = rear.reenter.ref_high
            else:
                ref = max(rear.ref_high, self._current_top_ref(buy))
                if rear.rear2 is not None:
                    ref = max(ref, rear.rear2.ref_high)
            if _breaks_ref(prev, cur, ref):
                rear.active = True
                if rear.reenter is None:
                    rear.reenter = RearReenter(ref_high=cur.h, ref_low=cur.l)
                    ev.append("REAR RE-ENTER")
                else:
                    rear.reenter.ref_high = cur.h
                    rear.reenter.ref_low = cur.l
                    ev.append("REAR RE-ENTER")
                rear.sl = None
            return ev

        # Post-REAR RED1 -> RED2, pulling back directly against REAR's (or
        # REAR RE-ENTER's) own reference -- mandatory before a fresh BAR1
        # can form again.
        if rear.red is None:
            if (cur.h <= prev.h and cur.l < prev.l and
                    (prev.l - cur.l) >= THRESH - EPS and cur.c <= prev.l):
                rear.red_ever = True
                rear.red = Red(ref_high=cur.h, ref_low=cur.l)
                ev.append("RED1")
        elif rear.red.active:
            red_ev = self._eval_red(rear.red, prev, cur, "RED1", "RED2", "RED1 HH")
            ev += red_ev
            if "RED2" in red_ev:
                rear.bar_pending = True

        ev += self._eval_bar_lineages(rear, prev, cur)
        return ev


def run_series(days_in):
    """Runs a fresh DtfBarEngine over a list of OHLC rows and returns
    [{"date": ..., "events": [...]}, ...] for every candle after the
    first. Mirrors tz_engine_wtf.py's own run_series for consistency."""
    days = [d if isinstance(d, Day) else
            Day(d["date"], float(d["o"]), float(d["h"]), float(d["l"]), float(d["c"]))
            for d in days_in]
    if len(days) < 2:
        raise ValueError("Need at least 2 OHLC rows (a prev + cur pair) to process any events.")
    engine = DtfBarEngine()
    results = []
    for i in range(1, len(days)):
        prev, cur = days[i - 1], days[i]
        events = engine.process(prev, cur)
        results.append({"date": cur.date, "events": events})
    return results
