# TZ BUY — the TZ ENGINE state machine

**Naming note:** this theory is called **TZ BUY**. Earlier drafts of this
file called it "WTF" or "the BAR 2 variant" — those names are retired; the
logic itself hasn't changed identity, just its name. The code file is
still `tz_engine_wtf.py` (not yet renamed).

**Time frames:** TZ BUY is the SAME theory/engine regardless of candle
period — DTF (Daily Time Frame), WTF (Weekly Time Frame), MTF (Monthly
Time Frame), YTF (Yearly Time Frame) are not different theories, just
different granularities of the same rules applied to the corresponding
day/week/month/year candles. "WTF" showing up in this file's own name is
a historical leftover from when it was first built against weekly data,
not a claim that this theory is weekly-only. Given a series of OHLC
candles at any of these periods, TZ BUY produces the complete, ongoing
history of every event that occurred on that period's own cadence
(day-to-day for DTF, week-to-week for WTF, and so on) — the engine itself
(`TZEngine.process`) has no period-specific logic; it simply consumes
whatever `Day` records it's given.

**Cross-time-frame follow-up actions (specification only, NOT
implemented):** a separate, not-yet-built layer maps a milestone reached
on a HIGHER time frame (e.g. WTF) to which SETUP to watch for on a LOWER
time frame (e.g. DTF) as the actual trade-entry trigger. User's exact
mapping given so far:

| WTF (higher time frame) event | DTF (lower time frame) follow-up action |
|---|---|
| TZ BUY 2 / REAR 2 / REAR RE-ENTER 2 | TZ BUY → TZ BUY ENTRY |
| BAR | TZ BUY → TZ BUY ENTRY, OR BAR → BAR ENTRY (disambiguated below) |

This is the same thing the code's "Open items" section below calls the
`extra_reentry_floor` cross-theory hook / "DTF-with-respect-to-TZ-BUY
work" — not started (no DTF code exists yet; TZ BUY only runs on whatever
single time frame's candles it's given, per the "Time frames" note
above). The table alone isn't a complete spec, but the BAR row's "OR" is
now disambiguated, per the user's exact confirmation:

**Disambiguating the BAR row**: the choice is decided entirely by
whether a BAR has EVER already formed for this specific TZ BUY's own
lineage, checked at the moment TZ BUY SL / TZ BUY 2 SL fires on the WTF
chart -- exactly the same `has_deeper_active`/`no_bar_yet` check the base
engine already uses everywhere else (`bool(buy.bar_lineages) or
buy.bar_pending or buy.rear is not None or buy.rear_reenter is not
None`), no new mechanism needed:

- **A BAR (through BAR 2) has ALREADY formed once for this lineage**,
  at any point before or up to the same day as TZ BUY SL / TZ BUY 2 SL
  (worked example: `TZ BUY → TZ BUY 2 → RED1 → RED2 → BAR → BAR 2 → BAR
  SL → TZ BUY 2 SL`) -- once that RED1→RED2→BAR→BAR 2 escalation has
  already completed for this buy, a fresh "BAR → BAR ENTRY" follow-up
  can NEVER occur again below that TZ BUY / TZ BUY 2 SL. The DTF
  follow-up is **TZ BUY → TZ BUY ENTRY** instead.
- **No BAR has formed yet for this lineage** by the time TZ BUY SL /
  TZ BUY 2 SL fires -- RED1→RED2→BAR never happened, either before or
  after the original TZ BUY/TZ BUY 2 formation. In that case the DTF
  follow-up CAN be **BAR → BAR ENTRY**, since this would be that
  lineage's first, still-available BAR occurrence.

Reactivation (TZ BUY's own SL recovering in place, per the base engine's
already-confirmed rule) is unaffected by any of this -- it's the same
mechanism either way, just decides which DTF setup to point at once WTF
reactivates.

**What "TZ BUY ENTRY" / "BAR ENTRY" require on the DTF chart itself**
(user's exact confirmation, resolving the question above): neither is a
new mechanism -- both are just DTF's own copy of the SAME TZ BUY engine
(run on daily candles) reaching an already-fully-coded tier. "DTF work"
is not a new theory or new rules; it's the identical `TZEngine` run on a
different (daily) OHLC series, with the cross-time-frame layer above only
deciding WHICH of its tiers to treat as the actionable follow-up signal.

- **TZ BUY ENTRY** = DTF's own `"TZ BUY("` event. Requires DTF's own TZ
  BUY to be ACTIVE -- a fresh first formation, OR a reactivation in
  place after DTF's own TZ BUY SL ("TZ BUY ENTRY SL") once DTF price
  breaks back above the reactivation reference high. This is *exactly*
  TZ BUY's own existing SL/reactivation rule (`buy.reentry_threshold`,
  "whichever is higher") -- nothing new, just DTF's own instance of it.

