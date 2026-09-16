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

`test_wtf_smoke.py` -- 18 synthetic scenarios (`python3 test_wtf_smoke.py`):

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

## Open items

- The `extra_reentry_floor` cross-theory hook (deferred to
  DTF-with-respect-to-TZ-BUY work, not started).
- File itself (`tz_engine_wtf.py`) not yet renamed to match "TZ BUY".
