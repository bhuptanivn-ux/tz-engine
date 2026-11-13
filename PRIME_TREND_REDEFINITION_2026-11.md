# PRIME TREND + BAR THEORY — redefinition in progress (2026-11)

**Status: WORK IN PROGRESS.** This captures everything confirmed, piece by
piece, in the ongoing session re-defining PRIME TREND "once and for all."
It will eventually replace/update `PRIME_TREND_RULEBOOK.md` (currently very
stale — describes an old Python Stage1/Stage2 model, not the current
BAR/BAR ENTRY ladder). Do not treat this as complete; sections marked "not
yet implemented" are confirmed rules that the code does not yet enforce.

## The chain

**WTF (foundation, already coded)**: TZ GREEN → RED → TZ BUY → TZ BUY 2.

**DTF, once WTF TZ BUY 2 (or REAR 2 / REAR RE-ENTER 2 — all three anchors
treated identically) confirms**: TZ BUY (Stage 1) → RED (continuous
RED1→RED2 tracker) → BAR → BAR ENTRY.

**PRIME TREND is active if and only if DTF BAR ENTRY is active.** This is
the single defining condition — not DTF TZ BUY alone. Implemented via
`barEntryActiveIntervals()` in `lib/primeTrend.ts`.

## BAR formation gate (DTF)

BAR needs only **RED1** to form — not a completed RED1→RED2. `everSawRed1`
alone unlocks `SEEK_BAR` in `stepBarLevel`. Once RED1 has ever occurred for
this BAR level (even one that later resolves as `INVALID RED1`, never
confirming to RED2), BAR-seeking stays unlocked permanently for that
level's life.

## BAR/BAR ENTRY reactivation rules (DTF) — implemented

- **Clean BAR ENTRY SL** (BAR itself survives): BAR ENTRY reactivates
  directly on the very next green (plain breakout, no reference to clear).
  Unrestricted, can recur any number of times.
- **Pre-escalation BAR SL** (BAR fails before ever reaching BAR ENTRY):
  unrestricted reform via `SEEK_BAR` — unless a reactivation gate
  (`topRef`) was already established earlier in this episode
  (`gateEstablished`), in which case it stays gated.
- **Combined failure** (BAR SL + BAR ENTRY SL, same candle or sequential):
  BAR reactivates gated above `topRef` — the highest high ever reached
  across BAR and BAR ENTRY's whole life (`Math.max`, never shrinks,
  carried across multiple cycles) — **except**:
- **One-time RED1→RED2 fast-lane bonus**: if the current BAR/BAR ENTRY
  cycle was born on bare RED1 alone (`birthTier === "RED1"`), and a
  RED1→RED2 has completed by the time of this combined failure (whenever
  that completion happened — before, during, or after the SL, as long as
  `doorOpen` is true when checked), BAR gets ONE unrestricted next-green
  reactivation instead of waiting to clear the BAR ENTRY highest high.
  `doorOpen` is consumed, `birthTier` becomes `"RED1_RED2"` on the new
  cycle, and `topRef` **resets fresh** from that new BAR's own formation —
  not carried forward from before the bonus fired. Once a cycle is
  `RED1_RED2`-born (from the start, or because the bonus was spent), no
  further shortcut, ever — reactivates only above the highest high.

Once BAR reactivates (any path), BAR ENTRY escalates ordinarily above it
on a later candle, and the cycle repeats.

## BAR THEORY gate — implemented

**BAR THEORY cannot occur, period, unless DTF BAR ENTRY (PRIME TREND) is
active.** This covers the entire BAR THEORY list: TAR, TAR ENTRY, BAR (BAR
THEORY), BAR ENTRY (BAR THEORY), SAR, SAR 2, INVALID SAR, INVALID SAR
ENTRY, and all their own SLs and reactivations. Implemented by wiring
`barEntryActiveIntervals()` into `tarTbar.ts`'s single gate-construction
site (`stage1ActiveAtFor`, which feeds both `simulateWindow` and every
`postBarSl2Race` call).

