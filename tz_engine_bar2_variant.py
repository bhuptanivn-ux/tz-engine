"""
TZ ENGINE simulator -- BAR 2 / REAR 2 / REAR RE-ENTER 2 variant.

Built on top of the validated 37-event base engine (tz_engine_v9.py),
keeping REAR / REAR RE-ENTER (unlike the House-of-Bull source document,
which removed REAR entirely). Layers a new confirmation-gate concept --
"2" -- at every tier: BAR 2, REAR 2, REAR RE-ENTER 2, each structurally
identical, one/two levels up. Rules established through extensive
back-and-forth verification against real 2020 OHLC data:

- BAR 2 forms off its own BAR lineage's reference high, mirroring TZ
  GREEN 2's shape (Low >= PrevLow, High > ref by >= 0.20, Close >= ref) --
  only while the lineage itself is still pre-SL.
- BAR 2 gates RED1/RED2 attaching to its BAR lineage (previously
  ungated), and gates BAR SL2 being reachable at all: a BAR SL that fires
  with NO BAR 2 ever having formed is a permanent dead end -- no BAR SL
  HH/LL/INVALID BAR SL/SL2, only a fresh BAR(n+1) elsewhere or the
  top-level TZ BUY SL can follow.
- BAR 2 has its own independent SL/recovery cycle (no "BAR 2 SL2"
  escalation). It does NOT persist through BAR-level reactivation --
  every fresh BAR generation needs a brand new BAR 2 from scratch.
- REAR 2 / REAR RE-ENTER 2 are exact structural mirrors, one/two levels
  up: REAR 2 gates RED1 on REAR and gates whether REAR's own SL can lead
  anywhere; REAR RE-ENTER 2 does the same one level deeper. REAR 2's own
  reference feeds REAR RE-ENTER's formation threshold (mirroring BAR 2 ->
  REAR exactly).
- Multi-lineage racing: a RED2 firing against a still-pre-SL BAR lineage
  does NOT terminate it when a fresh, independent BAR(n+1) forms
  elsewhere -- both keep racing in parallel (mirrors the base engine's
  own _clear_for_new_bar_generation principle, extended through and past
  the moment the fresh BAR actually confirms, not just while awaited).
  Only the NEWEST lineage participates in RED1/RED2 (single shared
  buy.red1 object). An older sibling terminates completely, retroactively
  same-day, the moment the NEWEST lineage's own BAR 2 confirms -- REAR's
  reference is now governed by the newer lineage regardless of what
  happens to it next. A lineage that already reached its own SL2 is
  unaffected by this (separate, already-established mechanism, racing
  toward REAR on its own merits via INVALID BAR HH).
- A BAR's own SL2 ALWAYS produces a fresh REAR, off that BAR's own
  reference -- never a reactivation of some old dormant ancestor (REAR or
  REAR RE-ENTER), even if the ancestor's frozen reference happens to
  numerically coincide. "REAR RE-ENTER" is reserved exclusively for REAR
  RE-ENTER's own SL genuinely failing and recovering -- a separate
  mechanism that never routes through BAR SL2 at all.
- Display suppression: BAR's own "BAR HH" is permanently suppressed once
  its lineage has a BAR 2 (BAR 2 is now the governing reference); REAR's
  own "REAR HH" suppressed once REAR 2 exists; REAR RE-ENTER's own "REAR
  RE-ENTER HH" suppressed once REAR RE-ENTER 2 exists. Applies from the
  exact same day the "2" produces ANY event (formation included),
  retroactively. Also: an underlying SL beats its own "2" tier's SL/LL
  the same day (only the underlying SL shows).
- INVALID [X] HH tracking: once a "2" is frozen (its own SL active) or
  its parent has failed, its reference keeps quietly climbing on any new
  High (weak >=0.01 threshold) as "INVALID BAR HH" / "INVALID REAR HH" /
  "INVALID REAR RE-ENTER HH" -- no recovery event, just an inflated
  reference kept alive in case something downstream needs it later.
- Dormancy must stop a "2" tracking entirely, not just suppress its
  display, once its PARENT (REAR/REAR RE-ENTER) goes permanently dormant
  (superseded by REAR RE-ENTER, or by a fresh BAR generation) --
  otherwise it would track forever incorrectly.

Verified end-to-end against the full 01-01-2020 through 08-08-2020 OHLC
dataset.
"""
from dataclasses import dataclass, field
from typing import Optional
import openpyxl
import datetime

THRESH = 0.20
ANY = 0.01
EPS = 1e-9  # float-precision guard for boundary comparisons (e.g. 429.75-429.55)


def branch_label(n: int) -> str:
    """1 -> A, 2 -> B, ..., 26 -> Z, 27 -> AA, 28 -> AB, ... (spreadsheet-
    column style), per the rule book's own A/B/C/D notation -- avoids any
    visual confusion with numeric price/quantity data on a dashboard."""
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


def load_days_xlsx(path):
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


@dataclass
class Red1:
    ref_high: float
    ref_low: float
    active: bool = True


@dataclass
class Bar2:
    """The "2" confirmation gate, reused identically at every tier: BAR 2
    (lineage.bar2), REAR 2 (rear.rear2), REAR RE-ENTER 2 (rre.rre2)."""
    ref_high: float
    ref_low: float
    sl_active: bool = False  # own SL fired; frozen except for its own recovery (no "SL2" escalation)
    dormant: bool = False  # REAR 2 / REAR RE-ENTER 2 only: True once the PARENT
    # (Rear/RearReenter) goes permanently dormant -- stops ALL tracking, not just display


@dataclass
class BarSL:
    ref_high: float
    ref_low: float
    sl2: bool = False
    invalidated: bool = False  # INVALID BAR SL fired but didn't qualify as a fresh BAR(n) --
    # dormant: no more HH/SL-HH/SL-LL/SL2 tracking, but the frozen ref_low
    # here still stays live for one more shot at a fresh BAR SL(n) below it


@dataclass
class BarLineage:
    """One BAR lineage within a buy. Multiple can coexist (branching): a
    fresh BAR can form directly within an existing BAR SL's own High/Low
    range, without RED1/RED2, once that SL is active -- or, BAR 2 variant,
    an older still pre-SL lineage can keep racing in parallel with a fresh
    independent BAR(n+1) formed elsewhere, until the newer one's own BAR 2
    confirms. Every lineage races independently toward its own SL2 --
    whichever fires SL2 first wins REAR's reference and terminates every
    other lineage still alive."""
    label: str                     # backend-only sub-label, e.g. "A.1", "A.2"
    ref_high: float
    ref_low: float
    red1_since: bool = False       # a fresh RED1 has occurred since this lineage began
    ref_high_at_red1: float = 0.0  # frozen anchor for the "after RED1" close-comparison
    sl: Optional[BarSL] = None      # None while this lineage itself is still the active stage
    red2_ever: bool = False        # this lineage's own RED1 has already resolved into RED2 once --
    # a fresh RED1 can never attach to THIS SAME lineage again (RED1/RED2 cannot repeat on an
    # already-RED2'd cycle; only a genuinely NEW BAR generation/lineage starts a fresh RED1-eligible
    # cycle). Lineage keeps racing toward its own SL/SL2 as normal -- only fresh RED1 attachment stops.
    bar2: Optional[Bar2] = None    # BAR 2 variant: the confirmation gate. Does NOT persist
    # through reactivation -- reset to None every time this lineage reactivates in place.


@dataclass
class RearSL:
    ref_low: float


@dataclass
class Rear:
    ref_high: float
    ref_low: float
    red1_since: bool = False
    ref_high_at_red1: float = 0.0
    sl: Optional[RearSL] = None
    dormant: bool = False   # True once a newer BAR generation has ACTUALLY superseded it (not
    # merely been awaited via bar_pending -- see _supersede_rear_for_new_bar). Only meaningful
    # while sl is None; suppresses HH display, not SL/LL, not routing/re-attachment (that's red2_ever).
    red2_ever: bool = False  # this REAR's own RED1 has already resolved into RED2 once -- a
    # fresh RED1 can never attach to THIS SAME object again (mirrors BarLineage.red2_ever).
    # Deliberately separate from `dormant`: RED2 firing blocks future RED1 re-attachment
    # immediately, but must NOT suppress this REAR's own HH/LL display until a fresh BAR
    # generation has ACTUALLY formed to genuinely supersede it (19/04 -- conflating the two
    # wrongly suppressed REAR HH while the awaited BAR hadn't even formed yet).
    rear2: Optional[Bar2] = None  # BAR 2 variant: REAR's own confirmation gate.


