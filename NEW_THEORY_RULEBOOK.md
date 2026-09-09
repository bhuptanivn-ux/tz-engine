# New Theory — v3: TZ GREEN → TZ BUY → BAR (unlimited) → REAR → REAR RE-ENTER

**Status:** provisional design + implementation (`tz_engine_new_theory.py`).
**Not yet verified against real OHLC data** — no dataset has been supplied
for this theory. Treat every mechanic as a hypothesis until it's run against
real data and confirmed, per this project's standing discipline (never guess
past a flagged date, re-verify after every fix).

This is a separate, from-scratch theory. It does **not** touch, extend, or
depend on `tz_engine_v9.py`, `tz_engine_bar2_variant.py`, or the DTF/WTF
variant — those are unrelated, already-built work on
`claude/rulebook-logic-interpretation-g3z130`.

**v3 supersedes v2.** v2 had dropped TZ BUY/TZ BUY 2 entirely and had BAR
form directly off TZ GREEN — that change is **dismissed**. TZ BUY / TZ BUY 2
are reinstated as the tier between TZ GREEN and BAR, matching the original
theory's shape.

## The flow (v3)

```
TZ GREEN → RED1 → RED2 (vs TZ GREEN) →
TZ BUY (above TZ GREEN's own ref high) → TZ BUY 2 (above TZ BUY's own ref) →
RED1 → RED2 (vs TZ BUY 2) →
BAR(1) (above TZ BUY 2's ref, orthodox shape) → BAR 2(1) → RED1 → RED2 →
BAR(2) → BAR 2(2) → ... (unlimited, while TZ BUY 2 stays active) ...
→ BAR SL → BAR SL2 ────────────────────┐
                                         ├──> RACE: REAR (above the current
TZ GREEN SL (after its own RED2) ───────┘     highest-tier reference reached
                                               so far) vs. a fresh sibling TZ
                                               GREEN reaching ITS OWN TZ BUY
                                               — whichever is earlier wins; a
                                               same-day tie favors the older
                                               lineage's REAR.
→ REAR → REAR 2 → REAR SL → RACE: REAR RE-ENTER (above REAR's own reference)
  vs. a fresh sibling reaching its own TZ BUY — same tie rule.
→ REAR RE-ENTER (terminal leaf: single-tier SL/recovery, no further tier)

TZ GREEN SL (before its own RED2 ever fired), or TZ BUY SL (before TZ BUY 2
ever formed): immediate fresh sibling, no REAR/RE-ENTER queued at all —
nothing established yet to recover from.
```

## Rules, as given

- **TZ GREEN**: unchanged (formation, HH/LL/SL).
- **RED1 / RED2**: unchanged shape, attach directly to TZ GREEN (no "TZ
  GREEN 2" — that tier never existed beyond the v2 draft).
- **TZ BUY**: reinstated. Forms above TZ GREEN's own reference high, once TZ
  GREEN's own RED2 has fired.
- **TZ BUY 2**: forms above TZ BUY's own reference high (the established
  "BAR 2" template shape).
- **BAR**: "as the original theory" — forms above TZ BUY 2's reference,
  once RED1→RED2 has fired against TZ BUY 2. (The v2 change — BAR forming
  directly off TZ GREEN's reference — is dismissed.)
- **BAR / BAR 2**: unlimited, exactly as established — BAR(n) → BAR 2(n) →
  RED1 → RED2 → BAR(n+1) → ... "BAR - BAR 2 can occur if TZ BUY 2 is active"
  — new generations can only keep forming while TZ BUY 2 is pre-SL (or has
  recovered).
- **Post TZ GREEN SL**: before its own RED2, a new lineage starts
  immediately, no REAR. After RED2, REAR can occur above whichever of {TZ
  GREEN's own ref, the last-confirmed BAR 2's ref} **occurred last**.
- **"Whichever occurred last"**, clarified: this is a single, general
  principle across BOTH REAR triggers (TZ GREEN SL and BAR SL), not two
  separate rules. If a BAR (and BAR 2) has ever formed for this lineage,
  its BAR 2 reference is what "occurred last" — even if the actual failure
  event is a TZ GREEN SL — because a BAR 2 reference **is** conceptually a
  TZ GREEN reference that has simply climbed higher under a different name.
  TZ GREEN's own reference only applies when nothing beyond it has ever
  formed. This **replaces** v2's trigger-based "BIG CHANGE" simplification,
  which was wrong: it read the BAR SL2 vs. TZ GREEN SL triggers as picking
  different reference *sources*, when actually there is one reference
  (whichever tier is most advanced) regardless of which trigger fires.
- **REAR RE-ENTER, new in v3**: if REAR's own SL fires, a race begins
  between REAR RE-ENTER (above REAR's own reference — REAR is itself the
  most-recently-established reference at that point, so no ambiguity) and a
  fresh sibling reaching its own TZ BUY.
- **Race tie-break**: "the earlier will be given preference" — if a fresh
  sibling reaches TZ BUY the same day REAR (or REAR RE-ENTER) confirms, the
  **older lineage's recovery wins**, and the new lineage is terminated (not
  "discarded silently" — it is a real termination, opening spawn eligibility
  for yet another attempt immediately, same as any other terminated cycle).