**CORRECTION (2026-11-12):** `barEntryActiveIntervals()`'s own "active"
definition originally closed on EVERY exit type, including a SAR exit --
but re-entry after SAR is only through BAR THEORY (see the SAR section
below), so the gate must stay open precisely in the stretch following a
SAR exit; closing it there made BAR THEORY permanently unreachable for
the rest of that anchor's life once it ever SAR-exited. Fixed: a `"DTF
SAR"` exit no longer closes this interval (an ordinary SL-type exit
still does, since BAR ENTRY's own ladder already handles getting back in
after those). Verified exact against ICICIBANK.NS, letter C: TAR
2006-07-31 / TAR ENTRY 2006-08-08, both of which the old gate made
impossible to ever compute.

WTF's own RED1→RED2 is what *produces the opportunity* for BAR THEORY
(TAR/TAR ENTRY anchors off a WTF BAR, which itself requires WTF's own
RED1→RED2 to have confirmed) — but it only actually occurs if BAR ENTRY
(PRIME TREND) is also active at that moment. Both required together.

## BAR THEORY entry/exit requires a following SAR 2 — ALREADY IMPLEMENTED (not a gap)

**Correction**: this was first mis-extracted from today's worked examples
as gated on plain SAR. The user corrected this directly: the real unlock
point is **SAR 2** (the terminal, decisive event), not the first SAR in
the ladder. Re-checked against the code: this exact rule is **already
fully implemented**, not a gap at all — `findWindows` itself anchors
unconditionally on every WTF BAR (correct, WTF-level display is always
unconditional), but a separate, already-wired eligibility layer right
after it (`governingRed2For`, `theorySupersededFrom`,
`openTarEntryUntilByLetter`, all in `lib/tarTbar.ts` around line
2602-2732) gates the DTF-side TAR/TAR ENTRY and nested BAR1→BAR2/BAR ENTRY
cascade on exactly this: a WTF BAR's own governing RED2 must have already
had its SAR 2 confirm *before* that BAR's own formation date, or the
window produces zero TAR/BAR ENTRY output for its entire life (not merely
hidden — genuinely never computed, same "continue"-and-skip shape as
`stage1ActiveAtFor`'s own gate).

- The rule, in the same words as before, just correcting SAR → SAR 2: BAR
  before its governing RED2's SAR 2 = never eligible. BAR after that
  SAR 2 = eligible. No "first" qualifier either side — repeats for as
  many bare reform cycles as happen before SAR 2 finally confirms.
- `governingRed2For(letter, formationDate)` finds the window's own
  governing RED2 (latest RED2 strictly before its formation);
  `sar2DateByRed2Group` looks up whether that RED2's own SAR 2 confirmed,
  and if so, whether it confirmed before this window's own formation.
- `theorySupersededFrom` additionally handles the ONGOING case: a window
  that *was* eligible at formation but is still alive when a FRESHER RED2
  (same letter) goes on to confirm its own SAR 2 later — from that later
  date on, the now-superseded window's ladder must produce zero further
  entries, confirmed real-data (DIXON.NS, letter A).
- Verified directly: for `RED1→RED2→SAR→SAR2→BAR(WTF)`, TAR/TAR ENTRY and
  the nested BAR1→BAR2/BAR ENTRY are possible for this BAR — traced
  through the exact code path, matches the existing comment's own worked
  example (DIXON.NS: SAR 2 confirming 2022-05-10 opens eligibility for
  the next fresh BAR, 2022-05-30, onward).

No code change needed here — already correct.

## SAR is the universal exit — implemented

SAR closes whichever of PRIME TREND's own open BAR ENTRY/REAR ENTRY, or
BAR THEORY's own open TAR ENTRY/nested BAR1→BAR2, is currently open —
confirmed and coded on both sides (`stepLevel` in `tarTbar.ts` for BAR
THEORY; the DTF SAR mechanism producing the `exitType: "DTF SAR"` row for
PRIME TREND's own side — the exact string is `"DTF SAR"`, not `"BAR EXIT
(PRIME TREND)"` as an earlier version of this doc said).

**Two more bugs found and fixed (2026-11-12), against real ICICIBANK.NS
data, not covered above:**

- A "fresh BAR 2 kills the SAR watch" switch (`lib/primeTrend.ts`,
  added Oct 30 for a DIXON.NS case) was supposed to leave an
  already-escalated INVALID SAR ENTRY position alone (its own commit
  message said so) but the code never actually implemented that
  exclusion -- it killed the position regardless of state, every time.
  Never actually fixed until now; the case that validated it originally
  never had an open position to kill, so the gap went undetected for
  about two weeks. Fixed: `InvalidSarState.everOpened` protects an
  already-opened cycle from this switch.
- `lib/tarTbar.ts`'s misclassified-letter reinterpretation (a WTF BAR
  SL2 spawning a fake new sibling letter when its own SAR 2 never
  confirms) was scoped to one level only -- if THAT reinterpreted
  window's own synthetic continuation reached its own fresh,
  unconfirmed BAR SL2, every further sibling spawn after that point got
  a one-day noise label and never got its own BAR THEORY window built
  at all (its TAR/TAR ENTRY for that stretch was silently dropped, not
  just mislabeled). Fixed to repeat for as many levels as the data goes.
  Not yet exercised by a real case that goes this deep -- verified by
  direct tracing and a non-regression check (ICICIBANK.NS:
  byte-identical output before and after), not by a real triggering
  example yet.

## The new WTF-level race — IMPLEMENTED

**Already-coded WTF-internal spawn conditions** (`eligibleAnchor` in
`lib/tzEngineWtf.ts`) — unaffected, still apply as-is:
1. WTF TZ BUY never formed or isn't active.
2. Deep failure reached (genuine BAR SL2).
3. WTF TZ BUY 2 SL'd.
4. WTF REAR 2 SL'd.
5. WTF REAR RE-ENTER 2 SL'd.

**New, additional trigger (not yet built)**: a fresh WTF cycle is allowed
to spawn when BOTH of the following hold at once:
- (a) the current/original cycle has not yet achieved its own PRIME TREND
  (DTF BAR ENTRY) active — this is NOT tied to any specific WTF-side tier
  being active; it's purely "has this episode's PRIME TREND ever become
  active yet," regardless of which WTF milestone the original cycle
  currently sits at.
- (b) a **fresh WTF RED1** has occurred since the last spawn attempt. This
  requires NEW state (not the existing `redEver`, which is a permanent,
  once-ever flag and does NOT reset) — a resettable "has a RED1 happened
  since the last spawn" tracker, reusing WTF's own existing RED1 shape
  formula (`cur.h <= prev.h && cur.l < prev.l && gap>=THRESH && cur.c <=
  prev.l`). Spawning consumes/resets this; the next spawn needs a fresh
  RED1 again.
- Applies identically to all three PRIME TREND anchors (WTF TZ BUY 2, WTF
  REAR 2, WTF REAR RE-ENTER 2) — not just TZ BUY 2.
- **Week-boundary nuance**: when a DTF BAR ENTRY SL triggers (making PRIME
  TREND inactive again), the SAME WTF week containing that SL also counts
  toward the "fresh RED1" requirement if, once that week closes, it
  itself turns out to be a RED1 week — not just a later week's RED1.

**Finish line for a spawned cycle to "win"**: the FULL chain, both time
frames — no shortcut. Its own WTF TZ GREEN → RED → TZ BUY → TZ BUY 2, then
its own DTF TZ BUY → RED → BAR → BAR ENTRY. Reaching its own BAR ENTRY
(PRIME TREND) active is the only finish line.

**Win/lose mechanics — nothing new, reuses the existing WTF leadership
contest exactly**:
- If the original (older) cycle reaches its own BAR ENTRY first →
  every later-spawned (newer) cycle still racing is **terminated**.
- If a newer cycle reaches its own BAR ENTRY first → the earlier
  (older) cycle goes **dormant**.
- Confirmed by worked example: a newly-spawned cycle that only reaches
  WTF `TZ BUY` (a lower milestone) while the original cycle is still
  alive at `TZ BUY 2` (a higher milestone) gets terminated immediately —
  this is the EXISTING milestone-contest rule firing naturally, not new
  logic.
- A spawned cycle's own DTF BAR/BAR ENTRY ladder uses the exact same
  `stepBarLevel` machinery as any other cycle — including the one-time
  RED1→RED2 bonus reactivation rule above. Nothing cycle-specific about
  it.

**Implementation, built as the two-pass process described above**:

- `TZEngine`'s constructor (`lib/tzEngineWtf.ts`) takes a new optional
  2nd param, `barEntryActiveAt?: (letter, date) => boolean`. Undefined
  for every caller except `runWtfTrace`'s own second pass, so every
  other use of `TZEngine` (daily/monthly/yearly Trading Zone pages, BAR
  THEORY's own `findWindows`/misclassified-letter detection, etc.) is
  byte-for-byte unchanged.
- A new resettable engine field `freshRedSinceDtfTrigger` (unlike
  `redEver`/`pc.redEver`, which are permanent/once-ever) — set true the
  moment tip gets a fresh `RED1(` event (the resettable, recurring
  buy-level pullback — **not** `RED(` alone, which is the ParentCycle's
  own permanent, once-ever flag that never recurs after TZ BUY first
  forms; caught this exact mix-up through direct testing before
  finalizing). Reset to false the moment tip makes ANY forward milestone
  progress (`TZ BUY(`, `TZ BUY 2(`, `REAR 2(`, `REAR RE-ENTER 2(` forming
  or reactivating) — confirmed necessary by testing: without this, the
  RED1 that originally led to TZ BUY 2's own formation stayed "fresh"
  forever, wrongly licensing a spawn on the very next green candle even
  before DTF had any chance to try reaching BAR ENTRY. Also reset the
  moment a spawn actually happens (any trigger).
- `eligibleAnchor` gets one new OR-condition: `dtfTrigger = tipLacksPrimeTrend && freshRedSinceDtfTrigger`,
  where `tipLacksPrimeTrend` reads the injected callback for tip's own
  letter/date.
- `runWtfTrace` (`lib/primeTrend.ts`) takes a new optional 4th param,
  `dtfDays?: Day[]`. When given, it runs pass 1 with a plain engine,
  derives `barEntryActiveIntervals` from that pass-1 trace, then runs
  pass 2 with a DTF-aware engine using those intervals — this is what
  `runWtfTrace` returns. `prepare`/`computePrimeTrend`/
  `barEntryActiveIntervals` all gained an optional `wtfTraceOverride`
  parameter purely to break the recursion this creates (pass 1's own
  `barEntryActiveIntervals` call must use the already-computed pass-1
  trace directly, not re-invoke the two-pass `runWtfTrace` again).
  `prepare`'s own call now always passes `dtfDays` through, so
  `computePrimeTrend` is race-aware; every other caller of `runWtfTrace`
  (`tarTbar.ts`'s `findWindows`, `raceFreshLineage`'s own re-slicing)
  omits the new param and keeps getting the exact same single-pass trace
  as before — **this feature is scoped to PRIME TREND's own
  computation only, not BAR THEORY's**, which is a known, deliberate
  asymmetry (not yet asked to be extended).
- Win/lose mechanics needed zero changes — the existing leadership
  contest fires automatically once the new branch exists in the trace.
- Verified: non-regression on a real (short) sample dataset
  (`data/tz_2020_verification_dataset.csv`, byte-identical output before
  and after), and a focused synthetic test of the trigger itself
  directly against `TZEngine` (no spawn without fresh RED1; spawn with
  it; no re-spawn without a further fresh RED1 after that).

## BAR THEORY's nested BAR1→BAR2 terminal state — IMPLEMENTED

Fixed in `lib/tarTbar.ts`'s `LevelState`/`stepLevel`: split the single
shared `nestedRefHigh`/`nestedRefLow` into separate, continuously-tracked
`nestedBar1RefHigh`/`nestedBar1RefLow` (tier 1) and
`nestedBar2RefHigh`/`nestedBar2RefLow` (tier 2) — same shape as PRIME
TREND's `BarLevelState`. Added a permanent `"DONE"` terminal `nestedMode`
and a `"SEEK_NESTED_ENTRY_REACTIVATION"` mode (clean BAR2 SL, mirrors
`SEEK_TAR_ENTRY_REACTIVATION`). `BAR1_ACTIVE`'s own SL now only reforms
bare (never escalated); `BAR2_ACTIVE`'s own SL distinguishes combined
(BAR1 also breaches → `DONE`, permanent) from clean (BAR1 survives →
reactivates directly above its frozen ref, repeatable).

**The correct rule, confirmed — and it is NOT the same as PRIME TREND's
own BAR/BAR ENTRY reactivation**:

- **Bare, pre-escalation SL** (BAR1 fails before ever reaching BAR2):
  already correctly unrestricted/reforms, unaffected by any of this.
- **Clean entry-tier SL** (BAR2 alone fails, BAR1 survives): reactivates
  directly above its own frozen reference — can repeat any number of
  times. (Exactly mirrors TAR ENTRY's own clean-SL reactivation, which is
  already correctly coded.)
- **Combined failure** (BAR1 also fails — same candle as BAR2's SL, or on
  a later candle while already waiting to reactivate): reactivation is
  blocked **permanently**, for both tiers, for the rest of that WTF BAR's
  window. This is genuinely different from PRIME TREND's own BAR/BAR
  ENTRY, which DOES reactivate (gated above the highest high, plus the
  one-time RED1→RED2 bonus) after a combined failure — do not copy that
  behavior here. Same symmetric rule for TAR/TAR ENTRY: once TAR has ever
  reached TAR ENTRY and then suffers a combined failure, it's `DONE`
  (already correctly coded) — the nested BAR1→BAR2 needs the exact same
  shape of terminal state, independently implemented (not shared state
  with TAR's own `DONE`).
- A combined failure (either theory) is only ever possible once the entry
  tier has already been confirmed at least once — a bare pre-escalation
  SL is a different, already-handled case.

**Terminology note** (not a new rule, just clarifying language used
throughout this whole redefinition): "RED 2" always already means
RED1→RED2 has completed — there is no such thing as a bare RED2. And
whenever "TAR SL"/"BAR SL" is said to happen after TAR ENTRY/BAR ENTRY was
active, it always means the entry tier's own SL (TAR ENTRY SL/BAR ENTRY
SL) has either already fired or fires that same day — i.e. that phrasing
always describes the combined case, never ambiguous. Same for PRIME
TREND: "after BAR → BAR ENTRY, BAR SL triggers" always means BAR ENTRY SL
has either already triggered or triggers the same day as BAR SL.

## New-RED2-voids-pending-BAR-THEORY-entry — IMPLEMENTED

A third, distinct mechanism — separate from TAR's own `DONE` and the
nested cascade's own combined-failure terminal state above.

Implemented via a new `redVoided` flag on `LevelState`, set the moment a
genuinely new (non-first) RED1→RED2 confirms — using the existing
`firstEver = !s.doorOpen` check already computed right before
`s.doorOpen = true` in the continuous RED tracker. `redVoided` gates:
TAR's own escalation (`TAR_ONLY` — terminates outright to `DONE` if set,
confirmed symmetric with BAR THEORY's nested route per the user's own
direct confirmation), `SEEK_TAR_ENTRY_REACTIVATION`'s own clean-SL
reactivation, the nested route's `SEEK_BAR1`/`BAR1_ACTIVE` (terminates
outright to `DONE` if active and un-escalated), and
`SEEK_NESTED_ENTRY_REACTIVATION`'s own clean-SL reactivation. An
already-open TAR ENTRY or nested BAR ENTRY position is left untouched —
only future formation/escalation/reactivation is blocked.

