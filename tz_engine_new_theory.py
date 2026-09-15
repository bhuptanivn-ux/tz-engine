"""
TZ ENGINE -- New Theory variant, v5: TZ GREEN -> TZ BUY -> BAR (unlimited) ->
REAR -> REAR RE-ENTER, each with its own "2" tier, full multi-branch support.

STATUS: provisional first-pass implementation. NOT yet verified against real
OHLC data -- no dataset has been supplied for this theory. Every open
question left unresolved has an explicit, documented default; see
NEW_THEORY_RULEBOOK.md ("v5" section) for the reasoning behind each one.
Re-check every one of these against real data before trusting this engine's
output.

Separate from, and independent of, tz_engine_v9.py / tz_engine_bar2_variant.py
and the DTF/WTF variant on claude/rulebook-logic-interpretation-g3z130.

v4 supersedes v3's spawn model. v3 treated cycles as sequential/exclusive --
a fresh sibling could only spawn once the whole prior lineage had decisively
failed. That's wrong: the theory's own baseline definition of TZ GREEN
formation says a new branch is eligible whenever an existing active branch
"has had its RED fire but has no currently-live buy" -- which is true the
INSTANT RED2 fires, long before TZ BUY ever forms. So multiple TZ GREEN
lineages can be alive at once, exactly like the base 37-event engine, and
v4 ports that engine's own multi-branch machinery wholesale:

- Branch-spawn eligibility (base engine section 8): a fresh sibling may spawn
  once the single newest ACTIVE branch (tip anchor) has had its own RED2
  fire, isn't dormant, and its buy is nonexistent, top-level-dead (TZ BUY SL
  before TZ BUY 2 ever formed), or has reached deep failure (any BAR SL2 /
  REAR SL / REAR RE-ENTER SL, ever) and is not currently live right now.
- Leadership contest (base engine section 7a): whenever ANY branch produces
  a milestone (TZ BUY formation, a fresh BAR(n) generation, REAR, REAR
  RE-ENTER), every OTHER branch is re-judged: older -> dormant; newer ->
  terminated outright, UNLESS a *continuation* milestone (not a fresh TZ
  BUY) meets a newer branch that already held an active buy before today
  (checked via a pre-today snapshot -- a same-day tie goes to the older
  branch). This single mechanism is what the user described as "the earlier
  lineage's REAR wins the race, the new lineage is terminated" -- it isn't a
  separate race system, it's this leadership contest.
- Dormancy display rule: a dormant branch keeps computing everything
  normally in the backend every candle, but only SHOWS milestone-formation
  events and SL/LL-type (decisive breach) events -- HH-type and the whole
  RED-family stay suppressed while dormant. Dormancy lifts system-wide the
  instant no branch anywhere currently holds a live buy.

v5 adds REAR 2 and REAR RE-ENTER 2 (previously REAR RE-ENTER was a plain
single-tier terminal leaf, with no "2" of its own). Both play the same DUAL
role BAR 2 already plays -- not TZ BUY 2's single role:
  (a) their own RED1->RED2 unlocks a FRESH BAR(1)->BAR2(1) cascade, exactly
      like TZ BUY 2's/BAR 2's RED1->RED2 does; and, separately,
  (b) their existence gates whether their parent's own SL can escalate to a
      genuine SL2 at all (a dead end otherwise) -- mirrors BAR/BAR 2 exactly,
      one and two levels up.

The full escalation within one lineage:

    TZ GREEN -> RED1 -> RED2 (vs TZ GREEN) ->
    TZ BUY (above TZ GREEN's own ref) -> TZ BUY 2 (above TZ BUY's own ref) ->
    RED1 -> RED2 (vs TZ BUY 2) ->
    BAR(1) (above TZ BUY 2's ref) -> BAR 2(1) -> RED1 -> RED2 ->
    BAR(2) -> BAR 2(2) -> ... (unlimited, while the current gate stays active) ...
    -> BAR SL -> BAR SL2 -- queues REAR's reference (whichever tier is most
       advanced so far -- see _current_top_ref())
    -> REAR -> REAR 2 -- two SEPARATE, independent things (neither gates the
       other -- REAR SL is single-tier, NOT gated on REAR 2 existing):
         - REAR 2's own RED1->RED2 -> a FRESH BAR(1)->BAR2(1) cascade
           (unlimited again, gated on REAR 2 staying active), which can
           itself reach a BAR SL2 and queue REAR's reference again
           (reactivating REAR under the same label if it still exists).
         - REAR's own SL (single-tier, one-way) -- directly queues REAR
           RE-ENTER's reference (whichever tier is most advanced at that
           moment).
    -> REAR RE-ENTER -> REAR RE-ENTER 2 -- the SAME shape one level deeper:
         - its own RED1->RED2 -> another fresh BAR(1) cascade.
         - REAR RE-ENTER's own SL (also single-tier) -- terminal: no named
           structure follows, this lineage's escalation is simply over
           (counted via `ever_deep_failure`); firing it also freezes REAR
           RE-ENTER 2 (mirrors how BAR's own SL freezes BAR 2).

    TZ GREEN SL before its own RED2, or TZ BUY SL before TZ BUY 2 ever
    formed: no reference queued at all (nothing established yet to recover
    from) -- this branch is simply done; a sibling was likely already
    spawn-eligible well before this point anyway.

A queued REAR/REAR RE-ENTER reference only confirms via a real recovery
breakout (Low >= PrevLow, High - ref >= THRESH, Close >= ref) on a later
candle, exactly like every other tier's formation -- never instantly on the
triggering candle itself. `Cycle.bar_gate` tracks whichever "2" tier (TZ
BUY 2 / REAR 2 / REAR RE-ENTER 2) most recently unlocked the currently-open
BAR cascade, since any of the three can do so and the cascade's own
continuation ("BAR - BAR 2 can occur while [gate] is active") depends on
that specific gate, not always TZ BUY 2.
"""
from dataclasses import dataclass, field
from typing import Optional, List, Dict
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
        next(reader)  # header
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
    """RED1/RED2, shared mechanic reused at every escalation point."""
    ref_high: float
    ref_low: float
    red2_fired: bool = False


