"""
TZ ENGINE simulator -- v3, incorporating every correction established over
the full review:

- RED1(n): Close <= Previous Day Low (same shape as RED).
- RED2(n): Close <= Reference Low of RED1(n); Low < that same ref low;
  gap >= 0.20; High <= Previous Day High.
- Branch spawning: a new TZ GREEN(n+1) can be created whenever a qualifying
  breakout candle occurs AND at least one existing active branch has had
  its RED(n) fire (or no branches exist yet at all) -- NOT gated on
  "hasn't reached TZ BUY yet". A branch that has already succeeded and
  gone deep into BAR/REAR territory remains permanently eligible to anchor
  new siblings, because RED(n) is a one-time flag that never resets.
- Leadership contest: whenever ANY branch produces one of five milestone
  events -- TZ BUY(n), NEW TZ BUY(n), a fresh BAR(n) generation (via
  RED2), REAR(n), REAR RE-ENTER(n) -- every OTHER currently active branch
  is re-judged against it: branches created EARLIER go dormant, branches
  created LATER are terminated outright. This re-fires every time any
  branch (dormant or not) produces one of these five, not just the first
  time ever.
- Dormant branches are NOT frozen: their entire internal state machine
  (RED, RED1, RED2, BAR-generation resets, everything) keeps running
  exactly as normal every candle. The only difference dormancy makes is
  visibility -- none of a dormant branch's events reach the EVENT column
  UNLESS it is one of the five milestone types, in which case it surfaces,
  the branch becomes the visible leader again, and the leadership contest
  re-applies against whoever was leading.
- TZ GREEN SL(n) cascades: terminates the branch itself AND every other
  active branch created after it (Section 0's original "all descendant
  branches n+1, n+2, ..." rule), independent of the leadership contest.
- RED1(n)/RED2(n) attach to whichever of {Buy, BAR-family, REAR, REAR
  RE-ENTER} is the currently *active* (non-dormant-within-branch) parent;
  a fresh RED1(n) is not reachable from any SL/dormant sub-state.
- A new BAR(n) generation terminates the entire prior BAR family (BAR,
  BAR HH, BAR LL, BAR SL, BAR SL2, INVALID BAR SL) but only dormants
  (never terminates) REAR(n)/REAR RE-ENTER(n) if either was the active
  parent -- and a fresh REAR(n)/REAR RE-ENTER(n) formation always
  terminates whatever older dormant REAR-family object currently exists
  (single-slot model, newest always wins).
- Renames: INVALID TZ GREEN -> TZ GREEN SL, INVALID TZ BUY -> TZ BUY SL,
  INVALID NEW TZ BUY -> NEW TZ BUY SL.

NOT validated against real data past BAR-generation formation -- this
specific dataset never drives any branch into BAR SL/SL2/REAR/REAR
RE-ENTER, so that part of the code is exercised only by internal
consistency, same caveat as before.
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
class BarSL:
    ref_high: float
    ref_low: float
    sl2: bool = False
    invalid_hh_ref: float = 0.0  # "Latest INVALID BAR HH" pool, meaningful once sl2=True
    ever_invalid: bool = False  # True once this SL object has shown its OWN INVALID
    # BAR SL at least once -- governs whether the cross-generation bar_high_pool
    # applies at SL2 (07/05: confirmed a lineage that reaches SL2 WITHOUT ever
    # showing its own INVALID BAR SL uses only its own peak, not a sibling
    # lineage's separate, never-reconfirmed peak)
    invalidated: bool = False  # INVALID BAR SL fired but didn't qualify as a fresh BAR(n) --
    # dormant: no more HH/SL-HH/SL-LL/SL2 tracking, but the frozen ref_low
    # here still stays live for one more shot at a fresh BAR SL(n) below it


@dataclass
class BarLineage:
    """One BAR lineage within a buy. Multiple can coexist (branching): a
    fresh BAR can form directly within an existing BAR SL's own High/Low
    range, without RED1/RED2, once that SL is active. Every lineage races
    independently toward its own SL2 -- whichever fires SL2 first wins
    REAR's reference and terminates every other lineage still alive."""
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


@dataclass
class RearSL:
    ref_low: float
    invalid_hh_ref: float  # "Latest INVALID REAR HH" pool while REAR is dormant


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


@dataclass
class RearReenterSL:
    ref_low: float
    invalid_hh_ref: float


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
    # above sl.invalid_hh_ref) -- same object reused, so per the per-transition audit (rulebook
    # 12a) this must be explicitly decided, same as red2_ever was for BarLineage reactivation.


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
    # Event028's LOCKED Reference High Rule for REAR pulls from the highest
    # confirmed BAR High/BAR HH/BAR SL HH/INVALID BAR High ever recorded for
    # THIS buy's entire BAR history -- across every generation/lineage
    # (A.1, A.2, A.3, ...), not just whichever lineage happens to be the one
    # that eventually reaches SL2. This tracks that running max, monotonic,
    # never decreasing, updated the instant any such high is confirmed.
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

# Decisive down-side events -- real price breaches -- that stay visible even
# for a dormant branch. Dormancy only silences ADVANCEMENT tracking (HH,
# RED/RED1/RED2, and "INVALID ... HH"-style recoveries); a genuine SL or LL
# is not advancement, it's the market actually moving, and must be recorded
# regardless of which branch currently holds leadership. Exact-prefix match
# so e.g. "BAR SL HH(" (an HH-family sub-event of the SL cycle) or
# "INVALID BAR SL(" (a recovery/climb-back event) don't qualify.
SL_LL_KEYS = (
    "TZ GREEN SL(", "TZ GREEN LL(",
    "TZ BUY SL(", "TZ BUY LL(", "NEW TZ BUY SL(", "NEW TZ BUY LL(",
    "BAR LL(", "BAR SL(", "BAR SL LL(", "BAR SL2(",
    "REAR LL(", "REAR SL(",
    "REAR RE-ENTER LL(", "REAR RE-ENTER SL(",
)