- **Trigger**: a genuinely new RED2 completes in WTF. (By the
  already-established WTF rule — a fresh RED1 can only attach once
  BAR1→BAR2 completes — "a new RED2 completes" and "BAR2 followed by a
  further RED1→RED2" describe the same thing, not two different
  conditions.)
- **Effect on the earlier, now-superseded BAR's own DTF-side entries**
  (TAR ENTRY and the nested BAR ENTRY ONLY — not the SAR-side ladder):
  - If the new RED2 confirms *before* the DTF-side BAR (tier 1) even
    formed → that BAR can never form at all.
  - If BAR (tier 1) is already active but hasn't yet escalated to BAR
    ENTRY (tier 2) → it gets **terminated** the moment the new RED2
    confirms.
  - If BAR ENTRY (or TAR ENTRY) is already open at that moment → it
    stays alive, untouched by the new RED2 — only SAR (the universal
    exit) closes it.
- **INVALID SAR/INVALID SAR ENTRY is completely exempt.** It keeps
  reactivating on its own next-green/frozen-reference mechanism
  regardless of how many new RED1→RED2 cycles pass in WTF afterward —
  confirmed by a worked example where INVALID SAR ENTRY reactivates
  normally even while "WTF is now trading with RED1→RED2" again.

## SAR — for PRIME TREND and BAR THEORY — already implemented, verified

