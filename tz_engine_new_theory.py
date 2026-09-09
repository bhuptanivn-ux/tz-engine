"""
TZ ENGINE -- New Theory variant: TZ GREEN -> TZ BUY -> BAR (unlimited) -> REAR.

STATUS: provisional first-pass implementation. NOT yet verified against real
OHLC data -- no dataset has been supplied for this theory. Every open question
the theory left unresolved has an explicit, documented default; see
NEW_THEORY_RULEBOOK.md for the reasoning behind each one (all marked
"ASSUMPTION" at the relevant site below too). Re-check every one of these
against real data before trusting this engine's output.

Separate from, and independent of, tz_engine_v9.py / tz_engine_bar2_variant.py
and the DTF/WTF variant on claude/rulebook-logic-interpretation-g3z130.

Shape, in order of escalation:
    TZ GREEN -> TZ GREEN 2 -> RED1 -> RED2 ->
    TZ BUY   -> TZ BUY 2   -> RED1 -> RED2 ->
    BAR(1)   -> BAR 2(1)   -> RED1 -> RED2 ->
    BAR(2)   -> BAR 2(2)   -> RED1 -> RED2 -> ... (unlimited)
    ... until a BAR SL2 fires -> REAR (above that generation's BAR 2 reference)
    -> REAR 2

Every "2" tier (TZ GREEN 2 / TZ BUY 2 / BAR 2 / REAR 2) shares one shape:
    forms while its parent is pre-SL: Low >= PrevLow, High > parent.ref_high by
    >= THRESH, Close >= parent.ref_high.
and one single-tier SL/recovery cycle (no escalation of its own):
    SL: Low breaks its own ref_low by >= THRESH, Close doesn't reclaim.
    Recovery (same label): High clears sl.ref_high by >= THRESH, Close holds.

RED1/RED2 (shared mechanic, reused at every escalation point) only attach once
the current tier's "2" exists (ASSUMPTION 3 in the rulebook):
    RED1: High <= PrevHigh, Low < PrevLow by >= THRESH, Close <= PrevLow.
    RED2: Low < RED1's own ref_low, High <= PrevHigh, gap >= THRESH,
          Close <= RED1's ref_low.
"""
from dataclasses import dataclass, field
from typing import Optional, List
import csv
import datetime

THRESH = 0.20
ANY = 0.01
EPS = 1e-9


def branch_label(n: int) -> str:
    s = ""
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(ord('A') + r) + s
    return s


@dataclass
class Day:
    date: str
    o: float
    h: float
    l: float
    c: float


def load_days_csv(path):
    days = []
    with open(path, newline="") as f:
        reader = csv.reader(f)
        header = next(reader)
        for row in reader:
            if not row or row[0] == "":
                continue
            date, o, h, l, c = row[0], row[1], row[2], row[3], row[4]
            days.append(Day(date, float(o), float(h), float(l), float(c)))
    return days