- **Recursive**: if REAR itself later fails (its own SL), a fresh lineage
  starts and races for TZ BUY against REAR RE-ENTER, by the same rule.

## Key implementation point: "whichever occurred last" is structural, not tracked

Every tier's own reference is, by construction, both numerically higher AND
chronologically later than the tier before it (each tier only forms by
clearing the previous tier's reference by ≥0.20). So "the reference that
occurred last" always collapses to "the current reference of the most
advanced tier this lineage has reached" — TZ GREEN's own if nothing beyond
it ever formed, else TZ BUY's, else TZ BUY 2's, else the active/newest BAR
generation's BAR 2 reference. `_current_top_ref()` implements this directly;
no separate "last touched" timestamp bookkeeping is needed. This single
helper is used for both REAR's own reference (from either trigger) — REAR
RE-ENTER's reference is simpler still, always REAR's own (REAR is
unambiguously the most recent tier once it exists).

## Resolutions adopted (judgment calls, not verified facts)

**A. TZ BUY's own SL, once TZ BUY 2 exists** — not addressed in the rules as
given. Adopted, by direct analogy to how TZ BUY's SL behaved in the original
theory ("does not stop the BAR family below it"): once TZ BUY 2 has formed,
TZ BUY's own top-level SL is never checked again — TZ BUY 2 becomes the
locus of control (its own SL/recovery cycle, and the "BAR - BAR 2 can occur
if TZ BUY 2 is active" gate, govern everything from there). TZ BUY's SL only
matters, and only ever terminates the lineage, while TZ BUY 2 has not yet
formed.

**B. TZ BUY SL before TZ BUY 2 ever formed** — treated exactly like TZ
GREEN's own "before RED2" case: the whole lineage terminates immediately, no
REAR queued, a fresh sibling becomes eligible. Not a "NEW TZ BUY" retry under
the same TZ GREEN (no such mechanic exists in this theory, same as v1/v2).

**C. Race-winning condition for the fresh sibling** — reaching its own TZ
BUY (the first escalation milestone after TZ GREEN in v3, replacing v2's
"reaching BAR"). Merely *spawning* a fresh TZ GREEN does not win anything —
in practice a sibling almost always spawns immediately once eligible (any
qualifying breakout does it), often the very same day the old lineage's REAR
confirms; that is not a race outcome, just two independent, unrelated events
sharing a candle. Only actually reaching TZ BUY counts.

**D. Single slot, newest wins** — if the sibling that's currently "the
challenger" itself fails early (before reaching TZ BUY 2), it doesn't cancel
the race; the queued reference keeps racing across any number of failed
sibling attempts. If that sibling instead reaches its own BAR SL2 (having
already won an earlier race), that queues a *new* pending reference,
single-slot-superseding style — there is only ever one race in flight.

**E. LL is never suppressed** (carried over from v1/v2) — TZ GREEN's own
LL, TZ BUY's own LL, and every "2" tier's own LL keep tracking regardless of
what's formed above them.

## Not yet modeled / open

- TZ GREEN's own SL is checked every candle for the entire life of the
  cycle, per the base engine's own established discipline — including deep
  into BAR/REAR/REAR RE-ENTER territory. This is a very rare, deeply
  degenerate case (price would have to round-trip almost all the way back to
  TZ GREEN's original low), but it is technically still live in this
  implementation and untested against real data.
- No cross-cycle leadership/dormancy contest — every cycle tracks and
  displays independently other than the single-slot REAR/REAR RE-ENTER race.
- REAR RE-ENTER has no "REAR RE-ENTER 2" — kept as the terminal leaf per the
  base engine's own convention ("the deepest, terminal leaf of the entire
  hierarchy"), since nothing further was described.

## Testing so far

`test_new_theory_smoke.py` runs two independent synthetic OHLC sequences:
1. Early death (TZ GREEN SL before RED2) → immediate fresh sibling, then a
   full escalation (TZ GREEN → TZ BUY → TZ BUY 2 → BAR → BAR 2 → a second BAR
   generation → BAR SL → BAR SL2 → REAR confirms uncontested → REAR 2 →
   REAR SL → REAR RE-ENTER confirms uncontested).
2. TZ BUY SL before TZ BUY 2 ever formed → immediate fresh sibling, no REAR.

Kept as two separate day sequences (two `Engine()` instances) specifically
because a fresh sibling spawning mid-sequence as a side effect of the older
lineage terminating shares every subsequent OHLC candle with that older
lineage — hand-picking numbers that drive one lineage's mechanics without
also tripping the other lineage's own SL thresholds becomes intractable
once both are alive on the same days. This only proves the state machine's
plumbing is internally consistent on data built to exercise it — it is
**not** a substitute for verification against real OHLC, which this theory
has never had. Run `python3 test_new_theory_smoke.py`.