@dataclass
class RearReenterSL:
    ref_low: float


@dataclass
class RearReenter:
    ref_high: float
    ref_low: float
    red1_since: bool = False
    ref_high_at_red1: float = 0.0
    sl: Optional[RearReenterSL] = None
    dormant: bool = False   # True once a newer BAR generation has ACTUALLY superseded it -- see Rear.dormant
    red2_ever: bool = False  # see Rear.red2_ever -- same principle, same reason for being separate
    # from `dormant`. Reset to False on this object's OWN reactivation (post-SL, price recovers
    # above its own frozen reference) -- same object reused, so per the per-transition audit this
    # must be explicitly decided, same as red2_ever was for BarLineage reactivation.
    rre2: Optional[Bar2] = None  # BAR 2 variant: REAR RE-ENTER's own confirmation gate.


@dataclass
class Buy:
    kind: str
    ref_high: float
    ref_low: float
    active: bool = True
    red1_ever: bool = False
    ref_high_at_red1: float = 0.0
    red1: Optional[Red1] = None
    bar_lineages: list = field(default_factory=list)  # ordered oldest-first; see BarLineage
    bar_sub_counter: int = 0   # for allocating "A.1", "A.2", ... sub-labels
    bar_pending: bool = False  # RED2 fired; awaiting BAR's own entry-shape confirmation
    # single persistent slot each -- a fresh REAR/REAR RE-ENTER formation
    # always wipes whichever older dormant one currently exists, regardless
    # of type (single-slot model, newest always wins)
    rear: Optional[Rear] = None
    rear_reenter: Optional[RearReenter] = None
    bar_high_pool: float = 0.0


@dataclass
class ParentCycle:
    id: int
    seq: int
    ref_high: float
    ref_low: float
    active: bool = True
    dormant: bool = False
    red_ever: bool = False
    ref_high_at_red: float = 0.0
    buy: Optional[Buy] = None


MILESTONE_KEYS = ("TZ BUY(", "NEW TZ BUY(", "BAR(", "REAR(", "REAR RE-ENTER(")

SL_LL_KEYS = (
    "TZ GREEN SL(", "TZ GREEN LL(",
    "TZ BUY SL(", "TZ BUY LL(", "NEW TZ BUY SL(", "NEW TZ BUY LL(",
    "BAR LL(", "BAR SL(", "BAR SL LL(", "BAR SL2(",
    "REAR LL(", "REAR SL(",
    "REAR RE-ENTER LL(", "REAR RE-ENTER SL(",
)


def is_milestone(ev: str) -> bool:
    for key in MILESTONE_KEYS:
        if ev.startswith(key):
            return True
    return False


def is_sl_or_ll(ev: str) -> bool:
    for key in SL_LL_KEYS:
        if ev.startswith(key):
            return True
    return False