def eval_red_tracker(holder, parent_terminated: bool, prev: Day, cur: Day):
    """Attach/advance RED1/RED2 on `holder.red`. `parent_terminated` is
    supplied by the caller -- SL always beats RED1/RED2, so callers must not
    invoke this on a candle where the parent's own SL just fired."""
    if holder is None or parent_terminated:
        return None
    red = holder.red
    if red is None:
        if cur.h <= prev.h and prev.l - cur.l >= THRESH - EPS and cur.c <= prev.l:
            holder.red = RedTracker(ref_high=cur.h, ref_low=cur.l)
            return "RED1"
        return None
    if red.red2_fired:
        return None
    if cur.h - red.ref_high >= THRESH - EPS and cur.c >= red.ref_high:
        holder.red = None
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


@dataclass
class Tier2SL:
    """Single-tier SL for a "2" structure (TZ BUY 2 / BAR 2) -- no
    escalation of its own. Can recover and re-fire indefinitely."""
    ref_high: float
    ref_low: float


@dataclass
class Tier2:
    """TZ BUY 2 / BAR 2 / REAR RE-ENTER -- identical shape and identical
    single-tier SL/recovery cycle."""
    ref_high: float
    ref_low: float
    sl: Optional[Tier2SL] = None
    red: Optional[RedTracker] = None  # unused for REAR RE-ENTER (terminal leaf)

    @property
    def active(self) -> bool:
        """"BAR - BAR2 can occur if TZ BUY 2 is active": pre-SL, or has since
        recovered. Only meaningful for TZ BUY 2 (gates new BAR generations)."""
        return self.sl is None


def try_form_tier2(parent_ref_high: float, prev: Day, cur: Day):
    """"2"-tier formation: Low >= PrevLow, High > parent's ref by >= THRESH,
    Close >= parent's ref. Caller only invokes this while the parent is
    pre-SL."""
    if cur.l >= prev.l and cur.h - parent_ref_high >= THRESH - EPS and cur.c >= parent_ref_high:
        return Tier2(ref_high=cur.h, ref_low=cur.l)
    return None


def eval_tier2_hh_ll(t2: Tier2, prev: Day, cur: Day):
    """LL is never suppressed by the "2" existing; HH is (own display rule)."""
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
            t2.ref_high = cur.h
            t2.ref_low = cur.l
            t2.red = None
            t2.sl = None
            events.append("RECOVER")
        elif cur.l < t2.sl.ref_low:
            t2.sl.ref_low = cur.l
            events.append("SL_LL")
    return events


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
# Cycle (one TZ GREEN lineage)
# ---------------------------------------------------------------------------