- **BAR ENTRY** = DTF's own tier immediately following DTF's own `"BAR("`
  formation -- mechanically identical to BAR 2 (an independent SL/
  recovery cycle of its own, `"BAR ENTRY SL"`), with DTF's own top-level
  BAR SL staying DECISIVE over it exactly like the base engine's BAR/BAR
  2: once BAR's own SL fires, it wipes BAR ENTRY, and a fresh BAR can
  only reform above "whichever is higher" between BAR's own reference
  high and BAR ENTRY's own reference high (`_current_top_ref`, same
  principle already used everywhere else in this file). Worked example
  given: `RED1 → RED2 → BAR → BAR ENTRY → BAR ENTRY SL → BAR SL → BAR
  (above BAR ENTRY's own ref high) → BAR ENTRY`.
  - Gate: DTF's own RED1 → RED2 → BAR → BAR ENTRY sequence is only
    available for a given lineage if that SAME RED1→RED2→BAR→BAR 2
    escalation hasn't ALREADY completed once for it -- the identical
    disambiguation condition as the cross-time-frame table above, just
    applied to DTF's own local state instead of WTF's.
  - Ordering: BAR → BAR ENTRY can occur either BEFORE TZ BUY → TZ BUY
    ENTRY forms at all, or AFTER TZ BUY / TZ BUY ENTRY's own SL fires --
    as long as no earlier BAR → BAR 2/BAR ENTRY has already happened for
    that lineage. There's no fixed required order between the two
    tracks, only the "hasn't already happened" gate.

