"""
TZ BUY -- the TZ ENGINE state machine, extended with TZ BUY 2 / BAR 2 /
REAR 2 / REAR RE-ENTER 2. (Code file still named tz_engine_wtf.py; the
theory itself is called TZ BUY -- see WTF_RULEBOOK.md for the full,
consolidated rule set from an exhaustive one-topic-at-a-time review.)

STATUS: verified against real weekly OHLC (KALYANKJIL.NS, 2021-03-28
through 2026-09-15) -- reproduces that dataset's own Event column exactly.
That run exposed a real bug (fresh BAR formation permanently blocked after
a BAR SL with no BAR 2), fixed below (see "Fresh BAR formation").

Built on top of the validated 37-event base engine (tz_engine_v9.py),
keeping REAR / REAR RE-ENTER. Layers a confirmation-gate concept -- "2" --
at every tier: TZ BUY 2, BAR 2, REAR 2, REAR RE-ENTER 2.

Every tier falls into one of two families (see WTF_RULEBOOK.md for the
full reasoning):

FAMILY 1 -- "escalating gate" (TZ BUY, TZ BUY 2, REAR, REAR 2, REAR
RE-ENTER, REAR RE-ENTER 2): own SL is NEVER a dead end; own SL is
DECISIVE (wipes everything structurally below it -- its own "2", the
whole BAR family, RED1 in flight); reactivates/self-recovers above
"whichever is higher" (`Engine._current_top_ref` -- the MAXIMUM current
reference across every tier this buy holds state for, snapshotted before
the wipe). This is a genuine max, not "defer to the deepest tier" -- a
shallower tier's own reference can climb higher than whatever forms
beneath it (only TZ BUY 2 has an HH-mute rule, and even that only
suppresses display, never the underlying value), so either side can win
depending on the actual numbers.

FAMILY 2 -- "one-shot" (BAR, BAR 2): BAR's own SL with NO BAR 2 ever
formed for that lineage is a genuine permanent dead end for that lineage
(no INVALID BAR SL, no SL2, ever). BAR 2 itself never needs to "reform" --
once frozen at its own SL it just keeps quietly climbing as INVALID BAR
HH. Regardless of dead-end status, a brand-new BAR(n+1) can always start
elsewhere the moment the current newest lineage is no longer pre-SL.

Specifics:
- TZ BUY 2 forms off TZ BUY's own reference high, only while TZ BUY is
  pre-SL. Gates RED1/RED2 on TZ BUY: RED1 cannot attach unless TZ BUY 2 is
  currently ACTIVE (its own SL closes this gate again, requiring TZ BUY 2
  to reform). Is its own leadership-contest milestone ("TZ BUY 2(" in
  MILESTONE_KEYS) -- unlike BAR 2/REAR 2/REAR RE-ENTER 2. Its own SL
  wipes the whole BAR family/REAR/REAR RE-ENTER/RED1 below it (Family 1),
  recovers under the same "TZ BUY 2(label)" text above "whichever occurred
  last", and ALSO opens spawn eligibility for a fresh sibling TZ
  GREEN(n+1) -- same as TZ BUY's own top-level SL (explicit rule addition;
  lifts the moment TZ BUY 2 recovers). Its own HH display is muted once
  some deeper tier's actual reference reaches or exceeds it -- a live
  comparison, not a mere existence check.
- TZ BUY's own SL: decisive, self-recovers IN PLACE (same object, same
  "TZ BUY" event text -- no "NEW TZ BUY" distinction), above "whichever
  occurred last". Always opens spawn eligibility.
- BAR 2 forms off its own BAR lineage's reference high (Low >= PrevLow,
  High > ref by >= 0.20, Close >= ref), only while the lineage is pre-SL.
  Gates BAR SL2 being reachable at all (no BAR 2 = SL is a permanent dead
  end). Does NOT persist through BAR-level reactivation.
- RED1/RED2 on a BAR lineage does NOT require that lineage's own BAR 2 to
  exist first (user rule reversal, ADANIENT.NS real data: an entire year
  of RED1-shaped pullbacks inside a BAR's own range were being silently
  absorbed as plain "BAR LL" resets because BAR 2 never formed) -- RED1
  attaches on the shape test alone, same as everywhere else. If RED2 then
  completes while that lineage's own BAR 2 is still None, the lineage is a
  genuine dead end (it never got confirmed) and terminates outright,
  freeing its label for reuse -- exactly like a no-BAR-2 BAR SL already
  did. If BAR 2 already existed when RED2 completes, the lineage survives
  and keeps racing in parallel, unchanged from before.
- Multi-lineage racing: an older, already-post-SL lineage that already has
  its own BAR 2 and hasn't shown INVALID BAR SL yet is NEVER terminated
  just because a fresh independent BAR(n+1) forms elsewhere -- it keeps
  racing toward its own SL2 in parallel (a single candle can trigger one
  lineage's SL2 while another's own SL is still open -- this is exactly
  why INVALID BAR SL matters as a distinct state). Only the NEWEST lineage
  participates in RED1/RED2 (single shared buy.red1 object). An older
  sibling still merely racing (not yet SL2'd) terminates the moment the
  NEWEST lineage's own BAR 2 confirms.
- Fresh BAR formation -- two independent triggers: (1) buy.bar_pending
  (fresh RED2) plus a qualifying breakout; (2) whenever the newest lineage
  is no longer pre-SL BUT HAS NOT YET REACHED ITS OWN SL2, a qualifying
  breakout ALONE forms a fresh BAR -- NO RED1/RED2 needed. (2) is the
  real-data-motivated fix: without it, a BAR SL with no BAR 2 left
  bar_pending permanently unset-able, and an engine run went silent for
  84 weeks after exactly that (KALYANKJIL.NS, 2025-02-23 onward). A
  dead-end lineage's (no BAR 2) sub-label is freed for reuse when this
  happens; one that got BAR 2 stays retired forever. EXCLUDES a lineage
  that already reached its own SL2 -- a second real-data bug
  (BBOX.NS): once SL2 fires, the only three valid next events are TZ
  BUY's own SL, REAR, or a fresh sibling TZ GREEN(n+1); a generic
  breakout must not let an unrelated BAR(n+1) jump in ahead of REAR.
- A BAR's own SL2 ALWAYS produces a fresh REAR off that BAR's own
  reference -- never a reactivation of some old dormant ancestor.
- REAR 2 / REAR RE-ENTER 2 mirror BAR 2's shape but are Family 1: their
  own SL is decisive (wipes RED1/bar_lineages below), requiring reformation
  before RED1/RED2 reattaches, and reforms above max(their own ref, BAR
  2's ref) -- whichever is higher. Their own SL stays reachable even AFTER
  their own dual-role BAR/BAR 2 cascade has formed (fixed bug: marking
  the CURRENT REAR/REAR RE-ENTER dormant the moment that cascade's first
  BAR confirmed wrongly blocked this permanently -- dormancy is now only
  ever set for a genuinely retired ancestor, e.g. after REAR's own SL
  leads to REAR RE-ENTER, never for the one whose own "2" just spawned
  the cascade).
- REAR's own SL / REAR RE-ENTER's own SL: Family 1 -- NEVER a dead end
  regardless of whether REAR 2/REAR RE-ENTER 2 ever formed; REAR's own SL
  always leads to REAR RE-ENTER, REAR RE-ENTER's own SL self-recovers
  under the same text -- both above "whichever occurred last".
- Display suppression: an underlying SL beats its own "2" tier's SL/LL the
  same day. Once a "2" produces ANY event (formation included), that same
  label's own underlying HH is suppressed that same day too.
- INVALID [X] HH tracking: once a "2" is frozen or its parent has failed,
  its reference keeps quietly climbing on any new High as "INVALID BAR
  HH" / "INVALID REAR HH" / "INVALID REAR RE-ENTER HH" -- no recovery
  event, just an inflated reference kept alive for later.
- Dormancy stops a "2" tracking entirely, not just its display, once its
  PARENT (REAR/REAR RE-ENTER) goes permanently dormant.

Spawn eligibility for TZ GREEN(n+1): opens on TZ BUY's own SL, TZ BUY 2's
own SL, REAR 2's own SL, or REAR RE-ENTER 2's own SL. Branch-level label
reuse (unconditional, any terminated branch) and leadership/dormancy/
reference-inheritance across sibling
branches needed no new code -- already generic in the base engine.
"""
from dataclasses import dataclass, field
from typing import Optional
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
    import openpyxl  # optional dependency -- only needed for .xlsx loading,
    # not for the core engine (Day/TZEngine), so it's kept out of the
    # module-level imports for lightweight callers (e.g. the Vercel API
    # wrapper in api/run.py, which only needs JSON in/out).
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
    (lineage.bar2), REAR 2 (rear.rear2), REAR RE-ENTER 2 (rre.rre2), TZ
    BUY 2 (buy.tz_buy2)."""
    ref_high: float
    ref_low: float
    sl_active: bool = False  # own SL fired; frozen except for its own recovery (no "SL2" escalation)
    dormant: bool = False  # REAR 2 / REAR RE-ENTER 2 only: True once the PARENT
    # (Rear/RearReenter) goes permanently dormant -- stops ALL tracking, not just display
    reentry_threshold: Optional[float] = None  # TZ BUY 2 only: "whichever
    # occurred last" (BAR/BAR 2/REAR/etc.), snapshotted at the moment TZ
    # BUY 2's own SL fires (before everything below it gets wiped) -- its
    # own SL/recovery cycle climbs back above THIS, not just its own frozen
    # ref_high. Unused by BAR 2/REAR 2/REAR RE-ENTER 2, which always
    # recover above their own reference directly.


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
    entry_threshold: float = 0.0  # "whichever occurred last" at the moment
    # REAR's own SL fired -- REAR RE-ENTER always forms above this (REAR's
    # own SL is never a dead end, regardless of whether REAR 2 ever formed)


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
    entry_threshold: float = 0.0  # "whichever occurred last" at the moment
    # REAR RE-ENTER's own SL fired -- it self-recovers above this, never a
    # dead end regardless of whether REAR RE-ENTER 2 ever formed


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
    ref_high: float
    ref_low: float
    active: bool = True
    red1_ever: bool = False
    ref_high_at_red1: float = 0.0
    red1: Optional[Red1] = None
    tz_buy2: Optional[Bar2] = None  # TZ BUY 2: the confirmation gate, one
    # tier above BAR 2 -- same shape, same independent SL/recovery, gates
    # RED1/RED2 attaching to TZ BUY itself. Does NOT persist through TZ
    # BUY's own reactivation (mirrors BAR 2 not persisting through BAR
    # reactivation) -- a fresh reactivation needs its own new TZ BUY 2.
    tz_buy2_hh_muted: bool = False  # TZ BUY 2's own HH keeps showing only
    # until some deeper tier's own reference (any BAR/BAR 2, or REAR/REAR 2/
    # REAR RE-ENTER/REAR RE-ENTER 2, once they exist) actually reaches or
    # exceeds it -- a comparison, not a mere existence check (TZ BUY 2 isn't
    # guaranteed lower than what forms below it, since it may have been
    # climbing long before any of that ever formed). Permanent and one-
    # directional once tripped; TZ BUY 2 itself keeps tracking internally
    # regardless, only its own HH display stops.
    bar_lineages: list = field(default_factory=list)  # ordered oldest-first; see BarLineage
    bar_sub_counter: int = 0   # for allocating "A.1", "A.2", ... sub-labels
    bar_dead_labels: set = field(default_factory=set)  # sub-numbers freed for
    # reuse -- ONLY by a generation that was a complete dead end (its own SL
    # fired with no BAR 2 ever having formed for it, so it never really
    # amounted to anything). A generation that DID get its own BAR 2 and
    # only lost out later to a newer lineage keeps its number retired
    # forever -- the counter just keeps incrementing past it.
    bar_pending: bool = False  # RED2 fired; awaiting BAR's own entry-shape confirmation
    # single persistent slot each -- a fresh REAR/REAR RE-ENTER formation
    # always wipes whichever older dormant one currently exists, regardless
    # of type (single-slot model, newest always wins)
    rear: Optional[Rear] = None
    rear_reenter: Optional[RearReenter] = None
    bar_high_pool: float = 0.0
    reentry_threshold: Optional[float] = None  # "whichever occurred last",
    # snapshotted the moment TZ BUY's own SL fires (before everything below
    # it gets wiped) -- TZ BUY reactivates above THIS, never just its own
    # frozen peak once something deeper had formed.


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


# TZ BUY 2 variant: "TZ BUY 2(" is explicitly its own milestone -- unlike
# BAR 2/REAR 2/REAR RE-ENTER 2 (none of which trigger the leadership
# contest), TZ BUY 2 forming (or reactivating -- same event text) does.
MILESTONE_KEYS = ("TZ BUY(", "TZ BUY 2(", "BAR(", "REAR(", "REAR RE-ENTER(")

SL_LL_KEYS = (
    "TZ GREEN SL(", "TZ GREEN LL(",
    "TZ BUY SL(", "TZ BUY LL(",
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

    def _bar_lineages_racing(self, buy: Buy) -> bool:
        # BAR 2 variant: a lineage whose own SL fired with no BAR 2 ever
        # having formed is a permanent dead end (rulebook: "BAR SL with no
        # BAR 2 -> straight to TZ BUY LL -> TZ BUY SL, nothing in
        # between") -- sl.sl2 can never become True for it, so without
        # this it would count as "still racing toward SL2" forever.
        return any(
            lin.sl is None or (lin.bar2 is not None and not lin.sl.sl2)
            for lin in buy.bar_lineages
        )

    def _bar_lineages_permanent_dead_end(self, buy: Buy) -> bool:
        """True only when EVERY current lineage is a genuine permanent dead
        end (its own SL fired with no BAR 2 ever having formed) -- as
        opposed to having reached BAR SL2 (deep failure, REAR pending
        confirmation), which is a deliberately DIFFERENT "not currently
        live" signal (see _buy_currently_live) used to open sibling spawn
        eligibility (tip_deep_failure) the instant SL2 fires, before REAR
        itself has necessarily confirmed. Conflating the two let a buy
        whose own BAR family had reached genuine deep failure (SL2) wrongly
        report itself as "still live" by checking straight through to its
        own TZ BUY 2/REAR 2/REAR RE-ENTER 2 state -- exactly the signal
        that mechanism exists to produce."""
        return all(lin.sl is not None and lin.bar2 is None for lin in buy.bar_lineages)

    def _buy_currently_live(self, buy: Buy) -> bool:
        if not buy.active:
            return False
        if buy.rear_reenter is not None:
            if buy.rear_reenter.sl is not None:
                return False
            if not buy.rear_reenter.dormant:
                if buy.bar_lineages:
                    if self._bar_lineages_racing(buy):
                        return True
                    if not self._bar_lineages_permanent_dead_end(buy):
                        return False
                # Real-data bug (MAXESTATES.NS, ICICIBANK.NS): once REAR
                # RE-ENTER 2's own SL fires with no fresh BAR cascade
                # racing beneath it -- and no BAR lineage of its own ever
                # reached genuine deep failure (BAR SL2) either -- NOTHING
                # in this buy is actually live any more, but this branch
                # was unconditionally returning True just because REAR
                # RE-ENTER itself hadn't failed, permanently blocking every
                # sibling's own first TZ BUY from ever forming. Symmetric
                # real-data bug (ICICIBANK.NS): a lineage that's SL'd with
                # NO BAR 2 ever formed -- a genuine permanent dead end, not
                # deep failure -- must NOT mask REAR RE-ENTER 2's own live
                # state either; a buy sitting on nothing but dead-end
                # lineages, with its own "2" tier genuinely still alive,
                # was wrongly reporting itself as fully collapsed, letting
                # an unrelated sibling's milestone terminate it outright
                # instead of exempting it. REAR RE-ENTER 2's own SL already
                # opens spawn eligibility (tip_rre2_sl) -- it must release
                # this gate too.
                return not (buy.rear_reenter.rre2 is not None and buy.rear_reenter.rre2.sl_active)
        elif buy.rear is not None:
            if buy.rear.sl is not None:
                return False
            if not buy.rear.dormant:
                if buy.bar_lineages:
                    if self._bar_lineages_racing(buy):
                        return True
                    if not self._bar_lineages_permanent_dead_end(buy):
                        return False
                # Same fix, one tier up: REAR 2's own SL (tip_rear2_sl)
                # must also release this gate once nothing is racing
                # beneath it and no lineage reached genuine deep failure.
                return not (buy.rear.rear2 is not None and buy.rear.rear2.sl_active)
        if buy.bar_lineages:
            if self._bar_lineages_racing(buy):
                return True
            if not self._bar_lineages_permanent_dead_end(buy):
                return False
        # Real-data bug (MAXESTATES.NS, ICICIBANK.NS): a plain buy whose own
        # TZ BUY 2 has SL'd, with no BAR family or REAR ever having formed
        # (or only a genuine no-BAR-2 dead end), was falling through to an
        # unconditional True -- this buy has fully collapsed (TZ BUY 2's
        # own SL already opens spawn eligibility, tip_tzbuy2_sl, exactly
        # like TZ BUY's own SL) but kept reporting itself as "currently
        # live" forever, permanently blocking every OTHER branch's own
        # red_ever from ever escalating into its first TZ BUY -- confirmed
        # real trace: branch B's RED(B) fired cleanly but TZ BUY(B) never
        # got a chance to form for months, because a long-dead branch A's
        # own TZ BUY 2 SL (with nothing else ever having formed for it) was
        # silently holding this gate shut the entire time. Symmetric real-
        # data bug (ICICIBANK.NS): a buy whose own TZ BUY 2 is STILL alive
        # (never SL'd) but whose only BAR lineage is a genuine no-BAR-2
        # dead end was wrongly reporting itself as NOT live purely because
        # nothing in bar_lineages was racing, letting an unrelated older
        # sibling's own milestone terminate it outright while TZ BUY 2
        # itself was still climbing -- confirmed real trace (ICICIBANK.NS
        # branch D, 2014): TZ BUY 2(D) sat un-SL'd at 289.67 while D's one
        # BAR lineage (a no-BAR-2 dead end) masked that fact, letting
        # REAR RE-ENTER(C) wrongly terminate D outright.
        return not (buy.tz_buy2 is not None and buy.tz_buy2.sl_active)

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

    def _current_top_ref(self, buy: Buy) -> float:
        """"Whichever is higher": the MAXIMUM current reference across
        every tier this buy currently holds state for. Used whenever a
        tier's own SL wipes everything below it and needs a reactivation
        threshold that isn't just its own frozen peak (TZ BUY's own SL, TZ
        BUY 2's own SL, REAR's own SL -> REAR RE-ENTER, REAR 2's own SL,
        REAR RE-ENTER's own self-recovery, REAR RE-ENTER 2's own SL).

        NOT simply "defer to the deepest/most-recent tier" -- a shallower
        tier's own reference can keep climbing independently of whatever
        forms beneath it (only TZ BUY 2 has an explicit HH-mute rule, and
        even that only suppresses DISPLAY, never the underlying value
        tracking), so it can end up numerically HIGHER than a deeper
        tier's reference despite being structurally earlier. Explicit user
        correction, worked example: REAR 2 forming after its own SL fires
        (with a BAR/BAR 2 cascade racing underneath it) must reform above
        "REAR 2's own ref high OR BAR 2's ref high, whichever is higher" --
        not unconditionally BAR 2's ref, the way an earlier draft of this
        method assumed."""
        refs = [buy.ref_high]
        if buy.tz_buy2 is not None:
            refs.append(buy.tz_buy2.ref_high)
        for lin in buy.bar_lineages:
            refs.append(lin.ref_high)
            if lin.bar2 is not None:
                refs.append(lin.bar2.ref_high)
        if buy.rear is not None:
            refs.append(buy.rear.ref_high)
            if buy.rear.rear2 is not None:
                refs.append(buy.rear.rear2.ref_high)
        if buy.rear_reenter is not None:
            refs.append(buy.rear_reenter.ref_high)
            if buy.rear_reenter.rre2 is not None:
                refs.append(buy.rear_reenter.rre2.ref_high)
        return max(refs)

    def _next_bar_label(self, buy: Buy, label_id: str) -> str:
        """Reuses the lowest freed dead-end number if one is available,
        else allocates the next never-used number."""
        if buy.bar_dead_labels:
            n = min(buy.bar_dead_labels)
            buy.bar_dead_labels.discard(n)
        else:
            buy.bar_sub_counter += 1
            n = buy.bar_sub_counter
        return f"{label_id}.{n}"

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
            buy_was_none = pc.buy is None
            all_events = self._eval_parent(pc, prev, cur, any_live_buy)
            per_branch_events[pid] = all_events

            if any(e.startswith("TZ GREEN SL(") for e in all_events):
                green_sl_pids.append(pc.seq)

            for e in all_events:
                if is_milestone(e):
                    # TZ BUY 2 variant: "TZ BUY(" reactivating in place uses
                    # the SAME event text as first formation (no more "NEW
                    # TZ BUY" distinction) -- but for the purposes of THIS
                    # termination-vs-exemption check, a reactivation must be
                    # treated as a *continuation* milestone, not a fresh
                    # one, or it would unconditionally terminate a newer
                    # sibling's currently-live, ongoing buy outright instead
                    # of merely dormanting it. Real-data bug (BBOX.NS): a
                    # long-dormant branch's own TZ BUY reactivating (its
                    # frozen threshold finally cleared) was wiping out a
                    # newer sibling's fully active TZ BUY/TZ BUY 2 cycle in
                    # progress, rather than staying hidden behind it until
                    # that sibling's own cycle actually failed -- explicit
                    # user correction. `buy_was_none` (captured BEFORE this
                    # candle's own _eval_parent/_eval_buy call) distinguishes
                    # a genuine first-ever formation (buy didn't exist a
                    # moment ago) from an in-place reactivation (buy object
                    # already existed, just inactive) -- only the former is
                    # "fresh" enough to unconditionally terminate. "TZ BUY
                    # 2(" never matches this prefix at all (space before the
                    # digit), so it was already exempt regardless.
                    is_fresh_buy = e.startswith("TZ BUY(") and buy_was_none
                    milestone_achievers.append((pc, is_fresh_buy))

        active_branches = [pc for pc in self.branches.values() if pc.active]
        tip = max(active_branches, key=lambda pc: pc.seq) if active_branches else None
        tip_deep_failure = (tip is not None and tip.buy is not None and
                             self._deep_failure_reached(tip.buy) and
                             not self._buy_currently_live(tip.buy))
        # TZ BUY 2 variant: TZ BUY 2's own SL ALSO opens spawn eligibility
        # now, same as TZ BUY's own SL -- explicit user addition ("SPAWN
        # ELIGIBILITY for new TZ GREEN to start even after TZ BUY 2 SL,
        # just like it can start after TZ BUY SL"). Lifts the moment TZ
        # BUY 2 recovers (sl_active back to False), same live-check style
        # as `not tip.buy.active` above, not a historical flag.
        tip_tzbuy2_sl = (tip is not None and tip.buy is not None and
                          tip.buy.tz_buy2 is not None and tip.buy.tz_buy2.sl_active)
        # TZ BUY 2 variant: REAR 2's own SL and REAR RE-ENTER 2's own SL
        # ALSO open spawn eligibility, same principle one/two tiers down
        # ("Just like New TZ GREEN cycle can start after TZ BUY 2 SL,
        # similarly TZ GREEN cycle can start after REAR 2 SL/REAR RE ENTER
        # 2 SL as well" -- explicit user addition). Live checks, same style
        # as tip_tzbuy2_sl -- lift the moment the "2" recovers.
        tip_rear2_sl = (tip is not None and tip.buy is not None and tip.buy.rear is not None and
                         tip.buy.rear.rear2 is not None and tip.buy.rear.rear2.sl_active)
        tip_rre2_sl = (tip is not None and tip.buy is not None and tip.buy.rear_reenter is not None and
                       tip.buy.rear_reenter.rre2 is not None and tip.buy.rear_reenter.rre2.sl_active)
        eligible_anchor = (
            tip is not None and not tip.dormant and tip.red_ever and
            (tip.buy is None or not tip.buy.active or tip_deep_failure or
             tip_tzbuy2_sl or tip_rear2_sl or tip_rre2_sl)
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
            leader_top_ref = self._current_top_ref(leader.buy) if leader.buy is not None else leader.ref_high
            for pc in active_pcs:
                if pc is not leader and pc.dormant and leader.ref_high > pc.ref_high:
                    pc.ref_high = leader.ref_high
                # TZ BUY 2 variant: a dormant sibling's OWN frozen top-level
                # reactivation threshold (buy.reentry_threshold, set once
                # when ITS OWN TZ BUY SL fired) must keep getting pulled up
                # to at least match the sole leader's own current top
                # reference, for as long as it stays dormant -- otherwise a
                # comparatively small bounce could clear this sibling's OLD,
                # much lower frozen threshold and reactivate/surface it (a
                # milestone event) even while the leader is still very much
                # alive and racing far above that level. Explicit user
                # correction, worked example: "TZ BUY A SL... TZ GREEN B -
                # TZ BUY 2 B occurs before TZ BUY A [reactivates]. Later
                # earlier threshold of A breaks[,] than it should not shift
                # to TZ BUY A. The HH should get[] revised for future. So in
                # case TZ BUY B SL triggers, technically TZ BUY A & TZ BUY B
                # reactivation price will be the same." Only ever raises the
                # threshold (never lowers it) and only while this sibling's
                # own buy is genuinely inactive (sitting on that frozen
                # value) -- a still-active dormant buy already tracks every
                # candle's real price action on its own (see BAR
                # 2/REAR-family "quietly climbing" INVALID HH tracking),
                # needing no separate propagation here.
                if (pc is not leader and pc.dormant and pc.buy is not None and
                        not pc.buy.active and pc.buy.reentry_threshold is not None and
                        leader_top_ref > pc.buy.reentry_threshold):
                    pc.buy.reentry_threshold = leader_top_ref

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
            if cur.h > pc.ref_high and (diff < THRESH - EPS or cur.l < prev.l or cur.c < pc.ref_high):
                pc.ref_high = cur.h
                hh = True
        if cur.l < pc.ref_low:
            gap = pc.ref_low - cur.l
            if (gap >= THRESH - EPS and cur.c > pc.ref_low + EPS) or gap < THRESH - EPS:
                pc.ref_low = cur.l
                ll = True

        if pc.buy is not None and pc.buy.ref_high > pc.ref_high:
            pc.ref_high = pc.buy.ref_high

        # TZ BUY 2 variant: both TZ GREEN's own HH and LL are only shown
        # while no buy is currently live for this branch (base engine only
        # suppressed HH this way; LL was always shown -- explicit user
        # correction extends the suppression to LL too).
        if hh and not has_live_buy and not is_sl:
            ev.append(f"TZ GREEN HH({branch_label(pc.id)})")
        if ll and not has_live_buy:
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

        # TZ BUY 2 variant: this only ever handles the very FIRST TZ BUY this
        # branch ever forms. Once pc.buy exists, every subsequent
        # reactivation (after TZ BUY's own SL) happens IN PLACE inside
        # _eval_buy -- there is no "create a brand-new Buy object" path and
        # no "NEW TZ BUY" label; reactivation always reuses the SAME object
        # and the SAME "TZ BUY" event text (explicit user correction).
        if pc.red_ever and pc.buy is None and not any_live_buy:
            ref_high = max(pc.ref_high, pc.ref_high_at_red)
            if cur.l >= prev.l and cur.h > ref_high and (cur.h - ref_high) >= THRESH - EPS and cur.c >= ref_high:
                pc.buy = Buy(ref_high=cur.h, ref_low=cur.l)
                ev.append(f"TZ BUY({branch_label(pc.id)})")

        if pc.buy is not None:
            ev += self._eval_buy(pc, pc.buy, prev, cur)

        return ev

    # -----------------------------------------------------------------
    def _eval_buy(self, pc, buy: Buy, prev: Day, cur: Day):
        ev = []
        label = "TZ BUY"
        sl_label = "TZ BUY SL"

        has_deeper_active = (bool(buy.bar_lineages) or buy.bar_pending or
                              buy.rear is not None or buy.rear_reenter is not None)
        no_bar_yet = not has_deeper_active
        red1_preexisting_at_buy_level = buy.active and no_bar_yet and buy.red1 is not None and buy.red1.active
        # TZ BUY 2 variant: snapshots BEFORE today's own tracking below (or
        # _eval_tzbuy2's own forever-climbing branch, called later this same
        # candle) can mutate them -- same ordering-bug class as every other
        # "2" tier's pre-today snapshot in this file.
        pre_today_buy_ref = buy.ref_high

        reactivated_today = False
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
                        if cur.h > buy.ref_high and (diff < THRESH - EPS or cur.l < prev.l or cur.c < buy.ref_high):
                            buy.ref_high = cur.h
                            hh = True
            if cur.l < buy.ref_low:
                gap = buy.ref_low - cur.l
                if (gap >= THRESH - EPS and cur.c > buy.ref_low + EPS) or gap < THRESH - EPS:
                    buy.ref_low = cur.l
                    ll = True

            # TZ BUY 2 variant: TZ BUY's own HH permanently suppressed from
            # display once TZ BUY 2 exists -- mirrors BAR HH's suppression
            # once BAR 2 exists. Value keeps updating internally above
            # regardless (needed so TZ BUY 2's own HH tracking, and a later
            # reactivation with no TZ BUY 2 having ever formed, both read a
            # live reference). LL is never suppressed, same as every tier.
            if hh and buy.tz_buy2 is None:
                ev.append(f"{label} HH({branch_label(pc.id)})")
            if ll:
                ev.append(f"{label} LL({branch_label(pc.id)})")

            if is_sl:
                ev.append(f"{sl_label}({branch_label(pc.id)})")
                # TZ BUY 2 variant: TZ BUY's own SL is DECISIVE -- it wipes
                # out everything below it (TZ BUY 2, the whole BAR family,
                # REAR/REAR RE-ENTER, if any of that had formed), regardless
                # of any RED1/RED2 already in flight down there (explicit
                # user correction -- this is NOT the base engine's "TZ BUY
                # SL doesn't stop the BAR/REAR family" rule; that no longer
                # applies here). Snapshot "whichever occurred last" BEFORE
                # wiping -- that's what TZ BUY reactivates above, never just
                # its own frozen peak once something deeper had formed.
                buy.reentry_threshold = self._current_top_ref(buy)
                buy.active = False
                buy.bar_pending = False
                buy.red1 = None
                buy.bar_lineages = []
                buy.bar_sub_counter = 0
                buy.bar_dead_labels = set()
                buy.rear = None
                buy.rear_reenter = None
                buy.tz_buy2 = None
                buy.tz_buy2_hh_muted = False
        else:
            # TZ BUY 2 variant: TZ BUY's own SL has no escalation (no "TZ
            # BUY SL2") and never leads to REAR by itself (REAR stays
            # reachable exclusively via BAR SL2) -- it just reactivates
            # directly, always under the SAME "TZ BUY" label (no "NEW TZ
            # BUY" distinction -- explicit user correction), retrying above
            # "whichever occurred last" as it stood at the moment the SL
            # fired (buy.reentry_threshold) -- TZ BUY 2's own reference if
            # it existed, or deeper still (BAR/BAR 2/REAR/etc.) if the
            # branch had gotten that far before TZ BUY's own SL wiped it;
            # TZ BUY's own frozen reference otherwise (the plain dead-end
            # case -- nothing below it ever formed).
            # Real-data bug (BBOX.NS): a long-dead branch's own reentry
            # threshold gets pulled up every week to match the sole live
            # leader's climbing top ref (see the propagation block in
            # process()), which means it clears "cur.h > ref" the INSTANT
            # the leader makes any new high at all -- reactivating this
            # branch's buy in place (active=True, ref_low reset to
            # whatever THIS week's low happens to be) while it's still
            # supposed to stay fully hidden behind that live leader. That
            # stray, arbitrary ref_low then lets this hidden branch's own
            # SL condition fire later completely disconnected from
            # anything happening in the actually-live cycle (confirmed
            # bug: "TZ BUY SL(A)" surfacing out of nowhere while sibling
            # C's cycle was still fully alive). Blocked here exactly like
            # a milestone event -- _milestone_blocked already answers "is
            # some higher-seq sibling currently live," using the same
            # pre-today snapshot -- so a hidden branch's own TZ BUY stays
            # inert (no active flip, no ref_low reset) the whole time it's
            # hidden; only its reference HIGH keeps climbing via that same
            # propagation block, per the user's own confirmed rule. Real
            # reactivation becomes possible again only once the leader's
            # own cycle actually fails.
            ref = buy.reentry_threshold if buy.reentry_threshold is not None else pre_today_buy_ref
            if (not self._milestone_blocked(pc) and cur.l >= prev.l and cur.h > ref and
                    (cur.h - ref) >= THRESH - EPS and cur.c >= ref):
                buy.active = True
                buy.ref_high = cur.h
                buy.ref_low = cur.l
                buy.red1_ever = False
                buy.red1 = None
                # TZ BUY 2 does NOT persist through TZ BUY's own
                # reactivation -- a fresh one has to form from scratch, same
                # principle as BAR 2 not persisting through BAR reactivation.
                buy.tz_buy2 = None
                buy.tz_buy2_hh_muted = False
                buy.reentry_threshold = None
                ev.append(f"{label}({branch_label(pc.id)})")
                reactivated_today = True
            elif not self._milestone_blocked(pc) and cur.h > ref and (cur.h - ref) >= ANY:
                # Real-data bug (ICICIBANK.NS): every other frozen SL
                # reference in this file quietly keeps climbing on any new
                # high while dormant/SL'd (INVALID BAR SL HH, INVALID TZ
                # BUY 2 HH) -- this one didn't. A high that clears the
                # frozen reentry_threshold but doesn't fully confirm
                # reactivation (fails l>=prev.l or the confirming close)
                # was simply dropped, leaving the STALE pre-SL reference as
                # the reactivation bar forever. That let a LATER, lower
                # high wrongly confirm "reactivated" against a level price
                # had already cleared and moved past weeks earlier.
                buy.reentry_threshold = cur.h
                ev.append(f"INVALID TZ BUY HH({branch_label(pc.id)})")

        # TZ BUY 2 variant: forms off TZ BUY's own reference, tracks/
        # recovers independently for as long as buy.active stays True,
        # regardless of what's happening deeper (mirrors BAR 2 tracking
        # regardless of RED2/bar_pending state one tier down). Skipped on
        # the exact day TZ BUY itself just reactivated -- pre_today_buy_ref
        # is stale (frozen from before today's reactivation) and a fresh TZ
        # BUY 2 needs tomorrow's candle at the earliest, same as every other
        # freshly-reset "2" tier in this file.
        if not reactivated_today:
            ev += self._eval_tzbuy2(pc, buy, prev, cur, pre_today_buy_ref)

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
        pre_today_rre_ref = buy.rear_reenter.ref_high if buy.rear_reenter is not None else None

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
            # suppressed. BAR's own LL is NEVER suppressed, bar2 or not --
            # it's what feeds BAR's own SL reference low, so it must always
            # display (confirmed: bundling it with the HH suppression was a
            # bug -- lin.ref_low was still being tracked correctly, but the
            # "BAR LL(label)" event text itself was wrongly getting dropped
            # from the output the moment BAR 2 existed).
            if newest_lin.bar2 is None:
                ev += lin_hh_ev
            else:
                ev += [e for e in lin_hh_ev if e.startswith("BAR LL(")]

        # Real-data bug (INDNIPPON.NS): an OLDER lineage racing in parallel
        # behind the newest one (still pre-SL, not yet dead) never got its
        # own ref_low updated at all, because _eval_bar_lineage_hh -- which
        # is where BAR LL(" is computed -- was only ever called for
        # newest_lin above. Its own SL check a few lines below (in
        # _eval_bar_lineages_progress) still runs for EVERY pre-SL lineage,
        # so that SL kept firing against a stale, un-lowered ref_low long
        # after the real price had already made a quiet, weak-close lower
        # low that should have dragged it down first -- confirmed real
        # trace: BAR SL(C.2) fired at Close 591.80 against a stale ref_low
        # of 595.30, when the actual reference should already have been
        # 591.20 (set the prior week, Low 591.2, Close 631.85 -- nowhere
        # near a weak close). HH is deliberately NOT extended to older
        # lineages here -- "an older, superseded lineage's own HH stops
        # being recorded" is the documented, intentional rule one tier up;
        # only the LL side (which every pre-SL lineage's own SL threshold
        # depends on regardless of seniority) needed this fix.
        for lin in buy.bar_lineages:
            if lin is newest_lin or lin.sl is not None:
                continue
            if cur.l < lin.ref_low:
                gap = lin.ref_low - cur.l
                if (gap >= THRESH - EPS and cur.c > lin.ref_low + EPS) or gap < THRESH - EPS:
                    lin.ref_low = cur.l
                    ev.append(f"BAR LL({lin.label})")

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
            ev += self._eval_rear2(pc, buy, buy.rear, prev, cur, pre_today_rear_ref)

        # Same rule for REAR RE-ENTER.
        if buy.rear_reenter is not None:
            if buy.rear_reenter.sl is None:
                rre_ev = self._eval_rear_reenter_hh_ll(pc, buy, buy.rear_reenter, prev, cur)
                if buy.rear_reenter.dormant:
                    rre_ev = [e for e in rre_ev if "LL(" in e]
                if buy.rear_reenter.rre2 is not None:
                    rre_ev = [e for e in rre_ev if not e.startswith("REAR RE-ENTER HH(")]
                ev += rre_ev
            ev += self._eval_rre2(pc, buy, buy.rear_reenter, prev, cur, pre_today_rre_ref)

        bar_confirms_today = (buy.bar_pending and buy.active and not buy.bar_lineages and
                               (buy.rear is not None or buy.rear_reenter is not None) and
                               self._bar_entry_shape(prev, cur))
        if buy.rear_reenter is not None and buy.rear_reenter.sl is not None:
            # TZ BUY 2 variant: REAR RE-ENTER's own SL is NEVER a dead end
            # (unlike BAR) -- it always self-recovers above "whichever
            # occurred last" as snapshotted when the SL fired (sl.
            # entry_threshold), regardless of whether REAR RE-ENTER 2 ever
            # formed (explicit user correction).
            ev += self._eval_rear_reenter_sl_progress(pc, buy, buy.rear_reenter, buy.rear_reenter.sl, prev, cur)
        elif buy.rear_reenter is None and buy.rear is not None and buy.rear.sl is not None:
            # TZ BUY 2 variant: REAR's own SL is NEVER a dead end either --
            # always leads to REAR RE-ENTER above "whichever occurred last"
            # (sl.entry_threshold), regardless of whether REAR 2 ever
            # formed (explicit user correction -- this follows TZ BUY's
            # own "never a dead end" pattern, not BAR's).
            ev += self._eval_rear_sl_progress(pc, buy, buy.rear, buy.rear.sl, prev, cur)
        elif bar_confirms_today:
            ev = [e for e in ev if not (e.startswith("REAR HH(") or e.startswith("REAR RE-ENTER HH("))]
            ev += self._check_bar_pending(pc, buy, prev, cur, supersede_rear=False)
        elif buy.bar_lineages:
            # Real-data bug (NSEI): once a fresh BAR(1) cascade forms under
            # REAR 2's own dual role, this branch MUST take priority over
            # REAR/REAR RE-ENTER's own RED1 attachment below -- per the
            # confirmed design ("only the NEWEST lineage ever participates
            # in RED1/RED2"), the BAR lineage is now the tier RED1/RED2/its
            # own SL/SL2 belong to, not REAR. Checking `buy.rear.dormant`
            # first (the previous ordering) was wrong: REAR never goes
            # dormant on its own just because a BAR cascade formed under
            # it, so that ordering let REAR's own (already-consumed)
            # red2_ever permanently block a fresh RED1 from ever attaching
            # to this lineage again -- confirmed real trace: a lineage sat
            # frozen for months with no RED1/RED2/BAR SL/BAR SL2 ever
            # checked again, because REAR (still non-dormant, its own
            # RED1/RED2 already used up) kept winning this elif every
            # single candle. REAR/REAR RE-ENTER's own HH/LL/SL tracking is
            # unaffected -- that already runs unconditionally above,
            # regardless of this dispatch.
            ev += self._eval_bar_lineages_progress(pc, buy, prev, cur, pre_today_bar2_ref)
        elif buy.rear_reenter is not None and not buy.rear_reenter.dormant:
            ev += self._eval_rear_reenter_progress(pc, buy, buy.rear_reenter, prev, cur)
        elif buy.rear_reenter is None and buy.rear is not None and not buy.rear.dormant:
            ev += self._eval_rear_progress(pc, buy, buy.rear, prev, cur)
        elif buy.bar_pending and buy.active:
            ev += self._check_bar_pending(pc, buy, prev, cur)
        elif not buy.active:
            pass
        elif buy.red1 is None or not buy.red1.active:
            # Real-data bug (ADANIENT, crash): re-checks buy.red1 FRESH here
            # instead of trusting red1_preexisting_at_buy_level, which was
            # snapshotted at the very top of this method, BEFORE
            # _eval_tzbuy2 (called later this same candle) can wipe
            # buy.red1 to None via TZ BUY 2's own decisive SL. Trusting the
            # stale snapshot let a candle where TZ BUY 2's SL fires and
            # buy.red1 is wiped in the same breath still fall into the
            # `else` below with buy.red1 now None, crashing
            # _eval_red1_generic (same ordering-bug class as every other
            # "pre-today" snapshot in this file, just one that was never
            # actually reactive to a same-candle wipe until this dataset
            # hit it).
            #
            # TZ BUY 2 gate: mirrors BAR 2 gating RED1 on a BAR lineage --
            # a fresh RED1 cannot attach to TZ BUY unless TZ BUY 2 is
            # currently ACTIVE, not merely "has existed once" (explicit user
            # rule: "RED 1 CANNOT BE FORMED UNLESS THERE IS AN ACTIVE TZ BUY
            # 2... NEW RED 1 WILL FORM EVERY TIME THERE IS A NEW TZ BUY 2 IN
            # CASE OF ANY TZ BUY 2 SL") -- TZ BUY 2's own SL wipes this gate
            # shut too, mirroring REAR 2/REAR RE-ENTER 2's own SL gates.
            if buy.tz_buy2 is not None and not buy.tz_buy2.sl_active and (
                    cur.h <= prev.h and cur.l < prev.l and (prev.l - cur.l) >= THRESH - EPS and cur.c <= prev.l):
                if not buy.red1_ever:
                    buy.ref_high_at_red1 = buy.ref_high
                buy.red1_ever = True
                buy.red1 = Red1(ref_high=cur.h, ref_low=cur.l)
                ev.append(f"RED1({branch_label(pc.id)})")
        else:
            ev += self._eval_red1_generic(pc, buy, buy, prev, cur)

        # REAR's (and REAR RE-ENTER's) own SL must still be checked and
        # take effect even while dormant -- same decisive treatment as the
        # main path (wipes everything below, snapshots "whichever occurred
        # last" first).
        if buy.rear_reenter is not None and buy.rear_reenter.dormant and buy.rear_reenter.sl is None:
            rre = buy.rear_reenter
            if (cur.l < rre.ref_low and (rre.ref_low - cur.l) >= THRESH - EPS and cur.c <= rre.ref_low + EPS):
                ev.append(f"REAR RE-ENTER SL({branch_label(pc.id)})")
                rre.sl = RearReenterSL(ref_low=cur.l, entry_threshold=self._current_top_ref(buy))
                rre.rre2 = None
                buy.red1 = None
                buy.bar_lineages = []
                buy.bar_sub_counter = 0
                buy.bar_dead_labels = set()
                buy.bar_pending = False
        elif buy.rear is not None and buy.rear.dormant and buy.rear.sl is None:
            rear = buy.rear
            if (cur.l < rear.ref_low and (rear.ref_low - cur.l) >= THRESH - EPS and cur.c <= rear.ref_low + EPS):
                ev.append(f"REAR SL({branch_label(pc.id)})")
                rear.sl = RearSL(ref_low=cur.l, entry_threshold=self._current_top_ref(buy))
                rear.rear2 = None
                buy.bar_lineages = []
                buy.bar_sub_counter = 0
                buy.bar_dead_labels = set()
                buy.red1 = None
                buy.bar_pending = False

        # TZ BUY 2 variant: TZ BUY 2's own HH keeps showing only until some
        # deeper tier's own reference (any BAR/BAR 2, or REAR/REAR 2/REAR
        # RE-ENTER/REAR RE-ENTER 2, once they exist) actually reaches or
        # exceeds it -- unlike BAR's HH being suppressed by BAR 2's mere
        # existence (guaranteed ordered by construction: BAR 2 always starts
        # above BAR's own reference), TZ BUY 2 isn't guaranteed lower than
        # BAR 2/REAR/REAR 2 since it may have been climbing long before any
        # of those ever formed, so this needs an explicit reference
        # comparison, not a mere existence check. Checked here, using the
        # CURRENT (post-today) values, so the cutover is retroactive
        # same-day. Permanent once tripped.
        if buy.tz_buy2 is not None and not buy.tz_buy2_hh_muted:
            deeper_refs = [lin.ref_high for lin in buy.bar_lineages]
            deeper_refs += [lin.bar2.ref_high for lin in buy.bar_lineages if lin.bar2 is not None]
            if buy.rear is not None:
                deeper_refs.append(buy.rear.ref_high)
                if buy.rear.rear2 is not None:
                    deeper_refs.append(buy.rear.rear2.ref_high)
            if buy.rear_reenter is not None:
                deeper_refs.append(buy.rear_reenter.ref_high)
                if buy.rear_reenter.rre2 is not None:
                    deeper_refs.append(buy.rear_reenter.rre2.ref_high)
            if deeper_refs and max(deeper_refs) >= buy.tz_buy2.ref_high:
                buy.tz_buy2_hh_muted = True
        if buy.tz_buy2_hh_muted:
            ev = [e for e in ev if not e.startswith("TZ BUY 2 HH(")]

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
            if (e.startswith("BAR SL(") or e.startswith("REAR SL(") or e.startswith("REAR RE-ENTER SL(") or
                    e.startswith("TZ BUY SL(")):
                sl_labels.add(e[e.index("(") + 1:-1])
        if sl_labels:
            ev = [e for e in ev if not (
                (e.startswith("BAR HH(") or e.startswith("BAR 2 SL(") or e.startswith("BAR 2 LL(") or
                 e.startswith("REAR 2 SL(") or e.startswith("REAR 2 LL(") or
                 e.startswith("REAR RE-ENTER 2 SL(") or e.startswith("REAR RE-ENTER 2 LL(") or
                 e.startswith("TZ BUY 2 SL(") or e.startswith("TZ BUY 2 LL("))
                and e[e.index("(") + 1:-1] in sl_labels
            )]

        # (2) Once a "2" produces ANY event (formation included) on a given
        # label, that SAME label's own underlying HH is suppressed THAT
        # SAME DAY too, not just from the following day -- confirmed:
        # "once BAR 2 HH occurs, no need to record BAR HH as well," and
        # this applies on the "2"'s own formation day exactly as much as
        # any later day (26/04, 07/06, 21/06 confirmed: "BAR HH(label) +
        # BAR 2(label)" together on BAR 2's own formation day is wrong).
        two_labels = {
            "BAR HH(": set(), "REAR HH(": set(), "REAR RE-ENTER HH(": set(), "TZ BUY HH(": set(),
        }
        for e in ev:
            for prefix, underlying in (
                ("BAR 2(", "BAR HH("), ("BAR 2 ", "BAR HH("),
                ("REAR RE-ENTER 2(", "REAR RE-ENTER HH("), ("REAR RE-ENTER 2 ", "REAR RE-ENTER HH("),
                ("REAR 2(", "REAR HH("), ("REAR 2 ", "REAR HH("),
                ("TZ BUY 2(", "TZ BUY HH("), ("TZ BUY 2 ", "TZ BUY HH("),
            ):
                if e.startswith(prefix):
                    branch_lbl = e[e.index("(") + 1:-1]
                    two_labels[underlying].add(branch_lbl)
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
                if isinstance(stage_obj, BarLineage) and stage_obj.bar2 is None:
                    # User rule: RED1/RED2 completing against a BAR
                    # generation that never got its own confirming BAR 2 is
                    # a failure pattern, exactly like a no-BAR-2 BAR SL --
                    # this generation never "really amounted to anything",
                    # so it terminates outright and frees its label for
                    # reuse, same as the no-BAR-2 dead-end mechanism below.
                    if stage_obj in buy.bar_lineages:
                        buy.bar_lineages.remove(stage_obj)
                        n = int(stage_obj.label.rsplit(".", 1)[-1])
                        buy.bar_dead_labels.add(n)
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
    def _check_bar_pending(self, pc, buy, prev: Day, cur: Day, supersede_rear: bool = True):
        # A dormant branch has already been superseded by a newer sibling
        # and must not independently spawn a brand-new BAR lineage -- doing
        # so lets it silently accumulate real state (which can even attempt
        # to collaterally-terminate the very sibling that superseded it,
        # per the milestone-achiever rule above, before being exempted and
        # rendered invisible) that later resurfaces as a phantom BAR SL/
        # BAR SL2 under the dormant branch's own letter (real-data bug,
        # INDNIPPON.NS: a dormant branch B silently formed BAR(B.1)/(B.2)/
        # (B.3) on the exact same candles as the active branch C's own
        # BAR(C.1)/(C.2)/(C.3) -- since _bar_entry_shape checks only the
        # candle's own shape, not any branch-specific reference, ANY branch
        # with bar_pending=True fires on the same breakout candle. B's own
        # SL/SL2 later fired right alongside C's, under B's own letter,
        # even though "B lineage was dormant" and should never have formed
        # a fresh BAR at all -- explicit user correction). Existing,
        # already-formed lineages' own HH/LL/SL/SL2 tracking is untouched.
        if pc.dormant:
            return []
        if (cur.l >= prev.l and cur.h > prev.h and
                (cur.h - prev.h) >= THRESH - EPS and cur.c >= prev.h):
            sub_label = self._next_bar_label(buy, branch_label(pc.id))
            buy.bar_lineages.append(BarLineage(label=sub_label, ref_high=cur.h, ref_low=cur.l))
            buy.bar_pending = False
            buy.bar_high_pool = max(buy.bar_high_pool, cur.h)
            # TZ BUY 2 variant: only supersede (mark dormant) a genuinely
            # OLD, leftover REAR/REAR RE-ENTER ancestor -- NEVER the current
            # REAR/REAR RE-ENTER whose own "2" just spawned THIS bar as its
            # own dual-role cascade (supersede_rear=False from that call
            # site). Marking the CURRENT one dormant was a real bug: once
            # dormant, _eval_rear2/_eval_rre2 return immediately and its own
            # SL could never be checked again, even though the user
            # confirmed it must stay reachable (worked example: BAR 2 SL +
            # REAR 2 SL can fire together after this exact cascade).
            if supersede_rear:
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
            if cur.h > lin.ref_high and (diff < THRESH - EPS or cur.l < prev.l or cur.c < lin.ref_high):
                lin.ref_high = cur.h
                buy.bar_high_pool = max(buy.bar_high_pool, lin.ref_high)
                ev.append(f"BAR HH({lin.label})")
        if lin.sl is None and cur.l < lin.ref_low:
            gap = lin.ref_low - cur.l
            if (gap >= THRESH - EPS and cur.c > lin.ref_low + EPS) or gap < THRESH - EPS:
                lin.ref_low = cur.l
                ev.append(f"BAR LL({lin.label})")
        return ev

    # ------------------- TZ BUY 2 / BAR 2 / REAR 2 / REAR RE-ENTER 2 --------
    def _eval_tzbuy2(self, pc, buy: Buy, prev: Day, cur: Day, pre_today_buy_ref=None):
        """Mirrors _eval_bar2 one tier up: forms off TZ BUY's own reference
        high, only while TZ BUY itself is pre-SL. Gates RED1/RED2 on TZ BUY.
        Has its own independent SL/recovery cycle -- no escalation. UNLIKE
        BAR 2 (which gates whether BAR SL can lead anywhere at all), TZ
        BUY's own top-level SL is never a dead end regardless of TZ BUY 2 --
        see TZ BUY's own reactivation check in _eval_buy, which reads TZ
        BUY 2's reference when it exists instead of just TZ BUY's own peak."""
        ev = []
        if buy.tz_buy2 is None:
            if buy.active:
                ref = pre_today_buy_ref if pre_today_buy_ref is not None else buy.ref_high
                if (cur.l >= prev.l and cur.h > ref and (cur.h - ref) >= THRESH - EPS and cur.c >= ref):
                    buy.tz_buy2 = Bar2(ref_high=cur.h, ref_low=cur.l)
                    ev.append(f"TZ BUY 2({branch_label(pc.id)})")
            return ev
        if not buy.active:
            if cur.h > buy.tz_buy2.ref_high and (cur.h - buy.tz_buy2.ref_high) >= ANY:
                buy.tz_buy2.ref_high = cur.h
                ev.append(f"INVALID TZ BUY 2 HH({branch_label(pc.id)})")
            return ev
        b2 = buy.tz_buy2
        if b2.sl_active:
            # TZ BUY 2 variant: recovers above "whichever occurred last" as
            # it stood at the moment THIS SL fired (b2.reentry_threshold),
            # not just its own frozen ref_high -- everything below it (BAR/
            # BAR 2/REAR/etc.) was already wiped when the SL fired, so this
            # is the only place that reference is still remembered.
            ref = b2.reentry_threshold if b2.reentry_threshold is not None else b2.ref_high
            if (cur.l >= prev.l and cur.h > ref and (cur.h - ref) >= THRESH - EPS and cur.c >= ref):
                b2.ref_high = cur.h
                b2.ref_low = cur.l
                b2.sl_active = False
                b2.reentry_threshold = None
                # Real-data bug (ADANIENT DTF): tz_buy2_hh_muted lives on
                # buy, not on this Bar2 object, so an in-place SL recovery
                # (unlike TZ BUY's own reactivation, which wipes tz_buy2
                # entirely and already resets this) was silently carrying
                # over a mute tripped by a PRIOR incarnation's own deeper
                # tier (BAR/BAR 2/REAR), even though that whole deeper tier
                # was wiped the moment this SL fired. That permanently hid
                # every "TZ BUY 2 HH(" for the fresh recovery, even while
                # it climbed hugely with nothing deeper to justify muting
                # it. This recovery is a fresh restart of TZ BUY 2's own
                # climbing life, same principle as BAR 2 not persisting
                # through BAR reactivation -- it earns its own fresh,
                # unmuted HH display until something deeper than IT
                # actually forms again.
                buy.tz_buy2_hh_muted = False
                ev.append(f"TZ BUY 2({branch_label(pc.id)})")
            elif cur.h > ref and (cur.h - ref) >= ANY:
                # Real-data bug (PAYTM.NS): a new high that doesn't (yet)
                # fully confirm recovery -- clears the old level but closes
                # back below it -- was simply ignored, leaving the STALE
                # pre-SL peak as the recovery bar forever. That let a LATER,
                # lower high wrongly confirm "recovered" against a level
                # price had already cleared and abandoned weeks earlier.
                # Matches INVALID BAR HH exactly: any new high while SL'd
                # quietly becomes the new bar TZ BUY 2 must clear, same ANY
                # threshold, no recovery event yet. Raises ref_high too (not
                # just reentry_threshold) so _current_top_ref sees this
                # climbed level live if TZ BUY's own SL fires later and
                # needs "whichever is higher" across every tier.
                b2.ref_high = cur.h
                b2.reentry_threshold = cur.h
                ev.append(f"INVALID TZ BUY 2 HH({branch_label(pc.id)})")
            return ev
        if cur.l < b2.ref_low:
            gap = b2.ref_low - cur.l
            if gap >= THRESH - EPS and cur.c <= b2.ref_low + EPS:
                # TZ BUY 2 variant: TZ BUY 2's own SL is ALSO decisive --
                # wipes out everything below it (the whole BAR family,
                # REAR/REAR RE-ENTER), same as TZ BUY's own SL does one
                # tier up. Snapshot "whichever occurred last" BEFORE wiping.
                b2.reentry_threshold = self._current_top_ref(buy)
                b2.sl_active = True
                ev.append(f"TZ BUY 2 SL({branch_label(pc.id)})")
                buy.bar_lineages = []
                buy.bar_sub_counter = 0
                buy.bar_dead_labels = set()
                buy.bar_pending = False
                buy.rear = None
                buy.rear_reenter = None
                buy.red1 = None
                return ev
            b2.ref_low = cur.l
            ev.append(f"TZ BUY 2 LL({branch_label(pc.id)})")
        if cur.h > b2.ref_high and (cur.h - b2.ref_high) >= ANY:
            b2.ref_high = cur.h
            ev.append(f"TZ BUY 2 HH({branch_label(pc.id)})")
        return ev

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
        """Mirrors _eval_bar2 one level up. rear.rear2.dormant is now ONLY
        ever set when REAR itself is permanently retired (REAR's own SL
        leading to REAR RE-ENTER -- see _eval_rear_sl_progress) -- NOT when
        REAR 2's own dual-role BAR cascade forms (that used to wrongly mark
        it dormant via _supersede_rear_for_new_bar, permanently blocking
        this method's own SL check; fixed -- see WTF_RULEBOOK.md). So by
        the time rear.rear2.dormant is True here, rear.sl is already set
        too, and this method's own SL branch below is naturally moot."""
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
            # TZ BUY 2 variant: recovers above "whichever is higher" as it
            # stood at the moment THIS SL fired (r2.reentry_threshold), not
            # just its own frozen ref_high -- mirrors TZ BUY 2's own
            # recovery exactly. In practice REAR 2's own ref rarely if ever
            # trails BAR 2's (REAR 2 tracks every candle unconditionally,
            # with a weaker threshold than BAR 2 needs to even form), but
            # the explicit snapshot keeps this tier consistent with the
            # rest of the Family-1 pattern rather than relying on that as
            # an unstated assumption.
            ref = r2.reentry_threshold if r2.reentry_threshold is not None else r2.ref_high
            if (cur.l >= prev.l and cur.h > ref and (cur.h - ref) >= THRESH - EPS
                    and cur.c >= ref):
                r2.ref_high = cur.h
                r2.ref_low = cur.l
                r2.sl_active = False
                r2.reentry_threshold = None
                ev.append(f"REAR 2({branch_label(pc.id)})")
            elif cur.h > ref and (cur.h - ref) >= ANY:
                # Same fix as TZ BUY 2's own SL/recovery (real-data bug,
                # PAYTM.NS): a new high that clears the old level but
                # closes back below it must still raise the recovery bar,
                # not be silently ignored -- otherwise a LATER, actually
                # lower high could wrongly confirm "recovered" against a
                # stale level price had already cleared and abandoned.
                r2.ref_high = cur.h
                r2.reentry_threshold = cur.h
                ev.append(f"INVALID REAR 2 HH({branch_label(pc.id)})")
            return ev
        if cur.l < r2.ref_low:
            gap = r2.ref_low - cur.l
            if gap >= THRESH - EPS and cur.c <= r2.ref_low + EPS:
                # TZ BUY 2 variant: REAR 2's own SL is decisive too, unlike
                # BAR 2 -- it wipes out whatever it had unlocked (RED1/RED2
                # in flight against REAR, any fresh BAR cascade opened
                # under REAR 2) and needs to reform (same label, above its
                # own ref) before RED1/RED2 can attach to REAR again.
                # Snapshot "whichever is higher" BEFORE wiping.
                r2.reentry_threshold = self._current_top_ref(buy)
                r2.sl_active = True
                ev.append(f"REAR 2 SL({branch_label(pc.id)})")
                buy.red1 = None
                buy.bar_lineages = []
                buy.bar_sub_counter = 0
                buy.bar_dead_labels = set()
                buy.bar_pending = False
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
            # TZ BUY 2 variant: same "whichever is higher" recovery
            # treatment as REAR 2's own SL, one level deeper.
            ref = r2.reentry_threshold if r2.reentry_threshold is not None else r2.ref_high
            if (cur.l >= prev.l and cur.h > ref and (cur.h - ref) >= THRESH - EPS
                    and cur.c >= ref):
                r2.ref_high = cur.h
                r2.ref_low = cur.l
                r2.sl_active = False
                r2.reentry_threshold = None
                ev.append(f"REAR RE-ENTER 2({branch_label(pc.id)})")
            elif cur.h > ref and (cur.h - ref) >= ANY:
                # Same fix as TZ BUY 2's own SL/recovery (real-data bug,
                # PAYTM.NS): a new high that clears the old level but
                # closes back below it must still raise the recovery bar,
                # not be silently ignored -- otherwise a LATER, actually
                # lower high could wrongly confirm "recovered" against a
                # stale level price had already cleared and abandoned.
                r2.ref_high = cur.h
                r2.reentry_threshold = cur.h
                ev.append(f"INVALID REAR RE-ENTER 2 HH({branch_label(pc.id)})")
            return ev
        if cur.l < r2.ref_low:
            gap = r2.ref_low - cur.l
            if gap >= THRESH - EPS and cur.c <= r2.ref_low + EPS:
                # TZ BUY 2 variant: same treatment as REAR 2's own SL, one
                # level deeper -- decisive, wipes what it unlocked, needs
                # to reform before RED1/RED2 can attach to REAR RE-ENTER.
                # Snapshot "whichever is higher" BEFORE wiping.
                r2.reentry_threshold = self._current_top_ref(buy)
                r2.sl_active = True
                ev.append(f"REAR RE-ENTER 2 SL({branch_label(pc.id)})")
                buy.red1 = None
                buy.bar_lineages = []
                buy.bar_sub_counter = 0
                buy.bar_dead_labels = set()
                buy.bar_pending = False
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
                    elif not lin.red2_ever:
                        # User rule reversal: RED1 no longer requires this
                        # lineage's own BAR 2 to exist first -- it attaches
                        # on the shape test alone, whether or not BAR 2 has
                        # ever formed. If RED2 then completes with bar2
                        # still None, _eval_red1_generic terminates this
                        # lineage outright (see there) rather than letting
                        # it keep racing, mirroring the no-BAR-2 SL dead end.
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
            buy.bar_dead_labels = set()
            return ev

        # A fresh, independent BAR can start on ANY qualifying breakout the
        # instant the current newest lineage is no longer pre-SL -- no
        # RED1/RED2 needed for this (explicit user rule: "a new BAR can
        # occur after BAR SL... not above earlier BAR reference high like
        # TZ BUY" -- it just needs the ordinary breakout shape against the
        # previous day, same as the very first BAR ever did). ADDED
        # alongside the original RED2/bar_pending-gated path (kept
        # unchanged below, for a still-pre-SL newest lineage whose own
        # RED2 already fired -- that's a different, already-validated
        # scenario), not a replacement for it: the RED2-gated path alone
        # made fresh BAR formation permanently impossible once the newest
        # lineage was a no-BAR-2 dead end, since nothing could ever set
        # bar_pending again for it (confirmed against real OHLC data: an
        # engine run went completely silent for 84 weeks after exactly this
        # happened). A lineage that's post-SL, already has its own BAR 2,
        # and hasn't shown INVALID BAR SL yet is NOT terminated by this --
        # it keeps racing in parallel (multi-generation racing, explicit
        # user confirmation: "RACE IN PARALLEL. CANNOT TERMINATE IT" -- a
        # single candle can trigger one lineage's own SL2 while another's
        # own SL is still open, which is exactly why INVALID BAR SL
        # matters). Only a lineage that's a genuine dead end (no BAR 2) or
        # already gave up (invalidated, dormant) gets dropped when a fresh
        # one forms -- and ONLY a dead-end (no BAR 2 ever formed) drop
        # frees its number for reuse; one that had BAR 2 stays retired.
        #
        # EXCLUDES a lineage that has ALREADY reached its own SL2
        # (`newest.sl.sl2`) -- confirmed bug, found against real data
        # (BBOX.NS): once BAR SL2 fires, that lineage is done, and the
        # ONLY three things that can happen next are TZ BUY's own SL,
        # REAR (this same lineage's own breakout above its BAR 2's
        # reference, handled separately below), or a fresh sibling TZ
        # GREEN(n+1) spawning. A fresh, unrelated BAR(n+1) must NOT be
        # able to jump in ahead of/instead of REAR just because a generic
        # breakout happened to occur first -- this mechanism exists for
        # the genuinely-dead-or-still-racing case, not the already-SL2'd
        # one, which has its own dedicated path below.
        newest = buy.bar_lineages[-1] if buy.bar_lineages else None
        newest_is_dead = newest is None or (newest.sl is not None and not newest.sl.sl2)
        fresh_bar_ready = newest_is_dead or buy.bar_pending
        if (not pc.dormant and not reactivated_this_candle and buy.active and fresh_bar_ready and
                self._bar_entry_shape(prev, cur)):
            surviving, dropped = [], []
            for l in buy.bar_lineages:
                if l.sl is None or (not l.sl.invalidated and l.bar2 is not None):
                    surviving.append(l)
                else:
                    dropped.append(l)
            for l in dropped:
                if l.sl is not None and l.bar2 is None:
                    n = int(l.label.rsplit(".", 1)[-1])
                    buy.bar_dead_labels.add(n)
            buy.bar_lineages = surviving
            sub_label = self._next_bar_label(buy, label_id)
            buy.bar_lineages.append(BarLineage(label=sub_label, ref_high=cur.h, ref_low=cur.l))
            buy.bar_pending = False
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
            if cur.h > rear.ref_high and (diff < THRESH - EPS or cur.l < prev.l or cur.c < rear.ref_high):
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
            # TZ BUY 2 variant: REAR's own SL is decisive -- wipes out
            # everything below it (REAR 2, any fresh BAR cascade opened
            # under REAR 2), regardless of any RED1/RED2 already in flight.
            # Snapshot "whichever occurred last" BEFORE wiping -- REAR RE-
            # ENTER always forms above THIS (never a dead end, unlike BAR).
            rear.sl = RearSL(ref_low=cur.l, entry_threshold=self._current_top_ref(buy))
            rear.rear2 = None
            buy.bar_lineages = []
            buy.bar_sub_counter = 0
            buy.bar_dead_labels = set()
            buy.red1 = None
            buy.bar_pending = False
            return ev
        red1_preexisting = buy.red1 is not None and buy.red1.active
        if red1_preexisting:
            ev += self._eval_red1_generic(pc, buy, rear, prev, cur)
        elif rear.rear2 is not None and not rear.rear2.sl_active and not rear.red2_ever:
            # TZ BUY 2 variant gate: a fresh RED1 cannot attach to REAR
            # unless REAR 2 is currently ACTIVE (not merely "has existed
            # once," unlike BAR 2) -- REAR 2's own SL wipes this out too,
            # requiring REAR 2 to reform before RED1/RED2 can attach again.
            ev += self._attach_fresh_red1(pc, buy, rear, prev, cur)
        return ev

    def _eval_rear_sl_progress(self, pc, buy, rear: Rear, sl: RearSL, prev: Day, cur: Day):
        # TZ BUY 2 variant: REAR's own SL always leads to REAR RE-ENTER --
        # never a dead end, regardless of whether REAR 2 ever formed
        # (explicit user correction, follows TZ BUY's pattern, not BAR's).
        # Threshold is "whichever occurred last" as snapshotted at the
        # moment this SL fired (sl.entry_threshold) -- REAR 2/bar_lineages
        # were already wiped at that point, so this is the only place that
        # reference is still remembered.
        ev = []
        label_id = branch_label(pc.id)
        ref = sl.entry_threshold
        is_reenter = (cur.l >= prev.l and cur.h > ref and
                      (cur.h - ref) >= THRESH - EPS and cur.c >= ref)
        if is_reenter and not self._milestone_blocked(pc):
            buy.rear_reenter = RearReenter(ref_high=cur.h, ref_low=cur.l)
            ev.append(f"REAR RE-ENTER({label_id})")
            rear.dormant = True  # this REAR is now permanently retired for this lineage
            return ev
        if cur.h > ref and (cur.h - ref) >= ANY:
            # Real-data bug (ICICIBANK.NS): this ratchet used to be gated
            # behind `not self._milestone_blocked(pc)` too -- but unlike the
            # REENTER-CONFIRMATION check above (which correctly stays
            # blocked, per the "hidden until newer fails" rule), the quiet
            # reference-tracking itself must NEVER stall just because a
            # newer sibling currently leads, exactly like every analogous
            # recovery elsewhere (TZ BUY's own SL-recovery, TZ BUY 2/REAR 2/
            # REAR RE-ENTER 2's own SL-recoveries -- none of which gate
            # their own ratchet on _milestone_blocked). Confirmed real
            # trace (ICICIBANK.NS branch C): this reference sat frozen near
            # its 2010 REAR SL level for over 5 years while a newer sibling
            # (D) climbed as high as 357.64, then confirmed REAR RE-ENTER
            # cheaply against that stale ~271 level the moment D finally
            # failed -- instead of needing to clear D's true peak first.
            sl.entry_threshold = cur.h
            ev.append(f"INVALID REAR SL HH({label_id})")
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
            if cur.h > rre.ref_high and (diff < THRESH - EPS or cur.l < prev.l or cur.c < rre.ref_high):
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
            # TZ BUY 2 variant: same decisive treatment as REAR's own SL,
            # one level deeper -- wipes REAR RE-ENTER 2 and any fresh BAR
            # cascade opened under it, snapshotting "whichever occurred
            # last" first (self-recovers above THIS, never a dead end).
            rre.sl = RearReenterSL(ref_low=cur.l, entry_threshold=self._current_top_ref(buy))
            rre.rre2 = None
            buy.red1 = None
            buy.bar_lineages = []
            buy.bar_sub_counter = 0
            buy.bar_dead_labels = set()
            buy.bar_pending = False
            return ev
        red1_preexisting = buy.red1 is not None and buy.red1.active
        if red1_preexisting:
            ev += self._eval_red1_generic(pc, buy, rre, prev, cur)
        elif rre.rre2 is not None and not rre.rre2.sl_active and not rre.red2_ever:
            # TZ BUY 2 variant gate: mirrors REAR 2's gate one level deeper
            # -- REAR RE-ENTER 2 must be currently ACTIVE, not merely have
            # existed once.
            ev += self._attach_fresh_red1(pc, buy, rre, prev, cur)
        return ev

    def _eval_rear_reenter_sl_progress(self, pc, buy, rre: RearReenter, sl: RearReenterSL, prev: Day, cur: Day):
        # TZ BUY 2 variant: REAR RE-ENTER's own SL always self-recovers --
        # never a dead end, regardless of whether REAR RE-ENTER 2 ever
        # formed (explicit user correction). Threshold is "whichever
        # occurred last" as snapshotted at the moment this SL fired
        # (sl.entry_threshold).
        ev = []
        label_id = branch_label(pc.id)
        ref = sl.entry_threshold
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
            # TZ BUY 2 variant: REAR RE-ENTER 2 was already wiped (rre.rre2
            # = None) the moment this SL fired -- a fresh REAR RE-ENTER 2
            # has to form from scratch before RED1/RED2 can attach again.
            return ev
        if cur.h > ref and (cur.h - ref) >= ANY:
            # Real-data bug (ICICIBANK.NS): same fix as REAR's own SL
            # ratchet (see there) -- the quiet reference-tracking must never
            # stall behind _milestone_blocked, only the confirmation check
            # above stays gated.
            sl.entry_threshold = cur.h
            ev.append(f"INVALID REAR RE-ENTER SL HH({label_id})")
        return ev


def run_series(days_in):
    """Runs a fresh TZEngine over a list of OHLC rows and returns
    [{"date": ..., "events": [...]}, ...] for every candle after the
    first (which only ever serves as the initial "prev" reference, per
    process()'s own (prev, cur) signature). Each row in `days_in` may
    already be a `Day`, or a dict/mapping with date/o/h/l/c keys (as
    JSON decodes to). Pure, dependency-free (no file I/O) -- shared by
    the CLI entrypoint below and the Vercel API wrapper in api/run.py,
    so the API doesn't need to import openpyxl."""
    days = [d if isinstance(d, Day) else
            Day(d["date"], float(d["o"]), float(d["h"]), float(d["l"]), float(d["c"]))
            for d in days_in]
    if len(days) < 2:
        raise ValueError("Need at least 2 OHLC rows (a prev + cur pair) to process any events.")
    engine = TZEngine()
    results = []
    for i in range(1, len(days)):
        prev, cur = days[i - 1], days[i]
        events = engine.process(prev, cur)
        results.append({"date": cur.date, "events": events})
    return results


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
