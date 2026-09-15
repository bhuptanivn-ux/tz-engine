# New Theory — v7: full multi-branch, TZ GREEN → TZ BUY → BAR (unlimited) → REAR → REAR RE-ENTER (self-recovering), each with its own "2"

**Status:** provisional design + implementation (`tz_engine_new_theory.py`).
**Not yet verified against real OHLC data** — no dataset has been supplied
for this theory. Treat every mechanic as a hypothesis until it's run against
real data and confirmed, per this project's standing discipline (never guess
past a flagged date, re-verify after every fix).

This is a separate, from-scratch theory. It does **not** touch, extend, or
depend on `tz_engine_v9.py`, `tz_engine_bar2_variant.py`, or the DTF/WTF
variant — those are unrelated, already-built work on
`claude/rulebook-logic-interpretation-g3z130`. It does, however, deliberately
borrow the base 37-event engine's own **multi-branch machinery** (sections
7a/8/9 of `TZ_ENGINE_RULEBOOK_REFERENCE.md`) and the BAR2-variant engine's
**"2"-tier template** (`tz_engine_bar2_variant.py`) as explicit building
blocks — see "Version history" below for exactly what came from where.

## The flow (v7)

```
TZ GREEN → RED1 → RED2 (vs TZ GREEN) →
TZ BUY (above TZ GREEN's own ref) → TZ BUY 2 (above TZ BUY's own ref) →
RED1 → RED2 (vs TZ BUY 2) →
BAR(1) (above TZ BUY 2's ref) → BAR 2(1) → RED1 → RED2 →
BAR(2) → BAR 2(2) → ... (unlimited, while the current gate stays active) ...
→ BAR SL → BAR SL2 — queues REAR's reference (§ "whichever occurred last")
→ REAR → REAR 2 — two SEPARATE, independent things can happen from here
(neither gates the other):
     • REAR 2's own RED1→RED2 → a FRESH BAR(1)→BAR 2(1) cascade, unlimited
       again, gated on REAR 2 staying active. If that cascade later reaches
       its own BAR SL2, it re-queues REAR's reference (reactivating REAR
       under the same label if it still exists).
     • REAR's own SL (single-tier — "REAR SL is enough as earlier, nothing
       like REAR SL2", NOT gated on REAR 2 existing) → directly queues REAR
       RE-ENTER's reference (whichever tier is most advanced at that
       moment — REAR 2's own, in the simple case where no fresh cascade
       has opened yet).
→ REAR RE-ENTER → REAR RE-ENTER 2 — the SAME shape one level deeper, PLUS
  REAR RE-ENTER's own self-recovery (v7, see below):
     • its own RED1→RED2 → another fresh BAR(1) cascade, exactly like REAR
       2's own role one level up.
     • REAR RE-ENTER's own SL (single-tier) → self-recovers: on a later
       recovery breakout above its own SL's reference, REAR RE-ENTER
       reactivates under the SAME event text as its original formation
       (unlike an ordinary "2" tier's SL, which shows a distinct "RECOVER"
       suffix — REAR RE-ENTER has nowhere further to route to, so it loops
       on itself instead). REAR RE-ENTER 2 does NOT freeze on this SL —
       it keeps tracking independently (needed for the compound-failure
       state below to be reachable at all).
     • Compound failure: if REAR RE-ENTER's own SL AND REAR RE-ENTER 2's
       own SL are BOTH active at the same time, REAR RE-ENTER can instead
       reactivate (same event text again) above REAR RE-ENTER 2's own
       reference — a strictly higher bar than the ordinary self-recovery
       case — racing a fresh sibling TZ GREEN(n+1) reaching its own TZ BUY.
       No separate mechanism needed: the pre-existing leadership contest
       arbitrates the race exactly as it does everywhere else (this branch
       stays dormant if the sibling wins first).

REAR RE-ENTER confirms (both the original formation and every subsequent
reactivation) via the ordinary recovery-breakout check (Low ≥ PrevLow, High
− ref ≥ 0.20, Close ≥ ref) — "in case new TZ GREEN does not reach TZ BUY"
describes the multi-branch leadership contest, not a separate condition on
the confirmation itself: if a competing sibling reaches its own TZ BUY
before REAR RE-ENTER confirms, that sibling becomes the leader
(dormant/terminated per the contest rules below); REAR RE-ENTER can still
go on to confirm afterward on its own schedule, and firing it re-triggers
the contest with today's leadership snapshot.

TZ GREEN SL (before its own RED2 ever fired), or TZ BUY SL (before TZ BUY 2
ever formed): no reference queued at all — nothing established yet to
recover from. This branch's forward escalation is over; per the multi-branch
rules below, a sibling was very likely already spawn-eligible well before
this point anyway.
```

