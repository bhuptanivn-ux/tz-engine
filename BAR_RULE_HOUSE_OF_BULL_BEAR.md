# BAR Rule — House of Bull / House of Bear Reference

**Purpose:** This is a variant rule set for the TZ engine, built on top of the same OHLC state-machine primitives as the original 37-event rule book (`TZ_ENGINE_RULEBOOK_REFERENCE.md`), but with a different structure hierarchy and an added dual-trend ("house") mechanic. Everything not explicitly overridden below inherits from the original rule book: `THRESH = 0.20` (main qualifying threshold), `ANY = 0.01` (minimum move for HH/LL qualification), and the general RED1/RED2 shared mechanic (§3 of the original).

**Status:** Verified against the user's case-study OHLC dataset (01-01-2021 through 24-04-2021) via `bar_rule_simulator.py`, the reference implementation. REAR/REAR RE-ENTER have been removed from this logic entirely (see §9) — only TZ GREEN/TZ RED cycles exist. This revision folds in the two-tier BAR/BAR 2 stop-loss split, ungoverned BAR 2 HH/LL tracking, the outer/inner reference ratchet during shallow-SL recovery, and the pullback-persists-past-parent-SL correction — all confirmed against real dates (see §14).

---

## 0. Structure hierarchy (BAR rule, House of Bull)

```
TZ GREEN → TZ GREEN 2 → RED1 → RED2 → [ BAR → BAR 2 ] ↻ (repeating engine)
                                            ↓
                          BAR 2 SL (shallow) → NEW BAR 2 reforms directly
                          BAR SL (deep)      → BAR SL2 → fresh TZ GREEN (see §9)
```

There is **no branch spawning and no branch-level dormancy** (original §7a/§8 removed entirely) — only one TZ GREEN lineage ever exists per cycle; no sibling branches.

---

## 1. TZ GREEN(n) — unchanged from the original rule book

- Formation: Low ≥ PrevLow, High > PrevHigh by ≥ 0.20, Close ≥ PrevHigh.
- HH: any higher High ≥ 0.01 above the reference qualifies (governed once TZ GREEN 2 forms — see §2).
- LL: any lower Low ≥ 0.01 below the reference qualifies.
- SL ("TZ GREEN SL"): Low breaks ref_low by ≥ 0.20, Close **at or below** ref_low (`<=`, not strict `<`) → terminates the entire cycle permanently. Checked first every candle, returns immediately.
- RED(n) itself does not exist in this chain (see §3) — replaced by RED1/RED2 attaching directly after TZ GREEN 2.

## 2. TZ GREEN 2(n) — new

- Formation: current-day High > TZ GREEN's reference High by ≥ 0.20, current-day Low ≥ PrevLow, current-day Close ≥ TZ GREEN's reference High.
- No HH/LL tracked on the formation day itself.
- **Governance**: once TZ GREEN 2 forms, it permanently silences further display of the **High** side of the anchor's own ongoing tracking (`TZ GREEN HH` no longer prints) — the **Low** side (`TZ GREEN LL`) keeps tracking and printing independently, forever, on any new extension. (House of Bear mirrors this: TZ RED 2 silences the **Low** side; the **High** side, `TZ RED LL`, keeps tracking.)
- **Gates RED1**: RED1 cannot attach until TZ GREEN 2 has formed.
- **No soft/close-based invalidation**: a Close below TZ GREEN 2's reference during RED1/RED2 formation does not end the cycle. The cycle stays active regardless of whether RED1/RED2 has fired. Only TZ GREEN's own SL (§1) can terminate everything.

## 3. RED1(n) / RED2(n)