@dataclass
class Cycle:
    """One TZ GREEN -> TZ BUY/TZ BUY2 -> BAR/BAR2 (unlimited) -> [REAR ->
    REAR RE-ENTER] lineage. Multiple cycles can be alive at once (v4) --
    see the leadership contest in Engine."""
    seq: int
    green_ref_high: float
    green_ref_low: float
    red: Optional[RedTracker] = None   # RED1/RED2 vs TZ GREEN directly
    dead: bool = False                 # branch-level: TZ GREEN's own SL fired
    # (permanent, cascades -- kills everything for this branch, forever)
    red2_ever: bool = False            # TZ GREEN's own RED2 has fired at least once

    buy_ref_high: float = 0.0
    buy_ref_low: float = 0.0
    buy_active: bool = False
    buy_sl_fired: bool = False         # buy-level only -- does NOT set `dead`
    # (mirrors the base engine: buy.active and pc.active are separate flags)
    buy2: Optional[Tier2] = None       # RED1/RED2 vs TZ BUY 2 lives on buy2.red

    bar_gens: List[BarGen] = field(default_factory=list)
    bar_sub_counter: int = 0
    bar_gate: Optional[Tier2] = None  # whichever "2" tier (buy2 / rear2 /
    # rear_reenter2) most recently unlocked the BAR cascade -- "BAR - BAR2
    # can occur while [that gate] is active" governs whether a NEXT
    # generation can keep forming, regardless of which tier unlocked it.

    rear_ref_high: float = 0.0
    rear_ref_low: float = 0.0
    rear_sl: bool = False  # single-tier, one-way -- no SL2, ungated by rear2
    # ("REAR SL is enough as earlier"). Fires and directly queues REAR
    # RE-ENTER's reference.
    rear2: Optional[Tier2] = None  # separate role from rear_sl (not a gate on
    # it): its own RED1->RED2 unlocks a fresh BAR(1) cascade, mirroring BAR
    # 2's dual role minus the "gates parent's SL2" half.

    rear_reenter_ref_high: float = 0.0
    rear_reenter_ref_low: float = 0.0
    rear_reenter_sl: bool = False  # same single-tier shape, one level deeper
    # -- terminal: nothing named follows it.
    rear_reenter2: Optional[Tier2] = None  # same role, one level deeper.

    pending_ref: Optional[float] = None   # queued REAR / REAR RE-ENTER reference
    pending_kind: Optional[str] = None    # "REAR" | "REAR_REENTER"

    ever_deep_failure: bool = False  # any BAR SL2 / REAR SL / REAR RE-ENTER
    # SL, ever -- historical, never un-set (base engine section 8).
    dormant: bool = False  # branch-level leadership-contest dormancy (7a)


def _current_top_ref(c: Cycle) -> float:
    """"Whichever occurred last": the current reference of the most advanced
    tier this lineage has reached. Every tier's own reference is, by
    construction, both numerically higher AND chronologically later than the
    tier before it, so this always IS "whichever occurred last" -- no
    separate bookkeeping needed. BAR generations (regardless of which "2"
    tier's RED2 unlocked them) are always the deepest when any exist."""
    for gen in reversed(c.bar_gens):
        if not gen.superseded:
            return gen.bar2.ref_high if gen.bar2 is not None else gen.ref_high
    if c.bar_gens:
        newest = c.bar_gens[-1]
        return newest.bar2.ref_high if newest.bar2 is not None else newest.ref_high
    if c.rear_reenter2 is not None:
        return c.rear_reenter2.ref_high
    if c.rear_reenter_ref_high:
        return c.rear_reenter_ref_high
    if c.rear2 is not None:
        return c.rear2.ref_high
    if c.rear_ref_high:
        return c.rear_ref_high
    if c.buy2 is not None:
        return c.buy2.ref_high
    if c.buy_active or c.buy_sl_fired:
        return c.buy_ref_high
    return c.green_ref_high


# Milestones that trigger the leadership contest (base engine section 7a),
# adapted to this theory's tiers. "TZ_BUY" is a *fresh* milestone (no
# continuation exemption for a newer sibling); the rest are *continuation*
# milestones (a newer sibling is exempted if it already held an active buy
# before today).
MILESTONE_FRESH = "TZ_BUY"
MILESTONE_CONTINUATION = "CONTINUATION"