Multiple TZ GREEN lineages can be alive **simultaneously** (v4) — see below.

## Rules, as given (cumulative across all messages)

- **TZ GREEN**: unchanged (formation, HH/LL/SL). RED1/RED2 attach directly to
  it (no "TZ GREEN 2" — that only existed in an early, dismissed draft).
- **TZ BUY**: forms above TZ GREEN's own reference high, once TZ GREEN's own
  RED2 has fired. **TZ BUY 2**: forms above TZ BUY's own reference high.
- **BAR**: "as the original theory" — forms above TZ BUY 2's reference, once
  RED1→RED2 has fired against TZ BUY 2.
- **BAR / BAR 2**: unlimited — BAR(n) → BAR 2(n) → RED1 → RED2 → BAR(n+1) →
  ... "BAR - BAR 2 can occur if TZ BUY 2 is active" (or, later, if whichever
  other "2" tier most recently unlocked the cascade is active).
- **Post TZ GREEN SL**: before its own RED2, a new lineage starts
  immediately, no REAR. After RED2, REAR can occur above whichever reference
  "occurred last" (see below).
- **"Whichever occurred last"**: clarified explicitly by the user — this is
  a single, general principle across every REAR/REAR RE-ENTER trigger, not
  trigger-specific rules. A BAR 2 reference **is** conceptually a TZ GREEN
  reference that has simply climbed higher under a different name, so
  whichever tier is most advanced supplies the reference, regardless of
  which specific event (TZ GREEN SL, BAR SL2, REAR SL, REAR RE-ENTER SL)
  triggered the queueing.
- **REAR 2 / REAR RE-ENTER 2, added in v5**: own RED1→RED2 unlocks a fresh
  BAR(1) cascade. Confirmed explicitly by the user: "BAR 1 and BAR 2 can
  occur after REAR 2 and REAR RE-ENTER 2" — triggered by REAR 2's/REAR
  RE-ENTER 2's own RED1→RED2, exactly mirroring how TZ BUY 2's RED1→RED2
  triggers the first BAR (a parallel path, not gated on the parent's own SL
  failing first).
- **REAR SL / REAR RE-ENTER SL, corrected in v6**: v5 had also made these
  gate a deeper SL2 (mirroring BAR/BAR 2 exactly, since REAR 2/REAR RE-ENTER
  2 mirror BAR 2). **Reverted** — explicit user correction: "REAR SL is
  enough as earlier. Nothing like REAR SL2. likewise for REAR RE-ENTER."
  Both are single-tier, one-way, and NOT gated on their "2" tier existing —
  REAR's SL fires and directly queues REAR RE-ENTER's reference; REAR
  RE-ENTER's SL fires and is terminal. REAR 2 / REAR RE-ENTER 2 keep only
  their fresh-BAR-cascade role from v5 — they no longer gate anything on
  their parent.
- **Multi-branch spawn eligibility, corrected in v4**: the theory's own
  baseline TZ GREEN formation rule says a new branch is eligible whenever an
  existing active branch "has had its RED fire but has no currently-live
  buy" — true the instant RED2 fires, long before TZ BUY ever forms. So a
  fresh sibling can spawn well before the prior lineage fails at all.
- **Leadership contest / "race" tie-break, corrected in v4**: what was
  described as "if 2 are resolving on the same day the earlier will be given
  preference... new lineage will be terminated" is the base engine's own
  leadership contest (§7a), not a separate race system: whenever any branch
  fires a milestone, every other branch is re-judged — older → dormant,
  newer → terminated, unless a *continuation* milestone (not a fresh TZ BUY)
  meets a newer branch that already held an active buy before that day.

## Key implementation point: "whichever occurred last" is structural, not tracked