def load_days_xlsx(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb['Sheet1']
    days = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        date, o, h, l, c = row[0], row[1], row[2], row[3], row[4]
        if o is None:
            continue
        if isinstance(date, datetime.datetime):
            date = date.strftime('%d-%m-%Y')
        days.append(Day(date, float(o), float(h), float(l), float(c)))
    return days


# ---------------------------------------------------------------------------
# Shared building blocks
# ---------------------------------------------------------------------------

@dataclass
class RedTracker:
    """RED1/RED2, shared mechanic reused at every escalation point. Attaches
    to a tier's own "2" once that "2" exists (rulebook assumption 3)."""
    ref_high: float
    ref_low: float
    red2_fired: bool = False


@dataclass
class Tier2SL:
    """Single-tier SL for a "2" structure -- no escalation of its own. Can
    recover and re-fire indefinitely (rulebook assumption 5: "no escalation"
    means no SL2 tier, not a one-shot lifetime)."""
    ref_high: float
    ref_low: float


@dataclass
class Tier2:
    """TZ GREEN 2 / TZ BUY 2 / BAR 2 / REAR 2 -- identical shape and identical
    single-tier SL/recovery cycle (rulebook assumption 5)."""
    ref_high: float
    ref_low: float
    sl: Optional[Tier2SL] = None
    red: Optional[RedTracker] = None


def try_form_tier2(parent_ref_high: float, parent_sl_fired: bool, prev: Day, cur: Day):
    """Generic "2"-tier formation check: only while the parent is pre-SL."""
    if parent_sl_fired:
        return None
    if cur.l >= prev.l and cur.h - parent_ref_high >= THRESH - EPS and cur.c >= parent_ref_high:
        return Tier2(ref_high=cur.h, ref_low=cur.l)
    return None


def eval_tier2_hh_ll(t2: Tier2, prev: Day, cur: Day):
    """Returns (event_or_None, hh_bool). LL is never suppressed (assumption 2)."""
    events = []
    if t2.sl is None:
        if cur.h - t2.ref_high >= ANY - EPS:
            t2.ref_high = cur.h
            events.append("HH")
        if cur.l < t2.ref_low:
            t2.ref_low = cur.l
            events.append("LL")
    return events


def eval_tier2_sl_cycle(t2: Tier2, prev: Day, cur: Day):
    """SL / recovery for a "2" tier. Returns list of event tags fired today."""
    events = []
    if t2.sl is None:
        gap = t2.ref_low - cur.l
        if cur.l <= t2.ref_low and gap >= THRESH - EPS and cur.c <= t2.ref_low:
            t2.sl = Tier2SL(ref_high=t2.ref_high, ref_low=cur.l)
            events.append("SL")
    else:
        if cur.h - t2.sl.ref_high >= THRESH - EPS and cur.c >= t2.sl.ref_high:
            # recovery: fresh cycle under the same label
            t2.ref_high = cur.h
            t2.ref_low = cur.l
            t2.red = None
            t2.sl = None
            events.append("RECOVER")
        elif cur.l < t2.sl.ref_low:
            t2.sl.ref_low = cur.l
            events.append("SL_LL")
    return events


def eval_red_tracker(parent_ref: Tier2, prev: Day, cur: Day):
    """Attach/advance RED1/RED2 against a tier's own "2" (assumption 3).
    Returns event tag or None. Only called while parent_ref is pre-SL."""
    if parent_ref is None or parent_ref.sl is not None:
        return None
    red = parent_ref.red
    if red is None:
        if cur.h <= prev.h and prev.l - cur.l >= THRESH - EPS and cur.c <= prev.l:
            parent_ref.red = RedTracker(ref_high=cur.h, ref_low=cur.l)
            return "RED1"
        return None
    if red.red2_fired:
        return None
    if cur.h - red.ref_high >= THRESH - EPS and cur.c >= red.ref_high:
        parent_ref.red = None
        return "INVALID_RED1"
    gap = red.ref_low - cur.l
    if cur.l < red.ref_low and cur.h <= prev.h and gap >= THRESH - EPS and cur.c <= red.ref_low + EPS:
        red.red2_fired = True
        return "RED2"
    if cur.l < red.ref_low:
        red.ref_low = cur.l
        return "RED1_LL"
    if cur.h - red.ref_high >= ANY - EPS:
        red.ref_high = cur.h
        return "RED1_HH"
    return None


# ---------------------------------------------------------------------------
# BAR generation (unlimited chain)
# ---------------------------------------------------------------------------

@dataclass
class BarSL:
    ref_high: float
    ref_low: float
    sl2: bool = False


@dataclass
class BarGen:
    label: str
    ref_high: float
    ref_low: float
    bar2: Optional[Tier2] = None
    sl: Optional[BarSL] = None
    superseded: bool = False  # a fresh next-generation BAR has formed above this one


# ---------------------------------------------------------------------------
# Top-level tiers
# ---------------------------------------------------------------------------

@dataclass
class Tier1SL:
    ref_low: float


@dataclass
class Cycle:
    """One full TZ GREEN -> ... -> REAR chain. Independently tracked; no
    cross-cycle dormancy/leadership contest in this first pass (see
    NEW_THEORY_RULEBOOK.md, "Not yet modeled")."""
    seq: int
    green_ref_high: float
    green_ref_low: float
    green2: Optional[Tier2] = None

    buy_ref_high: float = 0.0
    buy_ref_low: float = 0.0
    buy_active: bool = False
    buy_sl_fired: bool = False
    buy2: Optional[Tier2] = None

    bar_gens: List[BarGen] = field(default_factory=list)
    bar_sub_counter: int = 0

    # REAR forms only once price actually recovers above the queued
    # reference by >=THRESH (mirrors the base engine's own sl.invalid_hh_ref
    # + real-breakout-confirmation pattern, §5) -- NOT instantly on the BAR
    # SL2 candle itself. rear_pending_ref is set at SL2 and climbs weakly
    # (ANY threshold, "INVALID BAR HH"-equivalent) until the real breakout
    # confirms and REAR actually forms from that day's own H/L.
    rear_pending_ref: Optional[float] = None
    rear_ref_high: float = 0.0
    rear_ref_low: float = 0.0
    rear_sl: Optional[Tier1SL] = None
    rear2: Optional[Tier2] = None

    dead: bool = False       # TZ GREEN SL fired -- whole cycle terminated
    red1_ever: bool = False  # this cycle's own RED1-against-GREEN-2 has fired at least once


class Engine:
    def __init__(self):
        self.cycles: List[Cycle] = []
        self.next_seq = 1

    # -- spawn eligibility -------------------------------------------------
    def _spawn_eligible(self) -> bool:
        """ASSUMPTION 1 + branch-spawn rule: mirrors base engine's sibling-
        spawn rule, adapted since this theory has no standalone RED (only
        RED1-against-GREEN-2)."""
        if not self.cycles:
            return True
        anchor = self.cycles[-1]
        if anchor.dead:
            # TZ GREEN SL is terminal and cascades (assumption 4) -- a dead
            # cycle is not "active" and cannot anchor a new sibling, mirroring
            # the base engine's own §8 anchor-must-be-active requirement.
            return False
        if not anchor.red1_ever:
            return False
        if not anchor.buy_active and anchor.buy_sl_fired:
            return True
        if anchor.bar_gens and all(g.sl is not None and g.sl.sl2 for g in anchor.bar_gens):
            return True
        if anchor.rear_sl is not None:
            return True
        return False

    def _try_spawn(self, prev: Day, cur: Day):
        if not self._spawn_eligible():
            return None
        if cur.l >= prev.l and cur.h - prev.h >= THRESH - EPS and cur.c >= prev.h:
            c = Cycle(seq=self.next_seq, green_ref_high=cur.h, green_ref_low=cur.l)
            self.next_seq += 1
            self.cycles.append(c)
            return f"TZ GREEN({branch_label(c.seq)})"
        return None

    # -- per-cycle evaluation -----------------------------------------------
    def _eval_cycle(self, c: Cycle, prev: Day, cur: Day):
        events = []
        label = branch_label(c.seq)
        if c.dead:
            return events

        # Snapshot every "child forms above this reference" value as it stood
        # BEFORE today's own processing -- otherwise a tier's own same-day
        # weak-HH bump could self-block the child's full-THRESH breakout
        # check (mirrors the base engine's own documented §5a fix: read the
        # ancestor's reference as it stood coming into today).
        green2_ref_pre = c.green2.ref_high if c.green2 is not None else None
        buy2_ref_pre = c.buy2.ref_high if c.buy2 is not None else None

        # 1. TZ GREEN's own SL -- checked first, unconditionally, cascades
        #    (assumption 4): kills TZ GREEN 2 / BUY / BUY2 / BAR family / REAR.
        gap = c.green_ref_low - cur.l
        if cur.l <= c.green_ref_low and gap >= THRESH - EPS and cur.c <= c.green_ref_low:
            c.dead = True
            events.append(f"TZ GREEN SL({label})")
            return events

        # 2+3. TZ GREEN 2 formation check uses the PRE-today reference
        # (forming today suppresses today's own HH, not LL -- display rule +
        # assumption 2). LL always tracks, regardless of GREEN 2's existence.
        pre_green_ref_high = c.green_ref_high
        if c.green2 is None:
            t2 = try_form_tier2(pre_green_ref_high, False, prev, cur)
            if t2 is not None:
                c.green2 = t2
                events.append(f"TZ GREEN 2({label})")
            elif cur.h - pre_green_ref_high >= ANY - EPS:
                c.green_ref_high = cur.h
                events.append(f"TZ GREEN HH({label})")
        else:
            for tag in eval_tier2_hh_ll(c.green2, prev, cur):
                events.append(f"TZ GREEN 2 {tag}({label})")
            for tag in eval_tier2_sl_cycle(c.green2, prev, cur):
                events.append(f"TZ GREEN 2 {tag}({label})")

        if cur.l < c.green_ref_low:
            c.green_ref_low = cur.l
            events.append(f"TZ GREEN LL({label})")

        # 4. RED1/RED2 against TZ GREEN 2, gating TZ BUY formation.
        if c.green2 is not None and not c.buy_active and not c.buy_sl_fired:
            tag = eval_red_tracker(c.green2, prev, cur)
            if tag:
                events.append(f"{tag.replace('_', ' ')}({label})")
                if tag == "RED2":
                    c.red1_ever = True

        # 5. TZ BUY formation -- above TZ GREEN 2's ref, once its RED2 fired.
        if (
            c.green2 is not None
            and c.green2.red is not None
            and c.green2.red.red2_fired
            and not c.buy_active
            and not c.buy_sl_fired
        ):
            ref = green2_ref_pre
            if cur.l >= prev.l and cur.h - ref >= THRESH - EPS and cur.c >= ref:
                c.buy_active = True
                c.buy_ref_high = cur.h
                c.buy_ref_low = cur.l
                events.append(f"TZ BUY({label})")

        # 6. TZ BUY's own SL (terminal for the buy; does not retro-kill BAR
        #    generations already formed -- assumption 4). SL beats RED1/RED2
        #    (§3 in the base rulebook, applied uniformly): firing it today
        #    must also block RED1/RED2 from attaching to TZ BUY 2 today.
        buy_sl_fired_today = False
        if c.buy_active:
            gap = c.buy_ref_low - cur.l
            if cur.l <= c.buy_ref_low and gap >= THRESH - EPS and cur.c <= c.buy_ref_low:
                c.buy_active = False
                c.buy_sl_fired = True
                buy_sl_fired_today = True
                events.append(f"TZ BUY SL({label})")
            else:
                # 7. TZ BUY 2 formation uses the PRE-today reference (same
                # same-day-self-comparison fix as TZ GREEN, above).
                pre_buy_ref_high = c.buy_ref_high
                if c.buy2 is None:
                    t2 = try_form_tier2(pre_buy_ref_high, False, prev, cur)
                    if t2 is not None:
                        c.buy2 = t2
                        events.append(f"TZ BUY 2({label})")
                    elif cur.h - pre_buy_ref_high >= ANY - EPS:
                        c.buy_ref_high = cur.h
                        events.append(f"TZ BUY HH({label})")
                else:
                    for tag in eval_tier2_hh_ll(c.buy2, prev, cur):
                        events.append(f"TZ BUY 2 {tag}({label})")
                    for tag in eval_tier2_sl_cycle(c.buy2, prev, cur):
                        events.append(f"TZ BUY 2 {tag}({label})")
                if cur.l < c.buy_ref_low:
                    c.buy_ref_low = cur.l
                    events.append(f"TZ BUY LL({label})")

        # 8. RED1/RED2 against TZ BUY 2, gating the first BAR generation.
        if c.buy2 is not None and not c.bar_gens and not buy_sl_fired_today:
            tag = eval_red_tracker(c.buy2, prev, cur)
            if tag:
                events.append(f"{tag.replace('_', ' ')}({label})")

        # 9. First BAR generation -- above TZ BUY 2's ref, once its RED2
        #    fired, and only while TZ BUY is still active (rule 7).
        if (
            c.buy_active
            and c.buy2 is not None
            and c.buy2.red is not None
            and c.buy2.red.red2_fired
            and not c.bar_gens
        ):
            ref = buy2_ref_pre
            if cur.l >= prev.l and cur.h - ref >= THRESH - EPS and cur.c >= ref:
                c.bar_sub_counter += 1
                gen = BarGen(label=f"{label}.{c.bar_sub_counter}", ref_high=cur.h, ref_low=cur.l)
                c.bar_gens.append(gen)
                events.append(f"BAR({gen.label})")

        # 10. Unlimited BAR/BAR2/RED1/RED2 loop; once a generation reaches
        # BAR SL2, REAR forms and REAR/REAR 2 tracking takes over from here
        # (handled inside _eval_bar_chain -> _queue_rear/_eval_rear).
        self._eval_bar_chain(c, prev, cur, events)

        return events

    def _eval_bar_chain(self, c: Cycle, prev: Day, cur: Day, events: list):
        active_gens = [g for g in c.bar_gens if not g.superseded]
        if not active_gens:
            return self._eval_rear(c, prev, cur, events)
        gen = active_gens[-1]

        # BAR's own SL/SL2 -- gated on BAR2 having formed (dead end otherwise).
        if gen.bar2 is not None:
            if gen.sl is None:
                gap = gen.ref_low - cur.l
                if cur.l <= gen.ref_low and gap >= THRESH - EPS and cur.c <= gen.ref_low:
                    gen.sl = BarSL(ref_high=gen.ref_high, ref_low=cur.l)
                    events.append(f"BAR SL({gen.label})")
                    return self._eval_rear(c, prev, cur, events)
            elif not gen.sl.sl2:
                gap2 = gen.sl.ref_low - cur.l
                if cur.l <= gen.sl.ref_low and gap2 >= THRESH - EPS and cur.c <= gen.sl.ref_low:
                    gen.sl.sl2 = True
                    events.append(f"BAR SL2({gen.label})")
                    return self._queue_rear(c, prev, cur, gen, events)
                if cur.l < gen.sl.ref_low:
                    gen.sl.ref_low = cur.l
                    events.append(f"BAR SL LL({gen.label})")

        if gen.sl is not None:
            return self._eval_rear(c, prev, cur, events)

        # BAR 2 formation uses the PRE-today reference (same self-comparison
        # fix as TZ GREEN/TZ BUY, above). LL never suppressed (assumption 2).
        # Also snapshot BAR 2's own ref_high before its HH tracking runs below,
        # for the next-generation breakout check further down (same fix).
        pre_bar_ref_high = gen.ref_high
        bar2_ref_pre = gen.bar2.ref_high if gen.bar2 is not None else None
        if gen.bar2 is None:
            t2 = try_form_tier2(pre_bar_ref_high, False, prev, cur)
            if t2 is not None:
                gen.bar2 = t2
                events.append(f"BAR 2({gen.label})")
            elif cur.h - pre_bar_ref_high >= ANY - EPS:
                gen.ref_high = cur.h
                events.append(f"BAR HH({gen.label})")
        else:
            for tag in eval_tier2_hh_ll(gen.bar2, prev, cur):
                events.append(f"BAR 2 {tag}({gen.label})")
            for tag in eval_tier2_sl_cycle(gen.bar2, prev, cur):
                events.append(f"BAR 2 {tag}({gen.label})")
        if cur.l < gen.ref_low:
            gen.ref_low = cur.l
            events.append(f"BAR LL({gen.label})")

        # RED1/RED2 against this generation's BAR 2, gating the next generation.
        if gen.bar2 is not None:
            tag = eval_red_tracker(gen.bar2, prev, cur)
            if tag:
                events.append(f"{tag.replace('_', ' ')}({gen.label})")

        # Attempt next-generation formation once this generation's BAR 2 had
        # a fired RED2 coming into today and is awaiting the fresh breakout
        # above BAR 2's pre-today reference -- only while TZ BUY is still
        # active (rule 7's gate applies to every generation, not just the
        # first -- assumption 4).
        if (
            c.buy_active
            and gen.bar2 is not None
            and gen.bar2.red is not None
            and gen.bar2.red.red2_fired
            and bar2_ref_pre is not None
        ):
            ref = bar2_ref_pre
            if cur.l >= prev.l and cur.h - ref >= THRESH - EPS and cur.c >= ref:
                gen.superseded = True
                c.bar_sub_counter += 1
                new_gen = BarGen(
                    label=f"{branch_label(c.seq)}.{c.bar_sub_counter}",
                    ref_high=cur.h, ref_low=cur.l,
                )
                c.bar_gens.append(new_gen)
                events.append(f"BAR({new_gen.label})")

        return None

    def _queue_rear(self, c: Cycle, prev: Day, cur: Day, gen: BarGen, events: list):
        """BAR SL2 queues REAR's reference (rule 10) -- REAR itself only
        forms once price actually recovers above it by >=THRESH (mirrors the
        base engine's own §5 real-breakout-confirmation, not an instant
        formation on the SL2 candle)."""
        ref = gen.bar2.ref_high if gen.bar2 is not None else gen.ref_high
        if c.rear_pending_ref is None or ref > c.rear_pending_ref:
            c.rear_pending_ref = ref
        return None

    def _eval_rear(self, c: Cycle, prev: Day, cur: Day, events: list):
        label = branch_label(c.seq)

        if not c.rear_ref_high:
            # Queued, not yet confirmed -- check for the real recovery
            # breakout; otherwise the pending reference keeps climbing
            # weakly on any new High (INVALID BAR HH-equivalent, ANY
            # threshold), same principle as base engine §5's queued state.
            if c.rear_pending_ref is None:
                return None
            ref = c.rear_pending_ref
            if cur.l >= prev.l and cur.h - ref >= THRESH - EPS and cur.c >= ref:
                c.rear_ref_high = cur.h
                c.rear_ref_low = cur.l
                c.rear_sl = None
                c.rear2 = None
                c.rear_pending_ref = None
                events.append(f"REAR({label})")
            elif cur.h - ref >= ANY - EPS:
                c.rear_pending_ref = cur.h
            return None

        if c.rear_sl is None:
            gap = c.rear_ref_low - cur.l
            if cur.l <= c.rear_ref_low and gap >= THRESH - EPS and cur.c <= c.rear_ref_low:
                c.rear_sl = Tier1SL(ref_low=cur.l)
                events.append(f"REAR SL({label})")
                return None
            # REAR 2 formation uses the PRE-today reference (same
            # self-comparison fix as TZ GREEN/TZ BUY/BAR, above).
            pre_rear_ref_high = c.rear_ref_high
            if c.rear2 is None:
                t2 = try_form_tier2(pre_rear_ref_high, False, prev, cur)
                if t2 is not None:
                    c.rear2 = t2
                    events.append(f"REAR 2({label})")
                elif cur.h - pre_rear_ref_high >= ANY - EPS:
                    c.rear_ref_high = cur.h
                    events.append(f"REAR HH({label})")
            else:
                for tag in eval_tier2_hh_ll(c.rear2, prev, cur):
                    events.append(f"REAR 2 {tag}({label})")
                for tag in eval_tier2_sl_cycle(c.rear2, prev, cur):
                    events.append(f"REAR 2 {tag}({label})")

            if cur.l < c.rear_ref_low:
                c.rear_ref_low = cur.l
                events.append(f"REAR LL({label})")
        return None

    def process(self, days: List[Day]):
        out = []
        for i in range(1, len(days)):
            prev, cur = days[i - 1], days[i]
            day_events = []

            spawn_ev = self._try_spawn(prev, cur)
            if spawn_ev:
                day_events.append(spawn_ev)

            for c in list(self.cycles):
                day_events.extend(self._eval_cycle(c, prev, cur))

            out.append((cur.date, day_events))
        return out


def run(path):
    if path.lower().endswith(".csv"):
        days = load_days_csv(path)
    else:
        days = load_days_xlsx(path)
    engine = Engine()
    return engine.process(days)


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("usage: python tz_engine_new_theory.py <path.csv|path.xlsx>")
        sys.exit(1)
    for date, events in run(sys.argv[1]):
        if events:
            print(date, "|", ", ".join(events))