- RED1 attach: High ≤ PrevHigh, Low < PrevLow by ≥ 0.20, Close ≤ PrevLow.
- RED1 LL ("deepening"): Low breaks `red1.ref_low` further, without the full RED2 conjunction holding.
- RED1 HH ("weak extension", tracked per the original book's §3 even though it's the opposite side from the pullback's own direction): High extends above `red1.ref_high`.
- RED2: Low ≤ `red1.ref_low` AND High ≤ PrevDayHigh AND (PrevHigh − PrevLow) ≥ 0.20 AND Close ≤ `red1.ref_low + eps`.
- RED1 SL: High clears `red1.ref_high` by ≥ 0.20, Close **at or above** `red1.ref_high` (`>=`) → `red1.active = False`.
- **SL always beats RED1/RED2** — checked first every candle.
- **Fresh attach** requires an ACTIVE front: RED1 can only newly attach once the current front structure's own "…2" object exists (TZ GREEN 2 the first time; BAR 2 on every subsequent generation) **and** that front is alive. Once a BAR SL has fired and no fresh BAR has yet reformed, fresh RED1/RED2 attachment is blocked entirely — it does **not** fall back to using the anchor (TZ GREEN) once at least one BAR has ever existed (the anchor-fallback path is only available before any BAR has ever formed).
- **Persistence**: an **already-attached** RED1/GREEN1 pullback is NOT cleared when its parent BAR/SAR subsequently dies via SL. It continues resolving toward RED2/GREEN2 (or its own SL) on its own schedule, completely independent of whether its parent generation is still alive. The "active front required" gating in the previous bullet applies only to a *fresh* attach, never to an already-active pullback.
- RED2 firing sets `gen_pending` — the trigger that lets the next BAR generation form (see §4).

## 4. BAR(n) — formation

- Forms via a general breakout consuming `gen_pending` (set by RED2): Low ≥ PrevLow, High > PrevHigh by ≥ 0.20, Close ≥ PrevHigh.
- Once at least one BAR has ever formed and later died via SL, a second independent trigger applies: a **fresh** BAR can also form directly off the same plain-breakout shape without requiring a new RED1/RED2 first (the SL-recovery path — see §7).

## 5. BAR 2(n) — formation, ungoverned dual HH/LL tracking

- Formation: current-day High > BAR's reference High by ≥ 0.20, Low ≥ PrevLow, Close ≥ BAR's reference High.
- On formation, BAR's own reference Low is **frozen** as the *outer* threshold (`bar_ref_low`); BAR 2 then starts its own fresh *inner* reference Low from the formation candle's own Low. (House of Bear mirrors this on the High side: SAR's reference High freezes as `bar_ref_high`; SAR 2 starts its own fresh inner reference High.)
- **HH and LL are BOTH recorded, fully, forever — ungoverned.** This is the one deliberate difference from the anchor's TZ GREEN 2/TZ RED 2 governance rule (§2): BAR 2/SAR 2 never silences either side. Every further High extension prints `BAR 2 HH`; every further Low extension prints `BAR 2 LL` — both keep tracking independently for the life of BAR 2, regardless of which side is "favorable."
- Gates the next RED1 attach, same role TZ GREEN 2 played for the first RED1 (§3).

## 6. BAR SL — two-tier split (post-BAR 2)

Before BAR 2 has formed, BAR has a single, simple SL: Low breaks BAR's own ref_low by ≥ 0.20, Close **at or below** it. This always resets to the full BAR SL2 tracking path (§8) — there is no "shallow" tier until BAR 2 exists.

**Once BAR 2 has formed**, two independent thresholds are live simultaneously:

- **Outer / deep threshold** = `min(BAR's frozen outer ref_low, BAR 2's current inner ref_low)`. Because BAR 2's inner reference keeps ratcheting downward as `BAR 2 LL` fires, this threshold **can get lower over time** even though BAR's own outer reference itself never moves once frozen.
- **Inner / shallow threshold** = BAR 2's own current ref_low.

Each day, both are checked (deep first):

- **`BAR SL` (deep)**: Low breaks the outer/deep threshold by ≥ 0.20, Close doesn't reclaim it. This is the full-restart failure — recovery is via §8 (BAR SL2 tracking), i.e. a brand-new BAR(N+1) from scratch.
- **`BAR 2 SL` (shallow)**: Low breaks BAR 2's own inner threshold by ≥ 0.20, Close doesn't reclaim it, *and* the deep threshold is not also breached the same day. Recovery is the lighter-weight path in §7 — a NEW BAR 2 reforming directly, without needing a fresh BAR first.

(House of Bear: mirror on the High side — `SAR SL` deep, `SAR 2 SL` shallow, outer/deep threshold = `max(SAR's frozen outer ref_high, SAR 2's current inner ref_high)`.)

## 7. Shallow-SL recovery — "NEW BAR 2 reforms directly"

When `BAR 2 SL` (shallow) fires, BAR itself is not restarted — the engine instead awaits a **fresh BAR 2** reforming directly, without an intervening plain BAR:

- **Recovery**: a fresh breakout above BAR 2's own last (pre-SL) reference High (Low ≥ PrevLow, High > that reference + 0.20, Close ≥ that reference) forms a brand-new BAR 2 immediately — it inherits the still-live outer/deep reference as its own frozen `bar_ref_low`.
- **Escalation**: if instead price breaks the outer/deep threshold (§6) by ≥ 0.20 with Close confirming — whether on the same day the shallow SL fired or on a later day while still awaiting recovery — that converts straight into the full-restart `BAR SL` (deep) path, and §8's SL2 tracking begins.
- **Ongoing ratchet while awaiting recovery**: on every day neither of the above fires, **both** references keep extending independently on the adverse side, using the ordinary `ANY` (0.01) threshold:
  - the **outer** reference prints `BAR LL` (bullish) / `BAR HH` (bearish) as it extends,
  - the **inner** reference prints `BAR 2 LL` (bullish) / `BAR 2 HH` (bearish) as it extends.

  This ratchet is unconditional — it happens whether or not recovery/escalation actually confirms that day, **including the very same day the shallow SL first fires** (the outer reference can extend that same day even as `BAR 2 SL` is being recorded, provided High/Low clears it by `ANY` without itself confirming a deep SL).
- **Convergence**: once the outer and inner references ratchet to the same value, the shallow/deep distinction collapses — any further close past that shared level triggers `BAR SL` (deep) directly, since there is no longer a separate inner threshold to breach first.

(House of Bear mirror: `SAR HH`/`SAR 2 HH` ratchet on the adverse — upside — side while awaiting recovery; convergence then routes any further close above that level straight to `SAR SL`.)

## 8. BAR(N+1) and BAR(n)'s fate — implementation note

`gen_pending` (from a fresh RED2) and the SL-recovery path (§7's escalation, or a plain breakout after `BAR SL2` per §9) are the two ways a new BAR generation can start. **In the current, verified implementation, only one BAR "front" is tracked at a time** — the moment a new BAR(N+1) forms, it fully replaces BAR(n) as the tracked generation; BAR(n)'s own further HH/LL/SL are no longer tracked from that point on.

This is a deliberate simplification relative to a richer model the user originally described (BAR(n) continuing to "race" in parallel with BAR(n+1), going dormant rather than terminating, with termination keyed to BAR 2(n+1) validly confirming or BAR(n)'s own reactivation firing, whichever is earlier). That richer multi-generation-racing model has **not been exercised or verified** against the case-study dataset to date — no date in the 01-01-2021–24-04-2021 series has produced two live BAR generations at once. It is flagged here as an **open item** (see §15), not asserted as current behavior.

## 9. BAR SL2(n) — permanent terminal failure, no REAR

**REAR and REAR RE-ENTER are removed from this logic entirely.** Only TZ GREEN and TZ RED cycles exist.

- On `BAR SL` (deep) formation, a fresh SL-tracking object starts, initialized from the *SL-triggering candle's own* High/Low (not BAR's original reference).
- Each subsequent day, in priority order:
  1. **Reactivation** (a fresh BAR forming via the plain SL-recovery breakout, §4/§8) is checked first — if it fires, the SL object is discarded and a fresh BAR(N+1) takes over; SL2 is not checked that day.
  2. Otherwise, **`BAR SL2`**: Low breaks the SL object's own ref_low further by ≥ 0.20, Close doesn't reclaim (Close ≤ that ref_low) — permanent terminal failure of that BAR lineage generation.
  3. Otherwise, ordinary **`BAR SL HH` / `BAR SL LL`** tracking on the SL object (both sides, simple `ANY` threshold, ungoverned).
- **On `BAR SL2`: the whole cycle resets unconditionally to a fresh TZ GREEN search** — anchor, pullback, gen, and all generation state are cleared. There is no REAR recovery path; a brand-new `TZ GREEN` can only form from here via the ordinary formation breakout, exactly as if starting from scratch.
- The exact mirror applies to House of Bear: **`SAR SL2`** resets unconditionally to a fresh **TZ RED** search.

## 10. Summary — the repeating generational engine

There is really **one generational engine**: `BAR → BAR 2 → RED1 → RED2 → next BAR`, repeating for as long as each `BAR SL2` recovers via the direct reactivation path (§9). TZ GREEN/TZ GREEN 2 is the very start of a cycle. Post-BAR 2, SL is two-tiered (§6/§7): a shallow breach recovers lightly (a NEW BAR 2 reforms directly); a deep breach — whose threshold can itself get deeper over time as BAR 2's own inner reference ratchets past BAR's frozen outer one — triggers the full-restart path through `BAR SL2` (§9), which resets the whole thing back to a fresh TZ GREEN search. There is no recovery label that continues the old cycle past a deep SL2; the engine starts over from scratch. (§1–§10 describe this engine as it runs under House of Bull, where the generational label is `BAR`/`BAR 2`; §11 defines House of Bear's mirror, where the same engine's label is `SAR`/`SAR 2` instead.)

---

## 11. House of Bull vs. House of Bear

Two full mirror-image structures, mostly sharing the same event vocabulary (the one deliberate exception: House of Bull's generational label is `BAR`/`BAR 2`, House of Bear's is `SAR`/`SAR 2`). **Both houses' engines always run, fully independently off the same raw price series, and always log — "active" means whichever house's own chain currently reaches furthest, not that the other stops being tracked or computed.** There is no cross-coupling in the implementation; the "shadow rebirth"/house-switch behavior described in §12 is an emergent consequence of both engines reading the same OHLC series with mirrored formulas, not a separate mechanism layered on top.

**House of Bull** (as built in §1–§10):
```
TZ GREEN → TZ GREEN 2 → RED1 → RED2 → BAR → BAR 2 → RED1 → RED2 → ...
```

**House of Bear** (exact directional mirror — up ↔ down):
```
TZ RED → TZ RED 2 → GREEN1 → GREEN2 → SAR → SAR 2 → GREEN1 → GREEN2 → ...
```

**Naming/condition mapping (House of Bear):**
- `TZ RED` = same condition shape as `RED1` (downside pullback-attach), now serving as the house's own anchor.
- `TZ RED 2` = same condition shape as `RED2`. Governs (silences) the **Low** side of TZ RED's own ongoing tracking; `TZ RED LL` (i.e. the High-side mirror label) keeps tracking.
- `GREEN1` = same condition shape as `TZ GREEN` (upside breakout), now serving as the pullback-within-a-downtrend structure.
- `GREEN2` = same condition shape as `TZ GREEN 2`.
- **`SAR` / `SAR 2`** = House of Bear's own name for the generational-engine label that House of Bull calls `BAR` / `BAR 2` — same condition shape as `TZ RED` / `TZ RED 2` (downside breakdown continuation). **`BAR`/`BAR 2` is Bull-only naming; `SAR`/`SAR 2` is the Bear equivalent.**
- Every downstream mechanic built for Bull in §4–§9 under the name `BAR`/`BAR 2` (the two-tier SL split, the outer/inner ratchet during shallow-SL recovery, `BAR SL2` resetting to a fresh anchor) applies **exactly, direction-flipped, to `SAR`/`SAR 2`** in House of Bear — read every `BAR`/`BAR 2`/`BAR SL`/`BAR 2 SL`/`BAR SL2` in §4–§9 as `SAR`/`SAR 2`/`SAR SL`/`SAR 2 SL`/`SAR SL2` when applying those rules under House of Bear. **`SAR SL2` resets unconditionally to a fresh `TZ RED` search**, mirroring `BAR SL2` → fresh `TZ GREEN`.

## 12. House-switch mechanic

**Both houses' full engines run continuously and independently off raw price, from day 1, forever — neither is ever dormant, and both are logged every time either fires an event.** "Active" simply means whichever house's own chain reaches further/triggers first; that does not stop the other house's engine from computing and logging.

**Which house is active initially:** determined purely by whichever chain (TZ GREEN's or TZ RED's own independent anchor search) completes its own sequence through to a `BAR`/`SAR` first. Both can — and typically do — produce events on the very same early dates before this is settled (see the case-study table in §14).

**The repeating rebirth/termination cycle** (this is the actual mechanism behind the switch, not a one-shot check):
- Every time the *active* house produces a fresh pullback (RED1→RED2 for an active House of Bull; GREEN1→GREEN2 for an active House of Bear), that identical price action *simultaneously* forms a fresh anchor pair for the *non-active* house (`TZ RED`/`TZ RED 2`, or `TZ GREEN`/`TZ GREEN 2`, respectively) — logged under both houses the same day.
- If the active house's *next* continuation (`BAR`/`BAR 2`) then closes decisively past that fresh non-active anchor's reference (above it for a TZ RED anchor being cleared by an upside BAR; below it for a TZ GREEN anchor being cleared by a downside SAR), the non-active anchor is **terminated** right there.
- The very next time the active house produces another fresh pullback, the non-active anchor is **reborn** from scratch, and the cycle repeats.
- The **switch fires** the first time this cycle breaks the other way: the active house's continuation (`BAR`/`BAR 2` for Bull, `SAR`/`SAR 2` for Bear) **fails** to clear the live non-active anchor's reference, **and** the active house's *next* pullback (RED1→RED2 / GREEN1→GREEN2) then confirms. At that exact point the non-active house takes over as active — and that confirming pullback is relabeled under the *new* active house's own naming.

**Worked trace (confirmed), Bull active initially, two rebirth cycles before the switch:**
```
TZ GREEN - TZ GREEN 2 - RED1 - RED2 - BAR                [Bull's own chain reaches BAR first -> Bull active]
              (RED1/RED2 simultaneously = TZ RED/TZ RED2 for Bear)
           BAR closes above TZ RED's reference high      -> Bear's TZ RED terminated (cycle 1 ends)

... BAR 2 ...
new RED1 - RED2                                          (simultaneously = fresh TZ RED/TZ RED2 for Bear, reborn)
BAR - BAR 2                                               (simultaneously = GREEN1/GREEN2 for Bear)
           BAR/BAR 2 does NOT close above TZ RED's ref high -> Bear's TZ RED SURVIVES (cycle 2 does not terminate)
new RED1 - RED2                                          -> this RED1/RED2 IS Bear's own SAR/SAR 2
                                                              => SWITCH: House of Bear becomes active here
```

**Bear → Bull switch is the exact symmetric mirror**, using GREEN1/GREEN2 pullbacks, downside BAR/BAR 2 continuations, and TZ GREEN/TZ GREEN 2 as the reborn/terminated non-active anchor.

**After a switch — reclaiming active status is different from mere tracking.** The house that just lost active status does **not** stop being tracked or logged. But to become the *active* house again, that house must complete a **brand-new anchor from scratch** (a fresh `TZ GREEN` for Bull, a fresh `TZ RED` for Bear), not a continuation of its old pre-switch lineage. This is the only way any cycle restarts, whether from a house-switch or from `BAR`/`SAR SL2` (§9) — there is no other recovery path.

## 13. Output format — House column

A **House** column is added alongside the Event column in the report output.

- Every date lists **every** house whose engine produced an event that day — `BULL`, `BEAR`, or `BULL + BEAR` — with the corresponding event(s) listed side by side (e.g., `RED1 + TZ RED`, `BAR 2 SL + TZ RED`, `BAR + GREEN1`).
- On the exact date a house-switch confirms, the event printed for that date uses the **new** house's naming for that step, not the old house's.
- This is a continuous, permanent feature of the output — both houses' events keep appearing side-by-side for the life of the dataset, per §12's repeating rebirth/termination cycle, not only before the first switch ever happens.

## 14. Worked case-study excerpts (from the user, confirmed correct)

**Early sequencing (01/01–15/01):**
```
DATE      HOUSE OF     EVENT
01/01     BULL         TZ GREEN
02/01     BEAR         TZ RED
03/01     BULL + BEAR  TZ GREEN 2 + TZ RED SL
05/01     BULL + BEAR  RED 1 + TZ RED
07/01     BULL + BEAR  RED 2 + TZ RED 2
09/01     BULL + BEAR  BAR + TZ RED HH + GREEN 1
11/01     BULL + BEAR  BAR SL + GREEN 1 SL
12/01     BULL + BEAR  BAR + GREEN 1
15/01     BULL + BEAR  BAR 2 + GREEN 2
```
Row 03/01 lists `BULL + BEAR` — TZ RED SL is still a House-of-Bear event and must be tagged as such even though Bear has no further live structure that day; a house tag is never dropped just because that house's structure terminated on the same date.

**BAR/SAR SL2 (permanent terminal failure), and the outer/inner ratchet:**
```
DATE      HOUSE OF     EVENT
25/02     BULL         BAR SL2                [reset to fresh TZ GREEN search]
01/03     BULL         TZ GREEN               [new cycle starts, as expected]
03/03     BEAR         SAR 2 SL + SAR HH      [shallow SL; outer ref ALSO ratchets same day]
05/03     BEAR         SAR SL2                [reset to fresh TZ RED search]
22/03     BEAR         SAR HH: 616            [outer/deep ref ratchets during awaiting-recovery]
24/03     BEAR         SAR 2 HH: 614          [inner ref ratchets independently, still below outer]
01/04     BEAR         SAR AND SAR 2 HH       [High 616.05 clears BOTH — outer and inner converge;
                                                from here, any close past this level = plain SAR SL]
31/03     BULL + BEAR  GREEN2 fires same day SAR2 SL fires — the already-attached pullback
                        (GREEN1→GREEN2) is NOT cleared by its parent SAR's same-day SL.
```

**Two-tier SL and shallow recovery (11/04–14/04):**
```
DATE      HOUSE OF     EVENT
11/04     BULL         BAR 2 HH
12/04     BULL + BEAR  BAR 2 SL + TZ RED       [shallow SL on Bull; independent fresh TZ RED on Bear]
13/04     BEAR         TZ RED HH
14/04     BULL + BEAR  BAR 2 + TZ RED SL       [NEW BAR 2 reforms directly, skipping a plain BAR]
```

## 15. Open items — pending case-study verification

- **Multi-generation racing (§8)**: the richer BAR(n)/BAR(n+1) coexistence-with-dormancy model originally described (BAR(n) staying "active/racing" until BAR 2(n+1) confirms or its own reactivation fires, whichever is earlier) has not been exercised by any date in the case-study dataset so far. Current implementation always replaces the front generation immediately. Needs a case study where a second BAR forms while the first is still alive to resolve.
- Whether the $0.20 / $0.01 thresholds need to scale for weekly/monthly/yearly candles remains an open question inherited unchanged from the original rule book (§13 there).
- Reference implementation: `bar_rule_simulator.py` (this repo), run against the full 01-01-2021–24-04-2021 case-study dataset. Not yet merged into `tz_engine_v9.py` as a production rule variant.