class Engine:
    def __init__(self):
        self.cycles: List[Cycle] = []
        self.next_seq = 1

    # -- system-wide buy-liveness (base engine section 9, adapted) ----------
    def _buy_currently_live(self, c: Cycle) -> bool:
        if not c.buy_active and not c.buy_sl_fired:
            return False  # buy nonexistent
        if c.buy_sl_fired:
            return False  # top-level dead (buy died before TZ BUY 2 ever formed)
        if c.rear_reenter_ref_high:
            return not c.rear_reenter_sl
        if c.rear_ref_high:
            return not c.rear_sl
        if c.bar_gens:
            return any(g.sl is None or not g.sl.sl2 for g in c.bar_gens)
        if c.buy2 is not None:
            return c.buy2.sl is None
        return True  # TZ BUY formed, nothing beyond has failed yet

    # -- spawn eligibility (base engine section 8) ---------------------------
    def _tip_anchor(self) -> Optional[Cycle]:
        for c in reversed(self.cycles):
            if not c.dead:
                return c
        return None

    def _spawn_eligible(self) -> bool:
        anchor = self._tip_anchor()
        if anchor is None:
            return True  # no branches yet, or every branch is dead
        if not anchor.red2_ever:
            return False
        if anchor.dormant:
            return False
        buy_nonexistent = not anchor.buy_active and not anchor.buy_sl_fired
        buy_top_level_dead = anchor.buy_sl_fired
        deep_and_not_live = anchor.ever_deep_failure and not self._buy_currently_live(anchor)
        return buy_nonexistent or buy_top_level_dead or deep_and_not_live

    def _try_spawn(self, prev: Day, cur: Day):
        if not self._spawn_eligible():
            return None
        if cur.l >= prev.l and cur.h - prev.h >= THRESH - EPS and cur.c >= prev.h:
            c = Cycle(seq=self.next_seq, green_ref_high=cur.h, green_ref_low=cur.l)
            self.next_seq += 1
            self.cycles.append(c)
            return f"TZ GREEN({branch_label(c.seq)})"
        return None

    # -- queued REAR / REAR RE-ENTER confirmation (per cycle) ----------------
    def _eval_pending(self, c: Cycle, prev: Day, cur: Day, events: list):
        if c.pending_ref is None:
            return
        ref = c.pending_ref
        label = branch_label(c.seq)
        if cur.l >= prev.l and cur.h - ref >= THRESH - EPS and cur.c >= ref:
            if c.pending_kind == "REAR":
                # Fresh formation, or reactivation under the same label if a
                # later BAR cascade (unlocked by rear2/rear_reenter2) reached
                # its own SL2 and REAR already existed -- single-slot, same
                # convention used throughout this family.
                c.rear_ref_high = cur.h
                c.rear_ref_low = cur.l
                c.rear_sl = False
                c.rear2 = None
                events.append(f"REAR({label})")
            else:
                c.rear_reenter_ref_high = cur.h
                c.rear_reenter_ref_low = cur.l
                c.rear_reenter_sl = False
                c.rear_reenter2 = None
                events.append(f"REAR RE-ENTER({label})")
            c.pending_ref = None
            c.pending_kind = None
        elif cur.h - ref >= ANY - EPS:
            c.pending_ref = cur.h

    # -- per-cycle evaluation. Returns (raw_events, milestone_kinds). -------
    def _eval_cycle(self, c: Cycle, prev: Day, cur: Day):
        events = []
        milestones = []
        label = branch_label(c.seq)

        if c.dead and c.pending_ref is None and not c.rear_ref_high and not c.rear_reenter_ref_high:
            return events, milestones  # nothing left to ever show for this branch

        if not c.dead:
            # 1. TZ GREEN's own SL -- checked every candle for the branch's
            # entire life (base engine discipline), single-shot (no SL2 of
            # its own). Before its own RED2: no reference queued. After:
            # queue REAR above the current top reference.
            gap = c.green_ref_low - cur.l
            if cur.l <= c.green_ref_low and gap >= THRESH - EPS and cur.c <= c.green_ref_low:
                c.dead = True
                events.append(f"TZ GREEN SL({label})")
                if c.red2_ever:
                    c.pending_ref = _current_top_ref(c)
                    c.pending_kind = "REAR"
                return events, milestones

            green_ref_pre = c.green_ref_high  # snapshot before today's own HH

            # 2. TZ GREEN HH/LL.
            if cur.h - c.green_ref_high >= ANY - EPS:
                c.green_ref_high = cur.h
                events.append(f"TZ GREEN HH({label})")
            if cur.l < c.green_ref_low:
                c.green_ref_low = cur.l
                events.append(f"TZ GREEN LL({label})")

            # 3. RED1/RED2 directly against TZ GREEN.
            tag = eval_red_tracker(c, c.dead, prev, cur)
            if tag:
                events.append(f"{tag.replace('_', ' ')}({label})")
                if tag == "RED2":
                    c.red2_ever = True

            # 4. TZ BUY formation -- above TZ GREEN's own reference, once
            # TZ GREEN's own RED2 has fired.
            if not c.buy_active and not c.buy_sl_fired and c.red is not None and c.red.red2_fired:
                ref = green_ref_pre
                if cur.l >= prev.l and cur.h - ref >= THRESH - EPS and cur.c >= ref:
                    c.buy_active = True
                    c.buy_ref_high = cur.h
                    c.buy_ref_low = cur.l
                    events.append(f"TZ BUY({label})")
                    milestones.append(MILESTONE_FRESH)

            # 5+6. TZ BUY's own tracking (SL only checked before TZ BUY 2
            # ever forms -- once TZ BUY 2 exists it becomes the locus of
            # control and TZ BUY's own top-level SL stops mattering,
            # mirroring how the original theory's TZ BUY SL never cascaded
            # into the BAR family below it -- does NOT set `dead`: the
            # branch itself stays active, only the buy is permanently done).
            if c.buy_active and c.buy2 is None:
                gap = c.buy_ref_low - cur.l
                if cur.l <= c.buy_ref_low and gap >= THRESH - EPS and cur.c <= c.buy_ref_low:
                    c.buy_active = False
                    c.buy_sl_fired = True
                    events.append(f"TZ BUY SL({label})")
                else:
                    buy_ref_pre = c.buy_ref_high
                    t2 = try_form_tier2(buy_ref_pre, prev, cur)
                    if t2 is not None:
                        c.buy2 = t2
                        events.append(f"TZ BUY 2({label})")
                    elif cur.h - buy_ref_pre >= ANY - EPS:
                        c.buy_ref_high = cur.h
                        events.append(f"TZ BUY HH({label})")
                    if cur.l < c.buy_ref_low:
                        c.buy_ref_low = cur.l
                        events.append(f"TZ BUY LL({label})")
            elif c.buy2 is not None:
                buy2_ref_pre = c.buy2.ref_high
                for t in eval_tier2_hh_ll(c.buy2, prev, cur):
                    events.append(f"TZ BUY 2 {t}({label})")
                for t in eval_tier2_sl_cycle(c.buy2, prev, cur):
                    events.append(f"TZ BUY 2 {t}({label})")
                if cur.l < c.buy_ref_low:
                    c.buy_ref_low = cur.l
                    events.append(f"TZ BUY LL({label})")

                # 7. RED1/RED2 against TZ BUY 2, gating the first BAR generation.
                if not c.bar_gens:
                    tag = eval_red_tracker(c.buy2, c.buy2.sl is not None, prev, cur)
                    if tag:
                        events.append(f"{tag.replace('_', ' ')}({label})")

                # 8. First BAR generation -- "as the original theory", only
                # while TZ BUY 2 is active.
                if (
                    not c.bar_gens and c.buy2.active
                    and c.buy2.red is not None and c.buy2.red.red2_fired
                ):
                    ref = buy2_ref_pre
                    if cur.l >= prev.l and cur.h - ref >= THRESH - EPS and cur.c >= ref:
                        c.bar_sub_counter += 1
                        gen = BarGen(label=f"{label}.{c.bar_sub_counter}", ref_high=cur.h, ref_low=cur.l)
                        c.bar_gens.append(gen)
                        c.bar_gate = c.buy2
                        events.append(f"BAR({gen.label})")
                        milestones.append(MILESTONE_CONTINUATION)

            # 9. Unlimited BAR/BAR2/RED1/RED2 loop.
            if self._eval_bar_chain(c, prev, cur, events):
                milestones.append(MILESTONE_CONTINUATION)

        # 10. Queued REAR / REAR RE-ENTER confirmation -- checked regardless
        # of `dead` (a branch can be TZ-GREEN-SL'd yet still racing toward
        # REAR on a reference queued at the moment it died).
        pre_pending_rear = bool(c.rear_ref_high)
        pre_pending_reenter = bool(c.rear_reenter_ref_high)
        self._eval_pending(c, prev, cur, events)
        if not pre_pending_rear and c.rear_ref_high:
            milestones.append(MILESTONE_CONTINUATION)
        if not pre_pending_reenter and c.rear_reenter_ref_high:
            milestones.append(MILESTONE_CONTINUATION)

        # 11. REAR's own HH/LL/SL, plus REAR 2's own HH/LL/SL/2, once
        # confirmed and not yet superseded by a confirmed REAR RE-ENTER.
        # REAR 2's RED1/RED2 can separately open a fresh BAR cascade -- a
        # milestone if it does.
        if c.rear_ref_high and not c.rear_reenter_ref_high:
            if self._eval_rear_tracking(c, prev, cur, events):
                milestones.append(MILESTONE_CONTINUATION)

        # 12. Same shape one level deeper for REAR RE-ENTER / REAR RE-ENTER 2.
        if c.rear_reenter_ref_high:
            if self._eval_rear_reenter_tracking(c, prev, cur, events):
                milestones.append(MILESTONE_CONTINUATION)

        return events, milestones

    def _eval_bar_chain(self, c: Cycle, prev: Day, cur: Day, events: list) -> bool:
        """Returns True if a fresh BAR(n) generation formed this candle
        (milestone), other than the very first one (already reported by the
        caller)."""
        active_gens = [g for g in c.bar_gens if not g.superseded]
        if not active_gens:
            return False
        gen = active_gens[-1]

        if gen.bar2 is not None:
            if gen.sl is None:
                gap = gen.ref_low - cur.l
                if cur.l <= gen.ref_low and gap >= THRESH - EPS and cur.c <= gen.ref_low:
                    gen.sl = BarSL(ref_high=gen.ref_high, ref_low=cur.l)
                    events.append(f"BAR SL({gen.label})")
                    return False
            elif not gen.sl.sl2:
                gap2 = gen.sl.ref_low - cur.l
                if cur.l <= gen.sl.ref_low and gap2 >= THRESH - EPS and cur.c <= gen.sl.ref_low:
                    gen.sl.sl2 = True
                    c.ever_deep_failure = True
                    events.append(f"BAR SL2({gen.label})")
                    c.pending_ref = _current_top_ref(c)
                    c.pending_kind = "REAR"
                    return False
                if cur.l < gen.sl.ref_low:
                    gen.sl.ref_low = cur.l
                    events.append(f"BAR SL LL({gen.label})")

        if gen.sl is not None:
            return False

        pre_bar_ref_high = gen.ref_high
        bar2_ref_pre = gen.bar2.ref_high if gen.bar2 is not None else None
        if gen.bar2 is None:
            t2 = try_form_tier2(pre_bar_ref_high, prev, cur)
            if t2 is not None:
                gen.bar2 = t2
                events.append(f"BAR 2({gen.label})")
            elif cur.h - pre_bar_ref_high >= ANY - EPS:
                gen.ref_high = cur.h
                events.append(f"BAR HH({gen.label})")
        else:
            for t in eval_tier2_hh_ll(gen.bar2, prev, cur):
                events.append(f"BAR 2 {t}({gen.label})")
            for t in eval_tier2_sl_cycle(gen.bar2, prev, cur):
                events.append(f"BAR 2 {t}({gen.label})")
        if cur.l < gen.ref_low:
            gen.ref_low = cur.l
            events.append(f"BAR LL({gen.label})")

        if gen.bar2 is not None:
            tag = eval_red_tracker(gen.bar2, gen.bar2.sl is not None, prev, cur)
            if tag:
                events.append(f"{tag.replace('_', ' ')}({gen.label})")

        # Next generation only while whichever "2" tier unlocked this
        # cascade (TZ BUY 2 / REAR 2 / REAR RE-ENTER 2) is still active.
        if (
            c.bar_gate is not None and c.bar_gate.active
            and gen.bar2 is not None and gen.bar2.red is not None
            and gen.bar2.red.red2_fired and bar2_ref_pre is not None
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
                return True
        return False

    def _eval_rear_tracking(self, c: Cycle, prev: Day, cur: Day, events: list) -> bool:
        """REAR's own HH/LL/SL, plus REAR 2's own HH/LL/SL/recovery. REAR's
        own SL is single-tier -- no SL2 escalation, ungated by REAR 2 (unlike
        BAR's own SL/SL2, which IS gated by BAR 2) -- "REAR SL is enough as
        earlier. Nothing like REAR SL2." It fires and directly queues REAR
        RE-ENTER's reference (whichever tier is most advanced -- REAR 2's
        own, if it exists). REAR 2 separately plays BAR 2's dual role: its
        own RED1->RED2 opens a fresh BAR(1) cascade, independent of REAR's
        own SL. Returns True if that cascade opened this candle (milestone)."""
        label = branch_label(c.seq)

        if c.rear_sl:
            return False
        gap = c.rear_ref_low - cur.l
        if cur.l <= c.rear_ref_low and gap >= THRESH - EPS and cur.c <= c.rear_ref_low:
            c.rear_sl = True
            c.ever_deep_failure = True
            events.append(f"REAR SL({label})")
            c.pending_ref = _current_top_ref(c)
            c.pending_kind = "REAR_REENTER"
            return False

        pre_rear_ref_high = c.rear_ref_high
        rear2_ref_pre = c.rear2.ref_high if c.rear2 is not None else None
        if c.rear2 is None:
            t2 = try_form_tier2(pre_rear_ref_high, prev, cur)
            if t2 is not None:
                c.rear2 = t2
                events.append(f"REAR 2({label})")
            elif cur.h - pre_rear_ref_high >= ANY - EPS:
                c.rear_ref_high = cur.h
                events.append(f"REAR HH({label})")
        else:
            for t in eval_tier2_hh_ll(c.rear2, prev, cur):
                events.append(f"REAR 2 {t}({label})")
            for t in eval_tier2_sl_cycle(c.rear2, prev, cur):
                events.append(f"REAR 2 {t}({label})")
        if cur.l < c.rear_ref_low:
            c.rear_ref_low = cur.l
            events.append(f"REAR LL({label})")

        if c.rear2 is not None:
            tag = eval_red_tracker(c.rear2, c.rear2.sl is not None, prev, cur)
            if tag:
                events.append(f"{tag.replace('_', ' ')}({label})")

        # REAR 2's dual role: once its own RED2 fires, a fresh BAR(1)
        # cascade opens above REAR 2's reference -- only if no cascade is
        # currently still in progress (the earlier one, if any, already
        # concluded via its own SL2).
        cascade_open = self._bar_cascade_concluded(c)
        if (
            cascade_open and c.rear2 is not None and c.rear2.active
            and c.rear2.red is not None and c.rear2.red.red2_fired and rear2_ref_pre is not None
        ):
            ref = rear2_ref_pre
            if cur.l >= prev.l and cur.h - ref >= THRESH - EPS and cur.c >= ref:
                c.bar_sub_counter += 1
                new_gen = BarGen(label=f"{label}.{c.bar_sub_counter}", ref_high=cur.h, ref_low=cur.l)
                c.bar_gens.append(new_gen)
                c.bar_gate = c.rear2
                events.append(f"BAR({new_gen.label})")
                return True
        return False

    def _eval_rear_reenter_tracking(self, c: Cycle, prev: Day, cur: Day, events: list) -> bool:
        """Same shape one level deeper. REAR RE-ENTER's own SL is also
        single-tier ("likewise for REAR RE-ENTER") -- no SL2, ungated by
        REAR RE-ENTER 2. Once it fires, this lineage's escalation is simply
        over: terminal, no named structure follows (already counted via
        `ever_deep_failure`)."""
        label = branch_label(c.seq)

        if c.rear_reenter_sl:
            return False
        gap = c.rear_reenter_ref_low - cur.l
        if cur.l <= c.rear_reenter_ref_low and gap >= THRESH - EPS and cur.c <= c.rear_reenter_ref_low:
            c.rear_reenter_sl = True
            c.ever_deep_failure = True
            events.append(f"REAR RE-ENTER SL({label})")
            return False

        pre_ref_high = c.rear_reenter_ref_high
        reenter2_ref_pre = c.rear_reenter2.ref_high if c.rear_reenter2 is not None else None
        if c.rear_reenter2 is None:
            t2 = try_form_tier2(pre_ref_high, prev, cur)
            if t2 is not None:
                c.rear_reenter2 = t2
                events.append(f"REAR RE-ENTER 2({label})")
            elif cur.h - pre_ref_high >= ANY - EPS:
                c.rear_reenter_ref_high = cur.h
                events.append(f"REAR RE-ENTER HH({label})")
        else:
            for t in eval_tier2_hh_ll(c.rear_reenter2, prev, cur):
                events.append(f"REAR RE-ENTER 2 {t}({label})")
            for t in eval_tier2_sl_cycle(c.rear_reenter2, prev, cur):
                events.append(f"REAR RE-ENTER 2 {t}({label})")
        if cur.l < c.rear_reenter_ref_low:
            c.rear_reenter_ref_low = cur.l
            events.append(f"REAR RE-ENTER LL({label})")

        if c.rear_reenter2 is not None:
            tag = eval_red_tracker(c.rear_reenter2, c.rear_reenter2.sl is not None, prev, cur)
            if tag:
                events.append(f"{tag.replace('_', ' ')}({label})")

        cascade_open = self._bar_cascade_concluded(c)
        if (
            cascade_open and c.rear_reenter2 is not None and c.rear_reenter2.active
            and c.rear_reenter2.red is not None and c.rear_reenter2.red.red2_fired
            and reenter2_ref_pre is not None
        ):
            ref = reenter2_ref_pre
            if cur.l >= prev.l and cur.h - ref >= THRESH - EPS and cur.c >= ref:
                c.bar_sub_counter += 1
                new_gen = BarGen(label=f"{label}.{c.bar_sub_counter}", ref_high=cur.h, ref_low=cur.l)
                c.bar_gens.append(new_gen)
                c.bar_gate = c.rear_reenter2
                events.append(f"BAR({new_gen.label})")
                return True
        return False

    @staticmethod
    def _bar_cascade_concluded(c: Cycle) -> bool:
        """True if there is no BAR generation currently in progress -- either
        none has ever formed, or the newest one has already reached its own
        SL2. Guards against a fresh cascade opening while an earlier one
        (under a different gate) is still live."""
        active_gens = [g for g in c.bar_gens if not g.superseded]
        if not active_gens:
            return True
        newest = active_gens[-1]
        return newest.sl is not None and newest.sl.sl2

    # -- dormancy display filtering (base engine section 7a) ---------------
    @staticmethod
    def _is_suppressed_while_dormant(event: str) -> bool:
        if " HH(" in event:
            return True
        if event.startswith(("RED1(", "RED2(", "RED1 HH(", "RED1 LL(", "INVALID RED1(")):
            return True
        return False

    def process(self, days: List[Day]):
        out = []
        for i in range(1, len(days)):
            prev, cur = days[i - 1], days[i]
            day_events = []

            # Pre-today snapshot for the leadership-contest exemption rule
            # (checked before ANY of today's processing, per the base engine).
            pre_today_buy_active: Dict[int, bool] = {c.seq: c.buy_active for c in self.cycles}

            spawn_ev = self._try_spawn(prev, cur)
            if spawn_ev:
                day_events.append(spawn_ev)
                pre_today_buy_active[self.cycles[-1].seq] = False

            raw_events: Dict[int, list] = {}
            milestone_kinds: Dict[int, list] = {}
            for c in list(self.cycles):
                events, milestones = self._eval_cycle(c, prev, cur)
                raw_events[c.seq] = events
                if milestones:
                    milestone_kinds[c.seq] = milestones

            # System-wide dormancy lift: the instant no active branch holds
            # a live buy, every branch's dormancy clears.
            if not any(self._buy_currently_live(c) for c in self.cycles if not c.dead):
                for c in self.cycles:
                    c.dormant = False

            # Leadership contests, oldest-first (a same-day tie goes to the
            # older branch, per the base engine's own documented behavior).
            for c in sorted((cc for cc in self.cycles if cc.seq in milestone_kinds), key=lambda cc: cc.seq):
                if c.dead:
                    continue  # already terminated by an earlier same-day contest
                is_fresh_buy = MILESTONE_FRESH in milestone_kinds[c.seq]
                for other in self.cycles:
                    if other.seq == c.seq or other.dead:
                        continue
                    if other.seq < c.seq:
                        other.dormant = True
                    else:
                        exempt = (not is_fresh_buy) and pre_today_buy_active.get(other.seq, False)
                        if not exempt:
                            other.dead = True
                            raw_events[other.seq] = []  # collateral damage, same day
                c.dormant = False  # today's leader

            for c in self.cycles:
                events = raw_events.get(c.seq, [])
                if c.dormant:
                    events = [e for e in events if not self._is_suppressed_while_dormant(e)]
                day_events.extend(events)

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