So the only genuinely new piece needed for DTF work is the cross-time-
frame disambiguation logic itself (which WTF milestone points at which
DTF tier) -- the DTF-side mechanics (TZ BUY's own SL/reactivation, BAR/
BAR 2's own SL/reactivation) are the exact same rules already coded and
tested in `TZEngine`, just needing to run a second instance against
daily candles alongside the weekly one.

**Status:** verified against real weekly OHLC (KALYANKJIL.NS, 2021-03-28
through 2026-09-15) — reproduces that dataset's own Event column exactly.
That run also exposed a real bug (engine going silent for 84 weeks after a
BAR SL with no BAR 2), fixed as described below. All rules below reflect
the corrected, final design after an exhaustive one-topic-at-a-time
walkthrough of every event in the theory.

## The flow

```
TZ GREEN → RED → TZ BUY (above TZ GREEN's own ref) →
TZ BUY 2 (above TZ BUY's own ref) →
RED1 → RED2 (vs TZ BUY -- NOT reachable until TZ BUY 2 is ACTIVE) →
BAR(1) → BAR 2(1) → RED1 → RED2 → BAR(2) → BAR 2(2) → ... (unlimited) →
BAR SL → BAR SL2 (only reachable once BAR 2 has formed for THAT lineage) →
REAR → REAR 2 → RED1 → RED2 → BAR(1) (fresh cascade, REAR 2's dual role) →
REAR SL → REAR RE-ENTER (ALWAYS -- never a dead end) →
REAR RE-ENTER 2 → RED1 → RED2 → BAR(1) (fresh cascade) →
REAR RE-ENTER SL → REAR RE-ENTER (self-recovers, same text)
```

## The core organizing principle: two families of tiers

Every tier in this hierarchy falls into exactly one of two families, and
this single distinction resolves almost every rule below.

**Family 1 -- "escalating gate" tiers: TZ BUY, TZ BUY 2, REAR, REAR 2,
REAR RE-ENTER, REAR RE-ENTER 2.** Every one of these:
- Is **never a dead end** at its own SL, regardless of whether its own "2"
  (or, for REAR/REAR RE-ENTER, whether REAR 2/REAR RE-ENTER 2) ever formed.
- On its own SL, is **decisive**: wipes out EVERYTHING structurally below
  it (its own "2", the whole BAR family, RED1 in flight) and requires that
  everything reform from scratch before RED1/RED2 can attach again.
- Reactivates/self-recovers **above "whichever occurred last"** -- the
  current reference of the most structurally advanced tier this buy had
  reached at the moment the SL fired -- not just its own frozen peak.

**Family 2 -- "one-shot" tiers: BAR, BAR 2.** These are the exception:
- BAR's own SL, **with no BAR 2 ever having formed for that lineage**, is a
  genuine **permanent dead end** for that specific lineage -- no INVALID
  BAR SL, no BAR SL HH/LL, no BAR SL2, ever, for it.
- BAR's own SL, **with BAR 2 having formed**, can reactivate in place
  under the same label (INVALID BAR SL), or continue toward BAR SL2.
- BAR 2 itself never needs to "recover" or reform once frozen at its own
  SL -- it has done its job (gated RED1/RED2 and BAR SL2 eligibility for
  that lineage already); it just keeps quietly climbing as INVALID BAR HH.
- Regardless of any of the above, **a brand-new BAR(n+1) can always start
  elsewhere in the same buy** the moment the current newest lineage is no
  longer pre-SL -- see "Fresh BAR formation" below.

## "Whichever is higher" -- the reactivation threshold

Implemented as `Engine._current_top_ref(buy)`. Whenever a Family-1 tier's
own SL fires (or REAR RE-ENTER self-recovers), the reactivation/re-entry
threshold is NOT just that tier's own frozen reference -- it's the
**maximum** of every tier's current reference across the whole chain
(TZ BUY's own ref, TZ BUY 2's ref, every BAR lineage's ref and its own BAR
2 ref, REAR's ref and REAR 2's ref, REAR RE-ENTER's ref and REAR RE-ENTER
2's ref -- whichever of these currently hold state), snapshotted BEFORE
the wipe.

**Correction from an earlier draft**: this method originally deferred
UNCONDITIONALLY to the deepest/most-recently-formed tier (e.g. always
BAR 2's ref over TZ BUY 2's own ref, on the theory that "structurally most
recent" always wins). That was wrong. A shallower tier's own reference can
climb HIGHER than what forms beneath it -- only TZ BUY 2 has an explicit
HH-mute rule, and even that only suppresses the DISPLAY text, never the
underlying value, which keeps climbing on every new high regardless of
mute state. The user gave an explicit worked example forcing the
distinction: REAR 2 reforming after its own SL (with a BAR/BAR 2 cascade
racing underneath it) must use "REAR 2's own ref high OR BAR 2's ref high,
WHICHEVER IS HIGHER" -- an explicit max, not a hand-off. `test_wtf_smoke.py`
now has both directions covered: Test 8 (the deeper tier, BAR 2 at 101, is
LOWER than the shallower TZ BUY 2's own peak of 104 -- 104 wins) and Test
13 (the shallower tier, REAR 2 at 107, is HIGHER than the deeper BAR 2's
100 -- REAR 2's own ref wins). Whichever is actually higher governs, full
stop -- there is no structural precedence.

## Rules, tier by tier

**TZ BUY 2** forms off TZ BUY's own reference high, only while TZ BUY is
pre-SL. Gates RED1/RED2 attaching to TZ BUY: RED1 cannot attach unless TZ
BUY 2 is currently **ACTIVE** (not merely "has existed once" -- its own SL
closes this gate again, requiring TZ BUY 2 to reform before RED1/RED2 can
reattach; mirrors the REAR 2/REAR RE-ENTER 2 gates below). Is its own
leadership-contest milestone (`MILESTONE_KEYS` includes `"TZ BUY 2("`) --
a deliberate asymmetry; BAR 2/REAR 2/REAR RE-ENTER 2 are not milestones.
Its own HH display is muted only once some deeper tier's actual reference
(any BAR/BAR 2, REAR/REAR 2/REAR RE-ENTER/REAR RE-ENTER 2) reaches or
exceeds it -- a live comparison, not a mere existence check, since TZ BUY
2 isn't guaranteed lower than what eventually forms below it.

**TZ BUY 2's own SL** (Family 1): decisive -- wipes the whole BAR family,
REAR/REAR RE-ENTER, and RED1 in flight, same as TZ BUY's own SL. Recovers
under the same `"TZ BUY 2(label)"` text, above "whichever occurred last".
**Also opens spawn eligibility for a fresh sibling TZ GREEN(n+1)**, exactly
like TZ BUY's own top-level SL -- an explicit rule-reversal addition
(TZ BUY 2's own SL was originally NOT a spawn trigger; the user later
added it back explicitly), even while TZ BUY itself stays active. Lifts
the moment TZ BUY 2 recovers (a live check on `sl_active`, not a
historical flag).

**TZ BUY's own SL** (Family 1): decisive, self-recovers, IN PLACE (same
object, same `"TZ BUY(label)"` text -- there is no "NEW TZ BUY"). Opens
spawn eligibility for TZ GREEN(n+1) (this was always true, unlike TZ BUY
2's SL which needed the explicit addition above).

**BAR / BAR 2** (Family 2, multi-lineage): multiple lineages can coexist
and race in parallel -- an older lineage that's already post-SL, already
has its own BAR 2, and hasn't shown INVALID BAR SL yet is **never
terminated** just because a fresh independent BAR(n+1) forms elsewhere; it
keeps racing toward its own SL2 (a single candle can trigger one lineage's
SL2 while another's own SL is still open -- this is exactly why INVALID
BAR SL matters as a distinct state). Only the NEWEST lineage participates
in RED1/RED2 (single shared `buy.red1`). BAR 2 gates RED1/RED2 attaching
to a lineage, and gates whether that lineage's own SL can ever reach SL2 at
all.

**Fresh BAR formation** -- two independent, non-exclusive triggers:
1. The original mechanism: `buy.bar_pending` (a fresh RED2 fired) plus a
   qualifying breakout shape.
2. **Added this pass, real-data-motivated**: whenever the current newest
   lineage is no longer pre-SL (dead-ended or otherwise) but has **not**
   yet reached its own SL2, a qualifying breakout ALONE forms a fresh BAR
   immediately -- **no RED1/RED2 needed**. Without this, a BAR SL firing
   with no BAR 2 ever having formed left `bar_pending` permanently
   unset-able (nothing could ever trigger a fresh RED2 again), which
   produced a genuine bug against real data: an engine run went completely
   silent for 84 weeks after exactly this happened (KALYANKJIL.NS, BAR SL
   fired 2025-02-23 with no BAR 2, zero further events through
   2026-09-06). Confirmed by the user: "CAN A NEW BAR OCCUR after BAR SL:
   YES... In this case NO NEED TO HAVE A RED 1 - RED 2."
   **Corrected again this pass** (a second real-data bug, BBOX.NS): this
   trigger must NOT fire once the newest lineage has already reached its
   own SL2 -- at that point the only three valid outcomes are TZ BUY's
   own SL, REAR (this lineage's own breakout above its BAR 2's reference),
   or a fresh sibling TZ GREEN(n+1). The original condition
   (`newest.sl is not None`) didn't check `sl.sl2`, so a merely generic
   breakout could let an unrelated BAR(n+1) jump in ahead of REAR. Fixed
   by excluding `newest.sl.sl2` from the "dead" check. Impact on
   BBOX.NS was severe: a single wrong `BAR(A.4)` at 2006-06-18 kept that
   dead branch alive for the rest of the dataset (through 2023),
   suppressing the correct `TZ GREEN(B)`/`(C)` progression the whole time.

**BAR sub-label reuse**: a dead lineage's numeric sub-label (e.g. the `1`
in `"A.1"`) is freed for reuse ONLY if it was a **complete dead end** (its
own SL fired with no BAR 2 ever having formed). A lineage that DID get its
own BAR 2 and only later lost out to a newer generation keeps its number
retired permanently -- the counter just keeps incrementing past it. This
is a different rule from branch-level label reuse (below), which is
unconditional.

**Branch-level label reuse** (unrelated rule, unconditional): any
terminated branch frees its integer ID for reuse via `lowest_free_id()` --
no BAR-2-style qualification. Already correctly implemented via the base
engine's own branch-management machinery; needed no new code.

**REAR / REAR 2**: REAR forms off a BAR's own SL2 (never a reactivation of
some old dormant ancestor -- always fresh, off that BAR's own reference).
REAR 2 mirrors BAR 2's shape one level up, but is Family 1, not Family 2:
REAR 2's own SL is decisive -- wipes RED1/bar_lineages/bar_pending below
it, requires REAR 2 to reform (same label, above its own ref) before
RED1/RED2 can attach to REAR again.

**REAR's own SL** (Family 1, corrected this pass from an earlier,
wrong Family-2 assumption): **never a dead end**, regardless of whether
REAR 2 ever formed -- always leads to REAR RE-ENTER above "whichever
occurred last". Mirrors TZ BUY's pattern, not BAR's. Worked example from
the user: `REAR - REAR SL - REAR (REAR RE-ENTER ABOVE THE REAR REF. HIGH)`.

**REAR RE-ENTER / REAR RE-ENTER 2**: exact structural mirrors, one level
deeper. REAR RE-ENTER 2's own SL is decisive (wipes what it unlocked, same
as REAR 2). REAR RE-ENTER's own SL self-recovers under the same event
text, above "whichever occurred last", never a dead end regardless of
whether REAR RE-ENTER 2 ever formed -- terminal (no further escalation
beyond this).

## Multi-branch / spawn eligibility / leadership

Spawn eligibility for a fresh sibling TZ GREEN(n+1) opens on TZ BUY's own
top-level SL, TZ BUY 2's own SL, REAR 2's own SL, or REAR RE-ENTER 2's own
SL (all but the first are explicit additions/reversals -- see above).
Leadership contest, dormancy, and
reference inheritance across sibling branches needed **no new code** --
already correctly handled by the base engine's existing
`_milestone_blocked` / dormancy / `lowest_free_id` machinery; only the
new milestone classification (`"TZ BUY 2("`) and the new spawn triggers
needed adding.

A newer branch's own TZ BUY 2 forming can retroactively record a higher
reference for an older, now-dormant sibling's own TZ BUY 2 (single-leader
reference-inheritance rule, already generic in the base engine). Two
sibling branches reaching a milestone (e.g. both TZ BUY 2) on the exact
same day is resolved by the existing seq-ordering / collateral-termination
rules -- no special-casing needed for TZ BUY 2 specifically.

## Testing

`test_wtf_smoke.py` -- 19 synthetic scenarios (`python3 test_wtf_smoke.py`):

1. Full escalation TZ BUY → TZ BUY 2 → RED1 → RED2 → BAR(A.1).
2. TZ BUY SL with no TZ BUY 2 ever formed → reactivates in place off the
   dead buy's own raw peak.
3. TZ BUY SL after TZ BUY 2 existed → reactivates off TZ BUY 2's ref; a
   companion run confirms a candle clearing only the old peak does not.
4. `"TZ BUY 2("` is its own milestone; BAR 2/REAR 2 are not.
5. TZ BUY 2's own HH muted once a BAR generation's reference catches up.
6. **BAR SL with no BAR 2 → fresh BAR reuses the freed label, no
   RED1/RED2 needed** (the real-data bug fix).
7. Multi-generation BAR racing: an older, post-SL, BAR-2'd lineage
   survives a fresh independent BAR forming elsewhere, both tick forward
   on the same days, and the older one eventually wins its own SL2 and
   forms REAR off its own BAR 2 reference. Also exercises the exact edge
   case the user flagged directly ("a single candle can trigger BAR(3) SL
   + BAR(2) SL2"): the newer lineage's own SL coinciding with the older
   one's SL2 on the same candle -- only the SL2 event shows.
8 (a/b). TZ BUY's own SL, firing after BAR 2 has formed, reactivates above
   the MAXIMUM of every tier's own reference -- here TZ BUY 2's own peak
   (104) is higher than BAR 2's ref (101), so 104 wins; clearing only 101
   does not reactivate (8a), clearing 104 does (8b).
9. TZ BUY 2's own SL wipes the BAR family (even with BAR 2 already formed)
   and opens spawn eligibility for a fresh sibling TZ GREEN(n+1), while TZ
   BUY itself stays active throughout.
10. REAR's own SL (no REAR 2 ever formed) leads straight to REAR RE-ENTER
    -- never a dead end; REAR RE-ENTER's own SL (no REAR RE-ENTER 2
    either) self-recovers under the same event text -- also never a dead
    end. Both mirror TZ BUY's pattern, not BAR's Family-2 dead-end
    pattern.
11 / 12. REAR 2's own SL, and REAR RE-ENTER 2's own SL, wipe RED1/
    bar_pending, close the RED1 gate on REAR/REAR RE-ENTER until they
    reform, and recover under the same event text -- mirroring TZ BUY 2's
    own SL one/two tiers down. Triggered BEFORE their own "fresh cascade"
    BAR confirms, ahead of the fix below.
13 (/ 13b). REAR 2's own SL fires AFTER its own fresh-cascade BAR/BAR 2
    has already formed (`BAR 2 SL(A.1)` + `REAR 2 SL(A)` together on the
    same candle, exactly the scenario the user gave) -- proving the
    dormancy bug (below) is fixed -- and reforms above `max(REAR 2's own
    ref, BAR 2's ref)`, with REAR 2's own (higher) reference winning this
    time, the opposite of Test 8. 13b confirms this also opens spawn
    eligibility for a fresh sibling TZ GREEN(n+1).
14 (/ 14b). Same as 13/13b, one tier deeper: REAR RE-ENTER 2's own SL
    fires AFTER its own fresh-cascade BAR/BAR 2 has formed (`BAR 2
    SL(A.1)` + `REAR RE-ENTER 2 SL(A)` together), reforms above
    `max(REAR RE-ENTER 2's own ref, BAR 2's ref)`, and also opens spawn
    eligibility for a fresh sibling TZ GREEN(n+1).
15. Bug fix found against real data (BBOX.NS): once a BAR lineage reaches
    its own SL2, the fresh-BAR-without-RED1/RED2 mechanism (Test 6) must
    NOT let an unrelated new BAR jump in on a merely generic breakout --
    only TZ BUY's own SL, REAR, or a fresh sibling TZ GREEN(n+1) may
    follow. Impact was severe: a single wrong `BAR(A.4)` kept a dead
    branch alive for 17 years of the BBOX.NS dataset, suppressing the
    correct branch progression the whole time.
16. A second bug fix found against real data (BBOX.NS): a long-dormant
    branch's own TZ BUY reactivating must never terminate a newer
    sibling's currently-live, ongoing buy -- it must stay completely
    hidden until that sibling's own cycle fails, not merely "jump in."
    See the dedicated section below.

## A long-dormant branch reactivating must never override a live sibling

Two related corrections, both found against real data (BBOX.NS) in the
same investigation:

**1. The reactivation threshold must track the current leader, only ever
upward.** Whenever exactly one branch is the sole non-dormant leader,
every OTHER (dormant) branch's own frozen top-level reactivation
threshold (`Buy.reentry_threshold`, set once when ITS OWN TZ BUY SL
fired) is pulled up to at least match the leader's own current
`_current_top_ref` -- so a dormant branch's old, comparatively low
threshold can never trail far behind wherever the real leader has since
climbed to. Implemented alongside the base engine's existing (unchanged)
`pc.ref_high` propagation, in the same single-leader block in `process()`.
Only ever raises the threshold, never lowers it -- a dormant branch whose
own historical peak is ALREADY higher than the current leader's climb
keeps that higher number.

**2. A reactivation is a *continuation* milestone, not a fresh one, for
termination purposes.** This is the decisive fix. Even with (1) in place,
once price does clear a dormant branch's (possibly-raised) threshold, it
reactivates -- and the ORIGINAL milestone-resolution rule (inherited
unmodified from the base engine, predating TZ BUY 2 entirely) decides
whether that milestone event **dormants** every other branch with a lower
seq or **unconditionally terminates outright** every branch with a higher
seq, based on whether the event text starts with `"TZ BUY("` (`is_fresh_buy`).
Before this fix, EVERY `"TZ BUY("` event -- fresh formation or in-place
reactivation alike, since both use the identical text -- counted as
"fresh," meaning a long-dormant branch reactivating would unconditionally
**wipe out** a newer sibling's fully live, ongoing TZ BUY/TZ BUY 2 cycle,
rather than merely sitting behind it. Root cause: the "no NEW TZ BUY,
reactivate in place under the same text" rule (confirmed earlier in this
review) removed the only signal that used to distinguish "genuinely new"
from "just waking back up" for this OLDER, unrelated check.

