# WTF — the TZ ENGINE itself, extended with TZ BUY 2 / BAR 2 / REAR 2 / REAR RE-ENTER 2

**Status:** TZ BUY 2 is a new, provisional layer — **not yet verified against
real OHLC data**. Everything at BAR 2 / REAR 2 / REAR RE-ENTER 2 and below
carries over its original real-data validation from `tz_engine_bar2_variant.py`
(verified end-to-end against 01-01-2020 through 08-08-2020) unchanged — this
file only adds a new tier one level above what that file already proved.

## What WTF is, and how it relates to the other two files in this repo

Per the user's framing: this project develops three theories —
**A) WTF** (the TZ ENGINE itself — the theory this file covers),
**B) DTF with respect to WTF**, **C) DTF** — with WTF the current focus.
WTF is **not** the from-scratch `tz_engine_new_theory.py` theory on this same
branch (that is a separate, independent hypothesis with its own TZ BUY→BAR
structure that predates TZ BUY 2 entirely) — it is the real TZ ENGINE
(`tz_engine_v9.py`, the validated 37-event base) extended in place with a
"2"-tier confirmation gate at TZ BUY, in addition to the "2" tiers BAR/REAR/
REAR RE-ENTER already have in `tz_engine_bar2_variant.py`.

`tz_engine_wtf.py` was built by copying `tz_engine_bar2_variant.py` (already
has BAR 2/REAR 2/REAR RE-ENTER 2, real-data-validated) and adding TZ BUY 2 on
top, following the exact same "2"-tier pattern, rather than re-deriving that
already-solved layer from the un-extended base engine.

## The flow

```
TZ GREEN → RED → TZ BUY (above TZ GREEN's own ref) →
TZ BUY 2 (above TZ BUY's own ref) →
RED1 → RED2 (vs TZ BUY — NOT reachable until TZ BUY 2 has formed) →
BAR(1) → BAR 2(1) → RED1 → RED2 → BAR(2) → BAR 2(2) → ... (unlimited) →
BAR SL → BAR SL2 (only reachable once BAR 2 has formed) →
REAR → REAR 2 → RED1 → RED2 → BAR(1) (fresh cascade, REAR 2's own dual role) →
REAR SL (only reachable once REAR 2 has formed) →
REAR RE-ENTER → REAR RE-ENTER 2 → RED1 → RED2 → BAR(1) (fresh cascade) →
REAR RE-ENTER SL (only reachable once REAR RE-ENTER 2 has formed) →
REAR RE-ENTER (self-recovers, same event text, terminal)
```

TZ BUY 2 breaks the pattern in exactly one place: unlike BAR/REAR/REAR
RE-ENTER's own SL (which are permanent dead ends when their "2" never
formed), **TZ BUY's own top-level SL is never a dead end** — it always
permits a NEW TZ BUY retry, exactly as the un-extended base engine's system-
wide safety valve already does. TZ BUY 2's only effect on that transition is
*which reference* the retry must clear.

## Rules, as given by the user (verbatim intent, lightly formatted)

- **TZ BUY 2 exists, alongside BAR 2** — both explicitly requested
  ("Include TZ BUY 2 AND BAR 2 as well").
- **RED1/RED2 gating**: "NO RED1-RED2 UNTIL TZ BUY2 is THERE" — RED1 cannot
  attach to TZ BUY at all until TZ BUY 2 has formed. Mirrors BAR 2 gating
  RED1 on its BAR lineage exactly. (This is a change from the un-extended
  base engine, where RED1/RED2 attaches directly to TZ BUY with no gate.)
- **TZ BUY 2's own SL/recovery**: "TZ BUY 2 SL - TZ BUY 2 (new should form)
  or TZ BUY SL" — TZ BUY 2 has its own independent, single-tier SL/recovery
  cycle (recovers under the same event text, no escalation of its own —
  identical shape to BAR 2/REAR 2/REAR RE-ENTER 2), and/or TZ BUY's own
  top-level SL can separately fire the same day or later.
- **TZ BUY SL escalation**: "TZ BUY - TZ BUY 2 - TZ BUY 2 SL - TZ BUY SL -
  TZ BUY (NEW ABOVE THE TZ BUY 2 REFERENCE HIGH) - TZ BUY 2" — once TZ BUY's
  own top-level SL fires, NEW TZ BUY's threshold is TZ BUY 2's own (frozen)
  reference if TZ BUY 2 ever formed, else the dead buy's own raw peak
  exactly as the un-extended base engine already used. Confirmed via
  explicit choice: "TZ BUY 2 mirrors BAR 2 exactly."
