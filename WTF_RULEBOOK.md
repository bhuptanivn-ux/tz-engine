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

**Superseded by PRIME TREND**: this section's framing of "TZ BUY ENTRY
= DTF's own `TZ BUY(` event" (a single tier) turned out to be
incomplete once actually worked through against real data -- see the
separate `PRIME_TREND_RULEBOOK.md` for the corrected, fully-worked
two-stage version (DTF TZ BUY, then a further DTF TZ BUY ENTRY
escalation above it). The "BAR ENTRY" side of this table has since been
worked through to the same depth -- see the next section, which
supersedes the "BAR ENTRY" bullet above too (still specification only,
not implemented).

## TAR / TBAR and the separate BAR → BAR ENTRY / BAR 2 track (specification only, NOT implemented)

Fully worked out in a later pass, after the two-stage PRIME TREND
correction above prompted the same rigor to be applied to the BAR row.
Renamed to avoid two separate naming collisions: with TZ BUY/TZ BUY 2
(the base engine's own top-level tiers) and with BAR/BAR 2 (the base
engine's own lineage tiers) -- reusing either name here would make the
same word mean different things depending on context, exactly the
confusion a brief detour into "let RED1/RED2 skip the TZ BUY 2 gate"
would have caused (considered and rejected -- see "Rules, tier by
tier" above's spawn-eligibility discussion for why the base engine's
own TZ BUY 2 gate must never become context-dependent).

**TAR** = the old "TZ BUY" in this specific context: DTF's first
response to a WTF BAR, confirming the moment DTF's own high crosses the
WTF BAR's own reference high, with the standard full breakout shape
(`low >= prev.low`, high clears the reference by `>= THRESH`, close
holds at/above it).

**TBAR** = the old "TZ BUY ENTRY": TAR's own escalation, confirming
above TAR's own (quietly climbing) reference high -- mirrors TZ BUY's
own reactivation-ladder mechanics exactly, nothing new.

**BAR → BAR ENTRY / BAR 2 is a second, fully independent track -- NOT
sequentially gated on TAR/TBAR at all.** RED1/RED2 for this track pulls
back directly against the WTF BAR's own reference high, never against
TAR. So BAR (and its own Stage 2) can be DTF's very first response to a
WTF BAR, entirely without TAR or TBAR ever forming -- or it can form
while TAR is active but before TBAR ever confirms, or after TAR's own
SL. There is no required ordering between the TAR/TBAR track and the
BAR track beyond one gate, inherited unchanged from the original
disambiguation above: **once a RED1→RED2→BAR→(BAR ENTRY or BAR 2)
escalation has completed once for this whole lineage, that door closes
permanently** -- no fresh BAR cascade can start again after any later
SL (TAR's, TBAR's, or the BAR family's own), only TAR/TBAR reactivating.

**Naming a cascade's own Stage 2 -- BAR ENTRY vs. BAR 2.** Decided by
one question, asked at the moment this cascade's own Stage 2 confirms:
*is there currently an already-active Stage-2-level tier for this
lineage (TBAR, or an earlier BAR ENTRY)?*

- **No** (neither TBAR nor an earlier BAR ENTRY is active yet --
  regardless of whether TAR itself happens to be active or not) -- this
  cascade's Stage 2 is named **BAR ENTRY**. TAR's own presence never
  affects this naming: RED1/RED2/BAR/BAR ENTRY can complete entirely
  while TAR is active and un-SL'd, well before TBAR ever confirms.
  Includes a same-candle tie: if this cascade's own Stage 2 and TBAR
  happen to confirm on the exact same candle, the cascade's name still
  resolves to BAR ENTRY, since TBAR wasn't *already* active beforehand.
- **Yes** (TBAR, or an earlier BAR ENTRY, is already active) -- this
  cascade's Stage 2 is named **BAR 2** instead.

**No REAR tier in this theory.** Once a nested BAR family (formed under
BAR ENTRY, under BAR 2, or directly beneath TBAR) reaches its own SL2
together with its own parent's own SL (`BAR SL + BAR ENTRY SL + BAR
SL2`, or the equivalent under BAR 2/TBAR), this does NOT escalate to a
REAR-equivalent tier the way the base engine's own BAR family does. It
simply reactivates the parent (BAR ENTRY, BAR 2, or TBAR) in place,
above that parent's own historical highest high.

**Decisive parent/child dependency, same shape as TZ BUY → TZ BUY 2
everywhere:**
- TAR's own SL is decisive: wipes TBAR and the entire BAR family under
  it in one shot.
- Each BAR-tier's own first formation (call it BAR1 for a given
  cascade) is *also* decisive with respect to its own Stage 2 (BAR
  ENTRY or BAR 2): that Stage 2 cannot exist -- neither forming for the
  first time, nor reactivating -- while its own BAR1 is currently down.
  When BAR1 SLs, its own Stage 2 doesn't just disappear without a
  trace: its own accumulated reference persists (see below) as the
  level BAR1's own reform has to clear.

**One universal reactivation rule, no per-tier special cases:**
whenever anything needs to reactivate, the threshold it must clear is
**whichever reference is currently highest across every tier the whole
structure is holding at that moment** -- TAR, TBAR, BAR1, BAR2/BAR
ENTRY, and any further nesting -- re-evaluated fresh each time, exactly
`_current_top_ref`'s existing "whichever is higher" principle, just
applied to this taller structure. Nothing is restricted to only its own
specific named reference. Two fully worked examples:

1. `TAR → TBAR → RED1 → RED2 → BAR1 → BAR2` (BAR2 climbs *past* TBAR's
   own level) → `TAR SL` fires (decisive, wipes TBAR/BAR1/BAR2 all at
   once) → TAR's own reactivation must clear **BAR2's** level, not
   TBAR's, since BAR2 was the highest point reached. Once TAR
   reactivates there, **TBAR's own subsequent reactivation** then has
   to clear *that* new TAR reference in turn.
2. `BAR ENTRY → RED1 → RED2 → BAR1 → BAR2` (a fresh cascade forming
   under an already-active BAR ENTRY, hence named BAR 2 per the naming
   rule above) -- if BAR2 climbs past BAR ENTRY's own level, that
   becomes the new high; when BAR ENTRY's own decisive parent (its own
   BAR1) eventually fails and reforms, it must clear that BAR2-set
   high, and BAR ENTRY's own subsequent reactivation then has to clear
   *that* freshly-reformed reference -- the identical leapfrogging
   pattern as example 1, one tier down.

**The ratchet must never stall, at any tier, ever** -- the exact same
principle behind the live site's own REAR SL / REAR RE-ENTER SL
reactivation-reference fix (see "REAR's own SL / REAR RE-ENTER's own
SL reactivation reference must never stall behind `_milestone_blocked`"
below): every tier's own highest-high tracking must keep silently
absorbing every new high made anywhere in this structure for the
entire time it's dormant -- never restricted to only what happened
before its own SL. A design that freezes a reference and only resumes
tracking later reproduces exactly the bug already found and fixed on
the live site, one layer up.

Confirmed explicitly by the user across a working session tracing
through IDEA VODAFONE's real numbers; not yet verified against a full
real dataset the way PRIME TREND was, and not yet implemented in either
`tz_engine_wtf.py` or `lib/tzEngineWtf.ts`.

### Two separate rules, evaluated at different moments -- worked examples

A follow-up round of questioning (prompted by an apparent contradiction:
"BAR 2 can only occur if there will be TBAR" read against a worked
example that showed BAR 2 forming with no TBAR anywhere in the chain)
pinned down that there are **two separate rules here, answering two
different questions at two different moments** -- easy to conflate, so
spelled out explicitly:

- **Rule A -- naming, re-evaluated fresh every time a Stage 2 confirms:**
  is a Stage-2-level tier (TBAR, or an earlier still-active BAR ENTRY/BAR
  2) active **right now, at this exact moment**? Yes → **BAR 2**. No →
  **BAR ENTRY**. This is a live, moment-by-moment check -- NOT a "has
  TBAR ever existed anywhere in this lineage's history" flag. A lineage
  that had TAR/TBAR earlier can still produce a BAR ENTRY later, if TBAR
  happens to be down (SL'd, not yet reactivated) at the exact moment this
  new BAR 1's own Stage 2 confirms.
- **Rule B -- "the door closes permanently," a one-time lineage-level
  flag:** has a BAR1→(BAR ENTRY or BAR 2) escalation **ever fully
  completed** for this lineage, at any point in its history? Once yes,
  that door never reopens for the rest of the lineage's life -- no fresh,
  from-scratch BAR 1 can ever form again, no matter how far everything
  later collapses (even all the way back to TAR itself failing); only
  reactivation is possible from then on.

Rule B decides whether a fresh BAR 1 is even allowed to exist at all;
Rule A decides what to call its Stage 2 once it does form. Six worked
examples, confirmed by the user against these two rules:

1. `WTF TZ BUY 2 → TAR → TBAR → RED1 → RED2 → BAR1 → BAR2 → RED1 → RED2
   → BAR1 → BAR2` -- TBAR hosts a BAR1→BAR2 cascade, it fails, TBAR
   self-reactivates in place (no REAR), a fresh RED1-RED2-BAR1 nests
   under it again -- still named BAR 2 (never reverts to BAR ENTRY),
   since the door already closed after the first BAR 2 (Rule B), and
   TBAR is active again by the time this second Stage 2 confirms
   (Rule A).
2. `WTF TZ BUY 2 → RED1 → RED2 → BAR1 → BAR ENTRY → RED1 → RED2 → BAR1
   → BAR2` -- pure independent track, no TAR/TBAR ever. BAR1→BAR ENTRY
   forms first (nothing active yet, Rule A → BAR ENTRY; this also
   triggers Rule B, closing the door for this lineage from here on). A
   nested cascade under it is BAR 2 (BAR ENTRY is active, Rule A).
3. `WTF TZ BUY 2 → TAR → TBAR → RED1 → RED2 + TBAR SL → BAR1 → BAR ENTRY
   + TBAR (reactivation)` **or** `... → BAR1 → BAR ENTRY (before TBAR
   reactivation)` -- RED1-RED2 pulls back against TBAR and TBAR SLs
   *before any BAR1 ever formed* -- no BAR1→StageX escalation has ever
   completed for this lineage, so Rule B was never triggered and a fresh
   BAR1 is still allowed. At the moment this fresh BAR1's own Stage 2
   confirms, TBAR is down (Rule A) -- correctly named BAR ENTRY, whether
   or not TBAR has reactivated yet on its own, fully independent track.
4. `WTF TZ BUY 2 → TAR → TBAR → RED1 → RED2 → TAR SL → BAR → BAR ENTRY`
   -- same shape as #3, but the decisive TAR SL fires instead (wiping
   TBAR and everything under it in one shot). Again, no BAR1 ever formed
   before this failure, so Rule B doesn't block a fresh BAR1, and it's
   named BAR ENTRY (Rule A: nothing active at that moment).
5. `WTF TZ BUY 2 → TAR → TBAR → RED1 → RED2 → BAR1 → BAR2 → RED1 → RED2
   → BAR1 → BAR2 → RED1 + BAR SL → BAR SL2 → TAR SL → TAR (above the
   BAR2/TBAR reference, whichever is higher)` -- two full BAR1→BAR2
   cascades complete under TAR-TBAR, then on a third attempt everything
   collapses all the way down to TAR itself failing. Even from total
   collapse, BAR1-BAR ENTRY cannot occur -- the door closed permanently
   after the very first BAR 2 (Rule B), so the only valid recovery is TAR
   reactivating, above whichever of BAR2's/TBAR's own references is
   higher (the universal reactivation rule).
6. `WTF TZ BUY 2 → RED1 → RED2 → BAR1 → BAR ENTRY → RED1 → RED2 → BAR1 →
   BAR2 → BAR1 SL → BAR ENTRY SL + BAR SL2 → BAR1 SL → BAR1 (not REAR,
   the cycle reactivates) → BAR ENTRY` -- independent track, door closes
   at the very first BAR1→BAR ENTRY (Rule B). A nested BAR1→BAR2 forms
   under it. The nested BAR1 SLs; BAR ENTRY's own SL fires together with
   the nested BAR SL2 (BAR ENTRY failing on its own reference, not merely
   because its nested child failed); then the original, outer BAR1 also
   SLs, wiping everything. Since the door already closed, the only valid
   recovery is BAR1 reactivating in place (explicitly NOT a REAR-style
   escalation, even from a full collapse-to-zero), followed by BAR ENTRY
   reforming on top of it.

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

### Confirmed correct (not a bug): a `buy=None` branch gets no special exemption from collateral termination

Investigated at length against real ICICIBANK.NS data (2010-04-05:
branches D, seq=13, and E, seq=16, both sitting at `buy=None`, vanish the
instant `REAR(C)` fires, with no explicit event) -- initially suspected as
a gap, since a branch that hasn't failed on its own terms still gets
killed outright. Instrumenting the raw per-branch events *before*
collateral-termination filtering showed exactly what each branch was
doing that candle:

```
C (seq=6,  achiever):  ['INVALID BAR HH(C.5)', 'REAR(C)']
D (seq=13, buy=None):  ['TZ BUY(D)']        -- a genuine, same-candle fresh formation
E (seq=16, buy=None):  ['TZ GREEN HH(E)']   -- not a milestone at all
```

D's termination turned out to already be explained by an existing,
separate, deliberate rule: `is_fresh_buy` -- a brand-new, same-candle TZ
BUY formation is terminated **unconditionally** when an older achiever's
milestone fires the same candle, no exemption check even applies. E's
termination follows the identical principle one level further: E carried
no competing milestone of its own that day either -- it is simply a later
branch with nothing to show for itself at that date, so the earlier
achiever gets preference and the later one is terminated. Both cases are
the same rule: **whichever branch has actually earned a milestone as of
that date wins; a later branch that hasn't earned anything yet (whether
`buy=None` or a same-candle fresh formation with nothing before it) does
not get to survive alongside it.** Explicit user confirmation, generalized
worked example: "REAR A and TZ BUY B/REAR B occurring on the same day,
then REAR A will get active and TZ BUY B will be terminated... to keep
the later titles available, technically and logically D/E termination was
correct... later new Lineage D got active as well after REAR SL B and got
TZ BUY 2 D before REAR RE ENTER B. This way higher milestone got the
preference though it was later one... It is same as D [for E]. Since it
is a later branch with no higher milestone at that given date. Earlier
will get the preference and later one's terminated."

**Independently corroborated**: the live Trading Zone website's own
historical display for ICICIBANK.NS shows neither `TZ BUY(D)` nor
anything for E on 2010-04-05 -- matching this conclusion exactly, without
having seen the engine's internal reasoning.

No fix needed -- `_pre_today_live_buy` correctly requires `pc.buy is not
None` for exemption; a `buy=None` branch is not meant to be exempted, and
this is not connected to `_milestone_blocked`'s separate role (blocking a
dormant branch's own future escalation while a newer sibling leads,
covered above) at all.

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

## A fully-collapsed buy must not permanently block a sibling's first TZ BUY

Bug found against real data (MAXESTATES.NS): `_buy_currently_live` decides
whether a buy still counts as "currently live" -- and `not any(... for pc
in self.branches.values())` over this function is the gate that a
DIFFERENT branch's own `red_ever and buy is None` must clear before it can
ever form its own first TZ BUY. The function correctly returned `False`
once REAR/REAR RE-ENTER's own SL fired, and correctly checked whether a
BAR family was still racing -- but its various fallback paths (no BAR
family ever formed, or one existed and was later wiped by TZ BUY 2's own
SL) all unconditionally fell through to `return True`, with no check for
whether TZ BUY 2 / REAR 2 / REAR RE-ENTER 2's own SL had ALSO already
fired. A buy whose entire BAR family was wiped by its own TZ BUY 2 SL --
with no REAR ever formed -- had genuinely nothing left racing at all, yet
kept reporting itself as "live" forever.

Real trace: branch A's `TZ BUY 2 SL(A)` fired 2025-03-09 (BAR family
already wiped, no REAR ever formed). From that point on, `any_live_buy`
stayed `True` on every single subsequent candle -- for over a year --
purely because of this stale, wrongly-"live" A. Branch B's own `RED(B)`
fired cleanly on 2026-06-07, but its own `TZ BUY(B)` could not form no
matter how large the breakout, because the `not any_live_buy` gate never
released. User's exact framing, confirming this must never recur: "In
almost all the stocks with history, one branch['s] TZ BUY would be active
after a BAR SL2 or TZ BUY [2] SL. Hence... TZ GREEN(N+1) CAN START
FOLLOWED BY TZ BUY(N+1). It should never be a problem in future. Likewise,
new lineage can start after BAR SL2 / REAR SL2 / REAR RE-ENTER SL2 along
with TZ BUY/TZ BUY 2 SL."

Fixed by extending `_buy_currently_live`'s three fallback points
(top-level, under a non-dormant REAR, under a non-dormant REAR RE-ENTER)
to also return `False` when that tier's own "2" has SL'd
(`tz_buy2.sl_active` / `rear2.sl_active` / `rre2.sl_active`) with no BAR
lineage still racing beneath it -- exactly the same conditions already
used for spawn eligibility (`tip_tzbuy2_sl`/`tip_rear2_sl`/`tip_rre2_sl`),
just applied consistently to this function too. Factored the repeated
"is any BAR lineage still racing" check into `_bar_lineages_racing` to
keep the three call sites in sync. Test 21 covers the top-level TZ BUY 2
case (the one the real trace hit); the REAR 2 / REAR RE-ENTER 2 cases are
the identical pattern, one and two tiers up. Verified: full smoke suite
(24/24) passes; re-run against the real MAXESTATES.NS file, `TZ BUY(B)`
now correctly fires 2026-08-16 and `TZ BUY 2(B)` 2026-08-23, matching the
real breakout exactly, with the same fix additionally confirmed working
earlier in the same file's own history (2025-03-09's TZ BUY 2 SL(A) no
longer blocks 2025-05-11's TZ BUY(B)).

## A genuine no-BAR-2 dead-end lineage must not mask a still-alive "2" tier (ICICIBANK.NS)

Follow-on to the fix above, found the same way (real ICICIBANK.NS data,
2014 window, branch D). `_buy_currently_live`'s three fallback points each
check `if buy.bar_lineages: return self._bar_lineages_racing(buy)` --
returning `False` outright the moment nothing in `bar_lineages` is racing,
with no further check of whether the buy's own "2" tier (`tz_buy2` /
`rear.rear2` / `rear_reenter.rre2`) was still un-SL'd. This conflated two
structurally different "not racing" reasons:

- a genuine **permanent dead end**: that lineage's own SL fired with no
  BAR 2 ever having formed (`lin.sl is not None and lin.bar2 is None`) --
  should fall through and check the "2" tier instead, exactly like the
  "no BAR family at all" case already does;
- **BAR SL2 reached** (deep failure, REAR pending): an intentional "not
  live" signal, used by `tip_deep_failure`/spawn eligibility the instant
  SL2 fires -- must NOT fall through, or a buy that's genuinely reached
  deep failure would wrongly report itself as "still live" via its own
  TZ BUY 2/REAR 2/REAR RE-ENTER 2 state, permanently blocking every
  sibling's own spawn eligibility that SL2 is supposed to open.

Confirmed real trace (ICICIBANK.NS branch D, 2014): `TZ BUY 2(D)` formed
2014-05-05, peaked at 289.67 (2014-05-12, `TZ BUY 2 HH(D)`) and was NEVER
SL'd. D's one BAR lineage (`BAR(D.1)`, formed 2014-06-30) hit `BAR SL(D.1)`
2014-07-07 with no BAR 2 ever formed -- a genuine dead end, not deep
failure. Because `_buy_currently_live(D)` checked `bar_lineages` first and
returned `False` outright without falling through to D's still-alive TZ
BUY 2, D got no termination exemption. `REAR RE-ENTER(C)` (an unrelated,
much older dormant sibling) confirmed 2014-08-18 and terminated D outright
with **zero explicit event** -- no `TZ BUY 2 SL(D)`, nothing. D's letter
freed up; a fresh `TZ GREEN(D)` formed 2014-10-13, and a wholly unrelated
`TZ BUY(A)`/`TZ BUY 2(A)` on 2014-10-27/2014-11-03 looked like it "came
from nowhere."

**Fix**: added `_bar_lineages_permanent_dead_end(buy)` -- `True` only when
EVERY current lineage is `sl is not None and bar2 is None`. Each of the
three fallback points now does: if racing, live; else if NOT a permanent
dead end (i.e. genuine SL2 deep failure), not live; else fall through to
check the "2" tier, same as the no-BAR-family case.

**Verification**: full `test_wtf_smoke.py` suite passes; zero diffs on
EICHERMOT.NS, PAYTM.NS, BBOX.NS (×3), KALYANKJIL.NS, NSEI, MAXESTATES.NS
(WTF+DTF) -- confirming this fix changes nothing for the already-correct
"BAR SL2 masks nothing" case documented above. On ICICIBANK.NS, D now
correctly reforms `BAR(D.1)` in place on 2014-08-18 instead of dying, `C`
correctly stays exempt/dormant (its own REAR RE-ENTER can't confirm while
D remains live, mirroring the "hidden until newer fails" rule below), and
the whole spurious `TZ GREEN(D)` → `TZ BUY(A)`/`TZ BUY 2(A)` chain never
occurs -- those same real highs (296.95, 307.59) instead become D's own
`BAR 2 HH(D.1)` reference-high updates, silently extending its already-
running climb.

**Independently corroborated**: the live Trading Zone website's own
historical display for ICICIBANK.NS shows `TZ BUY 2(D)` on 2014-05-05,
matching the corrected engine -- not the buggy pre-fix trace, where D's
TZ BUY 2 would have been silently hijacked and hidden by an incorrect
`REAR RE-ENTER(C)`.

## A BAR lineage's own RED1/RED2 progress must not freeze once REAR exists above it

Major bug found against real data (NSEI, ~19 years of Nifty history): the
per-candle dispatch in `_eval_buy` that decides who gets to advance
RED1/RED2/BAR-SL progress this candle treated "REAR is live" and "a BAR
lineage needs its own RED1/RED2/SL progress" as MUTUALLY EXCLUSIVE
branches of one `if/elif` chain -- only one of `_eval_rear_progress`
(attaches RED1 to REAR itself) or `_eval_bar_lineages_progress` (attaches
RED1 to the newest BAR lineage, checks its own BAR SL/SL2) could ever run
per candle, and the REAR branch was checked FIRST.

This breaks the confirmed cascade the instant it actually happens: `REAR
→ REAR 2 → RED1 → RED2 → BAR(1)` (REAR 2's own dual-role cascade,
already-confirmed mechanic) consumes REAR's own `red2_ever` to spawn
BAR(1). From that point on, per the ALREADY-confirmed design ("only the
NEWEST lineage ever participates in RED1/RED2"), BAR(1)/BAR 2(1) should
be the one racing toward its own RED1 → RED2 → BAR(2) escalation, or its
own BAR SL/SL2. But REAR never goes dormant on its own just because a BAR
cascade formed under it -- `buy.rear is not None and not buy.rear.dormant`
stays true indefinitely -- so the dispatch kept calling
`_eval_rear_progress` every candle instead. That function's own RED1
attachment is gated on `not rear.red2_ever`, which is now permanently
`True` (already consumed) -- so it does nothing either. Net effect: NO
RED1/RED2 could EVER attach again for that buy, and
`_eval_bar_lineages_progress` -- which also owns the lineage's own BAR
SL/BAR SL2 checks -- never ran again either. The lineage sat permanently
frozen, silently, for as long as REAR stayed non-dormant (REAR/REAR 2's
own HH/LL/SL tracking, called separately/unconditionally earlier in the
same function, kept running fine, which is why `BAR 2 HH`/`REAR 2 HH`
kept showing and made the freeze easy to miss).

Real trace: NSEI branch C's `BAR 2(C.1)` formed 2014-08-17 under REAR 2's
dual role; the lineage then sat completely frozen -- no RED1, no RED2, no
BAR SL, no BAR SL2 possible -- until a fix released it, at which point
2014-10-05's already-qualifying pullback correctly fired `RED1(C)`,
followed by `RED2(C)` and a fresh `BAR(C.2)`, exactly as the base cascade
always specifies. User's framing, confirming the scale of the bug: "big
bug... Following that, BAR, BAR 2, BAR SL, BAR SL2 I believe other events
must be missing."

Fixed by reordering the dispatch: `elif buy.bar_lineages:` now runs
BEFORE the REAR/REAR RE-ENTER progress branches, not after. Whenever a
BAR cascade is live, it owns RED1/RED2/its own SL/SL2 -- REAR/REAR
RE-ENTER's own HH/LL/SL tracking is untouched by this reordering (that
already runs unconditionally, earlier in the same function, regardless of
this dispatch). Test 22 covers this (a genuine RED1 shape for the
BAR lineage must attach, `RED1(A)`, even while REAR stays non-dormant
with its own HH still climbing).

**Verification scope, and why it wasn't caught until now**: this fix only
changes output for a buy that has BOTH a live BAR lineage AND a
still-non-dormant REAR/REAR RE-ENTER at the same time -- i.e. specifically
the "REAR 2's own dual-role BAR cascade" scenario. Re-run against all
eight real datasets used so far: **zero diffs** on KALYANKJIL.NS, all
three BBOX.NS variants, PAYTM.NS, ADANIENT.NS, and MAXESTATES.NS (none of
them happened to exercise this exact combination in a way that produced
visible divergence) -- but **421 of 992 total events differ** on NSEI,
whose ~19-year index history hits this combination repeatedly. This is
the highest-impact fix found so far this session; treat any REAR-adjacent
BAR-family analysis on other long-history tickers as suspect until
re-verified against this fix.

## Crash fix: a stale RED1-preexistence snapshot could outlive the same-candle TZ BUY 2 SL that wipes it (ADANIENT.NS, 2018-03-05)

`_eval_buy` computes `red1_preexisting_at_buy_level` once, near the very
top of the method, as a snapshot of whether `buy.red1` already existed
BEFORE any of that candle's processing runs. Later in the same method,
after several other tiers have already been evaluated (including
`_eval_tzbuy2`, which can fire TZ BUY 2's own decisive SL and wipe
`buy.red1` back to `None` as part of that collapse), the code used to
branch on the STALE snapshot instead of re-checking `buy.red1` fresh:

```python
elif not red1_preexisting_at_buy_level:
    ...attach a fresh RED1...
else:
    ev += self._eval_red1_generic(pc, buy, buy, prev, cur)
```

On a candle where TZ BUY 2's own SL fires and wipes `buy.red1` to `None`,
the stale snapshot (taken before that wipe) could still read `True`
("RED1 already existed"), sending execution into the `else` branch with
`buy.red1` now `None` -- crashing `_eval_red1_generic` on
`None.ref_high` with `AttributeError: 'NoneType' object has no attribute
'ref_high'`.

This is the same "stale pre-candle snapshot" bug class already called out
elsewhere in this file's own comments, just one that had never actually
been hit by a same-candle wipe until this dataset did.

**Fix**: re-check `buy.red1` fresh at the point of use instead of
trusting the early snapshot:

```python
elif buy.red1 is None or not buy.red1.active:
    ...attach a fresh RED1...
else:
    ev += self._eval_red1_generic(pc, buy, buy, prev, cur)
```

Real trace: ADANIENT.csv (2006-09-18 to 2026-09-15, 1044 rows) crashed
exactly at 2018-03-05 with the `AttributeError` above. Test 23 reproduces
the same shape synthetically (RED1 attaches on `n5`; TZ BUY 2's own SL
fires on `n6`, wiping `buy.red1` on that same candle) -- confirmed this
exact sequence crashes under the pre-fix code, and the fixed code
processes it (and the full 1044-row ADANIENT dataset, 507 event-days)
cleanly with no crash.

## Rule reversal: RED1/RED2 on a BAR lineage no longer requires that lineage's own BAR 2 to exist first (ADANIENT.NS)

Previously, a fresh RED1 could only attach to a BAR lineage once that
lineage's own BAR 2 had formed and confirmed — documented at the top of
`tz_engine_wtf.py` as "BAR 2... Gates RED1/RED2 on its lineage." Real
data (ADANIENT.NS) showed the cost of this: `BAR(C.2)` formed
2018-10-15 and never got its own BAR 2 until 2019-10-22, a full year
later. Every pullback in between that had a genuine RED1 shape — the
first one, 2018-12-03 (`cur.h<=prev.h`, `cur.l<prev.l` by ≥0.20,
`cur.c<=prev.l`, checked by hand against the real OHLC) — was silently
absorbed as a plain `BAR LL(C.2)` reference update instead, because the
gate blocked `_attach_fresh_red1` from ever running. User's framing: "I
believe any RED 1 - RED 2 occurring within the range (high and low) of
BAR 1 are not being considered... The correct logic is: If BAR A.1 -
RED 1 - RED 2 (occurring within the range of BAR A.1) - BAR A.1. Hence,
RED 1 - RED 2 after BAR A.1 will terminate the BAR A.1 and will lead to
another BAR (when BAR occurs) with the same name as it will be
available."

**Fix, two parts** (`_eval_bar_lineages_progress` and
`_eval_red1_generic`):

1. The BAR-2 precondition on attaching a fresh RED1 to the newest BAR
   lineage is removed — RED1 now attaches on the same shape test used
   everywhere else, whether or not that lineage's own BAR 2 has ever
   formed:
   ```python
   elif not lin.red2_ever:
       ev += self._attach_fresh_red1(pc, buy, lin, prev, cur)
   ```
2. If RED2 then completes while that lineage's own `bar2` is still
   `None`, the lineage never really got confirmed — it terminates
   outright (removed from `buy.bar_lineages`) and its label frees for
   reuse, exactly like a no-BAR-2 BAR SL already does:
   ```python
   if isinstance(stage_obj, BarLineage) and stage_obj.bar2 is None:
       if stage_obj in buy.bar_lineages:
           buy.bar_lineages.remove(stage_obj)
           n = int(stage_obj.label.rsplit(".", 1)[-1])
           buy.bar_dead_labels.add(n)
   ```
   If BAR 2 already existed when RED2 completes, nothing changes from
   before — the lineage survives and keeps racing in parallel.

**Verification scope**: re-run against the full ADANIENT.csv dataset
(1044 rows) — 11 rows differ from the pre-fix trace, all additive (a
`RED1`/`RED1 LL`/`RED1 HH`/`INVALID RED1` appended alongside an
already-firing `BAR LL`, or a previously-silent day now showing
`RED1`), no event lost, no crash; total event-days rose from 507 to
509. Test 24 covers the full cycle synthetically end to end: RED1
attaches with no BAR 2 ever formed, RED2 confirms and terminates the
lineage, and a fresh breakout reforms `BAR(A.1)` reusing the freed
label — confirmed to discriminate cleanly against the pre-fix code
(which shows nothing at any of those three steps). Per explicit user
instruction, this fix has **not yet been re-verified against the other
real datasets** (KALYANKJIL.NS, PAYTM.NS, MAXESTATES.NS, the three
BBOX.NS variants, NSEI, EICHERMOT.NS) — that check is still pending.

## Bug: TZ BUY 2's own HH-mute must not survive its own SL recovery (ADANIENT.NS DTF)

Found while doing the first real DTF/WTF cross-timeframe entry/exit
analysis (branch A, ADANIENT.NS daily data): TZ BUY 2 recovered from its
own SL on 2007-06-26 and climbed from 11.93 to 16.20 over the following
six weeks, yet **not one `TZ BUY 2 HH(A)` event showed** despite the
internal reference genuinely climbing every single step (confirmed by
direct inspection of `buy.tz_buy2.ref_high`, which tracked `cur.h`
exactly, day after day, while the corresponding event string never
reached the output).

Root cause: `tz_buy2_hh_muted` lives on `buy`, not on the `Bar2` object
itself. It gets permanently tripped once some deeper tier (a BAR
lineage, in this case) reaches or exceeds TZ BUY 2's own reference —
which is exactly what happened back in February 2007, when `BAR
2(A.1)`'s own reference climbed past the *original* TZ BUY 2(A)'s
reference. That original TZ BUY 2(A) then hit its own SL
(2007-03-06), which correctly wipes the whole BAR family (Family 1,
decisive) — but TZ BUY 2 itself is *never a dead end* (also Family 1)
and recovered fresh in place on 2007-06-26, a brand-new climbing life
with nothing deeper below it any more. The stale `tz_buy2_hh_muted`
flag, however, was never reset by this in-place recovery (unlike TZ
BUY's own top-level SL/reactivation, which wipes `tz_buy2` to `None`
and already resets the flag at that point) — so the fresh recovery
inherited a mute earned by a structurally unrelated, already-wiped
prior incarnation, silently hiding its own HH progress indefinitely.

**Fix** (`_eval_tzbuy2`, the SL-recovery branch): reset
`buy.tz_buy2_hh_muted = False` the moment TZ BUY 2's own SL recovery
confirms —

```python
b2.sl_active = False
b2.reentry_threshold = None
buy.tz_buy2_hh_muted = False
ev.append(f"TZ BUY 2({branch_label(pc.id)})")
```

Same principle already established for BAR 2 not persisting through
BAR's own reactivation ("every fresh BAR generation needs its own new
BAR 2 from scratch") — a fresh TZ BUY 2 climbing life earns its own
fresh, unmuted HH display, since whatever deeper tier justified the old
mute was wiped along with everything else when this same SL fired.

**Verification**: re-ran the full ADANIENT.NS WTF (1044 rows) and DTF
(4940 rows) datasets end to end — no crash, no regression (509 and 2404
event-days respectively). Test 25 reproduces the exact real-data shape
synthetically end to end (TZ BUY 2 forms → a BAR lineage's own reference
exceeds it, tripping the mute → TZ BUY 2's own SL wipes the BAR lineage
→ TZ BUY 2 recovers fresh → a further tiny rally must show `TZ BUY 2
HH(A)`) — confirmed to discriminate cleanly against the pre-fix code
(silent at that last step).

## Bug: the "1" tiers' own post-SL reactivation reference must also keep climbing on intervening highs (ICICIBANK.NS WTF)

The quiet-climb fix documented above ("TZ BUY 2's own post-SL recovery bar
must keep climbing on intervening highs") was applied to the three "2"
tiers (TZ BUY 2, REAR 2, REAR RE-ENTER 2) and to two of the "deeper tier
already failed" cases (`INVALID BAR SL HH`, `INVALID REAR SL HH` — see
below). It was **not** applied to the three "1" tiers' own reactivation
references: `buy.reentry_threshold` (TZ BUY's own SL → reactivation),
`RearSL.entry_threshold` (REAR's own SL → REAR RE-ENTER), and
`RearReenterSL.entry_threshold` (REAR RE-ENTER's own SL → self-recovery).
All three were one-time frozen snapshots — taken via `self._current_top_ref
(buy)` at the exact moment the respective SL fired — with no `elif`
fallback for an intervening high that clears the snapshot without fully
confirming reactivation. Exactly the same defect, one layer up.

Found while checking a specific real event by hand (ICICIBANK.NS WTF,
branch E): 2014-03-10 was flagged as `TZ BUY(E)`, which looked wrong on
inspection. My first pass concluded (incorrectly) that the code was
behaving as designed. The user's correction pinned down the actual rule
precisely: "TZ BUY → TZ BUY 2 → TZ BUY 2 SL → TZ BUY SL. Whether TZ BUY SL
occurs on the same day as TZ BUY 2 or following days, reference high will
be the highest high after TZ BUY 2 and not TZ BUY... Highest high can be
TZ BUY 2 high or if during later days there is a higher high then, that
will be the new reference high for TZ BUY for reactivation." Traced by
hand against the real numbers: TZ BUY REFERENCE HIGH IS 219.38
(2013-12-09, TZ BUY 2's own peak at the moment TZ BUY's own SL fired),
which later got revised to 223.64 (2014-03-03) and 225.73 (2014-03-10) —
both genuine highs that cleared the *previous* bar but never closed back
above it, so under the buggy code they were silently dropped instead of
raising the bar, leaving the stale 219.38 as the reactivation level
forever and letting the eventual `TZ BUY(E)` fire against a level price
had already cleared and moved six-plus points past, months earlier.

The user immediately flagged that the identical gap had to exist one
level deeper too: "Same logic in the case of REAR AND REAR RE ENTER
REACTIVATION in case of any SL of REAR & REAR RE ENTER after REAR 2 &
REAR RE ENTER 2 respectively." Checked `_eval_rear_sl_progress` (REAR's
own SL → REAR RE-ENTER) and `_eval_rear_reenter_sl_progress` (REAR
RE-ENTER's own SL → self-recovery) directly — both had the exact same
missing pattern as TZ BUY's own case.

**Fix**: added the missing `elif` branch to all three reactivation paths,
mirroring `INVALID TZ BUY 2 HH` exactly — any new high clearing the frozen
threshold by `ANY` (0.01) without fully confirming reactivation (the
standard shape: `L>=prevL`, `H-ref>=THRESH`, confirming `C>=ref`) now
raises the threshold to that new high and emits an event:

- TZ BUY's own SL → reactivation (`_eval_buy`): `INVALID TZ BUY HH(label)`
- REAR's own SL → REAR RE-ENTER (`_eval_rear_sl_progress`):
  `INVALID REAR SL HH(label)`
- REAR RE-ENTER's own SL → self-recovery (`_eval_rear_reenter_sl_progress`):
  `INVALID REAR RE-ENTER SL HH(label)`

**Verification**:
- Full `test_wtf_smoke.py` suite (25 tests at the time) still passed with
  no regressions.
- Re-ran the real ICICIBANK.NS WTF trace around 2014-01-20 to 2014-04-01:
  now shows `INVALID TZ BUY HH(E)` on exactly 2014-03-03 and 2014-03-10,
  matching the user's hand-traced sequence (219.38 → 223.64 → 225.73)
  exactly; E correctly does NOT reactivate on 2014-03-10, and `TZ BUY(D)`
  fires instead (an unrelated, already-correct sibling branch).
- Full old-vs-new diff on ADANIENT.NS: 1 diff on WTF, 20 diffs on DTF, all
  internally consistent with the fix (e.g. 2019-05-21 DTF: old code wrongly
  shows `TZ BUY(B)`, new code correctly shows `INVALID TZ BUY HH(B)`).
- Tests 26 (TZ BUY), 27 (REAR → REAR RE-ENTER), and 28 (REAR RE-ENTER's
  own self-recovery) added to `test_wtf_smoke.py`, each built the same way
  as Test 18: a quiet-climb candle that raises the bar without confirming,
  a candle that would have wrongly confirmed under the old frozen
  reference but must stay silent under the fix, and a final candle that
  correctly confirms against the properly-raised reference. Test 27 and
  28 chain directly off Test 7's multi-generation BAR-racing fixture,
  since REAR RE-ENTER can only be reached via REAR's own SL recovery in
  the first place — so Test 28 also re-confirms Test 27's fix holds up as
  the foundation for a further reactivation cycle stacked on top of it.

Root cause, for the record: this is the same gap documented above for the
"2" tiers (PAYTM.NS), just missed one layer up. When this quiet-climb
principle was first identified and fixed, it was applied to the "2" tiers
and to the two "deeper tier already failed" cases that already existed
(`INVALID BAR SL HH`, `INVALID REAR SL HH` as they applied to a BAR/REAR
lineage that's already dead), but the parallel case for the "1" tiers'
own SL — TZ BUY's own top-level SL, REAR's own SL, REAR RE-ENTER's own
SL — was never audited for the same gap, since real data hadn't yet
produced a multi-week gap between one of THOSE specific SLs and its
eventual genuine reactivation. ICICIBANK.NS's branch E did.

**Impact on PRIME TREND**: since the underlying `tz_engine_wtf.py` trace
changes with this fix (confirmed diffs above), `prime_trend.py`'s own
downstream worked tables (in `PRIME_TREND_RULEBOOK.md` and locked into
`test_prime_trend_smoke.py`) were recomputed against the fixed engine —
see `PRIME_TREND_RULEBOOK.md` for the updated results.

## REAR's own SL / REAR RE-ENTER's own SL reactivation reference must never stall behind `_milestone_blocked` (ICICIBANK.NS)

Follow-on to the fix above (the "1" tiers' own post-SL quiet-climb) --
the `elif` branches added there for `_eval_rear_sl_progress` (REAR's own
SL → REAR RE-ENTER) and `_eval_rear_reenter_sl_progress` (REAR RE-ENTER's
own SL → self-recovery) were each wrapped in `not self._milestone_blocked
(pc)`, mirroring the reenter-CONFIRMATION check right above them. That's
correct for the confirmation itself (a blocked branch must never surface
a milestone while a newer sibling leads, per "hidden until newer fails"
below) -- but the STATE UPDATE for the quiet ratchet was accidentally
folded into the same gate, so the reference itself stopped climbing
entirely while blocked, instead of continuing to silently track the real
market high the way every analogous recovery does (TZ BUY's own SL-
recovery, and TZ BUY 2/REAR 2/REAR RE-ENTER 2's own SL-recoveries -- none
of which gate their own ratchet on `_milestone_blocked` at all).

Confirmed real trace (ICICIBANK.NS branch C): `REAR SL(C)` fired
2010-04-12. From then until 2015-08-31, a newer sibling (D) held a
continuously live buy (with one brief gap), so C sat `_milestone_blocked`
almost the entire stretch -- including the week D itself peaked at 357.64
(2015-01-27/28). Because the ratchet's state update was gated too, C's
own reference never moved off its 2010 level; it only ticked twice
(266.09 on 2015-10-12, 271.27 on 2016-11-07) once D was no longer
blocking it. `REAR RE-ENTER(C)` then confirmed cheaply on 2017-05-02
against that stale ~271 reference, instead of needing to clear D's true
357.64+ peak first -- and won a same-candle collision against what should
have been a fresh `TZ BUY`, which the user had already independently
flagged as suspicious ("TZ BUY B was correct") without yet knowing why.

**Fix**: removed `not self._milestone_blocked(pc) and` from the ratchet
line only, in both functions -- the confirmation check directly above
keeps its own `_milestone_blocked` gate unchanged.

**Verification**: full `test_wtf_smoke.py` suite passes (Tests 27/28,
which already covered this ratchet in the *unblocked* case, are
unaffected since they never had a genuinely live blocking sibling).
Old-vs-new diff, both fixes together: zero diffs on EICHERMOT.NS,
PAYTM.NS, BBOX.NS (×3), KALYANKJIL.NS, NSEI, MAXESTATES.NS (WTF+DTF);
ICICIBANK.NS shows 392 diffs on WTF / 695 on DTF, all downstream of C no
longer confirming `REAR RE-ENTER` on 2017-05-02 -- traced by hand and
confirmed correct: instead, a fresh `TZ BUY`/`TZ BUY 2` forms on
2017-05-02/2017-05-22 (and again 2017-10-30/2018-01-17 after its own
first cycle SLs), exactly matching the user's independently-reconstructed
real dates and prices for that stock.

## PRIME TREND is now its own theory — see `PRIME_TREND_RULEBOOK.md`

The DTF-with-respect-to-WTF cross-timeframe follow-up layer (WTF TZ BUY
2 → DTF TZ BUY → DTF TZ BUY ENTRY, and the entry/exit rules around it)
is documented as its own separate theory in `PRIME_TREND_RULEBOOK.md`,
not as a section of this file. It depends on TZ BUY as a prerequisite,
but is tracked independently going forward.

## Open items

- The RED1/RED2-without-BAR-2 rule reversal (above) has since been
  re-verified byte-for-byte against all real datasets used this session
  (KALYANKJIL.NS, PAYTM.NS, MAXESTATES.NS, BBOX.NS ×3, NSEI,
  EICHERMOT.NS, both ADANIENT.NS files) as part of porting it to
  `main`/TypeScript — no longer pending.
- The TZ BUY 2 HH-mute fix (above) has **not yet** been re-verified
  against those other real datasets, nor ported to `main`/TypeScript.
- The "1" tiers' own reactivation quiet-climb fix (above -- TZ BUY's own
  SL, REAR's own SL, REAR RE-ENTER's own SL) has **not yet** been
  re-verified against the other real datasets beyond ADANIENT.NS and
  ICICIBANK.NS, nor ported to `main`/TypeScript.
- The no-BAR-2 dead-end / still-alive "2" tier fix and the REAR SL /
  REAR RE-ENTER SL `_milestone_blocked` ratchet fix (both above) are
  applied to `tz_engine_wtf.py` and re-verified (zero diffs on
  EICHERMOT.NS, PAYTM.NS, BBOX.NS ×3, KALYANKJIL.NS, NSEI, MAXESTATES.NS;
  confirmed-correct diffs on ICICIBANK.NS) but **not yet** checked against
  ADANIENT.NS (standing restriction this session), nor ported to
  `main`/TypeScript.
- A `buy=None` branch's lack of exemption from collateral termination
  (ICICIBANK.NS, 2010-04-05, branches D/E) was investigated at length and
  **confirmed to be correct, existing behavior, not a bug** -- see
  "Confirmed correct (not a bug)" under "Multi-branch / spawn eligibility
  / leadership" above. No fix needed.
- The `extra_reentry_floor` cross-theory hook (deferred to
  DTF-with-respect-to-TZ-BUY work) — now documented as its own separate
  theory in `PRIME_TREND_RULEBOOK.md` (the TZ BUY 2 → TZ BUY → TZ BUY
  ENTRY chain; the "BAR ENTRY" side of the original cross-time-frame
  table is still only at the earlier, less-worked-through spec level
  in this file). None of it is implemented in `TZEngine` itself yet —
  it is computed by a separate manual/external analysis script.
- File itself (`tz_engine_wtf.py`) not yet renamed to match "TZ BUY".
