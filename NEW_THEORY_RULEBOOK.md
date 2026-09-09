# New Theory — v2: TZ GREEN → BAR (unlimited) → REAR

**Status:** provisional design + implementation (`tz_engine_new_theory.py`).
**Not yet verified against real OHLC data** — no dataset has been supplied for
this theory. Treat every mechanic as a hypothesis until it's run against real
data and confirmed, per this project's standing discipline (never guess past
a flagged date, re-verify after every fix).

This is a separate, from-scratch theory. It does **not** touch, extend, or
depend on `tz_engine_v9.py`, `tz_engine_bar2_variant.py`, or the DTF/WTF
variant — those are unrelated, already-built work on
`claude/rulebook-logic-interpretation-g3z130`.

**v2 supersedes v1** (the earlier TZ GREEN → TZ BUY → BAR → REAR draft in this
same file's history). TZ BUY / TZ BUY 2 / TZ GREEN 2 are removed entirely.

## The flow, as given verbatim

```
TZ GREEN - RED1 - RED2 - BAR - BAR2 - RED1 - RED2 - BAR - BAR2 -
RED1/BAR SL - RED2/BAR SL - BAR SL2 -
TZ GREEN NEW CYCLE (TZ GREEN - RED1 - RED2 - BAR) / REAR, whichever is earlier
```

## Rules, as given

- **TZ GREEN**: unchanged (Low ≥ PrevLow, High > PrevHigh by ≥0.20, Close ≥
  PrevHigh, subject to branch-spawn eligibility). HH/LL/SL unchanged.
- **RED1 / RED2**: unchanged shape, but now attach **directly to TZ GREEN**
  (no "TZ GREEN 2" gate — that tier no longer exists in v2).
- **BAR**: forms above **TZ GREEN's own reference high** (not TZ BUY 2's, not
  TZ GREEN 2's). Low compared to Previous Day, High/Close compared to TZ
  GREEN's reference high. Only once TZ GREEN's own RED2 has fired.
- **BAR 2**: forms above BAR's own reference high (same shape/mechanics as
  the already-established BAR 2 template — single-tier SL/recovery, no
  escalation of its own).
- BAR / BAR 2 are unlimited, exactly as before: BAR(n) → BAR 2(n) → RED1 →
  RED2 → BAR(n+1) → BAR 2(n+1) → … until a BAR SL2 fires.
- **TZ GREEN SL2: not needed.** TZ GREEN's own SL is single-shot per cycle —
  no deeper escalation tier of its own.