**PRIME TREND side**: once SAR occurs in DTF after RED 2, for the first
time while PRIME TREND is active, any active BAR ENTRY (PRIME TREND)
position shows exit. INVALID SAR → INVALID SAR ENTRY can occur for this
same exit — and this mechanism is treated as ONE SHARED thing with BAR
THEORY's own version, not two separate implementations: INVALID SAR ENTRY
following a SAR that closed a PRIME TREND entry, or one that closed a BAR
THEORY entry, behaves identically.

**BAR THEORY side**: SAR after RED1→RED2 (post PRIME TREND theory, i.e.
under the already-established BAR-ENTRY-active gate) allows INVALID SAR →
INVALID SAR ENTRY normally. If SAR 2 confirms right after SAR instead (no
invalidation ever happened), INVALID SAR → INVALID SAR ENTRY is NOT
possible for that episode — mutually exclusive, matches `stepInvalidSar`'s
`SEEK_INVALID` case exactly (an upside breakout produces `invalidSarNow`;
a decisive downside breach first produces `sar2Now` instead, and these
are alternatives, never both). After SAR 2, the next BAR THEORY entry is
plain TAR/TAR ENTRY or BAR/BAR ENTRY off a fresh WTF BAR — matches the
already-confirmed `freshBarEvent`/"straight back to plain BAR THEORY"
mechanism.