- **Spawn eligibility for TZ GREEN(n+1)**: "TZ BUY 2 SL: No. Only either of
  the above can happen [TZ BUY 2 reforms, or TZ BUY SL fires] ... TZ BUY SL:
  YES. TZ BUY SL before or after TZ BUY 2, opens window for TZ GREEN(N+1)
  Unless new TZ BUY occurs. Race will begin." — TZ BUY 2's own SL alone does
  **not** open spawn eligibility; only TZ BUY's own top-level SL does. This
  required **zero new code**: the base engine's existing spawn-eligibility
  rule (§8 — anchor's buy nonexistent, top-level-dead, or deep-failed-and-
  not-live) already keys off `buy.active`, not anything BAR-2/TZ-BUY-2-
  specific, so it already produces exactly this behavior. Once both a fresh
  sibling and a NEW TZ BUY retry become simultaneously eligible, the
  existing leadership contest (both are *fresh* milestones — no
  continuation exemption) already arbitrates the race: whichever reaches
  its own TZ BUY/NEW TZ BUY milestone first wins outright.
- **REAR RE-ENTER 2 exists too** — confirmed explicitly ("Yes, add REAR
  RE-ENTER 2"), full symmetry with BAR 2/REAR 2, already present in
  `tz_engine_bar2_variant.py` (this predates the TZ BUY 2 question — it was
  simply confirmed still applies here).

## Implementation notes

- `Buy.buy2: Optional[Bar2]` reuses the exact same `Bar2` dataclass already
  used for `BarLineage.bar2` / `Rear.rear2` / `RearReenter.rre2` — same
  shape everywhere in this file.
- `_eval_buy2` mirrors `_eval_bar2` field-for-field, one tier up: forms off
  `buy.ref_high` (pre-today snapshot, avoiding the same-day self-comparison
  bug already solved at every other tier in this file); does full HH/LL/SL/
  recovery tracking for as long as `buy.active` is True, regardless of
  whether `bar_lineages`/`bar_pending`/`rear`/`rear_reenter` exist yet
  (mirrors `_eval_bar2` not caring about its lineage's own RED2/bar_pending
  state); switches to quiet "INVALID TZ BUY 2 HH" climbing once `buy.active`
  is False (mirrors `_eval_bar2`'s behavior once `lin.sl` is set) — a new
  named event, invented for consistency with "INVALID BAR HH"/"INVALID REAR
  HH"/"INVALID REAR RE-ENTER HH", since the user didn't specify a name for
  this narrow, rarely-hit corner and none exists in the original 37-event
  vocabulary.
- **Display suppression**: TZ BUY's own HH is permanently suppressed once
  `buy.buy2` exists (mirrors BAR HH suppressed once BAR 2 exists); LL is
  never suppressed. The retroactive same-day suppression pass (an
  underlying SL beats its own "2" tier's SL/LL the same day; a "2"
  producing any event suppresses that label's underlying HH the same day
  too) was extended to include TZ BUY/NEW TZ BUY HH and TZ BUY 2 SL/LL,
  mirroring the existing BAR/REAR/REAR RE-ENTER entries exactly.
- **Not added to `SL_LL_KEYS`** (the dormancy-display-exemption list): TZ
  BUY 2's own SL/LL, matching the existing choice for BAR 2/REAR 2/REAR
  RE-ENTER 2's own SL/LL, none of which are in that list either — kept
  consistent rather than introducing an asymmetry.
- **Not added to `MILESTONE_KEYS`**: TZ BUY 2's own formation isn't a
  leadership-contest milestone, matching BAR 2/REAR 2/REAR RE-ENTER 2's own
  formation, none of which trigger the contest either (only the base tier's
  formation does).
- `old_buy_unresolved` (blocks NEW TZ BUY while a BAR/REAR family is still
  racing on the dead buy) was **not** extended to check `buy.buy2` — TZ BUY
  2 alone quietly climbing post-death isn't "still racing toward something,"
  unlike an unresolved BAR/REAR family.

## Testing so far

`test_wtf_smoke.py` — three independent synthetic OHLC sequences (own
`TZEngine()` each):

1. Full escalation TZ GREEN → RED → TZ BUY → TZ BUY 2 → RED1 → RED2 (gated
   on TZ BUY 2) → BAR(A.1) — confirms the new gate doesn't break the
   existing BAR-family machinery below it.
2. TZ BUY SL with no TZ BUY 2 ever formed → NEW TZ BUY off the dead buy's
   own raw peak, unchanged from the un-extended base engine.
3. TZ BUY SL after TZ BUY 2 already existed → NEW TZ BUY off TZ BUY 2's own
   (higher) reference, not the raw old peak; a companion run confirms a
   candle that clears the old peak but not TZ BUY 2's reference does
   **not** form NEW TZ BUY.

This only proves the new layer's plumbing is internally consistent on data
built to exercise it — not a substitute for verification against real OHLC,
which TZ BUY 2 specifically has never had (unlike BAR 2/REAR 2/REAR
RE-ENTER 2, already proven against the 2020 dataset). Run
`python3 test_wtf_smoke.py`.