def is_milestone(ev: str) -> bool:
    # exact-prefix match so e.g. "TZ BUY HH(" or "TZ BUY SL(" don't qualify
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
        """True once this buy's chain has EVER reached BAR SL2 (any
        lineage), REAR SL, or REAR RE-ENTER SL -- the recognized trigger
        points where a brand new sibling TZ GREEN branch is allowed to
        spawn even though this buy is technically still live. Historical
        (does not un-set itself on a later reactivation) -- once spawning
        rights are earned they stay earned; the leadership contest handles
        the rest."""
        if buy.rear is not None and buy.rear.sl is not None:
            return True
        if buy.rear_reenter is not None and buy.rear_reenter.sl is not None:
            return True
        for lin in buy.bar_lineages:
            if lin.sl is not None and lin.sl.sl2:
                return True
        return False

    def _buy_currently_live(self, buy: Buy) -> bool:
        """True while this buy currently represents an open/blocking
        position for the system-wide 'only one TZ BUY/NEW TZ BUY live'
        rule. Unlike _deep_failure_reached this is NOT historical: once
        REAR SL fires, the buy stops blocking new buys elsewhere (13/05
        REAR SL(A) -> TZ BUY(B) becomes possible on 21/05); if REAR
        RE-ENTER later reactivates it, it becomes live/blocking again;
        if REAR RE-ENTER SL then fires, it stops blocking again, etc."""
        if not buy.active:
            return False
        # A REAR/REAR RE-ENTER's own SL is decisive regardless of .dormant
        # -- Event031/036's own rules govern completely once that SL
        # exists (same principle as everywhere else in this file: dormancy
        # stops mattering the moment the structure has its own SL). Only
        # when it's dormant AND still sl is None (own RED2 fired, awaiting
        # a fresh BAR, never actually failed -- just abandoned) do we skip
        # it and fall through to whatever the CURRENT BAR family is doing;
        # without that fallthrough, an old, long-superseded REAR object
        # with .sl still None would wrongly answer this question forever
        # instead of the CURRENT BAR family.
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
            # Multiple lineages can coexist (multi-generation racing): an
            # OLD lineage sitting at SL2, superseded by a newer generation
            # via RED2 before ever forming REAR, does not by itself make
            # the buy "not live" -- it's still racing (INVALID BAR HH
            # tracking toward REAR), just no longer the only thread. The
            # buy is live as long as ANY lineage -- old or new -- still has
            # something left to do: still pre-SL2, or still genuinely
            # pre-SL. Only "not live" once EVERY lineage has already
            # reached SL2 (bug fixed: previously checked "any lineage
            # reached SL2", which wrongly went "not live" the moment any
            # one generation failed, even while a newer one was still
            # actively pre-SL and racing normally).
            return any(lin.sl is None or not lin.sl.sl2 for lin in buy.bar_lineages)
        return True

    def _milestone_blocked(self, pc: ParentCycle) -> bool:
        """True if some OTHER, newer branch's buy was GENUINELY still live
        coming into today (_buy_currently_live, not raw buy.active) -- a
        continuation milestone (REAR/REAR RE-ENTER) for pc must not be
        allowed to actually form while that's true; it stays queued, still
        tracking, until either the blocker's buy is genuinely gone (top-level
        dead, OR merely deep-failed and not currently live -- e.g. sitting
        past its own REAR SL) or (same-day tie) the blocker's buy hasn't
        formed yet today."""
        return any(pid != pc.id and other.seq > pc.seq and self._pre_today_live_buy.get(pid, False)
                    for pid, other in self.branches.items())

    def _rear_ancestor_terminated(self, buy: Buy) -> bool:
        """True if this buy's current REAR-family ancestor (REAR RE-ENTER
        if it exists, else REAR) has ALREADY failed at its own SL. Once
        that's happened, a fresh "REAR(n)" can never form again off some
        later BAR's own SL2 recovery -- the only valid paths back up are
        that SAME ancestor's own post-SL REAR RE-ENTER machinery, or an
        entirely new TZ GREEN branch reaching its own TZ BUY (26/04/2022).
        False if no ancestor exists yet, OR one exists but is merely
        dormant (superseded while awaiting/racing a fresh BAR, never
        having reached its own SL) -- in that case "REAR" is free to recur
        off a later BAR's own SL2 recovery, even while an ancestor object
        still exists (04/07/2022 -- REAR RE-ENTER(A) never had its own SL,
        so BAR(A.1)'s own SL2 recovery correctly produced a fresh REAR(A))."""
        target = buy.rear_reenter if buy.rear_reenter is not None else buy.rear
        return target is not None and target.sl is not None

    def process(self, prev: Day, cur: Day):
        per_branch_events = {}   # pid -> list of event strings, before contest
        milestone_achievers = []  # in evaluation order
        green_sl_pids = []

        # Only one TZ BUY/NEW TZ BUY can be live system-wide at any time.
        # Computed from state as of the end of the previous candle, so no
        # branch (dormant or not) may form its own buy -- first-time or
        # retry -- while another branch's buy is currently live.
        any_live_buy = any(pc.active and pc.buy and self._buy_currently_live(pc.buy) for pc in self.branches.values())

        # Snapshot, BEFORE today's processing, of which branches' buys were
        # GENUINELY still live coming into today (_buy_currently_live, NOT
        # raw buy.active). ONE question, asked at two different call sites,
        # both needing the SAME answer:
        #  1. REAR/REAR RE-ENTER must not be allowed to actually FORM while
        #     a newer branch's buy is genuinely still live -- it stays
        #     queued, continuing to track upward (INVALID BAR HH-style)
        #     rather than silently completing a transition that's
        #     immediately going to be blocked anyway (14/03 -- REAR(A) must
        #     not "happen and fail" that day; it should just keep tracking).
        #  2. The leadership-contest exemption (a continuation milestone
        #     can't displace a branch that's already reached its own buy)
        #     must only protect a buy that's genuinely still live -- a buy
        #     that's ALSO deep-failed (BAR SL2/REAR SL/REAR RE-ENTER SL) and
        #     not currently live is not "ahead" of anything anymore, even
        #     though its top-level buy.active flag only clears via that
        #     SAME buy's own top-level SL (which may never fire at all).
        #     Must also only count a buy that predates today -- a brand new
        #     buy formed on the SAME candle as the older branch's milestone
        #     does not count, and the older/earlier-queued cycle wins that
        #     tie (24/03 -- REAR(A) and NEW TZ BUY(B) both become possible
        #     the same day; B's buy is brand new that day, so REAR(A) wins).
        # These two call sites used to read two DIFFERENT dicts -- one raw-
        # active, one genuinely-live -- on the theory that the exemption
        # deliberately wanted the cruder, raw-active question. That theory
        # was never independently confirmed and turned out to be wrong
        # (04/06/2022 -- confirmed: B's own REAR RE-ENTER attempt does NOT
        # get to displace A's same-day REAR RE-ENTER attempt just because
        # B's top-level buy.active flag never happened to clear -- B's buy
        # had ALSO genuinely deep-failed via REAR SL 31/05, so it is not
        # "ahead" of A in any real sense; both call sites ask the exact
        # same question and must use the exact same answer).
        self._pre_today_live_buy = {pid: (pc.buy is not None and self._buy_currently_live(pc.buy))
                                     for pid, pc in self.branches.items()}

        # Dormancy is not something a branch earns its way out of by
        # achieving a fresh milestone -- it exists only because some other
        # branch is currently in control. The moment nothing anywhere holds
        # a live buy (whether that buy failed on its own, or its whole
        # parent TZ GREEN terminated and took the buy down with it), every
        # dormant branch becomes the active tip again immediately, evaluated
        # normally from this candle on -- not gated on it producing a fresh
        # milestone of its own first.
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

        # spawn a new sibling: allowed only while some active branch has had
        # RED fire but has NOT YET reached its own TZ BUY (checked *after*
        # today's processing above, so a branch that just bought this same
        # candle is immediately disqualified as an anchor) -- or no branches
        # exist yet at all (bootstrap).
        # Spawning eligibility is scoped to the single NEWEST active branch
        # (the actual "growing tip") only -- not any older branch that
        # happens to still be active and non-dormant. An older branch
        # lingering alongside a newer one doesn't extend spawning rights;
        # only the newest one's own RED/buy status governs whether a
        # further sibling can form.
        active_branches = [pc for pc in self.branches.values() if pc.active]
        tip = max(active_branches, key=lambda pc: pc.seq) if active_branches else None
        # A new sibling can also spawn even while the tip's buy is still
        # technically live, once that buy has reached one of the recognized
        # deep-failure points (BAR SL2, REAR SL, REAR RE-ENTER SL) -- the
        # standard leadership contest (already in place) then governs
        # whether the tip dormants or the new sibling terminates once
        # either side reaches its own next milestone; no special-casing
        # needed there. Deep failure alone is NOT enough, though: it must
        # ALSO not be currently live right now (19/03 -- REAR SL(A) fired
        # 11/03, a real deep failure, but REAR RE-ENTER(A) subsequently
        # reactivated and is actively climbing as of 19/03 -- spawning a
        # sibling while the anchor is actively winning right now makes no
        # sense; deep failure only opens the door once the anchor is
        # ALSO not currently live via that same recovery).
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

        # cascade: a branch's own TZ GREEN SL terminates every branch created
        # after it, regardless of leadership status
        for seq in green_sl_pids:
            for oid, other in list(self.branches.items()):
                if other.active and other.seq > seq:
                    other.active = False

        # leadership contest, in the order milestones actually fired.
        # Branches TERMINATED as a side effect (not self-caused) have their
        # entire day's contribution wiped, not just future days.
        #
        # Exemption (23/05 case): a CONTINUATION milestone (BAR(n)/REAR(n)/
        # REAR RE-ENTER(n) -- i.e. NOT a fresh TZ BUY(n)/NEW TZ BUY(n)) does
        # NOT get to terminate a newer branch that has ALREADY reached its
        # own TZ BUY/NEW TZ BUY at some point. An older branch's REAR/REAR
        # RE-ENTER resurfacing from a long-dead buy cycle cannot evict a
        # newer branch that has since opened its own genuine position --
        # it just stays dormant and silent. The complementary case (older
        # branch's REAR/REAR RE-ENTER firing BEFORE the newer branch has
        # reached its own buy -- still just a TZ GREEN) is unaffected: the
        # newer TZ GREEN still terminates normally.
        collaterally_terminated = set()
        exemption_blocked_pids = set()
        for pc, is_fresh_buy in milestone_achievers:
            if not pc.active:
                continue  # this achiever was itself wiped by an earlier, later-seq milestone this same candle
            blocked_this_achiever = False
            for oid, other in list(self.branches.items()):
                if other is pc or not other.active:
                    continue
                if other.seq < pc.seq:
                    other.dormant = True
                else:
                    # exemption is dynamic, not a permanent lock: it only
                    # holds while `other`'s own buy was GENUINELY still live
                    # coming into today (pre-today snapshot, not today's
                    # post-processing state) -- if that buy has since hit
                    # its own top-level SL, OR merely deep-failed and not
                    # currently live (e.g. sitting past its own REAR SL,
                    # awaiting REAR RE-ENTER), `other` is no longer "ahead"
                    # in any real sense and the default rule (older
                    # milestone terminates newer) resumes, so `other`'s
                    # label doesn't leak forever (04/06/2022 -- confirmed:
                    # B's own REAR RE-ENTER attempt does NOT get to displace
                    # A's own same-day REAR RE-ENTER attempt just because
                    # B's top-level buy.active flag never happened to clear
                    # -- B's buy had ALSO deep-failed via REAR SL 31/05,
                    # genuinely no longer live, so it is not "ahead" of A;
                    # the same exact question _milestone_blocked already
                    # asks -- must use the SAME "genuinely live" snapshot,
                    # not a raw-active one that answers a different, cruder
                    # question). A buy `other` forms on this SAME candle
                    # does NOT count either way -- a same-day tie goes to
                    # the older/earlier-queued cycle (24/03: REAR(A) vs a
                    # NEW TZ BUY(B) forming that same day -- REAR(A) wins,
                    # B does not get protection).
                    if not is_fresh_buy and self._pre_today_live_buy.get(oid, False):
                        blocked_this_achiever = True
                        continue
                    other.active = False
                    collaterally_terminated.add(oid)
            if blocked_this_achiever:
                exemption_blocked_pids.add(pc.id)

        # Reference-high inheritance: a dormant (but not terminated) older
        # branch mirrors whatever the single currently-leading (non-dormant)
        # branch has achieved -- including that leader's own buy-level
        # advances, already folded into leader.ref_high via its own
        # buy-sync inside _eval_parent. Confirmed 22-23/01/2024: TZ GREEN(A)
        # went dormant under TZ GREEN(B) on 17/01; once TZ BUY(B) climbed to
        # 306 (TZ BUY HH(B), 22/01), A's own reference must also read 306,
        # not keep tracking independently off its own stale RED-anchor via
        # the AFTER-RED weak rule -- that weak rule governs TZ BUY-formation
        # strength for the currently active branch, not what a dormant
        # ancestor is allowed to inherit from the branch that superseded it.
        # Only fires when there is EXACTLY one non-dormant active branch --
        # when every branch is simultaneously non-dormant (no live buy
        # anywhere resets them all), there's no single leader to inherit
        # from and each branch goes back to tracking independently.
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
                continue  # entire day's contribution wiped
            if pc_now is not None and pc_now.dormant and pid != new_branch_id:
                if pid in exemption_blocked_pids:
                    continue  # contest was fully neutralized -- stays dormant, silent
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

        # TZ GREEN's own reference keeps updating in the backend for as
        # long as a buy is live (kept in sync with the buy's own peak
        # below), but is NOT displayed while the buy is live -- confirmed:
        # once TZ BUY(n) forms, TZ BUY HH(n) is the front-facing event;
        # TZ GREEN HH(n) resumes being shown only once the buy is no
        # longer live (dormancy display rule: only SL/LL stay visible,
        # HH does not).
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

        # TZ GREEN's own reference must never fall behind what TZ BUY has
        # already proven -- once the buy is gone and TZ GREEN HH resumes
        # being checked, it has to pick up from the buy's own peak, not
        # from wherever TZ GREEN's own (separately, weakly tracked)
        # reference happened to be sitting. Concretely: TZ BUY(B) reached
        # 229 on 14/03 via TZ BUY HH(B); TZ GREEN's own reference had been
        # frozen at 225 since 07/03 and was never being updated while the
        # buy was live. Without this sync, once the buy failed on 18/03,
        # TZ GREEN HH(B) checks 21/03's High (228.5) against the stale 225
        # instead of the true 229 -- wrongly firing. This keeps the two in
        # step at every candle, not just at the moment of failure.
        if pc.buy is not None and pc.buy.ref_high > pc.ref_high:
            pc.ref_high = pc.buy.ref_high

        # TZ GREEN-specific: if this same candle ALSO triggers TZ GREEN SL,
        # suppress the HH -- TZ GREEN SL terminates the entire cycle, so a
        # same-day HH makes no difference to anything (unlike BAR/TZ BUY/
        # REAR/REAR RE-ENTER, where HH keeps mattering after SL and must
        # still show -- this suppression is TZ GREEN-only, confirmed).
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

        # Only one TZ BUY/NEW TZ BUY can be live system-wide -- a branch may
        # not form its own (first-time or retry) while another's is live,
        # regardless of whether this branch is dormant or visible. A retry
        # (NEW TZ BUY) on THIS SAME branch additionally needs the OLD buy
        # to be fully done, not just invalid at its own top level: if a
        # BAR/REAR/REAR RE-ENTER family is still racing off it (05/06 --
        # B.1 still chasing REAR after TZ BUY SL(B)), forming a brand new
        # Buy() object here would silently discard that whole chain out
        # from under it. Once no such family exists (or never did), the
        # old buy is genuinely finished and a retry is fair game.
        # bar_pending alone (RED2 fired but no BAR ever actually confirmed
        # before the top-level SL killed it) does NOT count -- it can never
        # complete on a dead buy anyway (mechanism 1 is gated on buy.active
        # elsewhere), so it's inert and must not block a legitimate retry
        # (24/03 -- NEW TZ BUY(A) needs to fire; branch A's PRIOR buy died
        # 17/03 with only a stale bar_pending, no BAR ever having formed).
        old_buy_unresolved = (pc.buy is not None and not pc.buy.active and
                               (bool(pc.buy.bar_lineages) or
                                pc.buy.rear is not None or pc.buy.rear_reenter is not None))
        if pc.red_ever and (pc.buy is None or not pc.buy.active) and not old_buy_unresolved and not any_live_buy:
            # Event006 (first-time TZ BUY): "Reference High of TZ GREEN(n)"
            # -- the parent cycle's own tracker. Event010 (NEW TZ BUY, a
            # retry) explicitly reads differently: "Reference High of TZ
            # BUY(n)" -- the OLD (now-dead) buy's own peak, NOT the parent
            # TZ GREEN's. These are two different trackers that can diverge
            # significantly: pc.ref_high uses the weak AFTER-RED formula and
            # can go stale for a long stretch (20/03 -- pc.ref_high was
            # stuck at 225 since 07/03's RED while the actual buy climbed
            # to 229 on 14/03; NEW TZ BUY(B) must be measured against that
            # 229, not the stale 225).
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

        # Snapshot the REAR-family ancestor's reference high BEFORE today's
        # own dormant HH tracking (below) can silently bump it to today's
        # own High. The reactivation-vs-fresh-REAR priority check in
        # _eval_bar_lineages_progress needs to compare a later BAR's own
        # threshold against the ancestor's reference AS IT STOOD COMING
        # INTO today, not a value that already includes today's candle --
        # otherwise the ancestor's own dormant tracker "chases its own
        # tail": on a day where the ancestor's simple dormant-HH rule and
        # the BAR's own SL2-recovery threshold are the exact same number,
        # the dormant tracker updates first (it runs earlier in this same
        # function) and the reactivation check then compares today's High
        # against itself, always failing (21/06/2022 -- confirmed: REAR
        # RE-ENTER(A)'s own reference was frozen at 451 coming into today,
        # today's High of 453 must clear THAT 451, not the 453 the dormant
        # tracker had already just written into the same field moments
        # earlier this same candle).
        _ancestor_target = buy.rear_reenter if buy.rear_reenter is not None else buy.rear
        pre_today_ancestor_ref = _ancestor_target.ref_high if _ancestor_target is not None else None
        label = "TZ BUY" if buy.kind == 'TZ_BUY' else "NEW TZ BUY"
        sl_label = "TZ BUY SL" if buy.kind == 'TZ_BUY' else "NEW TZ BUY SL"

        # TZ BUY's own HH suppressed once ANY deeper structure has EVER
        # existed for this buy (a BAR lineage, or a REAR/REAR RE-ENTER
        # object of any kind) -- BAR HH/REAR HH/REAR RE-ENTER HH take
        # visible precedence for good; TZ BUY's own reference keeps
        # updating silently in the backend regardless. This must NOT be
        # conditioned on .dormant: once REAR or REAR RE-ENTER has formed
        # at all, the only way back to a front-facing top-level TZ BUY
        # display is via that SAME top-level object's own SL and a fresh
        # NEW TZ BUY retry -- not by the top-level HH tracking silently
        # resuming just because REAR/REAR RE-ENTER happens to be dormant
        # (own RED2 exhaustion, or its own SL) at this exact moment (29/03
        # -- REAR RE-ENTER SL(A) on 28/03 must not let TZ BUY HH(A) reappear
        # on 29/03; the correct next front-facing event is NEW TZ BUY(A),
        # above 329.50, once the top-level buy's own SL eventually fires).
        has_deeper_active = (bool(buy.bar_lineages) or buy.bar_pending or
                              buy.rear is not None or buy.rear_reenter is not None)
        no_bar_yet = not has_deeper_active
        red1_preexisting_at_buy_level = buy.active and no_bar_yet and buy.red1 is not None and buy.red1.active

        # The top-level buy's own HH/LL/SL only apply while it is still
        # active. Once TZ BUY SL(n) fires, its own tracking freezes for
        # good (confirmed: 31/05 TZ BUY LL(B), 01/06 TZ BUY SL(B) both
        # fire normally regardless of BAR depth) -- but that does NOT stop
        # the BAR-family/REAR-family sub-structure below it, which keeps
        # racing independently (05/06: REAR(B) must still be reachable
        # after TZ BUY SL(B) -- REAR is a recovery mechanism that operates
        # on its own once BAR SL2 is reached, not gated on the top buy's
        # own invalidation). No early return here anymore.
        if buy.active:
            # Same sync as TZ GREEN <-> TZ BUY above, one level down: TZ
            # BUY's own reference must not go stale relative to whatever
            # the BAR family has already proven, in case TZ BUY's own HH
            # tracking is ever the one checked again later.
            if buy.bar_high_pool > buy.ref_high:
                buy.ref_high = buy.bar_high_pool
            is_sl = (cur.l <= buy.ref_low and (buy.ref_low - cur.l) >= THRESH - EPS and cur.c <= buy.ref_low + EPS)
            hh = ll = False
            if no_bar_yet:
                # Same same-day fix as BAR/REAR: if the in-flight RED1 is
                # about to be invalidated THIS candle, TZ BUY's own HH must
                # be checked today too, off the just-restored simple rule
                # -- not skipped entirely just because a RED1 happened to
                # still be "in flight" at the start of today's evaluation
                # (Event017's own Multiple Events list "INVALID RED1(n) +
                # TZ BUY HH(n)" as a valid same-day combination).
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
                # bar_pending is already functionally inert once buy.active
                # is False (mechanism 1 is gated on buy.active), but leaving
                # it True and relying on that gate is exactly the kind of
                # implicit, remembered-elsewhere state the rest of this
                # audit is removing -- cancel it explicitly here too.
                buy.bar_pending = False
                # same for any in-flight RED1 -- every other terminal SL
                # event (BAR SL, REAR SL, REAR RE-ENTER SL) already
                # discards it; the top-level buy's own SL was the one
                # remaining terminal event that didn't.
                buy.red1 = None

        # BAR's own HH keeps tracking/showing for as long as it's the
        # NEWEST lineage in the chain (feeds REAR's reference pool) -- an
        # older, superseded lineage's own HH stops being recorded the
        # moment a newer generation (branched lineage, or same-label
        # reactivation) takes over, even retroactively for the very candle
        # that supersedes it (14/04, 25/04). LL only tracks/shows while a
        # lineage is still pre-SL (once SL exists, BAR SL's own LL takes
        # over that role -- confirmed 10/04).
        newest_lin = buy.bar_lineages[-1] if buy.bar_lineages else None
        if newest_lin is not None and not self._bar_hh_suppressed_today(buy, newest_lin, prev, cur):
            ev += self._eval_bar_lineage_hh(pc, buy, newest_lin, prev, cur)

        # REAR's own HH/LL only track/show while REAR hasn't hit its own
        # SL yet -- per Event031, REAR SL's allowed next events are only
        # {REAR SL, REAR RE-ENTER, INVALID REAR HH}; REAR's own HH/LL stop
        # entirely once SL fires (INVALID REAR HH takes over the High
        # side; there is no Low-side tracking post-SL at all).
        # Dormancy (REAR superseded by an actual fresh BAR generation, or
        # by REAR RE-ENTER) only silences ADVANCEMENT tracking -- HH -- not
        # LL: a dormant structure's own new Low is a real, decisive price
        # move and must still be recorded, silently or shown, same as a
        # dormant branch's own SL/LL staying visible in the leadership
        # contest (established principle, confirmed again this round --
        # dormancy means "keep tracking, HH suppressed," it does NOT mean
        # "stop examining entirely." Only TERMINATION -- REAR's own SL
        # actually firing -- ends this object's story; see the SL check
        # after the routing chain below).
        if buy.rear is not None and buy.rear.sl is None:
            rear_ev = self._eval_rear_hh_ll(pc, buy, buy.rear, prev, cur)
            if buy.rear.dormant:
                rear_ev = [e for e in rear_ev if "LL(" in e]
            ev += rear_ev

        # Same rule for REAR RE-ENTER: its own HH/LL stop once REAR
        # RE-ENTER SL fires (Event036's allowed next events are only
        # {Dormant REAR RE-ENTER, INVALID REAR RE-ENTER HH, REAR RE-ENTER}).
        if buy.rear_reenter is not None and buy.rear_reenter.sl is None:
            rre_ev = self._eval_rear_reenter_hh_ll(pc, buy, buy.rear_reenter, prev, cur)
            if buy.rear_reenter.dormant:
                rre_ev = [e for e in rre_ev if "LL(" in e]
            ev += rre_ev

        # route to whichever stage is currently the active parent for
        # SL-transitions and RED1/RED2 attachment. Once REAR's (or REAR
        # RE-ENTER's) own SL exists -- formed just now above, or on any
        # earlier candle -- Event031/036's own rules keep running
        # unconditionally: dormancy no longer matters once the structure
        # has its own decisive SL, since that IS the current governing
        # cycle now (REAR SL2/REAR RE-ENTER/INVALID REAR HH), not
        # something waiting to be superseded by a fresh BAR.
        # buy.rear must never be re-examined once REAR RE-ENTER exists in
        # any form -- it is permanently retired, not a fallback -- so both
        # buy.rear branches below are explicitly gated on rear_reenter
        # being absent. When REAR RE-ENTER exists but is BOTH dormant (own
        # RED2 fired) AND back to sl is None (e.g. just reactivated via
        # is_reenter_again, which doesn't itself clear .dormant), none of
        # the four branches below match and the chain correctly falls
        # through to bar_lineages/bar_pending -- awaiting a fresh BAR is
        # exactly what should happen there. (A prior version of this used
        # a bare "elif buy.rear_reenter is not None: pass" for that case,
        # which also consumed the elif chain and blocked that fallthrough
        # entirely -- 06/06 confirmed this: BAR never formed even though
        # bar_pending was set and the breakout candle qualified.)
        # The awaited fresh BAR (bar_pending, from REAR's or REAR
        # RE-ENTER's own RED2 -- see _clear_for_new_bar_generation) is
        # checked BEFORE letting REAR/REAR RE-ENTER's own continued
        # tracking claim this candle -- REAR/REAR RE-ENTER only keeps
        # living "in parallel" with the awaited BAR on days the BAR does
        # NOT confirm (19/04 -- neither has actually superseded the other
        # yet); the moment it DOES confirm, it wins this same candle,
        # retroactively (mirrors BAR-lineage's own supersession-is-
        # retroactive precedent, 14/04 & 25/04): strip whatever REAR/REAR
        # RE-ENTER HH was already computed earlier this candle (above) --
        # it's about to be superseded by the very BAR that just formed.
        # Only relevant while bar_lineages is still empty coming into
        # today -- i.e. still the awaiting-the-FIRST-fresh-BAR window for
        # this particular RED2 cycle (once that BAR confirms, buy.rear/
        # buy.rear_reenter DO stay around, dormant, alongside the now
        # non-empty bar_lineages -- see the SL check after this routing
        # chain, which is exactly why it must run AFTER, not before).
        bar_confirms_today = (buy.bar_pending and buy.active and not buy.bar_lineages and
                               (buy.rear is not None or buy.rear_reenter is not None) and
                               self._bar_entry_shape(prev, cur))
        if buy.rear_reenter is not None and buy.rear_reenter.sl is not None:
            ev += self._eval_rear_reenter_sl_progress(pc, buy, buy.rear_reenter, buy.rear_reenter.sl, prev, cur)
        elif buy.rear_reenter is None and buy.rear is not None and buy.rear.sl is not None:
            ev += self._eval_rear_sl_progress(pc, buy, buy.rear, buy.rear.sl, prev, cur)
        elif bar_confirms_today:
            ev = [e for e in ev if not (e.startswith("REAR HH(") or e.startswith("REAR RE-ENTER HH("))]
            ev += self._check_bar_pending(pc, buy, prev, cur)
        elif buy.rear_reenter is not None and not buy.rear_reenter.dormant:
            ev += self._eval_rear_reenter_progress(pc, buy, buy.rear_reenter, prev, cur)
        elif buy.rear_reenter is None and buy.rear is not None and not buy.rear.dormant:
            ev += self._eval_rear_progress(pc, buy, buy.rear, prev, cur)
        elif buy.bar_lineages:
            ev += self._eval_bar_lineages_progress(pc, buy, prev, cur, pre_today_ancestor_ref)
        elif buy.bar_pending and buy.active:
            # RED2 already fired; nothing among the five eligible parents is
            # genuinely active yet, so a fresh RED1 cannot attach here until
            # BAR itself confirms. Gated on buy.active: a bar_pending flag
            # left over from BEFORE the top-level buy died must not let a
            # brand-new BAR spring up after the fact (19/03 -- RED2 fired
            # 14/03, buy failed via TZ BUY SL 17/03 with no BAR ever having
            # confirmed; bar_pending must not still be live enough to form
            # BAR(A.1) out of nothing two days later). An ALREADY-confirmed
            # bar_lineages list is a different, existing structure and is
            # unaffected -- it keeps racing via the branch above.
            ev += self._check_bar_pending(pc, buy, prev, cur)
        elif not buy.active:
            # top-level buy has failed (TZ BUY SL) and no BAR/REAR family
            # ever formed for it -- nothing left to route to here.
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
        # take effect even while dormant -- dormancy (superseded by an
        # awaited or actual fresh BAR) doesn't mean the market stops: if
        # price genuinely still breaks REAR's frozen stop level, that's a
        # decisive, real event and must fire regardless (REAR SL is "given
        # importance" any time after REAR formed, dormant or not).
        # Checked HERE -- AFTER the routing chain above, not before -- so
        # it never preempts today's BAR-lineage events: REAR's own SL and
        # a currently-racing BAR lineage's own SL2 can genuinely coincide
        # on the same candle (26/04/2022 confirmed: REAR SL(A) and BAR
        # SL2(A.1) both fire together), and only once both have had their
        # chance to register today does REAR SL's TERMINATION effect take
        # hold for future candles: the whole BAR-family lineage racing
        # underneath is "no good" from here on (buy.bar_lineages = []) --
        # its only valid path back up is THIS SAME REAR's own REAR
        # RE-ENTER (Event031's own rules), never a second, independent
        # REAR forming again (see the buy.rear is None gate in
        # _eval_bar_lineages_progress).
        if buy.rear_reenter is not None and buy.rear_reenter.dormant and buy.rear_reenter.sl is None:
            rre = buy.rear_reenter
            if (cur.l < rre.ref_low and (rre.ref_low - cur.l) >= THRESH - EPS and cur.c <= rre.ref_low + EPS):
                ev.append(f"REAR RE-ENTER SL({branch_label(pc.id)})")
                rre.sl = RearReenterSL(ref_low=cur.l, invalid_hh_ref=rre.ref_high)
                buy.red1 = None
                buy.bar_lineages = []
                buy.bar_sub_counter = 0
                buy.bar_pending = False
        elif buy.rear is not None and buy.rear.dormant and buy.rear.sl is None:
            rear = buy.rear
            if (cur.l < rear.ref_low and (rear.ref_low - cur.l) >= THRESH - EPS and cur.c <= rear.ref_low + EPS):
                ev.append(f"REAR SL({branch_label(pc.id)})")
                rear.sl = RearSL(ref_low=cur.l, invalid_hh_ref=rear.ref_high)
                buy.bar_lineages = []
                buy.bar_sub_counter = 0
                buy.red1 = None
                buy.bar_pending = False

        return ev

    # -----------------------------------------------------------------
    def _eval_red1_generic(self, pc, buy, stage_obj, prev: Day, cur: Day):
        """Generic RED1(n)/RED2(n) handling, reused at every level (buy,
        BAR, REAR, REAR RE-ENTER). stage_obj must expose .ref_high,
        .ref_low, .red1_since (or .red1_ever for the buy level -- see
        callers), .ref_high_at_red1. buy.red1 is the single shared in-flight
        RED1 tracker, since only one stage can ever have RED1 attached at
        a time."""
        ev = []
        red1 = buy.red1
        if cur.h >= red1.ref_high and (cur.h - red1.ref_high) >= THRESH - EPS and cur.c >= red1.ref_high:
            ev.append(f"INVALID RED1({branch_label(pc.id)})")
            red1.active = False
            # INVALID RED1 fully terminates that RED1 -- the parent
            # structure's own HH tracking reverts to the simple BEFORE-RED1
            # rule (any move >= 0.01 qualifies, continuing from wherever
            # its own reference currently sits) until a fresh RED1 attaches
            # again, at which point the weaker AFTER-RED1 regime resumes,
            # newly anchored. Without this, the weakened AFTER-RED1
            # qualification test kept applying forever off a RED1 that no
            # longer exists (16/02-19/02 -- a lower high than a very recent
            # actual peak was wrongly still counting as a fresh HH).
            self._reset_red1_regime(stage_obj)
            return ev

        if cur.h > red1.ref_high and (cur.h - red1.ref_high) >= ANY:
            red1.ref_high = cur.h
            ev.append(f"RED1 HH({branch_label(pc.id)})")

        # RED1 LL vs RED2 are complementary: RED2 needs ALL of {High <=
        # Previous Day High, gap >= 0.20, Close <= reference low}; RED1 LL
        # fires whenever Low < reference low and RED2's full conjunction
        # does NOT hold -- for ANY reason, including High breaking above
        # Previous Day High (not just an insufficient gap or Close bouncing
        # back above the reference, which is all I originally checked).
        if cur.l < red1.ref_low:
            red2_holds = (cur.h <= prev.h and (red1.ref_low - cur.l) >= THRESH - EPS and
                          cur.c <= red1.ref_low + EPS)
            if red2_holds:
                red1.active = False
                ev.append(f"RED2({branch_label(pc.id)})")
                # RED1/RED2 cannot repeat on this SAME stage again -- once
                # RED2 fires here, this cycle is permanently exhausted for
                # fresh-RED1 purposes; only a genuinely NEW BAR/REAR/TZ BUY/
                # REAR RE-ENTER generation starts a fresh RED1-eligible
                # cycle. BAR lineage, REAR, and REAR RE-ENTER all keep
                # living/tracking past their own RED2 now (none of them go
                # dormant merely from RED2 -- see _clear_for_new_bar_generation),
                # so all three need this explicit re-attachment guard. (Top-level
                # buy is the one exception: it's naturally safe via routing order
                # alone -- _clear_for_new_bar_generation's bar_pending=True routes
                # every subsequent candle through _check_bar_pending BEFORE the
                # buy-level RED1-attach branches are ever reached.)
                if isinstance(stage_obj, (BarLineage, Rear, RearReenter)):
                    stage_obj.red2_ever = True
                self._clear_for_new_bar_generation(buy)
            else:
                red1.ref_low = cur.l
                ev.append(f"RED1 LL({branch_label(pc.id)})")

        return ev

    def _attach_fresh_red1(self, pc, buy, stage_obj, prev: Day, cur: Day):
        """Checks whether a fresh RED1(n) fires against stage_obj (BAR,
        REAR, or REAR RE-ENTER, whichever is currently active) and attaches
        it. Returns event list."""
        ev = []
        if (cur.h <= prev.h and cur.l < prev.l and (prev.l - cur.l) >= THRESH - EPS and cur.c <= prev.l):
            if not stage_obj.red1_since:
                stage_obj.ref_high_at_red1 = stage_obj.ref_high
            stage_obj.red1_since = True
            buy.red1 = Red1(ref_high=cur.h, ref_low=cur.l)
            ev.append(f"RED1({branch_label(pc.id)})")
        return ev

    def _reset_red1_regime(self, stage_obj):
        """Called when INVALID RED1 fires against stage_obj: switches its
        own HH tracking back to the simple BEFORE-RED1 rule. BarLineage/
        Rear/RearReenter expose this as .red1_since; the top-level Buy
        exposes the equivalent concept as .red1_ever (naming predates this
        fix and wasn't unified)."""
        if hasattr(stage_obj, 'red1_since'):
            stage_obj.red1_since = False
        elif hasattr(stage_obj, 'red1_ever'):
            stage_obj.red1_ever = False

    def _red1_invalidates_today(self, buy: Buy, cur: Day) -> bool:
        """True if the currently in-flight RED1 (if any) is about to be
        invalidated by THIS candle. HH-tracking functions run before the
        RED1/RED2 routing does within the same candle, so without this
        check a same-day INVALID RED1 doesn't take effect until tomorrow's
        HH check -- missing today's own qualifying high (31/03: INVALID
        RED1(A) fires AND REAR HH(A) should fire the same day, off the
        simple BEFORE-RED1 rule that INVALID RED1 just restored) and
        wrongly still gating tomorrow's high under the weak rule (01/04)."""
        red1 = buy.red1
        if red1 is None or not red1.active:
            return False
        return cur.h >= red1.ref_high and (cur.h - red1.ref_high) >= THRESH - EPS and cur.c >= red1.ref_high

    # -----------------------------------------------------------------
    def _bar_sl_invalidates_today(self, lin: BarLineage, cur: Day) -> bool:
        """True if this lineage's own BAR SL would be invalidated (INVALID
        BAR SL) by today's candle -- used to suppress that lineage's own
        stale BAR HH on the very day it gets superseded/reactivated."""
        sl = lin.sl
        if sl is None or sl.sl2 or sl.invalidated:
            return False
        return cur.h >= sl.ref_high and (cur.h - sl.ref_high) >= THRESH - EPS and cur.c >= sl.ref_high

    def _bar_entry_shape(self, prev: Day, cur: Day) -> bool:
        """BAR's own entry-shape formula (Event019): the general breakout
        used both to await a fresh BAR(n) after RED2 (mechanism 1) and to
        gate whether an INVALID BAR SL reactivates under its own label."""
        return (cur.l >= prev.l and cur.h > prev.h and
                (cur.h - prev.h) >= THRESH - EPS and cur.c >= prev.h)

    def _mechanism1_confirms_today(self, buy: Buy, prev: Day, cur: Day) -> bool:
        return buy.bar_pending and self._bar_entry_shape(prev, cur)

    def _dormant_bar_low_check(self, buy: Buy, lin: BarLineage, sl: BarSL, cur: Day):
        """Low-side tracking for a dormant (invalidated) BAR SL, mirroring
        INVALID BAR HH's high-side tracking once SL2 is reached. Mutually
        exclusive with a fresh BAR SL(n) re-forming, using the exact same
        split as the original (pre-invalidation) LL-vs-SL logic: gap>=0.20
        AND Close<=ref_low -> fresh BAR SL(n); otherwise -> INVALID BAR LL(n)."""
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
        """True whenever this (newest) lineage's own BAR HH should NOT be
        recorded today -- either it is permanently dormant (INVALID BAR SL
        fired and didn't qualify as a fresh BAR(n)), it is about to be
        invalidated/reactivated/terminated this very candle (14/04, 25/04),
        or a fresh independent BAR(n+1) is about to supersede it via
        mechanism 1 this same candle (03/05: A.4's HH stops the instant
        BAR(A.5) confirms, even though A.4 also made a genuine new high
        today -- "NEW BAR will terminate the Lineage of earlier BAR")."""
        if lin.sl is not None and lin.sl.invalidated:
            return True
        if lin.sl is not None and lin.sl.sl2:
            # SL2 reached: same rule as REAR's own HH stopping once REAR SL
            # fires -- INVALID BAR HH takes over the high-side tracking
            # role from here, BAR's own HH stops being a separate parallel
            # tracker (04/06 -- was double-firing alongside INVALID BAR HH).
            return True
        if self._bar_sl_invalidates_today(lin, cur):
            return True
        if lin.sl is None and self._mechanism1_confirms_today(buy, prev, cur):
            return True
        return False

    def _clear_for_new_bar_generation(self, buy):
        """RED2 just fired. Per Event018 (RED2)'s own Coexisting
        Structures / Allowed Next Events, the EXISTING BAR(n) lineage does
        NOT get wiped by its own RED2 -- it keeps living, continuing to
        track its own HH/LL/SL/SL2 in parallel with a freshly-awaited new
        BAR(n) generation (30/04-02/05 confirmed this: BAR SL(A.1) kept
        firing after RED2(A) on 29/04). REAR/REAR RE-ENTER follow the exact
        same principle now (19/04 -- a REAR whose own RED2 just fired must
        NOT go dormant yet: nothing has actually superseded it, only been
        awaited. It keeps tracking/showing its own HH/LL normally, in
        parallel with the awaited fresh BAR, exactly like a BAR lineage
        does. Dormant is set later, only once that fresh BAR ACTUALLY
        confirms -- see _check_bar_pending). BAR(n) itself does NOT confirm
        this same candle -- RED2 requires Close <= RED1's reference low (a
        low close) while BAR's own entry formula requires Close >= Previous
        Day High (a high close), which can never both be true the same
        day. BAR only confirms on a later candle that independently
        satisfies its own entry-shape formula (checked alongside every
        other still-alive lineage in _eval_bar_lineages_progress, or via
        _check_bar_pending when bar_lineages is still empty)."""
        buy.bar_pending = True

    def _supersede_rear_for_new_bar(self, buy):
        """A fresh BAR(n) generation has just ACTUALLY confirmed (not
        merely been awaited) -- REAR/REAR RE-ENTER, if either is still the
        pre-SL active structure, is now genuinely superseded and goes
        dormant from this point on (HH tracking suppressed; SL/LL keep
        being checked regardless, same as always -- see 7b in the
        rulebook). Called only from the sites where a fresh BAR generation
        actually forms, never merely from RED2 confirming (that only
        awaits it -- see _clear_for_new_bar_generation)."""
        # .dormant is only ever meaningful while sl is None (the PRE-SL
        # phase) -- once a structure has its own SL, dormant is ignored
        # everywhere it's read, so it must never be WRITTEN once sl exists
        # either. Without this guard the write is a harmless no-op today
        # only because of routing exclusivity elsewhere in the file; this
        # makes that invariant explicit at the point of the write instead
        # of relying on it staying true everywhere else.
        if buy.rear_reenter and buy.rear_reenter.sl is None and not buy.rear_reenter.dormant:
            buy.rear_reenter.dormant = True
        elif buy.rear and buy.rear.sl is None and not buy.rear.dormant:
            buy.rear.dormant = True

    # -----------------------------------------------------------------
    def _check_bar_pending(self, pc, buy, prev: Day, cur: Day):
        """A fresh BAR(n) is awaited (RED2 already fired, or this is the
        very first BAR off the buy). Confirm it only when this candle
        independently satisfies BAR's own entry-shape formula against
        Previous Day High/Low."""
        if (cur.l >= prev.l and cur.h > prev.h and
                (cur.h - prev.h) >= THRESH - EPS and cur.c >= prev.h):
            buy.bar_sub_counter += 1
            sub_label = f"{branch_label(pc.id)}.{buy.bar_sub_counter}"
            buy.bar_lineages.append(BarLineage(label=sub_label, ref_high=cur.h, ref_low=cur.l))
            buy.bar_pending = False
            buy.bar_high_pool = max(buy.bar_high_pool, cur.h)
            # this IS the fresh BAR generation that REAR/REAR RE-ENTER (if
            # still the pre-SL active structure) was being awaited to be
            # superseded by -- only now, not at RED2-confirm time (19/04).
            self._supersede_rear_for_new_bar(buy)
            return [f"BAR({sub_label})"]
        return []

    # =================== BAR family (multi-lineage) ===================
    def _eval_bar_lineage_hh(self, pc, buy: Buy, lin: BarLineage, prev: Day, cur: Day):
        """BAR's own HH -- tracked/shown for as long as this lineage exists
        at all (even once it has its own SL), since it feeds REAR's
        reference pool. LL only tracks/shows while pre-SL (confirmed
        10/04): once SL exists, BAR SL's own LL takes over that role."""
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

    def _eval_bar_lineages_progress(self, pc, buy, prev: Day, cur: Day, pre_today_ancestor_ref=None):
        """Advances every currently-alive BAR lineage's SL/SL2 state (HH/LL
        already handled by _eval_bar_lineage_hh, called earlier this same
        candle). Whichever lineage's SL2 condition fires first wins: REAR
        forms off its reference, and every other lineage -- ancestor or
        descendant, whatever stage it's at -- terminates immediately. Also
        checks whether a fresh BAR can branch off the newest lineage's SL
        range, and attaches RED1/RED2 to whichever lineage is currently the
        genuinely active (pre-SL) one."""
        ev = []
        label_id = branch_label(pc.id)
        rear_winner = None
        reactivation_winner = None
        sl2_confirmed_today = False
        # True the moment any lineage reactivates this candle via its own
        # INVALID BAR SL (sl -> None, fresh BAR under its own label). Only
        # one BAR can exist/form per candle -- a leftover bar_pending flag
        # (mechanism 1, checked after this loop) must not ALSO fire a
        # totally separate BAR(n+1) the same day a lineage just reactivated;
        # that would silently discard the reactivation even though its own
        # event already printed (02/03 -- confirmed: only INVALID BAR SL(A.2)
        # + BAR(A.2) should show, never a same-day BAR(A.3) on top of it).
        reactivated_this_candle = False
        # events are tracked PER LINEAGE (not appended straight to ev) so
        # that if BAR SL2 confirms on one lineage THIS candle, every other
        # lineage still sitting in an open (pre-SL2) BAR SL can have its
        # ENTIRE today's contribution wiped, not just future days -- same
        # as a branch collaterally terminated by a milestone in the
        # leadership contest has its whole day's contribution wiped, not
        # merely blocked going forward.
        per_lineage_ev: dict = {}
        lineage_objs: dict = {}

        for lin in list(buy.bar_lineages):
            lineage_objs[lin.label] = lin
            lin_ev = per_lineage_ev.setdefault(lin.label, [])
            ev = lin_ev  # redirect this iteration's appends into lin_ev
            if lin.sl is None:
                # BAR SL is checked FIRST, against the lineage's own
                # ref_low -- if it fires this candle, RED1/RED2 is skipped
                # entirely (whether about to attach fresh, or already
                # in-flight and about to resolve into RED2): once BAR SL
                # forms there is no longer an active BAR for RED1/RED2 to
                # mean anything for -- the only forward path is BAR SL2/
                # BAR SL HH/BAR SL LL/a fresh BAR reactivation. This
                # mirrors REAR/REAR RE-ENTER, which already check their own
                # SL first and never touch RED1 the same candle their SL
                # forms. (Previously RED1/RED2 was resolved BEFORE this
                # check, letting e.g. RED2(A) print alongside BAR SL(A.2)
                # on 18/04 -- confirmed wrong: BAR SL always takes priority,
                # same day or after RED1, regardless of same/different
                # reference values.)
                if (cur.l < lin.ref_low and (lin.ref_low - cur.l) >= THRESH - EPS and cur.c <= lin.ref_low + EPS):
                    ev.append(f"BAR SL({lin.label})")
                    lin.sl = BarSL(ref_high=cur.h, ref_low=cur.l)
                    # this lineage no longer has an active parent to attach
                    # to, so discard any in-flight RED1 rather than let it
                    # linger and get wrongly evaluated against whatever
                    # parent shows up next
                    buy.red1 = None
                    # no active BAR left for RED1's weak-HH regime to
                    # protect either -- revert to the simple rule for this
                    # lineage's own (still-continuing) BAR HH tracking
                    lin.red1_since = False
                    continue
                red1_preexisting = buy.red1 is not None and buy.red1.active
                if red1_preexisting:
                    ev += self._eval_red1_generic(pc, buy, lin, prev, cur)
                elif not lin.red2_ever:
                    ev += self._attach_fresh_red1(pc, buy, lin, prev, cur)
                continue

            sl = lin.sl

            if sl.invalidated:
                # Dormant: a prior INVALID BAR SL fired here but didn't
                # qualify as a fresh BAR(n) (01/05 -- Low condition failed).
                # No more HH/SL-HH/SL2 tracking while dormant, but on the
                # low side it mirrors INVALID BAR HH's role once SL2 is
                # reached: a fresh lower low updates the frozen reference
                # (INVALID BAR LL) unless it independently also qualifies
                # as a full fresh BAR SL(n), which takes priority and
                # re-arms the SL cycle from scratch -- "possibility BAR
                # SL2(n) is still there below the reference low of earlier
                # BAR SL(n)."
                ev += self._dormant_bar_low_check(buy, lin, sl, cur)
                continue

            if not sl.sl2:
                # priority: check INVALID BAR SL first, against the
                # pre-candle reference (same ordering bug class as
                # INVALID RED1 vs RED1 HH, now fixed here too)
                if cur.h >= sl.ref_high and (cur.h - sl.ref_high) >= THRESH - EPS and cur.c >= sl.ref_high:
                    ev.append(f"INVALID BAR SL({lin.label})")
                    sl.ever_invalid = True
                    buy.bar_high_pool = max(buy.bar_high_pool, cur.h)  # "INVALID BAR High"
                    if lin is buy.bar_lineages[-1] and self._bar_entry_shape(prev, cur):
                        # no newer lineage has branched off this one's SL,
                        # AND today's candle independently satisfies BAR's
                        # own entry-shape formula -- a genuine fresh BAR(n),
                        # reactivating under its own label
                        lin.sl = None
                        lin.ref_high = cur.h
                        lin.ref_low = cur.l
                        lin.red1_since = False
                        # this reactivation is a genuinely fresh BAR cycle in
                        # every respect except the label -- any RED2 this
                        # SAME lineage object produced in its PREVIOUS life
                        # (before its own SL) must not carry over and
                        # permanently block a fresh RED1 from ever attaching
                        # again; a truly new lineage would start at False.
                        lin.red2_ever = False
                        reactivated_this_candle = True
                        # this reactivation IS the fresh BAR that bar_pending
                        # was awaiting (just under the same label instead of
                        # a new one) -- cancel it outright, not just for
                        # today: two BARs can never be active at once, so a
                        # stale flag must not be left to supersede THIS SAME
                        # lineage again on a later candle (03/03 -- A.2
                        # reactivated 02/03 and was wiped into BAR(A.3) the
                        # very next day by this same leftover flag).
                        buy.bar_pending = False
                        ev.append(f"BAR({lin.label})")
                    elif lin is buy.bar_lineages[-1]:
                        # invalidated but doesn't qualify as a fresh BAR
                        # (e.g. Low < Previous Day Low) -- BAR(n) goes
                        # dormant rather than reactivating outright. Still
                        # check today's low against the frozen reference
                        # immediately (01/05 confirmed this fires same-day).
                        sl.invalidated = True
                        ev += self._dormant_bar_low_check(buy, lin, sl, cur)
                    else:
                        # a newer lineage already exists beyond this one --
                        # this one terminates outright, freeing its label
                        buy.bar_lineages.remove(lin)
                    continue
                if cur.h > sl.ref_high and (cur.h - sl.ref_high) >= ANY:
                    sl.ref_high = cur.h
                    buy.bar_high_pool = max(buy.bar_high_pool, sl.ref_high)  # "Latest BAR SL HH (before SL2)"
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
                    # Event028's Reference High Rule: the cross-generation
                    # bar_high_pool (highest confirmed value among BAR High/
                    # BAR HH/BAR SL HH/INVALID BAR High across this buy's
                    # ENTIRE history) governs REAR's reference ONLY when
                    # THIS lineage's own SL cycle has shown its own INVALID
                    # BAR SL at least once -- that's what proves a wider,
                    # previously-established peak was genuinely reconfirmed
                    # as still reachable during ITS OWN SL recovery attempt.
                    # Without that reconfirmation, a sibling lineage's peak
                    # from its own separate, since-terminated life doesn't
                    # transfer over -- REAR uses only this lineage's own
                    # peak instead (07/05 -- B.2 reaches BAR SL2 straight
                    # from BAR SL, never showing its own INVALID BAR SL;
                    # REAR must use only B.2's own peak of 326, not B.1's
                    # separate, never-reconfirmed 329 sitting in the pool).
                    if sl.ever_invalid:
                        sl.invalid_hh_ref = max(buy.bar_high_pool, lin.ref_high, sl.ref_high)
                    else:
                        sl.invalid_hh_ref = max(lin.ref_high, sl.ref_high)
                    # once THIS lineage reaches its own SL2, any "awaiting a
                    # fresh BAR" flag left over from its own RED2 is cancelled
                    buy.bar_pending = False
            elif not self._rear_ancestor_terminated(buy):
                # Two candidate outcomes, checked in a fixed priority
                # order: whichever structure "occurred earlier" wins
                # whenever BOTH conditions are satisfied the same candle.
                #
                # (1) Reactivating the EXISTING dormant ancestor (REAR
                # RE-ENTER if it exists, else REAR) in place, under its
                # OWN identity, using its OWN reference (target.ref_high).
                # This ancestor has existed since BEFORE this BAR cycle
                # ever started, so it takes priority whenever ITS OWN
                # threshold clears (21/06/2022 -- confirmed: REAR
                # RE-ENTER(A)'s own reference (451, frozen since 04-06/06)
                # AND this BAR's own Event028 reference (also 451 that
                # exact day, by coincidence of the underlying price
                # history) cleared together -- REAR RE-ENTER, having
                # started first, wins and reactivates in place; it must
                # NOT be wiped out by a fresh REAR that happens to also
                # qualify the same day).
                #
                # (2) Only if (1) doesn't apply (the ancestor's own
                # reference has NOT cleared): a fresh "REAR(n)", using
                # ONLY this BAR's own Event028 reference (sl.invalid_hh_ref)
                # -- covers both the very first REAR for this buy, and a
                # later BAR generation recovering while its ancestor
                # remains dormant but un-cleared (04/07/2022 -- confirmed:
                # BAR-second's own reference (457) cleared, but REAR
                # RE-ENTER(A)'s own separate, higher reference (458.95,
                # re-established after the 21/06 reactivation) had not --
                # REAR RE-ENTER cannot occur that day, only the fresh REAR,
                # under a new identity, "a further lineage of REAR
                # RE-ENTER(A)").
                #
                # Blocked entirely (see _rear_ancestor_terminated) once
                # the ancestor has already failed at its own SL (26/04/2022).
                target = buy.rear_reenter if buy.rear_reenter is not None else buy.rear
                reactivation_available = target is not None and target.dormant and target.sl is None
                ancestor_reactivates = False
                if reactivation_available:
                    # Use the ancestor's reference AS OF THE START OF TODAY
                    # (before today's own dormant HH tracking, evaluated
                    # earlier this same candle in _eval_buy, could have
                    # already bumped target.ref_high to today's own High --
                    # see the comment at that snapshot's capture site).
                    ancestor_ref = pre_today_ancestor_ref if pre_today_ancestor_ref is not None else target.ref_high
                    ancestor_reactivates = (cur.l >= prev.l and cur.h > ancestor_ref and
                                             (cur.h - ancestor_ref) >= THRESH - EPS and cur.c >= ancestor_ref)
                if ancestor_reactivates and not self._milestone_blocked(pc):
                    reactivation_winner = (target, cur.h, cur.l)
                    break  # first lineage to trigger reactivation this candle wins

                rear_ref = sl.invalid_hh_ref
                is_rear = (cur.l >= prev.l and cur.h > rear_ref and
                           (cur.h - rear_ref) >= THRESH - EPS and cur.c >= rear_ref)
                if is_rear and not self._milestone_blocked(pc):
                    rear_winner = (lin, cur.h, cur.l)
                    break  # first lineage to hit SL2/REAR this candle wins
                if cur.h > rear_ref:
                    # covers both a genuine partial breakout AND a full
                    # REAR-qualifying breakout that's blocked from actually
                    # forming (14/03 -- REAR(A) doesn't get to "happen and
                    # immediately fail"; it stays queued, still tracking
                    # upward, until it's either unblocked or wins a same-day
                    # tie against whichever branch was blocking it)
                    sl.invalid_hh_ref = cur.h
                    ev.append(f"INVALID BAR HH({lin.label})")

        if sl2_confirmed_today:
            # A BAR SL2 confirming is decisive, same as a fresh TZ BUY/BAR/
            # REAR milestone collaterally terminating another branch in the
            # leadership contest: any OTHER lineage still sitting in open
            # (pre-SL2) BAR SL -- whether that SL formed earlier or on this
            # very same candle -- terminates outright, and its ENTIRE
            # today's contribution is wiped, exactly like a collaterally
            # terminated branch's whole day gets wiped, not just future
            # days blocked. A lineage still pre-SL (sl is None) or already
            # past its own SL2 (still racing toward REAR via INVALID BAR
            # HH) is unaffected.
            for label, lin_obj in lineage_objs.items():
                if lin_obj.sl is not None and not lin_obj.sl.sl2:
                    per_lineage_ev[label] = []
            buy.bar_lineages = [l for l in buy.bar_lineages if l.sl is None or l.sl.sl2]

        ev = []
        for lin_ev in per_lineage_ev.values():
            ev += lin_ev

        if reactivation_winner is not None:
            # reactivates the EXISTING ancestor object IN PLACE, under its
            # own identity -- same field-reset discipline as every other
            # reactivation in this file (rulebook 4/12a): sl already None
            # (precondition), ref_high/ref_low/red1_since/dormant/red2_ever
            # all explicitly reset -- a genuinely fresh cycle in every
            # respect except identity. ref_high_at_red1 left alone: only
            # read while red1_since is True, which is False here, and gets
            # freshly overwritten the instant a new RED1 next attaches.
            target, rh, rl = reactivation_winner
            event_label = "REAR RE-ENTER" if target is buy.rear_reenter else "REAR"
            ev.append(f"{event_label}({label_id})")
            target.ref_high = rh
            target.ref_low = rl
            target.red1_since = False
            target.dormant = False
            target.red2_ever = False
            buy.bar_lineages = []  # this buy's leadership returns fully to the reactivated ancestor
            buy.bar_sub_counter = 0
            return ev

        if rear_winner is not None:
            lin, rh, rl = rear_winner
            ev.append(f"REAR({label_id})")
            buy.rear_reenter = None  # single-slot: newest REAR-family formation wipes any older dormant one
            buy.rear = Rear(ref_high=rh, ref_low=rl)
            buy.bar_lineages = []  # every lineage -- ancestor or descendant -- terminates
            buy.bar_sub_counter = 0
            return ev

        # mechanism 1: RED2 already fired against some (still sl=None)
        # lineage -- a fresh BAR is awaited via the general breakout shape
        # (Low>=PrevLow, High>PrevHigh, gap>=0.20, Close>=PrevHigh),
        # independent of any lineage's SL range. Now that RED2 no longer
        # wipes buy.bar_lineages, this must be checked here (not only in
        # _check_bar_pending, which only ever runs while bar_lineages is
        # still completely empty -- i.e. only for the very first BAR).
        # Gated on NOT reactivated_this_candle: only one BAR can exist or
        # form per candle, so this leftover flag must not also fire a
        # separate BAR(n+1) the same day a different lineage just
        # reactivated -- it stays pending, waiting for a later candle.
        if not reactivated_this_candle and buy.active and buy.bar_pending and self._bar_entry_shape(prev, cur):
            # A fresh, independent BAR(n+1) supersedes/terminates whichever
            # lineage RED2 fired from (still pre-SL, sl=None -- it never
            # reached its own SL/SL2 so there's no ongoing race to keep it
            # alive for) AND any lineage left dormant/invalidated (already
            # superseded once, now superseded again). A lineage still
            # genuinely racing toward its own SL2 (sl is not None, not
            # invalidated) is unaffected and keeps racing independently.
            buy.bar_lineages = [l for l in buy.bar_lineages
                                 if l.sl is not None and not l.sl.invalidated]
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

        # RED1/RED2 attachment for whichever lineage is currently pre-SL is
        # now handled inside the main per-lineage loop above (it has to run
        # before that lineage's own BAR SL check, not after -- see 18/04
        # fix). A lineage freshly created by mechanism 1/2 this same candle
        # can never also carry a same-day RED1 (mechanism 1/2 both require
        # Current High > Previous Day High; RED1 requires Current High <=
        # Previous Day High -- mutually exclusive), so there's nothing left
        # to do here.
        return ev

    # =================== REAR family ===================
    def _eval_rear_hh_ll(self, pc, buy: Buy, rear: Rear, prev: Day, cur: Day):
        ev = []
        # The weak AFTER-RED1 rule only makes sense for a LIVE structure --
        # it exists to filter a shallow bounce from a genuine breakout for
        # something currently being evaluated for real trading decisions.
        # Once dormant (superseded), REAR is a backend-only tracker; its
        # anchor (ref_high_at_red1) is frozen from BEFORE it went dormant
        # and has nothing to do with what's happening now under whichever
        # BAR generation is currently racing. Gating on `dormant` too makes
        # the simple "any higher high >= 0.01" rule apply throughout the
        # dormant window, same as before RED1 ever attached (16/04/2025 --
        # confirmed: cur.h=251 genuinely reached that day, but the weak
        # rule's stale 237 anchor silently blocked the update since none
        # of its three conditions happened to hold that exact candle --
        # the fix is here, in REAR's OWN tracking, not by borrowing a
        # cross-generation pooled value from a sibling BAR lineage).
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
        # only ever called with rear.sl is None -- the caller routes to
        # _eval_rear_sl_progress directly, unconditionally, once rear.sl
        # exists (see _eval_buy)
        ev = []
        if (cur.l < rear.ref_low and (rear.ref_low - cur.l) >= THRESH - EPS and cur.c <= rear.ref_low + EPS):
            ev.append(f"REAR SL({branch_label(pc.id)})")
            rear.sl = RearSL(ref_low=cur.l, invalid_hh_ref=rear.ref_high)
            buy.bar_lineages = []  # REAR SL terminates the whole BAR-family remnant for this generation
            buy.bar_sub_counter = 0
            buy.red1 = None  # discard any in-flight RED1 -- REAR no longer an active parent
            # once REAR has its OWN SL, Event031's own rules govern
            # completely -- BAR(n) is not in REAR SL's allowed next
            # events, so a fresh BAR reformation via bar_pending must not
            # happen anymore
            buy.bar_pending = False
            return ev
        red1_preexisting = buy.red1 is not None and buy.red1.active
        if red1_preexisting:
            ev += self._eval_red1_generic(pc, buy, rear, prev, cur)
        elif not rear.red2_ever:
            ev += self._attach_fresh_red1(pc, buy, rear, prev, cur)
        return ev

    def _eval_rear_sl_progress(self, pc, buy, rear: Rear, sl: RearSL, prev: Day, cur: Day):
        ev = []
        label_id = branch_label(pc.id)
        is_reenter = (cur.l >= prev.l and cur.h > sl.invalid_hh_ref and
                      (cur.h - sl.invalid_hh_ref) >= THRESH - EPS and cur.c >= sl.invalid_hh_ref)
        if is_reenter and not self._milestone_blocked(pc):
            buy.rear_reenter = RearReenter(ref_high=cur.h, ref_low=cur.l)
            ev.append(f"REAR RE-ENTER({label_id})")
            rear.dormant = True  # this REAR is now permanently retired for this lineage
            return ev
        if cur.h > sl.invalid_hh_ref:
            sl.invalid_hh_ref = cur.h
            ev.append(f"INVALID REAR HH({label_id})")
        # no RED1 here
        return ev

    # =================== REAR RE-ENTER family ===================
    def _eval_rear_reenter_hh_ll(self, pc, buy: Buy, rre: RearReenter, prev: Day, cur: Day):
        ev = []
        # same principle as _eval_rear_hh_ll above -- the weak AFTER-RED1
        # rule doesn't apply while dormant, since its anchor is frozen from
        # before dormancy and has nothing to do with the current market
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
        # only ever called with rre.sl is None -- the caller routes to
        # _eval_rear_reenter_sl_progress directly, unconditionally, once
        # rre.sl exists (see _eval_buy)
        ev = []
        if (cur.l < rre.ref_low and (rre.ref_low - cur.l) >= THRESH - EPS and cur.c <= rre.ref_low + EPS):
            ev.append(f"REAR RE-ENTER SL({branch_label(pc.id)})")
            rre.sl = RearReenterSL(ref_low=cur.l, invalid_hh_ref=rre.ref_high)
            buy.red1 = None  # discard any in-flight RED1 -- REAR RE-ENTER no longer an active parent
            # same as REAR SL -- a fresh BAR reformation via bar_pending is
            # no longer a valid path once REAR RE-ENTER has its own SL
            buy.bar_pending = False
            return ev
        red1_preexisting = buy.red1 is not None and buy.red1.active
        if red1_preexisting:
            ev += self._eval_red1_generic(pc, buy, rre, prev, cur)
        elif not rre.red2_ever:
            ev += self._attach_fresh_red1(pc, buy, rre, prev, cur)
        return ev

    def _eval_rear_reenter_sl_progress(self, pc, buy, rre: RearReenter, sl: RearReenterSL, prev: Day, cur: Day):
        ev = []
        label_id = branch_label(pc.id)
        is_reenter_again = (cur.l >= prev.l and cur.h > sl.invalid_hh_ref and
                             (cur.h - sl.invalid_hh_ref) >= THRESH - EPS and cur.c >= sl.invalid_hh_ref)
        if is_reenter_again and not self._milestone_blocked(pc):
            ev.append(f"REAR RE-ENTER({label_id})")
            rre.sl = None
            rre.ref_high = cur.h
            rre.ref_low = cur.l
            rre.red1_since = False
            # a stale .dormant from this SAME rre's own earlier RED2 must
            # not linger past reactivation -- the routing in _eval_buy no
            # longer depends on this once sl is None again, but leaving it
            # True here would be a live landmine for any future code that
            # checks .dormant directly, so it's reset explicitly for
            # correctness/clarity rather than relying on sl-state alone
            rre.dormant = False
            # this reactivation is a genuinely fresh cycle in every respect
            # except the label, same principle as BarLineage reactivation
            # (rulebook 4/12a) -- a red2_ever baked in from this SAME
            # object's PRE-reactivation life must not permanently block a
            # fresh RED1 from ever attaching to it again.
            rre.red2_ever = False
            return ev
        if cur.h > sl.invalid_hh_ref:
            sl.invalid_hh_ref = cur.h
            ev.append(f"INVALID REAR RE-ENTER HH({label_id})")
        # no RED1 here -- deepest terminal leaf
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