**Terminology** (not new rules): saying "INVALID SAR ENTRY occurs" always
implies INVALID SAR occurred first, by default, with INVALID SAR ENTRY
confirming above INVALID SAR's own reference high. Saying "INVALID SAR SL
after INVALID SAR ENTRY was confirmed" always means INVALID SAR and
INVALID SAR ENTRY either happened the same day, or INVALID SAR ENTRY SL
already happened and INVALID SAR SL is now triggering on top of that —
i.e. always the combined case, same convention used throughout this whole
document.

**INVALID SAR's own reactivation path** (`InvalidSarState`/
`stepInvalidSar` in `lib/primeTrend.ts`): the ONLY path that lets INVALID
SAR reactivate (fire the "INVALID SAR" label again) is the full sequence
INVALID SAR → INVALID SAR ENTRY → INVALID SAR ENTRY SL → INVALID SAR SL →
`SEEK_REFORM` → a decisive breach of the *historical* floor → `SEEK_INVALID`
→ a later breakout produces "INVALID SAR" again. This part was correct.

**CORRECTION (2026-11-12, found against real ICICIBANK.NS data):** the
narrower claim below this ("already correctly implemented, not a gap")
was wrong for `SEEK_REACTIVATION` specifically -- INVALID SAR ENTRY's own
clean-SL reactivation (after INVALID SAR ENTRY SL alone, INVALID SAR
itself still alive) was using a frozen-reference breakout
(`breakoutShape(prev, cur, s.frozenEntryRefHigh)`), copying the wrong
model -- `BarLevelState`'s own `SEEK_BAR_ENTRY_REACTIVATION` already
documents (and this exact codebase already validates against ICICIBANK)
that this kind of reactivation is a plain "next green" day-over-day
breakout (`breakoutShape(prev, cur, prev.h)`), not a climb back to an old
high. Per the user's own rule: "PLAIN INVALID SAR ENTRY SL occurs and
INVALID SAR is still active, then INVALID SAR ENTRY can reactivate in
next green" -- same Stage-1/Stage-2 shape used everywhere else in this
codebase. Fixed; verified exact against ICICIBANK.NS: INVALID SAR ENTRY
SL 2005-11-21 -> reactivates 2005-11-24 (the real next-green candle), not
the much later frozen-reference breakout the old code waited for
(2005-12-12). This is the concrete lesson behind every "verified"/
"implemented" label in this document from here on: a label means it was
actually run against real data and the dates matched, not that the code
was read and looked right.