Every tier's own reference is, by construction, both numerically higher AND
chronologically later than the tier before it (each tier only forms by
clearing the previous tier's reference by ≥0.20). So "the reference that
occurred last" always collapses to "the current reference of the most
advanced tier this lineage has reached." `_current_top_ref()` checks, in
order: the newest non-superseded BAR generation's BAR 2 (or BAR) reference →
REAR RE-ENTER 2 → REAR RE-ENTER → REAR 2 → REAR → TZ BUY 2 → TZ BUY → TZ
GREEN. No separate "last touched" timestamp bookkeeping is needed.

## Multi-branch machinery (ported from the base 37-event engine, v4)

- **`_buy_currently_live(c)`**: mirrors base engine §9 — False if the buy
  never formed or died before TZ BUY 2 ever formed; otherwise cascades
  through REAR RE-ENTER → REAR → BAR generations → TZ BUY 2, live if the
  deepest-reached structure's own SL hasn't fired (REAR/REAR RE-ENTER are
  single-tier, so this is a plain "has its SL fired" check; BAR generations
  and TZ BUY 2 still check their own SL2/SL as applicable).
- **`_spawn_eligible()`**: the *tip anchor* (newest branch whose own TZ GREEN
  SL hasn't fired) must have had its own RED2 fire, not be dormant, and its
  buy must be nonexistent, top-level-dead (TZ BUY SL before TZ BUY 2), or
  have reached deep failure (`ever_deep_failure`) and not be currently live.
- **Leadership contest**: processed oldest-branch-first each day (so a
  same-day tie resolves to the older branch, matching the user's explicit
  rule) for every branch that fired a milestone today (TZ BUY formation, a
  fresh BAR generation — from *any* gate — REAR, or REAR RE-ENTER). Every
  other still-active branch: older → `dormant = True`; newer → `dead = True`
  (collateral damage: that branch's entire day is wiped) unless exempted
  (continuation milestone + the newer branch already held an active buy
  before today, per a pre-today snapshot).
- **Dormancy display filtering**: a dormant branch keeps computing
  everything backend-side every candle (unaffected — `_eval_cycle` doesn't
  check `dormant` at all internally); only the *display* is filtered: HH-type
  events (any `" HH("` event) and the whole RED-family are suppressed;
  milestone-formation and SL/LL-type events always show.
- **System-wide dormancy lift**: every day, if no active branch anywhere
  currently holds a live buy, every branch's dormancy clears.

## Resolutions adopted (judgment calls, not verified facts)

**A. TZ BUY's own SL, once TZ BUY 2 exists** — mirrors the original theory's
"does not stop the BAR family below it": TZ BUY's own top-level SL is never
checked again once TZ BUY 2 forms (does **not** set the branch `dead` —
buy-level and branch-level "active" are separate flags, mirroring the base
engine). Branch-level `dead` is reserved strictly for TZ GREEN's own SL.

**B. TZ BUY SL before TZ BUY 2 ever formed** — mirrors TZ GREEN's own
"before RED2" case: `buy_sl_fired = True` (opens spawn eligibility via that
OR-branch) but the branch itself stays alive/active; no REAR queued, no "NEW
TZ BUY" retry (no such mechanic exists in this theory).

**C. A fresh BAR generation always queues "REAR" on its own SL2**,
regardless of which gate (TZ BUY 2 / REAR 2 / REAR RE-ENTER 2) unlocked that
particular cascade — reactivating REAR under the same label if it already
exists (single-slot, newest reference wins, same convention used throughout
this family). Not explicitly addressed by the user for the "cascade opened
under REAR 2 or REAR RE-ENTER 2" case specifically; the simpler uniform rule
was chosen over inventing a different target event per gate.

**D. `bar_gate`** tracks whichever "2" tier most recently unlocked the
currently-open cascade, since three different tiers can now do so; "BAR -
BAR 2 can occur while [gate] is active" is checked against that specific
gate, not hardcoded to TZ BUY 2.

**E. LL is never suppressed** — TZ GREEN's own LL, TZ BUY's own LL, and
every "2"/generation's own LL keep tracking regardless of what's formed
above them, for the entire life of the branch (this is independent of, and
not affected by, dormancy display filtering, which suppresses HH/RED-family
only).

**F. REAR RE-ENTER's own SL self-recovers (revised in v7)** — superseded:
earlier said to be genuinely terminal (no self-recovery, freezes REAR
RE-ENTER 2). Explicit user correction: REAR RE-ENTER has its own
SL → REAR RE-ENTER cycle, same event text on reactivation (not a distinct
"RECOVER" suffix, since it has nowhere further to route to and loops on
itself instead), and REAR RE-ENTER 2 does NOT freeze on this SL — it keeps
tracking independently. `ever_deep_failure = True` still fires the instant
the SL fires (opens spawn eligibility for a fresh sibling elsewhere),
regardless of whether this branch later self-recovers.

**G. Compound failure (added in v7)** — when REAR RE-ENTER's own SL AND
REAR RE-ENTER 2's own SL are simultaneously active, REAR RE-ENTER can
instead reactivate above REAR RE-ENTER 2's own (higher) reference, racing a
fresh sibling TZ GREEN(n+1) reaching its own TZ BUY — arbitrated entirely by
the pre-existing leadership contest (§7a), no separate mechanism needed.
Same single-slot `pending_ref`/`pending_kind` convention as every other
queued reference; same event text as ordinary self-recovery.

## Not yet modeled / open

- TZ GREEN's own SL is checked every candle for the entire life of the
  branch, per the base engine's own discipline — including deep into
  BAR/REAR/REAR RE-ENTER territory, however many "waves" of BAR cascades
  have occurred since. Still technically live in this implementation and
  untested against real data (a very rare, deeply degenerate case).
- The stage-level dormancy nuance from the base engine (§7b — RED2-exhaustion
  dormancy specific to REAR/REAR RE-ENTER while awaiting a fresh BAR) was
  **not** ported; only branch-level dormancy (§7a) was. The new theory's own
  explicit fork (REAR 2's RED2 → fresh cascade, vs. REAR's own SL escalation)
  plays a similar structural role, so this may not be needed at all — flagged
  for reconsideration once real data is available.
- "Whichever occurred last" is implemented as "whichever tier is
  structurally most advanced," which is provably equivalent under the stated
  construction (see above) — but only for a *single* lineage. It has not
  been extended to consider inherited/borrowed references across *sibling*
  branches (the base engine's own §1a reference-high inheritance) — not
  requested here.

## Version history

- **v1**: TZ GREEN → TZ GREEN 2 → TZ BUY → TZ BUY 2 → BAR (unlimited) → REAR.
  Dismissed: no "TZ GREEN 2" in this theory.
- **v2**: dropped TZ BUY/TZ BUY 2, had BAR form directly off TZ GREEN.
  Dismissed: TZ BUY/TZ BUY 2 reinstated, BAR forms off TZ BUY 2 again.
- **v3**: reinstated TZ BUY/TZ BUY 2; introduced REAR RE-ENTER; used a
  single-slot cross-branch "race" mechanic for REAR/REAR RE-ENTER vs. a
  fresh sibling. Superseded: the "race" was actually the base engine's own
  leadership contest, and spawn eligibility was too restrictive (sequential,
  not multi-branch).
- **v4**: full multi-branch support ported from the base 37-event engine
  (spawn eligibility, leadership contest, dormancy display, system-wide
  dormancy lift) — replaces v3's ad-hoc race entirely.
- **v5**: added REAR 2 and REAR RE-ENTER 2, each with BAR 2's dual role
  (fresh-cascade trigger + parent-SL-escalation gate).
- **v6**: reverted the "parent-SL-escalation gate" half of v5. Explicit user
  correction: "REAR SL is enough as earlier. Nothing like REAR SL2. likewise
  for REAR RE-ENTER." REAR's own SL and REAR RE-ENTER's own SL are both
  single-tier again, ungated by their "2" tier. REAR 2 / REAR RE-ENTER 2
  keep only the fresh-BAR-cascade trigger role.
- **v7**: REAR RE-ENTER's own SL now self-recovers (same event text on
  reactivation) instead of being terminal; REAR RE-ENTER 2 keeps tracking
  independently through that SL rather than freezing; added the
  compound-failure reactivation path (both SLs active at once → reactivate
  above REAR RE-ENTER 2's own reference, racing a fresh sibling per the
  leadership contest). Also fixed two bugs surfaced while building the test
  for this:
  - `eval_tier2_advance` (formerly two separately-called functions,
    `eval_tier2_hh_ll` + `eval_tier2_sl_cycle`): LL always ran before SL and
    always ratcheted `ref_low` down to today's own Low first, so the SL
    check's gap was always exactly 0 — SL was completely unreachable for
    every "2" tier (TZ BUY 2, BAR 2, REAR 2, REAR RE-ENTER 2) in every prior
    version. Fixed by merging into one function with SL checked before LL,
    using the reference as it stood before today's own update (mirrors TZ
    GREEN's own already-correct SL-before-LL ordering).
  - `_current_top_ref`: treated any non-`superseded` BAR generation as
    unconditionally "the deepest," even once it had long since concluded
    (its own SL2 fired) and the branch had since progressed into REAR / REAR
    2 / REAR RE-ENTER / REAR RE-ENTER 2 territory without ever reopening a
    fresh cascade above it. A frozen, buy2-gated BAR generation would then
    outrank REAR 2's or REAR RE-ENTER 2's own (numerically higher,
    chronologically later) reference simply because nothing had marked it
    `superseded`. Fixed using `Cycle.bar_gate` (which "2" tier opened the
    *current* BAR generation) to determine what that generation actually
    postdates: a buy2-gated generation predates REAR entirely; a
    rear2-gated one predates REAR RE-ENTER (REAR 2's dual role stops running
    the instant REAR RE-ENTER forms, so this ordering is guaranteed); a
    rear_reenter2-gated one is unconditionally the deepest tier that exists.
    This was latent in v4-v6 too (e.g. REAR's own SL queuing REAR RE-ENTER's
    reference off a stale frozen BAR generation instead of REAR 2's own) but
    never surfaced a wrong answer until the compound-failure test needed to
    distinguish REAR RE-ENTER 2's reference from an old BAR generation's.

## Testing so far

`test_new_theory_smoke.py` runs four independent synthetic OHLC sequences
(kept as separate `Engine()` instances — a spawned sibling shares every
subsequent candle with the lineage that spawned it, which makes hand-picking
collision-free numbers for a single continuous multi-lineage scenario
intractable):

1. Early death (TZ GREEN SL before RED2) → immediate fresh sibling, then a
   full escalation through TZ BUY → TZ BUY 2 → BAR → BAR 2 → a second BAR
   generation → BAR SL → BAR SL2 → REAR → REAR 2 → REAR SL (single-tier,
   directly queues REAR RE-ENTER's reference) → REAR RE-ENTER, all
   confirming uncontested. Asserts REAR SL2 / REAR RE-ENTER SL2 never fire.
2. TZ BUY SL before TZ BUY 2 ever formed → immediate fresh sibling, no REAR.
3. REAR 2's dual role specifically: after REAR 2 forms, RED1→RED2 against it
   (not REAR's own SL) opens a fresh BAR generation — asserts REAR's own SL
   does NOT fire in this scenario (SL beats RED1/RED2 is a *per-candle*
   priority, not a claim that RED1/RED2 can never coexist with an eventually-
   separate SL path).
4. Reuses Run 1's sequence through REAR RE-ENTER(B) confirming, then
   continues: REAR RE-ENTER's own SL fires and self-recovers uncontested
   (same event text on reactivation); REAR RE-ENTER 2 then reforms; a later
   candle fires REAR RE-ENTER's own SL and REAR RE-ENTER 2's own SL on the
   SAME candle (the compound-failure state), which queues REAR RE-ENTER's
   reactivation above REAR RE-ENTER 2's own reference; confirms on the next
   qualifying candle. This is the test that surfaced both bugs documented
   under v7 above.

This only proves the state machine's plumbing is internally consistent on
data built to exercise it — it is **not** a substitute for verification
against real OHLC, which this theory has never had. Multi-branch spawn
eligibility, the leadership contest, and dormancy filtering are exercised
incidentally by every run (siblings spawn as a side effect throughout) but
do not yet have a dedicated, deliberately-constructed test — that's the
next piece of work if more confidence in that layer specifically is wanted
before real data arrives. Run `python3 test_new_theory_smoke.py`.