- **TZ BUY / TZ BUY 2: not needed** — removed entirely, confirmed twice.
- **Post TZ GREEN SL:**
  - **Before RED2** (TZ GREEN's own RED2 has never fired for this cycle): a
    new lineage starts immediately. No REAR involved — nothing to queue a
    reference from yet.
  - **After RED2**: REAR can occur, using whichever of {TZ GREEN's own
    reference high, the last-confirmed BAR 2's reference high} occurred
    **last** before the TZ GREEN SL.
- **REAR — BIG CHANGE**: REAR forms above BAR 2's reference in the case of a
  BAR SL2 trigger (the original mechanism). REAR forms above TZ GREEN's own
  reference high in the case of a (post-RED2) TZ GREEN SL trigger.
- **REAR 2**: same BAR-2 shape, above REAR's own reference high.

## Resolutions adopted (judgment calls, not verified facts)

**A. "Whichever occurred last" vs. the "BIG CHANGE" trigger-based rule.**
The rules give two readings for REAR's reference on a post-RED2 TZ GREEN SL:
(1) whichever of {TZ GREEN's ref, last BAR 2's ref} is more recent, or (2) the
simpler, explicitly-flagged "BIG CHANGE": TZ GREEN SL → always TZ GREEN's own
ref; BAR SL2 → always BAR 2's own ref. **Adopted: (2)**, since it's the one
explicitly labeled as the corrected/final statement. Revisit if real data
shows a case where the *last-confirmed-reference* reading (1) would give a
different, better answer (e.g. TZ GREEN SL fires while a BAR 2 higher than TZ
GREEN's own ref is still the most recently confirmed structure).

**B. The endgame race — what "whichever is earlier" means, mechanically.**
Adopted: a **single-slot, first-past-the-post race** between (i) REAR
confirming (a real recovery breakout above the queued reference — Low ≥
PrevLow, High − ref ≥ 0.20, Close ≥ ref; not an instant formation on the
triggering candle itself, mirroring the already-established base-engine
recovery-confirmation pattern) and (ii) **any** fresh sibling TZ GREEN cycle
completing its own TZ GREEN → RED1 → RED2 → BAR sequence and reaching its own
first BAR formation. Whichever happens first wins:
  - If a sibling reaches its own first BAR before REAR confirms, REAR is
    **cancelled** (the queued reference is discarded, never confirms) and the
    sibling continues on as the ongoing story.
  - If REAR confirms first, it becomes the terminal structure for the
    original cycle; any sibling still mid-attempt is not retroactively
    erased (its already-fired events stand), it simply stops mattering for
    this race — it keeps existing as a normal cycle in its own right.
  - **Same-day tie** (both conditions satisfied on the identical candle):
    REAR wins, since its reference was queued earlier in wall-clock time. Not
    verified against real data — a genuine tie is expected to be rare.
  - **Recursive re-attempts**: a sibling that itself dies (its own TZ GREEN
    SL, before its own RED2) does not cancel the race — it just becomes
    eligible-anchor for yet another fresh attempt, same as the very first
    failure was. The queued REAR reference keeps racing across any number of
    failed sibling attempts.
  - **Single slot**: if the racing sibling itself later reaches its own BAR
    SL2 (having already won the earlier race), that queues a *new* pending
    REAR reference, single-slot-superseding style (mirrors the base engine's
    own REAR-family single-slot convention) — there is only ever one race in
    flight at a time.

**C. Branch-spawn eligibility.** A fresh sibling TZ GREEN may spawn once the
most recent cycle's own forward progress is over — either its own TZ GREEN SL
fired, or any of its BAR generations reached SL2. (No separate "is a buy
still live" check exists in v2, since TZ BUY is gone — this single
`terminated` flag is now the whole gate.)

**D. BAR's own SL/SL2 vs. BAR 2's own SL** — unchanged from v1: BAR's own
two-tier SL/SL2 escalation is gated on that generation's BAR 2 having formed
at all (a BAR SL with no BAR 2 is a dead end — no SL/SL2 tracking reachable).
BAR 2's own SL/recovery is a separate, single-tier cycle, does not persist
through BAR-level reactivation.

**E. LL is never suppressed** (carried over from v1) — only HH suppression is
tied to a tier's own display rules; TZ GREEN's own LL, BAR's own LL, and BAR
2/REAR 2's own LL all keep tracking regardless of what's formed above them.

## Not yet modeled / open

- TZ GREEN's own HH is **not** suppressed by anything in v2 (there's no "TZ
  GREEN 2" to suppress it the way v1 had) — it keeps climbing for the life of
  the cycle. Not explicitly addressed in the v2 rules as given; flagged for
  confirmation once real data is available.
- No cross-cycle leadership/dormancy contest (mirrors v1's same
  simplification) — every cycle tracks and displays independently other than
  the single-slot REAR race described above.
- Reference selection reading (A) above (last-confirmed-wins instead of
  trigger-based) is the most likely candidate for revision once real data
  disagrees with the simpler adopted rule.

## Testing so far

`test_new_theory_smoke.py` walks one hand-constructed, synthetic OHLC
sequence through three scenarios back to back:
1. TZ GREEN SL before RED2 → immediate fresh sibling, no REAR queued.
2. BAR SL2 → REAR confirms on the very next qualifying candle (the ordinary,
   uncontested case — "REAR wins" because nothing else had time to race it).
3. BAR SL2 → a fresh sibling completes its own TZ GREEN → RED1 → RED2 → BAR
   faster than the queued REAR reference ever confirms — "new cycle wins",
   and the test asserts REAR never fires for that cycle.

This only proves the state machine's plumbing is internally consistent on
data built to exercise it — it is **not** a substitute for verification
against real OHLC, which this theory has never had. Run `python3
test_new_theory_smoke.py`.