## WTF-level BAR lineage mechanics — verified against the code (reference)

Worked out precisely via several hand-traced examples against
`lib/tzEngineWtf.ts` directly (not guessed):

- A fresh BAR 1 only becomes eligible to form (`buy.barPending = true`)
  on an actual RED2 confirming — never on RED1 alone, and never on
  INVALID RED1 (which is RED1 failing to confirm).
- The moment the *newest* lineage itself reaches BAR 2, every other
  still-alive, un-SL'd lineage is removed/terminated outright (the
  `newestLin.bar2 !== null` filter) — confirmed this is what "a new
  RED1→RED2 completing, later escalating to BAR1→BAR2, terminates the
  earlier lineage" means mechanically.
  A lineage that already has its own SL survives this filter regardless.
- "BAR SL" seeds a fresh reference at that day's own Low each time it
  fires (including when re-fired later via `dormantBarLowCheck` after an
  earlier SL was invalidated by a recovery) — BAR SL2 always breaches
  *that* reference, never an older superseded one.
- "INVALID BAR SL" (a recovery closing back above the SL's own reference
  high) does not by itself freeze the lineage's low-tracking — a lower
  low on that SAME candle still ratchets the SL's reference low down
  (as "INVALID BAR LL"), even though the headline recovery event fires
  too.
- A decisive breach below a dormant/invalidated SL's current reference
  produces "BAR SL" again (a fresh, non-invalidated `BarSL` object) —
  never "BAR SL2" directly. BAR SL2 always needs one more decisive
  breach below *that* fresh reference.
- A bare lineage (never escalated to BAR 2) can never produce BAR SL2,
  under any circumstance — this is structural, not a close call.

## Open items / not yet implemented

- Known, deliberate asymmetry: the new WTF-level race (section above) is
  wired into PRIME TREND's own trace (`computePrimeTrend`) only. BAR
  THEORY's own `findWindows`/misclassified-letter detection still uses
  the plain, non-raced trace -- never asked to extend it there.
- Full rewrite of `PRIME_TREND_RULEBOOK.md` itself, once the whole theory
  is confirmed complete.
