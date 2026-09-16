# TZ BUY — the TZ ENGINE state machine

**Naming note:** this theory is called **TZ BUY**. Earlier drafts of this
file called it "WTF" or "the BAR 2 variant" — those names are retired; the
logic itself hasn't changed identity, just its name. The code file is
still `tz_engine_wtf.py` (not yet renamed).

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

## "Whichever occurred last" -- the reactivation threshold

Implemented as `Engine._current_top_ref(buy)`. Whenever a Family-1 tier's
own SL fires (or REAR RE-ENTER self-recovers), the reactivation/re-entry
threshold is NOT just that tier's own frozen reference -- it's the current
reference of the deepest structure the buy had actually reached, snapshotted
BEFORE the wipe:

- If `bar_lineages` is non-empty: the newest lineage's own BAR 2 reference
  (or the lineage's own reference, if it never got a BAR 2). `bar_lineages`
  is checked FIRST inside whichever REAR-family branch applies, because
  forming REAR/REAR RE-ENTER always wipes it immediately -- so a non-empty
  list can never be a stale leftover from before the current REAR-family
  tier existed.
- Else if REAR RE-ENTER exists: its own "2"'s reference, or its own.
- Else if REAR exists: its own "2"'s reference, or its own.
- Else if TZ BUY 2 exists: its reference.
- Else: TZ BUY's own frozen reference.

This can be numerically LOWER than a shallower tier's own frozen peak (TZ
BUY's or TZ BUY 2's own HH tracking keeps climbing independently and isn't
guaranteed to stay below whatever BAR/BAR 2 eventually reach) -- the
deepest tier's value governs regardless, because it is structurally the
most recent. Confirmed by explicit worked examples from the user, and by
Test 8 in `test_wtf_smoke.py` (TZ BUY's own SL reactivates above BAR 2's
ref of 101, not the numerically higher frozen peaks of 104).

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
   lineage is no longer pre-SL (dead-ended or otherwise), a qualifying
   breakout ALONE forms a fresh BAR immediately -- **no RED1/RED2 needed**.
   Without this, a BAR SL firing with no BAR 2 ever having formed left
   `bar_pending` permanently unset-able (nothing could ever trigger a fresh
   RED2 again), which produced a genuine bug against real data: an engine
   run went completely silent for 84 weeks after exactly this happened
   (KALYANKJIL.NS, BAR SL fired 2025-02-23 with no BAR 2, zero further
   events through 2026-09-06). Confirmed by the user: "CAN A NEW BAR OCCUR
   after BAR SL: YES... In this case NO NEED TO HAVE A RED 1 - RED 2."

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

Spawn eligibility for a fresh sibling TZ GREEN(n+1) opens on EITHER TZ
BUY's own top-level SL OR TZ BUY 2's own SL (the latter an explicit
addition/reversal -- see above). Leadership contest, dormancy, and
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

`test_wtf_smoke.py` -- 9 synthetic scenarios (`python3 test_wtf_smoke.py`):

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
8. TZ BUY's own SL, firing after BAR 2 has formed, reactivates above BAR
   2's reference specifically -- not the numerically higher frozen peaks
   of TZ BUY/TZ BUY 2 (proves "whichever occurred last" is structural, not
   simply `max()`).
9. TZ BUY 2's own SL wipes the BAR family (even with BAR 2 already formed)
   and opens spawn eligibility for a fresh sibling TZ GREEN(n+1), while TZ
   BUY itself stays active throughout.

Not yet independently covered by a dedicated synthetic test (lower
priority -- the same `_current_top_ref` machinery is exercised end-to-end
by Test 8, and real-data validation already exists for the flow overall):
REAR's own SL → REAR RE-ENTER with no REAR 2 ever formed; REAR 2/REAR
RE-ENTER 2's own SL wiping and requiring reformation; REAR RE-ENTER's own
SL self-recovery with no REAR RE-ENTER 2 ever formed.

## Open items

- The `extra_reentry_floor` cross-theory hook (deferred to
  DTF-with-respect-to-TZ-BUY work, not started).
- File itself (`tz_engine_wtf.py`) not yet renamed to match "TZ BUY".