Fixed by computing `is_fresh_buy` from whether `pc.buy` was `None`
immediately before this candle's own `_eval_parent` call, not from the
event text -- a genuine first-ever formation is still "fresh" (unconditional
termination of anything higher-seq, as before); an in-place reactivation
is now a *continuation* milestone, subject to the SAME exemption that
already protected e.g. `"TZ BUY 2("` events: a higher-seq sibling that
currently has a live buy is spared (goes dormant, not terminated), and
the reactivating branch's own event is fully suppressed (not even shown
as a milestone) for as long as it stays blocked this way -- it keeps
running internally in the background, exactly like a post-SL2 BAR lineage
already quietly climbs via INVALID BAR HH.

Confirmed by the user with a worked example: "TZ BUY A SL... TZ GREEN B -
TZ BUY 2 B occurs before TZ BUY A [reactivates]. Later[,] earlier
threshold of A breaks[,] than it should not shift to TZ BUY A... So in
case TZ BUY B SL triggers, technically TZ BUY A & TZ BUY B reactivation
price will be the same." Impact on BBOX.NS was severe: at 2012-08-19, a
branch dormant since 2011 reactivating on an old, un-revised threshold
was wiping out a fully live TZ BUY 2 cycle that had been running since
March 2012 -- deleting years of that cycle's future history in the
dataset. Test 16 covers this.