class TZEngine:
    def __init__(self):
        self.branches: dict[int, ParentCycle] = {}
        self._seq_counter = 0
        self._pre_today_live_buy = {}

    def _next_seq(self):
        self._seq_counter += 1
        return self._seq_counter

    def lowest_free_id(self):
        n = 1
        while n in self.branches:
            n += 1
        return n

    def _deep_failure_reached(self, buy: Buy) -> bool:
        if buy.rear is not None and buy.rear.sl is not None:
            return True
        if buy.rear_reenter is not None and buy.rear_reenter.sl is not None:
            return True
        for lin in buy.bar_lineages:
            if lin.sl is not None and lin.sl.sl2:
                return True
        return False

    def _buy_currently_live(self, buy: Buy) -> bool:
        if not buy.active:
            return False
        if buy.rear_reenter is not None:
            if buy.rear_reenter.sl is not None:
                return False
            if not buy.rear_reenter.dormant:
                return True
        elif buy.rear is not None:
            if buy.rear.sl is not None:
                return False
            if not buy.rear.dormant:
                return True
        if buy.bar_lineages:
            # BAR 2 variant: a lineage whose own SL fired with no BAR 2
            # ever having formed is a permanent dead end (rulebook: "BAR SL
            # with no BAR 2 -> straight to TZ BUY LL -> TZ BUY SL, nothing
            # in between") -- sl.sl2 can never become True for it, so
            # without this it would count as "still racing toward SL2"
            # forever and wrongly keep the whole buy live, blocking any new
            # sibling TZ GREEN/TZ BUY branch from ever forming.
            return any(
                lin.sl is None or (lin.bar2 is not None and not lin.sl.sl2)
                for lin in buy.bar_lineages
            )
        return True

    def _milestone_blocked(self, pc: ParentCycle) -> bool:
        return any(pid != pc.id and other.seq > pc.seq and self._pre_today_live_buy.get(pid, False)
                    for pid, other in self.branches.items())

    def _rear_ancestor_terminated(self, buy: Buy) -> bool:
        """True if this buy's current REAR-family ancestor (REAR RE-ENTER
        if it exists, else REAR) has ALREADY failed at its own SL. Once
        that's happened, a fresh "REAR(n)" can never form again off some
        later BAR's own SL2 -- the only valid paths back up are that SAME
        ancestor's own post-SL REAR RE-ENTER machinery, or an entirely new
        TZ GREEN branch reaching its own TZ BUY. False if no ancestor
        exists yet, OR one exists but is merely dormant (superseded, never
        having reached its own SL) -- in that case "REAR" is free to recur
        off a later BAR's own SL2, even while an ancestor object still
        exists (BAR 2 variant: this is now the ONLY path back up whenever
        an ancestor is present but merely dormant -- see
        _eval_bar_lineages_progress, which no longer ever reactivates a
        merely-dormant ancestor in place; a fresh REAR always forms
        instead, off the BAR's own reference, discarding it)."""
        target = buy.rear_reenter if buy.rear_reenter is not None else buy.rear
        return target is not None and target.sl is not None

    def process(self, prev: Day, cur: Day):
        per_branch_events = {}
        milestone_achievers = []
        green_sl_pids = []

        any_live_buy = any(pc.active and pc.buy and self._buy_currently_live(pc.buy) for pc in self.branches.values())

        self._pre_today_live_buy = {pid: (pc.buy is not None and self._buy_currently_live(pc.buy))
                                     for pid, pc in self.branches.items()}

        if not any_live_buy:
            for pc in self.branches.values():
                pc.dormant = False

        for pid in list(self.branches):
            pc = self.branches[pid]
            if not pc.active:
                continue
            all_events = self._eval_parent(pc, prev, cur, any_live_buy)
            per_branch_events[pid] = all_events

            if any(e.startswith("TZ GREEN SL(") for e in all_events):
                green_sl_pids.append(pc.seq)

            for e in all_events:
                if is_milestone(e):
                    is_fresh_buy = e.startswith("TZ BUY(") or e.startswith("NEW TZ BUY(")
                    milestone_achievers.append((pc, is_fresh_buy))

        active_branches = [pc for pc in self.branches.values() if pc.active]
        tip = max(active_branches, key=lambda pc: pc.seq) if active_branches else None
        tip_deep_failure = (tip is not None and tip.buy is not None and
                             self._deep_failure_reached(tip.buy) and
                             not self._buy_currently_live(tip.buy))
        eligible_anchor = (
            tip is not None and not tip.dormant and tip.red_ever and
            (tip.buy is None or not tip.buy.active or tip_deep_failure)
        )
        can_spawn = eligible_anchor or tip is None
        new_branch_id = None
        if can_spawn and (cur.l >= prev.l and cur.h > prev.h and
                          (cur.h - prev.h) >= THRESH - EPS and cur.c >= prev.h):
            nid = self.lowest_free_id()
            new_pc = ParentCycle(id=nid, seq=self._next_seq(), ref_high=cur.h, ref_low=cur.l)
            self.branches[nid] = new_pc
            per_branch_events[nid] = [f"TZ GREEN({branch_label(nid)})"]
            new_branch_id = nid

        for seq in green_sl_pids:
            for oid, other in list(self.branches.items()):
                if other.active and other.seq > seq:
                    other.active = False

        collaterally_terminated = set()
        exemption_blocked_pids = set()
        for pc, is_fresh_buy in milestone_achievers:
            if not pc.active:
                continue
            blocked_this_achiever = False
            for oid, other in list(self.branches.items()):
                if other is pc or not other.active:
                    continue
                if other.seq < pc.seq:
                    other.dormant = True
                else:
                    if not is_fresh_buy and self._pre_today_live_buy.get(oid, False):
                        blocked_this_achiever = True
                        continue
                    other.active = False
                    collaterally_terminated.add(oid)
            if blocked_this_achiever:
                exemption_blocked_pids.add(pc.id)

        active_pcs = [pc for pc in self.branches.values() if pc.active]
        non_dormant = [pc for pc in active_pcs if not pc.dormant]
        if len(non_dormant) == 1:
            leader = non_dormant[0]
            for pc in active_pcs:
                if pc is not leader and pc.dormant and leader.ref_high > pc.ref_high:
                    pc.ref_high = leader.ref_high

        visible = []
        for pid, events in per_branch_events.items():
            pc_now = self.branches.get(pid)
            if pid in collaterally_terminated:
                continue
            if pc_now is not None and pc_now.dormant and pid != new_branch_id:
                if pid in exemption_blocked_pids:
                    continue
                visible += [e for e in events if is_milestone(e) or is_sl_or_ll(e)]
                if any(is_milestone(e) for e in events):
                    pc_now.dormant = False
            else:
                visible += events

        self.branches = {pid: pc for pid, pc in self.branches.items() if pc.active}
        return visible

    # -----------------------------------------------------------------
    def _eval_parent(self, pc: ParentCycle, prev: Day, cur: Day, any_live_buy: bool = False):
        ev = []

        is_sl = (cur.l <= pc.ref_low and (pc.ref_low - cur.l) >= THRESH - EPS and cur.c <= pc.ref_low + EPS)

        has_live_buy = pc.buy is not None and pc.buy.active

        hh = ll = False
        if not pc.red_ever:
            if cur.h > pc.ref_high and (cur.h - pc.ref_high) >= ANY:
                pc.ref_high = cur.h
                hh = True
        else:
            diff = cur.h - pc.ref_high
            if cur.h > pc.ref_high and (diff < THRESH - EPS or cur.l < prev.l or cur.c < pc.ref_high_at_red):
                pc.ref_high = cur.h
                hh = True
        if cur.l < pc.ref_low:
            gap = pc.ref_low - cur.l
            if (gap >= THRESH - EPS and cur.c > pc.ref_low + EPS) or gap < THRESH - EPS:
                pc.ref_low = cur.l
                ll = True

        if pc.buy is not None and pc.buy.ref_high > pc.ref_high:
            pc.ref_high = pc.buy.ref_high

        if hh and not has_live_buy and not is_sl:
            ev.append(f"TZ GREEN HH({branch_label(pc.id)})")
        if ll:
            ev.append(f"TZ GREEN LL({branch_label(pc.id)})")

        if is_sl:
            ev.append(f"TZ GREEN SL({branch_label(pc.id)})")
            pc.active = False
            return ev

        if not pc.red_ever:
            if (cur.h <= prev.h and cur.l < prev.l and (prev.l - cur.l) >= THRESH - EPS and cur.c <= prev.l):
                pc.red_ever = True
                pc.ref_high_at_red = pc.ref_high
                ev.append(f"RED({branch_label(pc.id)})")

        old_buy_unresolved = (pc.buy is not None and not pc.buy.active and
                               (bool(pc.buy.bar_lineages) or
                                pc.buy.rear is not None or pc.buy.rear_reenter is not None))
        if pc.red_ever and (pc.buy is None or not pc.buy.active) and not old_buy_unresolved and not any_live_buy:
            ref_high = pc.buy.ref_high if pc.buy is not None else max(pc.ref_high, pc.ref_high_at_red)
            if cur.l >= prev.l and cur.h > ref_high and (cur.h - ref_high) >= THRESH - EPS and cur.c >= ref_high:
                kind = 'TZ_BUY' if pc.buy is None else 'NEW_TZ_BUY'
                pc.buy = Buy(kind=kind, ref_high=cur.h, ref_low=cur.l)
                label = "TZ BUY" if kind == 'TZ_BUY' else "NEW TZ BUY"
                ev.append(f"{label}({branch_label(pc.id)})")

        if pc.buy is not None:
            ev += self._eval_buy(pc, pc.buy, prev, cur)

        return ev

    # -----------------------------------------------------------------
    def _eval_buy(self, pc, buy: Buy, prev: Day, cur: Day):
        ev = []
        label = "TZ BUY" if buy.kind == 'TZ_BUY' else "NEW TZ BUY"
        sl_label = "TZ BUY SL" if buy.kind == 'TZ_BUY' else "NEW TZ BUY SL"

        has_deeper_active = (bool(buy.bar_lineages) or buy.bar_pending or
                              buy.rear is not None or buy.rear_reenter is not None)
        no_bar_yet = not has_deeper_active
        red1_preexisting_at_buy_level = buy.active and no_bar_yet and buy.red1 is not None and buy.red1.active

        if buy.active:
            if buy.bar_high_pool > buy.ref_high:
                buy.ref_high = buy.bar_high_pool
            is_sl = (cur.l <= buy.ref_low and (buy.ref_low - cur.l) >= THRESH - EPS and cur.c <= buy.ref_low + EPS)
            hh = ll = False
            if no_bar_yet:
                red1_clears_today = red1_preexisting_at_buy_level and self._red1_invalidates_today(buy, cur)
                if not red1_preexisting_at_buy_level or red1_clears_today:
                    if not buy.red1_ever or red1_clears_today:
                        if cur.h > buy.ref_high and (cur.h - buy.ref_high) >= ANY:
                            buy.ref_high = cur.h
                            hh = True
                    else:
                        diff = cur.h - buy.ref_high
                        if cur.h > buy.ref_high and (diff < THRESH - EPS or cur.l < prev.l or cur.c < buy.ref_high_at_red1):
                            buy.ref_high = cur.h
                            hh = True
            if cur.l < buy.ref_low:
                gap = buy.ref_low - cur.l
                if (gap >= THRESH - EPS and cur.c > buy.ref_low + EPS) or gap < THRESH - EPS:
                    buy.ref_low = cur.l
                    ll = True

            if hh:
                ev.append(f"{label} HH({branch_label(pc.id)})")
            if ll:
                ev.append(f"{label} LL({branch_label(pc.id)})")

            if is_sl:
                ev.append(f"{sl_label}({branch_label(pc.id)})")
                buy.active = False
                buy.bar_pending = False
                buy.red1 = None

        # BAR 2 variant: pre-today snapshots, taken BEFORE any of today's
        # own tracking below can mutate the values they need to compare
        # against -- same ordering-bug class fixed identically at every
        # tier in this file (a same-day self-referential mutation running
        # before a downstream check reads it, making that check compare
        # today's own value against itself and always fail/pass wrongly).
        pre_today_lin_ref = {lin.label: lin.ref_high for lin in buy.bar_lineages}
        pre_today_bar2_ref = {lin.label: (lin.bar2.ref_high if lin.bar2 is not None else None)
                               for lin in buy.bar_lineages}
        pre_today_rear_ref = buy.rear.ref_high if buy.rear is not None else None
        pre_today_rear2_ref = (buy.rear.rear2.ref_high if buy.rear is not None and buy.rear.rear2 is not None
                                else None)
        pre_today_rre_ref = buy.rear_reenter.ref_high if buy.rear_reenter is not None else None
        pre_today_rre2_ref = (buy.rear_reenter.rre2.ref_high
                               if buy.rear_reenter is not None and buy.rear_reenter.rre2 is not None else None)

        # BAR's own HH keeps tracking/showing for as long as it's the
        # NEWEST lineage in the chain (feeds REAR's reference pool) -- an
        # older, superseded lineage's own HH stops being recorded the
        # moment a newer generation takes over. LL only tracks/shows while
        # a lineage is still pre-SL.
        newest_lin = buy.bar_lineages[-1] if buy.bar_lineages else None
        if newest_lin is not None and not self._bar_hh_suppressed_today(buy, newest_lin, prev, cur):
            lin_hh_ev = self._eval_bar_lineage_hh(pc, buy, newest_lin, prev, cur)
            # BAR 2 variant: BAR's own HH is permanently suppressed from
            # display once this lineage has its own BAR 2 -- BAR 2 is now
            # the governing reference for everything above it. Value keeps
            # updating internally (lin.ref_high), only the display is
            # suppressed.
            if newest_lin.bar2 is None:
                ev += lin_hh_ev

        # BAR 2 variant: formation check + forever-ungoverned HH/LL/SL
        # tracking for EVERY lineage currently in buy.bar_lineages -- not
        # scoped to newest_lin, since an older lineage keeps racing in
        # parallel until the newest one's own BAR 2 confirms (see below),
        # and BAR 2 keeps tracking even after its own lineage's BAR SL2 has
        # fired. Collected per-lineage first (not appended straight to ev)
        # so the termination pass right after it can retroactively wipe an
        # older lineage's own same-day contribution.
        bar2_ev_by_label = {}
        for lin in buy.bar_lineages:
            bar2_ev_by_label[lin.label] = self._eval_bar2(pc, buy, lin, prev, cur, pre_today_lin_ref.get(lin.label))

        # Confirmed: "Once a new BAR 2 is confirmed, the earlier BAR
        # becomes irrelevant -- REAR's eventual reference is now governed
        # by the newest lineage's own BAR 2 regardless of what its own SL/
        # SL2 does later." This only cuts short an OLDER lineage still
        # sitting pre-SL and merely racing in parallel while the newer
        # generation's own BAR 2 had not yet confirmed -- it does NOT apply
        # once that older lineage has ALREADY reached its own BAR SL2
        # (separate, already-established mechanism: an SL2'd lineage races
        # toward REAR independently via its own INVALID BAR HH tracking).
        # And it never applies while the newest lineage's own BAR 2 hasn't
        # confirmed at all (a dead-end BAR with no BAR 2 lets an older
        # sibling keep racing indefinitely).
        if newest_lin is not None and newest_lin.bar2 is not None:
            surviving = [l for l in buy.bar_lineages if l is newest_lin or l.sl is not None]
            buy.bar_lineages = surviving
            for lin_survivor in surviving:
                ev += bar2_ev_by_label.get(lin_survivor.label, [])
        else:
            for lin_ev in bar2_ev_by_label.values():
                ev += lin_ev

        # REAR's own HH/LL only track/show while REAR hasn't hit its own
        # SL yet. Dormancy only silences ADVANCEMENT tracking (HH), not LL.
        if buy.rear is not None:
            if buy.rear.sl is None:
                rear_ev = self._eval_rear_hh_ll(pc, buy, buy.rear, prev, cur)
                if buy.rear.dormant:
                    rear_ev = [e for e in rear_ev if "LL(" in e]
                # BAR 2 variant: REAR's own HH permanently suppressed once
                # REAR 2 exists -- mirrors BAR HH's suppression one tier up.
                if buy.rear.rear2 is not None:
                    rear_ev = [e for e in rear_ev if not e.startswith("REAR HH(")]
                ev += rear_ev
            ev += self._eval_rear2(pc, buy, buy.rear, prev, cur, pre_today_rear_ref, pre_today_rear2_ref)

        # Same rule for REAR RE-ENTER.
        if buy.rear_reenter is not None:
            if buy.rear_reenter.sl is None:
                rre_ev = self._eval_rear_reenter_hh_ll(pc, buy, buy.rear_reenter, prev, cur)
                if buy.rear_reenter.dormant:
                    rre_ev = [e for e in rre_ev if "LL(" in e]
                if buy.rear_reenter.rre2 is not None:
                    rre_ev = [e for e in rre_ev if not e.startswith("REAR RE-ENTER HH(")]
                ev += rre_ev
            ev += self._eval_rre2(pc, buy, buy.rear_reenter, prev, cur, pre_today_rre_ref, pre_today_rre2_ref)

        bar_confirms_today = (buy.bar_pending and buy.active and not buy.bar_lineages and
                               (buy.rear is not None or buy.rear_reenter is not None) and
                               self._bar_entry_shape(prev, cur))
        if buy.rear_reenter is not None and buy.rear_reenter.sl is not None:
            # BAR 2 variant: REAR RE-ENTER's own SL -> REAR RE-ENTER transition
            # is only reachable once REAR RE-ENTER 2 has formed (mirrors BAR
            # SL2 requiring BAR 2). A REAR RE-ENTER whose own SL fired
            # without REAR RE-ENTER 2 ever having formed is a dead end --
            # nothing further happens for it (no explicit further path back
            # up defined; it just stays silent from here).
            if buy.rear_reenter.rre2 is not None:
                ev += self._eval_rear_reenter_sl_progress(pc, buy, buy.rear_reenter, buy.rear_reenter.sl,
                                                           prev, cur, pre_today_rre2_ref)
        elif buy.rear_reenter is None and buy.rear is not None and buy.rear.sl is not None:
            # BAR 2 variant: REAR's own SL -> REAR RE-ENTER transition is
            # only reachable once REAR 2 has formed (mirrors BAR SL2
            # requiring BAR 2). REAR's own SL fired without REAR 2 ever
            # having formed -- a dead end.
            if buy.rear.rear2 is not None:
                ev += self._eval_rear_sl_progress(pc, buy, buy.rear, buy.rear.sl, prev, cur, pre_today_rear2_ref)
        elif bar_confirms_today:
            ev = [e for e in ev if not (e.startswith("REAR HH(") or e.startswith("REAR RE-ENTER HH("))]
            ev += self._check_bar_pending(pc, buy, prev, cur)
        elif buy.rear_reenter is not None and not buy.rear_reenter.dormant:
            ev += self._eval_rear_reenter_progress(pc, buy, buy.rear_reenter, prev, cur)
        elif buy.rear_reenter is None and buy.rear is not None and not buy.rear.dormant:
            ev += self._eval_rear_progress(pc, buy, buy.rear, prev, cur)
        elif buy.bar_lineages:
            ev += self._eval_bar_lineages_progress(pc, buy, prev, cur, pre_today_bar2_ref)
        elif buy.bar_pending and buy.active:
            ev += self._check_bar_pending(pc, buy, prev, cur)
        elif not buy.active:
            pass
        elif not red1_preexisting_at_buy_level:
            if (cur.h <= prev.h and cur.l < prev.l and (prev.l - cur.l) >= THRESH - EPS and cur.c <= prev.l):
                if not buy.red1_ever:
                    buy.ref_high_at_red1 = buy.ref_high
                buy.red1_ever = True
                buy.red1 = Red1(ref_high=cur.h, ref_low=cur.l)
                ev.append(f"RED1({branch_label(pc.id)})")
        else:
            ev += self._eval_red1_generic(pc, buy, buy, prev, cur)

        # REAR's (and REAR RE-ENTER's) own SL must still be checked and
        # take effect even while dormant.
        if buy.rear_reenter is not None and buy.rear_reenter.dormant and buy.rear_reenter.sl is None:
            rre = buy.rear_reenter
            if (cur.l < rre.ref_low and (rre.ref_low - cur.l) >= THRESH - EPS and cur.c <= rre.ref_low + EPS):
                ev.append(f"REAR RE-ENTER SL({branch_label(pc.id)})")
                rre.sl = RearReenterSL(ref_low=cur.l)
                buy.red1 = None
                buy.bar_lineages = []
                buy.bar_sub_counter = 0
                buy.bar_pending = False
        elif buy.rear is not None and buy.rear.dormant and buy.rear.sl is None:
            rear = buy.rear
            if (cur.l < rear.ref_low and (rear.ref_low - cur.l) >= THRESH - EPS and cur.c <= rear.ref_low + EPS):
                ev.append(f"REAR SL({branch_label(pc.id)})")
                rear.sl = RearSL(ref_low=cur.l)
                buy.bar_lineages = []
                buy.bar_sub_counter = 0
                buy.red1 = None
                buy.bar_pending = False

        # BAR 2 variant retroactive same-day suppression pass -- both parts
        # confirmed necessary because HH/LL/SL-tier functions above run
        # BEFORE the checks that would otherwise need to suppress them:
        #
        # (1) An underlying SL beats its own "2" tier's SL/LL the same day
        # (confirmed: BAR SL2(A.1) + BAR SL(A.2) triggering together should
        # only show BAR SL2(A.1); BAR SL(A) beats BAR 2 SL/LL(A) the same
        # day since a new BAR now has to form regardless).
        sl_labels = set()
        for e in ev:
            if e.startswith("BAR SL(") or e.startswith("REAR SL(") or e.startswith("REAR RE-ENTER SL("):
                sl_labels.add(e[e.index("(") + 1:-1])
        if sl_labels:
            ev = [e for e in ev if not (
                (e.startswith("BAR HH(") or e.startswith("BAR 2 SL(") or e.startswith("BAR 2 LL(") or
                 e.startswith("REAR 2 SL(") or e.startswith("REAR 2 LL(") or
                 e.startswith("REAR RE-ENTER 2 SL(") or e.startswith("REAR RE-ENTER 2 LL("))
                and e[e.index("(") + 1:-1] in sl_labels
            )]

        # (2) Once a "2" produces ANY event (formation included) on a given
        # label, that SAME label's own underlying HH is suppressed THAT
        # SAME DAY too, not just from the following day -- confirmed:
        # "once BAR 2 HH occurs, no need to record BAR HH as well," and
        # this applies on the "2"'s own formation day exactly as much as
        # any later day (26/04, 07/06, 21/06 confirmed: "BAR HH(label) +
        # BAR 2(label)" together on BAR 2's own formation day is wrong).
        two_labels = {"BAR HH(": set(), "REAR HH(": set(), "REAR RE-ENTER HH(": set()}
        for e in ev:
            for prefix, underlying in (
                ("BAR 2(", "BAR HH("), ("BAR 2 ", "BAR HH("),
                ("REAR RE-ENTER 2(", "REAR RE-ENTER HH("), ("REAR RE-ENTER 2 ", "REAR RE-ENTER HH("),
                ("REAR 2(", "REAR HH("), ("REAR 2 ", "REAR HH("),
            ):
                if e.startswith(prefix):
                    label = e[e.index("(") + 1:-1]
                    two_labels[underlying].add(label)
        if any(two_labels.values()):
            ev = [e for e in ev if not any(
                e.startswith(underlying) and e[len(underlying):-1] in labels
                for underlying, labels in two_labels.items()
            )]

        return ev

    # -----------------------------------------------------------------
    def _eval_red1_generic(self, pc, buy, stage_obj, prev: Day, cur: Day):
        ev = []
        red1 = buy.red1
        if cur.h >= red1.ref_high and (cur.h - red1.ref_high) >= THRESH - EPS and cur.c >= red1.ref_high:
            ev.append(f"INVALID RED1({branch_label(pc.id)})")
            red1.active = False
            self._reset_red1_regime(stage_obj)
            return ev

        if cur.h > red1.ref_high and (cur.h - red1.ref_high) >= ANY:
            red1.ref_high = cur.h
            ev.append(f"RED1 HH({branch_label(pc.id)})")

        if cur.l < red1.ref_low:
            red2_holds = (cur.h <= prev.h and (red1.ref_low - cur.l) >= THRESH - EPS and
                          cur.c <= red1.ref_low + EPS)
            if red2_holds:
                red1.active = False
                ev.append(f"RED2({branch_label(pc.id)})")
                if isinstance(stage_obj, (BarLineage, Rear, RearReenter)):
                    stage_obj.red2_ever = True
                self._clear_for_new_bar_generation(buy)
            else:
                red1.ref_low = cur.l
                ev.append(f"RED1 LL({branch_label(pc.id)})")

        return ev

    def _attach_fresh_red1(self, pc, buy, stage_obj, prev: Day, cur: Day):
        ev = []
        if (cur.h <= prev.h and cur.l < prev.l and (prev.l - cur.l) >= THRESH - EPS and cur.c <= prev.l):
            if not stage_obj.red1_since:
                stage_obj.ref_high_at_red1 = stage_obj.ref_high
            stage_obj.red1_since = True
            buy.red1 = Red1(ref_high=cur.h, ref_low=cur.l)
            ev.append(f"RED1({branch_label(pc.id)})")
        return ev

    def _reset_red1_regime(self, stage_obj):
        if hasattr(stage_obj, 'red1_since'):
            stage_obj.red1_since = False
        elif hasattr(stage_obj, 'red1_ever'):
            stage_obj.red1_ever = False

    def _red1_invalidates_today(self, buy: Buy, cur: Day) -> bool:
        red1 = buy.red1
        if red1 is None or not red1.active:
            return False
        return cur.h >= red1.ref_high and (cur.h - red1.ref_high) >= THRESH - EPS and cur.c >= red1.ref_high

    # -----------------------------------------------------------------
    def _bar_sl_invalidates_today(self, lin: BarLineage, cur: Day) -> bool:
        sl = lin.sl
        if sl is None or sl.sl2 or sl.invalidated:
            return False
        return cur.h >= sl.ref_high and (cur.h - sl.ref_high) >= THRESH - EPS and cur.c >= sl.ref_high

    def _bar_entry_shape(self, prev: Day, cur: Day) -> bool:
        return (cur.l >= prev.l and cur.h > prev.h and
                (cur.h - prev.h) >= THRESH - EPS and cur.c >= prev.h)

    def _mechanism1_confirms_today(self, buy: Buy, prev: Day, cur: Day) -> bool:
        return buy.bar_pending and self._bar_entry_shape(prev, cur)

    def _dormant_bar_low_check(self, buy: Buy, lin: BarLineage, sl: BarSL, cur: Day):
        ev = []
        if cur.l < sl.ref_low:
            gap = sl.ref_low - cur.l
            if gap >= THRESH - EPS and cur.c <= sl.ref_low + EPS:
                ev.append(f"BAR SL({lin.label})")
                lin.sl = BarSL(ref_high=cur.h, ref_low=cur.l)
                buy.red1 = None
            else:
                sl.ref_low = cur.l
                ev.append(f"INVALID BAR LL({lin.label})")
        return ev

    def _bar_hh_suppressed_today(self, buy: Buy, lin: BarLineage, prev: Day, cur: Day) -> bool:
        if lin.sl is not None and lin.sl.invalidated:
            return True
        if lin.sl is not None and lin.sl.sl2:
            return True
        if self._bar_sl_invalidates_today(lin, cur):
            return True
        if lin.sl is None and self._mechanism1_confirms_today(buy, prev, cur):
            return True
        return False

    def _clear_for_new_bar_generation(self, buy):
        buy.bar_pending = True

    def _supersede_rear_for_new_bar(self, buy):
        if buy.rear_reenter and buy.rear_reenter.sl is None and not buy.rear_reenter.dormant:
            buy.rear_reenter.dormant = True
            if buy.rear_reenter.rre2 is not None:
                buy.rear_reenter.rre2.dormant = True
        elif buy.rear and buy.rear.sl is None and not buy.rear.dormant:
            buy.rear.dormant = True
            if buy.rear.rear2 is not None:
                buy.rear.rear2.dormant = True

    # -----------------------------------------------------------------
    def _check_bar_pending(self, pc, buy, prev: Day, cur: Day):
        if (cur.l >= prev.l and cur.h > prev.h and
                (cur.h - prev.h) >= THRESH - EPS and cur.c >= prev.h):
            buy.bar_sub_counter += 1
            sub_label = f"{branch_label(pc.id)}.{buy.bar_sub_counter}"
            buy.bar_lineages.append(BarLineage(label=sub_label, ref_high=cur.h, ref_low=cur.l))
            buy.bar_pending = False
            buy.bar_high_pool = max(buy.bar_high_pool, cur.h)
            self._supersede_rear_for_new_bar(buy)
            return [f"BAR({sub_label})"]
        return []

    # =================== BAR family (multi-lineage) ===================
    def _eval_bar_lineage_hh(self, pc, buy: Buy, lin: BarLineage, prev: Day, cur: Day):
        ev = []
        if not lin.red1_since or self._red1_invalidates_today(buy, cur):
            if cur.h > lin.ref_high and (cur.h - lin.ref_high) >= ANY:
                lin.ref_high = cur.h
                buy.bar_high_pool = max(buy.bar_high_pool, lin.ref_high)
                ev.append(f"BAR HH({lin.label})")
        else:
            diff = cur.h - lin.ref_high
            if cur.h > lin.ref_high and (diff < THRESH - EPS or cur.l < prev.l or cur.c < lin.ref_high_at_red1):
                lin.ref_high = cur.h
                buy.bar_high_pool = max(buy.bar_high_pool, lin.ref_high)
                ev.append(f"BAR HH({lin.label})")
        if lin.sl is None and cur.l < lin.ref_low:
            gap = lin.ref_low - cur.l
            if (gap >= THRESH - EPS and cur.c > lin.ref_low + EPS) or gap < THRESH - EPS:
                lin.ref_low = cur.l
                ev.append(f"BAR LL({lin.label})")
        return ev

    # ------------------- BAR 2 / REAR 2 / REAR RE-ENTER 2 -------------------
    def _eval_bar2(self, pc, buy: Buy, lin: BarLineage, prev: Day, cur: Day, pre_today_lin_ref=None):
        """Forms off lin's own reference high (mirrors TZ GREEN 2's shape),
        only while lin itself is pre-SL. Gates RED1/RED2 on lin, and gates
        BAR SL2 being reachable at all. Has its own independent SL/recovery
        cycle -- no escalation. Frozen (no independent recovery) once lin's
        own SL fires, but keeps quietly climbing as INVALID BAR HH."""
        ev = []
        if lin.bar2 is None:
            if lin.sl is None:
                ref = pre_today_lin_ref if pre_today_lin_ref is not None else lin.ref_high
                if (cur.l >= prev.l and cur.h > ref and (cur.h - ref) >= THRESH - EPS and cur.c >= ref):
                    lin.bar2 = Bar2(ref_high=cur.h, ref_low=cur.l)
                    ev.append(f"BAR 2({lin.label})")
            return ev
        if lin.sl is not None:
            if cur.h > lin.bar2.ref_high and (cur.h - lin.bar2.ref_high) >= ANY:
                lin.bar2.ref_high = cur.h
                ev.append(f"INVALID BAR HH({lin.label})")
            return ev
        b2 = lin.bar2
        if b2.sl_active:
            if (cur.l >= prev.l and cur.h > b2.ref_high and (cur.h - b2.ref_high) >= THRESH - EPS
                    and cur.c >= b2.ref_high):
                b2.ref_high = cur.h
                b2.ref_low = cur.l
                b2.sl_active = False
                ev.append(f"BAR 2({lin.label})")
            return ev
        if cur.l < b2.ref_low:
            gap = b2.ref_low - cur.l
            if gap >= THRESH - EPS and cur.c <= b2.ref_low + EPS:
                b2.sl_active = True
                ev.append(f"BAR 2 SL({lin.label})")
                return ev
            b2.ref_low = cur.l
            ev.append(f"BAR 2 LL({lin.label})")
        if cur.h > b2.ref_high and (cur.h - b2.ref_high) >= ANY:
            b2.ref_high = cur.h
            ev.append(f"BAR 2 HH({lin.label})")
        return ev

    def _eval_rear2(self, pc, buy: Buy, rear: Rear, prev: Day, cur: Day,
                     pre_today_rear_ref=None, pre_today_rear2_ref=None):
        """Mirrors _eval_bar2 one level up. rear.dormant guard placed AFTER
        the formation branch -- rear.dormant can only become True once
        rear.rear2 already exists (set by _supersede_rear_for_new_bar,
        which requires rear.sl is None -- i.e. rear2 already formed if
        rear is ever superseded while rear2 exists -- so it's safe to check
        dormancy only on the tracking-after-formation path)."""
        ev = []
        if rear.rear2 is None:
            if rear.sl is None:
                ref = pre_today_rear_ref if pre_today_rear_ref is not None else rear.ref_high
                if (cur.l >= prev.l and cur.h > ref and (cur.h - ref) >= THRESH - EPS and cur.c >= ref):
                    rear.rear2 = Bar2(ref_high=cur.h, ref_low=cur.l)
                    ev.append(f"REAR 2({branch_label(pc.id)})")
            return ev
        if rear.rear2.dormant:
            return ev
        if rear.sl is not None:
            if cur.h > rear.rear2.ref_high and (cur.h - rear.rear2.ref_high) >= ANY:
                rear.rear2.ref_high = cur.h
                ev.append(f"INVALID REAR HH({branch_label(pc.id)})")
            return ev
        r2 = rear.rear2
        if r2.sl_active:
            if (cur.l >= prev.l and cur.h > r2.ref_high and (cur.h - r2.ref_high) >= THRESH - EPS
                    and cur.c >= r2.ref_high):
                r2.ref_high = cur.h
                r2.ref_low = cur.l
                r2.sl_active = False
                ev.append(f"REAR 2({branch_label(pc.id)})")
            return ev
        if cur.l < r2.ref_low:
            gap = r2.ref_low - cur.l
            if gap >= THRESH - EPS and cur.c <= r2.ref_low + EPS:
                r2.sl_active = True
                ev.append(f"REAR 2 SL({branch_label(pc.id)})")
                return ev
            r2.ref_low = cur.l
            ev.append(f"REAR 2 LL({branch_label(pc.id)})")
        if cur.h > r2.ref_high and (cur.h - r2.ref_high) >= ANY:
            r2.ref_high = cur.h
            ev.append(f"REAR 2 HH({branch_label(pc.id)})")
        return ev

    def _eval_rre2(self, pc, buy: Buy, rre: RearReenter, prev: Day, cur: Day,
                    pre_today_rre_ref=None, pre_today_rre2_ref=None):
        """Mirrors _eval_rear2 one level deeper. rre.dormant guard placed at
        the VERY TOP -- rre.dormant CAN become True before rre.rre2 ever
        forms (a fresh BAR generation superseding REAR RE-ENTER before its
        own "2" ever confirmed), unlike rear.dormant one tier up."""
        ev = []
        if rre.dormant:
            return ev
        if rre.rre2 is None:
            if rre.sl is None:
                ref = pre_today_rre_ref if pre_today_rre_ref is not None else rre.ref_high
                if (cur.l >= prev.l and cur.h > ref and (cur.h - ref) >= THRESH - EPS and cur.c >= ref):
                    rre.rre2 = Bar2(ref_high=cur.h, ref_low=cur.l)
                    ev.append(f"REAR RE-ENTER 2({branch_label(pc.id)})")
            return ev
        if rre.sl is not None:
            if cur.h > rre.rre2.ref_high and (cur.h - rre.rre2.ref_high) >= ANY:
                rre.rre2.ref_high = cur.h
                ev.append(f"INVALID REAR RE-ENTER HH({branch_label(pc.id)})")
            return ev
        r2 = rre.rre2
        if r2.sl_active:
            if (cur.l >= prev.l and cur.h > r2.ref_high and (cur.h - r2.ref_high) >= THRESH - EPS
                    and cur.c >= r2.ref_high):
                r2.ref_high = cur.h
                r2.ref_low = cur.l
                r2.sl_active = False
                ev.append(f"REAR RE-ENTER 2({branch_label(pc.id)})")
            return ev
        if cur.l < r2.ref_low:
            gap = r2.ref_low - cur.l
            if gap >= THRESH - EPS and cur.c <= r2.ref_low + EPS:
                r2.sl_active = True
                ev.append(f"REAR RE-ENTER 2 SL({branch_label(pc.id)})")
                return ev
            r2.ref_low = cur.l
            ev.append(f"REAR RE-ENTER 2 LL({branch_label(pc.id)})")
        if cur.h > r2.ref_high and (cur.h - r2.ref_high) >= ANY:
            r2.ref_high = cur.h
            ev.append(f"REAR RE-ENTER 2 HH({branch_label(pc.id)})")
        return ev

    # -----------------------------------------------------------------
    def _eval_bar_lineages_progress(self, pc, buy, prev: Day, cur: Day, pre_today_bar2_ref=None):
        """Advances every currently-alive BAR lineage's SL/SL2 state (HH/LL/
        BAR-2 already handled earlier this same candle). Whichever
        lineage's SL2 condition fires first wins: a fresh REAR forms off
        its own reference, and every other lineage terminates immediately.
        Also checks whether a fresh BAR can branch off the newest
        lineage's SL range, and attaches RED1/RED2 to whichever lineage is
        currently the genuinely active (pre-SL) one -- BAR 2 variant: only
        the NEWEST lineage ever participates in RED1/RED2 (single shared
        buy.red1 object)."""
        ev = []
        label_id = branch_label(pc.id)
        rear_winner = None
        sl2_confirmed_today = False
        reactivated_this_candle = False
        per_lineage_ev: dict = {}
        lineage_objs: dict = {}

        # RED1/RED2 is a SINGLE shared object per buy (buy.red1), not one
        # per lineage -- it only ever means "the currently active/newest
        # BAR's own RED1/RED2 pullback." Frozen once, before the loop, so
        # an older lineage racing in parallel behind the newest one never
        # also gets routed through it (which would double-process the same
        # candle's RED1/RED2 against two lineages at once).
        newest_for_red1 = buy.bar_lineages[-1] if buy.bar_lineages else None

        for lin in list(buy.bar_lineages):
            lineage_objs[lin.label] = lin
            lin_ev = per_lineage_ev.setdefault(lin.label, [])
            ev = lin_ev
            if lin.sl is None:
                if (cur.l < lin.ref_low and (lin.ref_low - cur.l) >= THRESH - EPS and cur.c <= lin.ref_low + EPS):
                    ev.append(f"BAR SL({lin.label})")
                    lin.sl = BarSL(ref_high=cur.h, ref_low=cur.l)
                    buy.red1 = None
                    lin.red1_since = False
                    continue
                if lin is newest_for_red1:
                    red1_preexisting = buy.red1 is not None and buy.red1.active
                    if red1_preexisting:
                        ev += self._eval_red1_generic(pc, buy, lin, prev, cur)
                    elif lin.bar2 is not None and not lin.red2_ever:
                        # BAR 2 variant gate: a fresh RED1 cannot attach to
                        # this lineage until its own BAR 2 has formed.
                        ev += self._attach_fresh_red1(pc, buy, lin, prev, cur)
                continue

            sl = lin.sl

            if lin.bar2 is None:
                # BAR 2 variant: this lineage's SL fired without a BAR 2
                # ever having formed for it -- a permanent dead end. No
                # INVALID BAR SL, no BAR SL HH/LL, no BAR SL2. The only
                # ways out are a fresh BAR(n+1) forming elsewhere
                # (mechanism 1 below, which removes this dead lineage) or
                # the top-level TZ BUY SL eventually firing.
                continue

            if sl.invalidated:
                ev += self._dormant_bar_low_check(buy, lin, sl, cur)
                continue

            if not sl.sl2:
                if cur.h >= sl.ref_high and (cur.h - sl.ref_high) >= THRESH - EPS and cur.c >= sl.ref_high:
                    ev.append(f"INVALID BAR SL({lin.label})")
                    buy.bar_high_pool = max(buy.bar_high_pool, cur.h)
                    if lin is buy.bar_lineages[-1] and self._bar_entry_shape(prev, cur):
                        lin.sl = None
                        lin.ref_high = cur.h
                        lin.ref_low = cur.l
                        lin.red1_since = False
                        lin.red2_ever = False
                        # BAR 2 variant: BAR 2 does NOT persist through a
                        # BAR-level reactivation -- every fresh BAR
                        # generation needs its own new BAR 2 from scratch.
                        lin.bar2 = None
                        reactivated_this_candle = True
                        buy.bar_pending = False
                        ev.append(f"BAR({lin.label})")
                    elif lin is buy.bar_lineages[-1]:
                        sl.invalidated = True
                        ev += self._dormant_bar_low_check(buy, lin, sl, cur)
                    else:
                        buy.bar_lineages.remove(lin)
                    continue
                if cur.h > sl.ref_high and (cur.h - sl.ref_high) >= ANY:
                    sl.ref_high = cur.h
                    buy.bar_high_pool = max(buy.bar_high_pool, sl.ref_high)
                    ev.append(f"BAR SL HH({lin.label})")
                if cur.l < sl.ref_low:
                    gap = sl.ref_low - cur.l
                    if (gap >= THRESH - EPS and cur.c > sl.ref_low + EPS) or gap < THRESH - EPS:
                        sl.ref_low = cur.l
                        ev.append(f"BAR SL LL({lin.label})")
                if (cur.l < sl.ref_low and (sl.ref_low - cur.l) >= THRESH - EPS and cur.c <= sl.ref_low + EPS):
                    ev.append(f"BAR SL2({lin.label})")
                    sl.sl2 = True
                    sl2_confirmed_today = True
                    # BAR 2 variant: Event028's own bar_high_pool/ever_invalid
                    # reference rule is superseded entirely for this variant.
                    # BAR SL2 is only reachable when lin.bar2 already exists,
                    # so REAR's reference is simply BAR 2's own live
                    # reference high, read at the moment REAR actually forms
                    # -- see the rear_ref read below, and _eval_bar2 for the
                    # ongoing forever tracking that keeps that value current
                    # even after this SL2 (BAR 2 HH/INVALID BAR HH keeps
                    # climbing days after SL2).
                    buy.bar_pending = False
            elif not self._rear_ancestor_terminated(buy):
                # BAR 2 variant: a BAR's own SL2 ALWAYS produces a fresh
                # REAR, never a reactivation of whatever dormant ancestor
                # (REAR or REAR RE-ENTER) happens to already exist --
                # regardless of whether that ancestor's own frozen/quietly-
                # climbing reference happens to clear the same day.
                # "REAR RE-ENTER" is reserved exclusively for that SAME
                # ancestor's own SL genuinely recovering, an unrelated
                # mechanism that never routes through here at all. Blocked
                # entirely (see _rear_ancestor_terminated) once the
                # ancestor has already failed at its own SL.
                pre_ref = pre_today_bar2_ref.get(lin.label) if pre_today_bar2_ref else None
                rear_ref = pre_ref if pre_ref is not None else lin.bar2.ref_high
                is_rear = (cur.l >= prev.l and cur.h > rear_ref and
                           (cur.h - rear_ref) >= THRESH - EPS and cur.c >= rear_ref)
                if is_rear and not self._milestone_blocked(pc):
                    rear_winner = (lin, cur.h, cur.l)
                    break  # first lineage to hit SL2/REAR this candle wins

        if sl2_confirmed_today:
            for label, lin_obj in lineage_objs.items():
                if lin_obj.sl is not None and not lin_obj.sl.sl2:
                    per_lineage_ev[label] = []
            buy.bar_lineages = [l for l in buy.bar_lineages if l.sl is None or l.sl.sl2]

        ev = []
        for lin_ev in per_lineage_ev.values():
            ev += lin_ev

        if rear_winner is not None:
            lin, rh, rl = rear_winner
            ev.append(f"REAR({label_id})")
            buy.rear_reenter = None  # single-slot: newest REAR-family formation wipes any older dormant one
            buy.rear = Rear(ref_high=rh, ref_low=rl)
            buy.bar_lineages = []  # every lineage -- ancestor or descendant -- terminates
            buy.bar_sub_counter = 0
            return ev

        # mechanism 1: RED2 already fired against some (still sl=None)
        # lineage -- a fresh BAR is awaited via the general breakout shape.
        # BAR 2 variant: a fresh, independent BAR(n+1) does NOT terminate
        # the lineage RED2 fired from while it's still pre-SL -- per
        # _clear_for_new_bar_generation's own principle ("the EXISTING
        # BAR(n) lineage does NOT get wiped by its own RED2 -- it keeps
        # living in parallel with a freshly-awaited new BAR(n) generation"),
        # that parallel-living continues THROUGH and PAST the moment the
        # fresh BAR(n+1) actually confirms, not just during the awaiting
        # window. It only stops being tracked once it reaches its own dead
        # end: a prior INVALID BAR SL that failed to reactivate, or its own
        # SL fired with no BAR 2 ever having formed (permanent dead end,
        # see the gate above). A lineage still genuinely racing toward its
        # own SL2 is unaffected either way and keeps racing independently.
        if not reactivated_this_candle and buy.active and buy.bar_pending and self._bar_entry_shape(prev, cur):
            buy.bar_lineages = [l for l in buy.bar_lineages
                                 if l.sl is None or (not l.sl.invalidated and l.bar2 is not None)]
            buy.bar_sub_counter += 1
            sub_label = f"{label_id}.{buy.bar_sub_counter}"
            buy.bar_lineages.append(BarLineage(label=sub_label, ref_high=cur.h, ref_low=cur.l))
            buy.bar_pending = False
            buy.bar_high_pool = max(buy.bar_high_pool, cur.h)
            ev.append(f"BAR({sub_label})")

        # mechanism 2: a fresh BAR can also branch directly off the NEWEST
        # lineage's own SL range, independent of RED1/RED2, as long as
        # it's still pre-SL2
        newest = buy.bar_lineages[-1] if buy.bar_lineages else None
        if buy.active and newest is not None and newest.sl is not None and not newest.sl.sl2:
            lo, hi = newest.sl.ref_low, newest.sl.ref_high
            if (cur.l >= prev.l and cur.h > prev.h and (cur.h - prev.h) >= THRESH - EPS and
                    cur.c >= prev.h and lo <= cur.l and cur.h <= hi):
                buy.bar_sub_counter += 1
                sub_label = f"{label_id}.{buy.bar_sub_counter}"
                buy.bar_lineages.append(BarLineage(label=sub_label, ref_high=cur.h, ref_low=cur.l))
                buy.bar_high_pool = max(buy.bar_high_pool, cur.h)
                ev.append(f"BAR({sub_label})")

        return ev

    # =================== REAR family ===================
    def _eval_rear_hh_ll(self, pc, buy: Buy, rear: Rear, prev: Day, cur: Day):
        ev = []
        if not rear.red1_since or rear.dormant or self._red1_invalidates_today(buy, cur):
            if cur.h > rear.ref_high and (cur.h - rear.ref_high) >= ANY:
                rear.ref_high = cur.h
                ev.append(f"REAR HH({branch_label(pc.id)})")
        else:
            diff = cur.h - rear.ref_high
            if cur.h > rear.ref_high and (diff < THRESH - EPS or cur.l < prev.l or cur.c < rear.ref_high_at_red1):
                rear.ref_high = cur.h
                ev.append(f"REAR HH({branch_label(pc.id)})")
        if cur.l < rear.ref_low:
            gap = rear.ref_low - cur.l
            if (gap >= THRESH - EPS and cur.c > rear.ref_low + EPS) or gap < THRESH - EPS:
                rear.ref_low = cur.l
                ev.append(f"REAR LL({branch_label(pc.id)})")
        return ev

    def _eval_rear_progress(self, pc, buy, rear: Rear, prev: Day, cur: Day):
        ev = []
        if (cur.l < rear.ref_low and (rear.ref_low - cur.l) >= THRESH - EPS and cur.c <= rear.ref_low + EPS):
            ev.append(f"REAR SL({branch_label(pc.id)})")
            rear.sl = RearSL(ref_low=cur.l)
            buy.bar_lineages = []
            buy.bar_sub_counter = 0
            buy.red1 = None
            buy.bar_pending = False
            return ev
        red1_preexisting = buy.red1 is not None and buy.red1.active
        if red1_preexisting:
            ev += self._eval_red1_generic(pc, buy, rear, prev, cur)
        elif rear.rear2 is not None and not rear.red2_ever:
            # BAR 2 variant gate: mirrors BAR 2 gating RED1 on a BAR
            # lineage -- a fresh RED1 cannot attach to REAR until REAR 2
            # has formed.
            ev += self._attach_fresh_red1(pc, buy, rear, prev, cur)
        return ev

    def _eval_rear_sl_progress(self, pc, buy, rear: Rear, sl: RearSL, prev: Day, cur: Day, pre_today_rear2_ref=None):
        # BAR 2 variant: only ever called once rear.rear2 exists (gated in
        # _eval_buy's routing) -- REAR's own SL -> REAR RE-ENTER transition
        # is only reachable once REAR 2 has formed, mirroring BAR SL2
        # requiring BAR 2. REAR RE-ENTER's formation threshold is REAR 2's
        # reference AS OF THE START OF TODAY (rear2 is frozen while
        # rear.sl is not None -- see _eval_rear2 -- so this is a static
        # value, not a live-climbing one; same freeze relationship as
        # BAR 2 has to BAR).
        ev = []
        label_id = branch_label(pc.id)
        ref = pre_today_rear2_ref if pre_today_rear2_ref is not None else rear.rear2.ref_high
        is_reenter = (cur.l >= prev.l and cur.h > ref and
                      (cur.h - ref) >= THRESH - EPS and cur.c >= ref)
        if is_reenter and not self._milestone_blocked(pc):
            buy.rear_reenter = RearReenter(ref_high=cur.h, ref_low=cur.l)
            ev.append(f"REAR RE-ENTER({label_id})")
            rear.dormant = True  # this REAR is now permanently retired for this lineage
            # BAR 2 variant: REAR RE-ENTER always forms fresh now (BAR SL2
            # -> fresh REAR is the only path back up; a dormant ancestor is
            # never reactivated in place any more), so REAR's own rear2
            # reference is never read again once REAR RE-ENTER exists --
            # stop it from climbing forever (same "dormant stops ALL
            # tracking" principle already applied in _supersede_rear_for_new_bar).
            if rear.rear2 is not None:
                rear.rear2.dormant = True
            return ev
        # no INVALID REAR HH tracking needed here -- REAR 2 is frozen while
        # rear.sl is active (see _eval_rear2), so the threshold stays
        # static until REAR RE-ENTER's own condition clears it.
        return ev

    # =================== REAR RE-ENTER family ===================
    def _eval_rear_reenter_hh_ll(self, pc, buy: Buy, rre: RearReenter, prev: Day, cur: Day):
        ev = []
        if not rre.red1_since or rre.dormant or self._red1_invalidates_today(buy, cur):
            if cur.h > rre.ref_high and (cur.h - rre.ref_high) >= ANY:
                rre.ref_high = cur.h
                ev.append(f"REAR RE-ENTER HH({branch_label(pc.id)})")
        else:
            diff = cur.h - rre.ref_high
            if cur.h > rre.ref_high and (diff < THRESH - EPS or cur.l < prev.l or cur.c < rre.ref_high_at_red1):
                rre.ref_high = cur.h
                ev.append(f"REAR RE-ENTER HH({branch_label(pc.id)})")
        if cur.l < rre.ref_low:
            gap = rre.ref_low - cur.l
            if (gap >= THRESH - EPS and cur.c > rre.ref_low + EPS) or gap < THRESH - EPS:
                rre.ref_low = cur.l
                ev.append(f"REAR RE-ENTER LL({branch_label(pc.id)})")
        return ev

    def _eval_rear_reenter_progress(self, pc, buy, rre: RearReenter, prev: Day, cur: Day):
        ev = []
        if (cur.l < rre.ref_low and (rre.ref_low - cur.l) >= THRESH - EPS and cur.c <= rre.ref_low + EPS):
            ev.append(f"REAR RE-ENTER SL({branch_label(pc.id)})")
            rre.sl = RearReenterSL(ref_low=cur.l)
            buy.red1 = None
            buy.bar_pending = False
            return ev
        red1_preexisting = buy.red1 is not None and buy.red1.active
        if red1_preexisting:
            ev += self._eval_red1_generic(pc, buy, rre, prev, cur)
        elif rre.rre2 is not None and not rre.red2_ever:
            ev += self._attach_fresh_red1(pc, buy, rre, prev, cur)
        return ev

    def _eval_rear_reenter_sl_progress(self, pc, buy, rre: RearReenter, sl: RearReenterSL, prev: Day, cur: Day,
                                        pre_today_rre2_ref=None):
        # BAR 2 variant: only ever called once rre.rre2 exists (gated in
        # _eval_buy's routing). This is the genuine post-SL recovery path
        # -- reactivates rre IN PLACE, under its own identity, once REAR
        # RE-ENTER 2's own (frozen, static) reference clears.
        ev = []
        label_id = branch_label(pc.id)
        ref = pre_today_rre2_ref if pre_today_rre2_ref is not None else rre.rre2.ref_high
        is_reenter_again = (cur.l >= prev.l and cur.h > ref and
                             (cur.h - ref) >= THRESH - EPS and cur.c >= ref)
        if is_reenter_again and not self._milestone_blocked(pc):
            ev.append(f"REAR RE-ENTER({label_id})")
            rre.sl = None
            rre.ref_high = cur.h
            rre.ref_low = cur.l
            rre.red1_since = False
            rre.dormant = False
            rre.red2_ever = False
            # BAR 2 variant: unlike BAR 2 (which explicitly does NOT
            # persist through a BAR-level reactivation), REAR RE-ENTER 2
            # DOES persist through this reactivation -- it stays as-is,
            # already gating RED1 immediately without needing to re-form
            # (confirmed by the actual verified sequence: REAR RE-ENTER 2
            # formed once on 19/03, REAR RE-ENTER's own SL fired and
            # reactivated in place on 24/03, and RED1(A) attached on 26/03
            # with no fresh REAR RE-ENTER 2 reforming in between).
            return ev
        # no further path back up from here -- deepest terminal leaf
        return ev


def main(path, out_path):
    days = load_days_xlsx(path)
    engine = TZEngine()
    results = {}
    for i in range(1, len(days)):
        prev, cur = days[i - 1], days[i]
        evs = engine.process(prev, cur)
        results[cur.date] = " + ".join(evs)
        print(f"{cur.date:12}{cur.o:8.2f}{cur.h:8.2f}{cur.l:8.2f}{cur.c:8.2f}   {' + '.join(evs)}")
    return results


if __name__ == "__main__":
    import sys
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