**Follow-up bug found and fixed (BBOX.NS, later pass): "hidden" was only
half-implemented -- the reactivation event TEXT was suppressed, but the
underlying STATE CHANGE was not.** Fix (2) above (an in-place reactivation
treated as a continuation milestone) correctly hid the *event*, but
`_eval_buy`'s own reactivation branch (`if not buy.active: ... if cur.h >
ref: buy.active = True; buy.ref_low = cur.l; ...`) ran unconditionally
regardless of whether the milestone got exempted afterward. Since (1)
above pulls the dormant sibling's `reentry_threshold` up to match the
live leader's climbing peak every single week, `cur.h > ref` becomes true
almost every time the leader makes ANY new high at all -- silently
flipping the hidden branch's `buy.active` to `True` and resetting its
`ref_low` to whatever THAT WEEK's low happened to be (an arbitrary value
with no relationship to the leader's own state). That mismatched pair --
a reference high pinned to the leader's current level, paired with a
reference low frozen at a random recent week -- let the hidden branch's
own SL condition fire completely disconnected from the live cycle. Real
trace: BBOX.NS showed `TZ BUY SL(A)` firing out of nowhere in March 2020
(the COVID crash week) even though sibling C's `TZ BUY 2` cycle was still
fully alive and had never failed -- A had silently "reactivated" in the
background back in February on a routine new high, using that week's low
(48.49) as its SL trigger, entirely unrelated to C's own much lower
reference (25.70).

Fixed by gating the reactivation itself (not just its display) on
`not self._milestone_blocked(pc)` -- the same "does some higher-seq
sibling currently have a live buy" check already used to decide whether a
BAR lineage's own REAR can form. While blocked, the hidden branch's own
`buy.active` and `ref_low` now stay completely untouched -- ONLY its
`reentry_threshold` keeps climbing via the existing propagation block, per
the user's own confirmed rule ("EVERY HIGHER HIGH... WILL KEEP ADDING").
This also answers the previously-open question above: once the live
leader's own cycle genuinely fails (`_milestone_blocked` no longer true),
the hidden branch becomes eligible again and reactivates cleanly straight
into whatever tier its `reentry_threshold` had caught up to -- confirmed
against real BBOX.NS data, where the fix changes a 2023 breakout from
wrongly starting a brand-new `TZ GREEN(F)` cycle (discarding a dormant
branch's already-built-up `TZ BUY 2` state) into correctly reactivating
directly into `TZ BUY(E)` at the escalated tier, exactly as rule (2)'s
"same object, same text" reactivation was always meant to work. Test 17
covers the core fix (hidden branch's own buy stays fully inert while a
sibling is live); verified end-to-end against both real datasets --
KALYANKJIL.NS unaffected (0 diffs), BBOX.NS corrected across the same
mechanism recurring repeatedly through its ~24-year history.

**Bug found and fixed this pass: REAR 2 / REAR RE-ENTER 2's own SL was
wrongly unreachable after their own fresh-cascade BAR formed.** Once that
BAR actually confirmed (`_check_bar_pending` firing under
`bar_confirms_today`), `_supersede_rear_for_new_bar` was unconditionally
marking REAR/REAR RE-ENTER (and their own "2") **dormant** -- at which
point `_eval_rear2`/`_eval_rre2` returned immediately
(`if rear2.dormant: return ev`) and never checked their own SL again for
as long as that BAR cascade raced. This directly contradicted the
`Rear.dormant`/`RearReenter.dormant` field's own documented intent
("suppresses HH display... not routing/re-attachment") and was caught by
the user via a worked example: `REAR - REAR 2 - RED1 - RED2 - BAR - BAR 2
- BAR 2 SL + REAR 2 SL - REAR SL` -- "this is possible," meaning REAR 2's
own SL must still fire even with a live BAR/BAR 2 underneath it. Root
cause: `_supersede_rear_for_new_bar` is only ever meaningfully needed to
retire a genuinely OLD, leftover ancestor -- never the CURRENT REAR/REAR
RE-ENTER whose own "2" just spawned this exact BAR as its own dual-role
cascade. Fixed by giving `_check_bar_pending` a `supersede_rear` flag,
defaulting True for the top-level call site (where it turns out to always
be a no-op in practice, since that site is unreachable while a live
non-dormant REAR/REAR RE-ENTER exists) and passed `False` explicitly from
the `bar_confirms_today` call site. Covered by Test 13/13b in
`test_wtf_smoke.py`, which reproduces the user's exact scenario (`BAR 2
SL(A.1) + REAR 2 SL(A)` firing together on the same candle) and confirms
REAR 2 reforms above `max(REAR 2's own ref, BAR 2's ref)`.

**Spawn eligibility, extended again**: per the same principle as TZ BUY
2's own SL, REAR 2's own SL and REAR RE-ENTER 2's own SL ALSO open spawn
eligibility for a fresh sibling TZ GREEN(n+1) ("Just like New TZ GREEN
cycle can start after TZ BUY 2 SL, similarly TZ GREEN cycle can start
after REAR 2 SL/REAR RE ENTER 2 SL as well" -- explicit user addition).
Implemented as `tip_rear2_sl`/`tip_rre2_sl` in `process()`, alongside the
existing `tip_tzbuy2_sl`. Test 13b confirms this for REAR 2's own SL.

## TZ BUY 2's own post-SL recovery bar must keep climbing on intervening highs

Bug found against real data (PAYTM.NS): once TZ BUY 2's own SL fires
(`b2.sl_active = True`), the code only ever checked new highs against the
STALE, frozen pre-SL peak (`b2.reentry_threshold`/`b2.ref_high` as they
stood at the moment the SL fired) -- there was no equivalent of `INVALID
BAR HH` for this specific state (`buy.active` still `True`, only TZ BUY
2's own tier SL'd). An intervening high that cleared that stale peak but
closed back below it (a failed recovery attempt) was silently ignored
instead of raising the bar -- which let a LATER, actually LOWER high
wrongly confirm "recovered" against a level price had already cleared and
abandoned weeks earlier.

Real trace (PAYTM.NS, branch A): TZ BUY 2 SL fired 2023-07-23, freezing
the recovery bar at 914.95 (2023-06-18's peak). 2023-08-20's high (938.65)
cleared 914.95 but closed at 899.20 (back below it) -- a failed recovery
attempt that the old code simply dropped. 2023-10-01's high (936.70) then
wrongly confirmed "TZ BUY 2(A)" recovering, against the STALE 914.95 --
even though it was actually 1.95 points BELOW the 938.65 the price had
already reached and abandoned six weeks earlier. 2023-10-08's high
(983.55) then also failed to close above 938.65, so the real recovery
bar should have climbed there too, before genuinely confirming on
2023-10-15 (high 998.30, close 987.65 -- clears 983.55 with a confirming
close). The user's exact correction: "After TZ BUY 2 SL, any HH above the
HH before the SL will be the new HH. You can notify it as INVALID TZ BUY
2 HH just like INVALID BAR HH. TZ BUY can reactivate only above this HH
and the reference high before the SL... any NEW HH after the TZ BUY 2 SL
will be the new reference high for both TZ BUY (in case TZ BUY SL also
occurs) and TZ BUY 2 in case only TZ BUY 2 SL."

Fixed by adding the missing `elif` branch in `_eval_tzbuy2`'s
`b2.sl_active` handling: any new high clearing the current bar by `ANY`
(0.01) without fully confirming recovery (needs the standard `THRESH`
gap AND a confirming close, same shape as every other recovery check in
this file) now emits `INVALID TZ BUY 2 HH(label)` and raises BOTH
`b2.ref_high` and `b2.reentry_threshold` to that new high -- mirroring
`INVALID BAR HH` exactly. Raising `b2.ref_high` (not just
`reentry_threshold`) is what satisfies the second half of the user's
rule for free: `_current_top_ref` reads `buy.tz_buy2.ref_high` live,
so if TZ BUY's own top-level SL fires later, its own reactivation
threshold (`self._current_top_ref(buy)`, snapshotted fresh at that
moment) automatically picks up whatever TZ BUY 2 had already quietly
climbed to -- no separate propagation needed. Test 18 covers this
(clearing a stale peak with a non-confirming close raises the bar
instead of recovering; a later, lower high against the raised bar shows
nothing; only a genuine close-confirmed break of the raised bar
recovers). Verified against all real datasets: KALYANKJIL.NS and all
three BBOX.NS variants show zero diffs (this code path never triggers
for them); PAYTM.NS diffs exactly and only in the affected window.

**Same fix ported to REAR 2 and REAR RE-ENTER 2** (explicit user
confirmation: "Recovery bar ABOVE TZ BUY 2/REAR 2/REAR RE ENTER
reference high after it's SL was a basic requirement. Fix it
permanent."). `_eval_rear2` and `_eval_rre2` had the identical gap --
their `r2.sl_active` branches only ever checked the full close-confirmed
recovery condition, with no fallback for an intervening high that clears
the bar without confirming. Fixed identically: an `elif` branch emits
`INVALID REAR 2 HH(label)` / `INVALID REAR RE-ENTER 2 HH(label)` and
raises both `ref_high` and `reentry_threshold` on any qualifying new
high that doesn't fully confirm. Test 19 (REAR 2) and Test 20 (REAR
RE-ENTER 2) cover this the same way Test 18 covers TZ BUY 2. Explicitly
NOT extended to BAR 2 (`_eval_bar2`) -- the user confirmed BAR 2's own
SL correctly needs no LL tracking, and did not include BAR 2 in the "fix
it permanent" instruction; BAR 2 is architecturally different anyway (a
per-lineage object that gets dropped entirely once a newer sibling
lineage's own BAR 2 confirms, per the already-established "once a new
BAR 2 is confirmed, the earlier BAR becomes irrelevant" rule, so a stale
BAR 2 rarely if ever survives long enough for this gap to matter the way
it did for the three buy-level "2" tiers).

Root cause, for the record (asked directly: "it was already coded
earlier to the engine -- why did the bug arrive?"): the general
principle -- keep the recovery bar climbing on any qualifying high, not
just checking the original frozen peak -- was already coded, but only
for ONE of the two situations that needed it. When the PARENT tier had
ALSO already failed (`not buy.active` / `lin.sl is not None` / `rear.sl
is not None`), the quiet-climb tracking already existed correctly
(`INVALID TZ BUY 2 HH` / `INVALID BAR HH` / `INVALID REAR HH`). But when
ONLY the "2" tier itself had failed while its parent was still fully
alive -- actually the more common case, since a "2" tier typically fails
well before its parent does -- there was no fallback branch at all, just
a single "does this fully confirm, yes or no" check. That gap existed
from when these tiers were first built; the original hand-built smoke
tests never happened to have more than one candle between an SL and its
recovery, so a failed intermediate attempt never got exercised until
real weekly data (PAYTM.NS) had several weeks between the SL and the
eventual genuine recovery.

## Open items

- The `extra_reentry_floor` cross-theory hook (deferred to
  DTF-with-respect-to-TZ-BUY work, not started) — see "Cross-time-frame
  follow-up actions" near the top of this file for the mapping given so
  far and what's still missing before it can be built.
- File itself (`tz_engine_wtf.py`) not yet renamed to match "TZ BUY".
