# BAR Rule — House of Bull / House of Bear Reference

**Purpose:** This is a variant rule set for the TZ engine, built on top of the same OHLC state-machine primitives as the original 37-event rule book (`TZ_ENGINE_RULEBOOK_REFERENCE.md`), but with a different structure hierarchy and an added dual-trend ("house") mechanic. Everything not explicitly overridden below inherits from the original rule book: `THRESH = 0.20` (main qualifying threshold), `ANY = 0.01` (minimum move for HH/LL qualification), and the general RED1/RED2 shared mechanic (§3 of the original).

**Status:** Verified against the user's case-study OHLC datasets (01-01-2021 through 24-04-2021, and 01-01-2022 through 27-01-2022) via `bar_rule_simulator.py`, the reference implementation. **`BAR SL2` has been removed entirely.** REAR is back, in a new role: it is no longer a distinct pre-existing structure alongside TZ GREEN — it is specifically the label for the generation that recovers directly from a *deep* BAR/SAR SL, off that dead generation's own BAR 2/SAR 2 reference (see §8), and the REAR ladder itself now extends to a full REAR RE ENTER rung. This revision folds in the two-tier BAR/BAR 2 stop-loss split (now also mirrored exactly at the TZ GREEN/TZ GREEN 2 anchor level — see §1/§2), ungoverned BAR 2 HH/LL tracking, the outer/inner reference ratchet during shallow-SL recovery (including a fixed gap where escalation to a deep SL was never actually checked while awaiting a shallow recovery), the pullback-persists-past-parent-SL correction, and the REAR/fresh-TZ-GREEN permanent dual-track that replaces `BAR SL2` — all confirmed against real dates (see §14).

---

## 0. Structure hierarchy (BAR rule, House of Bull)

```
TZ GREEN → TZ GREEN 2 → RED1 → RED2 → [ BAR → BAR 2 ] ↻ (repeating engine)
                                            ↓
                          BAR 2 SL (shallow) → NEW BAR 2 reforms directly (§7)
                          BAR SL (deep)      → permanent dual-track race (§8):
                                                 a) fresh TZ GREEN(N+1) cycle, or
                                                 b) REAR - REAR 2 - RED1 - RED2 - BAR - BAR 2
                                               (whichever reaches its own "2" first is active;
                                                the other goes dormant, not terminated)
```

There is **no branch spawning and no branch-level dormancy at the TZ-GREEN-anchor level** (original §7a/§8 removed entirely) — only one TZ GREEN lineage is ever *searching* at a time. Dormancy *does* exist one level down, between a fresh anchor cycle and a REAR recovery racing off a dead generation (§8) — that is a deliberate, permanent, ongoing dual-track, not a one-time branch.

---

## 1. TZ GREEN(n) — mirrors BAR/BAR 2's exact two-tier mechanic

- Formation: Low ≥ PrevLow, High > PrevHigh by ≥ 0.20, Close ≥ PrevHigh.
- **Pre-TZ-GREEN-2**: a single, simple SL — Low breaks ref_low by ≥ 0.20, Close **at or below** it (`<=`, not strict `<`). Ordinary ungoverned HH/LL tracking, both sides, `ANY` = 0.01 threshold.
- **The anchor is now structurally identical to BAR/BAR 2** (§4–§7) — not a simplified, single-SL version of it. TZ GREEN 2's formation freezes TZ GREEN's own reference Low as the *outer* threshold and starts TZ GREEN 2's own fresh *inner* reference Low, exactly like BAR 2 freezing BAR's own reference. This replaces an earlier version of this spec that gave TZ GREEN 2 only a single relabeled SL with no outer/inner split — confirmed wrong via exact numbers (see §14).
- RED(n) itself does not exist in this chain (see §3) — replaced by RED1/RED2 attaching directly after TZ GREEN 2.

## 2. TZ GREEN 2(n) — full mirror of BAR 2, including the two-tier SL and shallow-SL recovery

- Formation: current-day High > TZ GREEN's reference High by ≥ 0.20, current-day Low ≥ PrevLow, current-day Close ≥ TZ GREEN's reference High. Freezes TZ GREEN's own reference Low as the outer threshold; TZ GREEN 2 starts its own fresh inner reference Low/High from the formation candle's own Low/High.
- **Ungoverned dual HH/LL, exactly like BAR 2**: once TZ GREEN 2 forms, both `TZ GREEN 2 HH` and `TZ GREEN 2 LL` print on every new extension, forever, with no side silenced.
- **Two-tier SL, exactly like BAR/BAR 2 (§6)**:
  - `TZ GREEN 2 SL` (shallow): Low breaks TZ GREEN 2's own inner threshold by ≥ 0.20, Close doesn't reclaim, *and* the deep threshold isn't also breached the same day. Recovery: a fresh **TZ GREEN 2** reforms directly above the dead one's own last reference High, without needing a fresh plain TZ GREEN first — identical mechanics to §7's `NEW BAR 2 reforms directly` (same outer/inner ratchet during the awaiting window, same escalation check if the deep threshold is also breached while awaiting).
  - `TZ GREEN SL` (deep): Low breaks `min(TZ GREEN's frozen outer ref_low, TZ GREEN 2's current inner ref_low)` by ≥ 0.20, Close doesn't reclaim. **Unlike the gen's own deep SL, this is a total, unconditional termination — "complete lineage dies."** There is no REAR-equivalent recovery for the anchor: a fresh `TZ GREEN(N+1)` can only form from here via the ordinary ground-up formation breakout.
  - **Same-day priority, confirmed explicitly**: if both the shallow and deep thresholds are breached the same day, `TZ GREEN SL` (deep) is what gets recorded — never `TZ GREEN 2 SL` alongside it. This is the same "deep checked first, deep wins" convention as BAR/BAR 2, and the reason it matters: any future recovery-lineage logic (REAR, or anything downstream) needs to see the deep SL specifically, not a shallow one, to know the anchor is fully gone.
- **Gates RED1**: RED1 cannot attach until TZ GREEN 2 has formed.
- **No soft/close-based invalidation**: a Close below TZ GREEN 2's reference during RED1/RED2 formation does not end the cycle. Only the anchor's own deep SL can terminate everything.
- **Retirement once BAR 2 takes over**: the moment this lineage's *generation* (BAR, or any rung of the REAR ladder) reaches its own "2" stage for the first time, the anchor's own SL/stage2/HH-LL tracking — deep, shallow, and the shallow-SL recovery window alike — stops being checked or printed **permanently**, even if that generation later dies. From that point, `TZ GREEN 2 HH`/`LL` would only ever coincide exactly with `BAR 2 HH`/`LL` (they track from the same underlying reference), so recording both is pure redundancy. This retirement takes effect the *same day* the generation's own "2" forms — gen-level processing runs before anchor-level processing each day specifically so a same-day `BAR 2` formation suppresses that day's would-be redundant `TZ GREEN 2 HH`, not just future days'.

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

Before BAR 2 has formed, BAR has a single, simple SL: Low breaks BAR's own ref_low by ≥ 0.20, Close **at or below** it. This is always a "deep" failure (§8) — there is no "shallow" tier and no REAR option until BAR 2 has formed at least once (REAR needs BAR 2's own reference to reform against; if BAR 2 never existed, that reference never existed either).

**Once BAR 2 has formed**, two independent thresholds are live simultaneously:

- **Outer / deep threshold** = `min(BAR's frozen outer ref_low, BAR 2's current inner ref_low)`. Because BAR 2's inner reference keeps ratcheting downward as `BAR 2 LL` fires, this threshold **can get lower over time** even though BAR's own outer reference itself never moves once frozen.
- **Inner / shallow threshold** = BAR 2's own current ref_low.

Each day, both are checked (deep first):

- **`BAR SL` (deep)**: Low breaks the outer/deep threshold by ≥ 0.20, Close doesn't reclaim it. This is the full-restart failure — recovery is via §8 (the REAR/fresh-TZ-GREEN dual-track race).
- **`BAR 2 SL` (shallow)**: Low breaks BAR 2's own inner threshold by ≥ 0.20, Close doesn't reclaim it, *and* the deep threshold is not also breached the same day. Recovery is the lighter-weight path in §7 — a NEW BAR 2 reforming directly, without needing a fresh BAR first.

(House of Bear: mirror on the High side — `SAR SL` deep, `SAR 2 SL` shallow, outer/deep threshold = `max(SAR's frozen outer ref_high, SAR 2's current inner ref_high)`.)

## 7. Shallow-SL recovery — "NEW BAR 2 reforms directly"

When `BAR 2 SL` (shallow) fires, BAR itself is not restarted — the engine instead awaits a **fresh BAR 2** reforming directly, without an intervening plain BAR. The recovery reuses the *same* label it came from — `BAR 2 SL` recovers as `BAR 2` again (not a differently-named "re-enter" event); this holds at every level (§8): `REAR 2 SL` recovers as `REAR 2`, `REAR RE ENTER 2 SL` recovers as `REAR RE ENTER 2`.

- **Recovery**: a fresh breakout above BAR 2's own last (pre-SL) reference High (Low ≥ PrevLow, High > that reference + 0.20, Close ≥ that reference) forms a brand-new BAR 2 immediately — it inherits the still-live outer/deep reference as its own frozen `bar_ref_low`.
- **Escalation**: if instead price breaks the outer/deep threshold (§6) by ≥ 0.20 with Close confirming — whether on the same day the shallow SL fired or on a later day while still awaiting recovery — that converts straight into the full-restart `BAR SL` (deep) path, and §8's escalation ladder begins.
- **Ongoing ratchet while awaiting recovery** — three references move independently, all using the ordinary `ANY` (0.01) threshold, none requiring Low/Close to also hold:
  - The **favorable/recovery-target** reference (BAR 2's own last reference High) — an attempt at reforming BAR 2 that clears this by a little but doesn't fully qualify (Low/Close not required for this ratchet itself) still pushes the target further out. Printed as **`INVALID BAR HH`** (bullish) / **`INVALID BAR LL`** (bearish). This is the same naming convention used for the deep-SL awaiting window in §8, generalized: `INVALID {X} HH/LL` where `X` is the base name of whatever the recovery would be named (its trailing " 2" stripped) — here, `X` = `BAR` because the recovery is `BAR 2`.
  - The **outer** (adverse-side) reference prints `BAR LL` (bullish) / `BAR HH` (bearish) as it extends.
  - The **inner** (adverse-side) reference prints `BAR 2 LL` (bullish) / `BAR 2 HH` (bearish) as it extends.

  All three ratchets are unconditional — they happen whether or not recovery/escalation actually confirms that day, **including the very same day the shallow SL first fires**.
- **Convergence**: once the outer and inner adverse-side references ratchet to the same value, the shallow/deep distinction collapses — any further close past that shared level triggers `BAR SL` (deep) directly, since there is no longer a separate inner threshold to breach first.

(House of Bear mirror: `SAR HH`/`SAR 2 HH` ratchet on the adverse — upside — side while awaiting recovery; `INVALID SAR LL` ratchets the favorable/recovery-target Low; convergence then routes any further close above the adverse level straight to `SAR SL`.)

## 8. Deep BAR SL aftermath — the REAR ladder / fresh-TZ-GREEN dual-track race

**`BAR SL2` has been removed. The cycle halts (no further HH/LL/SL tracking) on the dead generation itself the moment a deep SL fires** (whether that SL happened before the "2" stage ever formed, or after). Two paths open up, and — unlike anything earlier in this document — **both stay permanently live at once**, not just until one of them wins:

- **(a) Fresh TZ GREEN(N+1) cycle**: a wholly new anchor search, unrelated to the dead generation's own reference — the ordinary base-case breakout (Low ≥ PrevLow, High > PrevHigh + 0.20, Close ≥ PrevHigh), exactly like day 1. This is the *only* available path if the dead generation never reached its own "2" stage (no reference exists to reform against).
- **(b) The escalation ladder**: only available if the dead generation *had* reached its own "2" stage. The recovery reforms directly above that "2" stage's own last reference High (same breakout shape, applied to that frozen reference instead of yesterday's High: Low ≥ PrevLow, High > the reference + 0.20, Close ≥ that reference), and the recovery's *name* escalates one rung up a capped ladder depending on what level just failed:
  - `BAR`/`BAR 2` deep SL → recovers as **`REAR`**.
  - `REAR`/`REAR 2` deep SL → recovers as **`REAR RE ENTER`**.
  - `REAR RE ENTER`/`REAR RE ENTER 2` deep SL → recovers as **`REAR RE ENTER`** again — the ladder **caps here**; it never escalates further (there is no "REAR RE ENTER RE ENTER").

  Each rung of the ladder is a **full generation**, structurally identical to BAR/BAR 2: `REAR` gets its own **`REAR 2`** (ungoverned dual HH/LL, two-tier SL, shallow-SL recovery — §5–§7, direction-flipped as needed), and `REAR RE ENTER` likewise gets its own **`REAR RE ENTER 2`** with the exact same mechanics. RED1/RED2 attach to whichever "2" is currently live exactly as they would to BAR 2. **Once RED2 fires and a fresh generation forms off it, the label reverts to plain `BAR`/`BAR 2`** regardless of which rung the lineage was just on — REAR and REAR RE ENTER are only the labels for the generation immediately recovering from a deep SL, never for an ordinarily-triggered one (see the hierarchy in §0(b): `REAR - REAR 2 - RED1 - RED2 - BAR - BAR 2`).
  - **While awaiting a rung's recovery**, that rung's own reference High keeps ratcheting on ordinary price action (`ANY` = 0.01 threshold, no Low/Close requirement) — even though the generation is dead, this reference stays live so the recovery remains reachable against an up-to-date target. The ratchet is printed as **`INVALID {X} HH`** (House of Bear mirror: **`INVALID {X} LL`**), where `X` is the name the recovery *will* be if it confirms: `INVALID REAR HH` while awaiting a `BAR`/`BAR 2` deep-SL recovery, `INVALID REAR RE ENTER HH` while awaiting a `REAR`/`REAR 2` **or** `REAR RE ENTER`/`REAR RE ENTER 2` deep-SL recovery (both land on the same rung, so they share the same ratchet name).

**Permanent dual-track, not a one-time decision**: whichever of (a)/(b) reaches its own "2" stage first becomes *active*; the other does **not** terminate — it goes **dormant**, exactly mirroring the House of Bull/Bear split (§11) one level down. A dormant lineage keeps existing and can become active again later if the currently-active one later fails — this is recursive and can repeat indefinitely.

**This permanent dual-track is scoped specifically to path (b), the ladder recovery — it does not apply to a bare pre-"2" deep SL.** When a generation dies before its own "2" stage ever formed (no ladder recovery possible, path (a) is the *only* option), its lineage's own anchor is not killed immediately — it keeps ticking its ordinary HH/LL/SL for as long as it takes the fresh anchor search to succeed — but that lineage is **not** kept alive as a permanent competitor once the new anchor forms: it is retired at that point. Only a lineage that reached the ladder (REAR/REAR RE ENTER, path (b)) persists indefinitely alongside a fresh TZ GREEN(N+1) cycle.

**`gen_pending` (a fresh RED2 firing) is a signal shared across both lineages of a house**, not scoped to just one: any lineage that is itself alive and past its own "2" stage — active or dormant — may independently consume it to form its own next generation. It persists, unconsumed, across days until at least one eligible lineage consumes it (so a lineage that only becomes eligible later can still benefit from an earlier RED2); if multiple lineages are simultaneously eligible the same day, they consume it together, same day (matching the "recorded at the backend" case where a rung's own RED2 also lets the dormant TZ GREEN(N+1)'s own BAR 2(N+1) form the same day).

**Every rung's own deep SL is fully recursive/self-similar**: if a rung's generation later deep-SLs, the exact same race reopens *on that same lineage* — a further TZ GREEN(N+2) vs. the next rung up the ladder (capped at `REAR RE ENTER`, per above). If a rung's generation SLs *before its own* "2" stage ever formed, that lineage's generation-path dies permanently (no reference exists to reform against, same as any pre-"2" deep SL) — but if that lineage's own anchor (from when it started life as a fresh TZ GREEN cycle) is still alive, the anchor itself is unaffected and keeps ticking its ordinary HH/LL/SL (§1/§2 tracking was never gated on generation state).

**The anchor's own SL remains an unconditional, total termination of its entire lineage** (§1) — including any generation-level state riding on it, such as a still-pending ladder recovery. This can extinguish a recovery opportunity before it ever gets a chance to fire, even though the recovery's own reference is otherwise unrelated to whatever broke the anchor's own Low. Confirmed case: a BAR SL on 22-03-2021 opened a REAR window (target 617.85); the underlying TZ GREEN anchor (born 17-03) then hit its own SL on 25-03-2021 before REAR ever recovered, killing the pending REAR opportunity along with the rest of that lineage.

## 9. Summary — the repeating generational engine

There is really **one generational engine**: `BAR → BAR 2 → RED1 → RED2 → next BAR`, repeating for as long as recovery succeeds. TZ GREEN/TZ GREEN 2 is the very start of a cycle. Post-BAR 2, SL is two-tiered (§6/§7): a shallow breach recovers lightly (a NEW BAR 2 reforms directly); a deep breach — whose threshold can itself get deeper over time as BAR 2's own inner reference ratchets past BAR's frozen outer one — opens the permanent dual-track race described in §8 (a fresh TZ GREEN cycle vs. REAR reforming off the dead generation's own reference), which is itself fully recursive on the REAR side. There is no terminal "SL2" state anymore — the engine simply keeps racing between fresh-anchor and REAR-recovery attempts, forever, one level below the House of Bull/Bear split. (§1–§9 describe this engine as it runs under House of Bull, where the generational label is `BAR`/`BAR 2`/`REAR`/`REAR 2`; §10 defines House of Bear's mirror, where the same engine's label is `SAR`/`SAR 2`/`REAR`/`REAR 2` instead — REAR's own name does not flip between houses, only the ordinary generational label does.)

---

## 10. House of Bull vs. House of Bear

Two full mirror-image structures, mostly sharing the same event vocabulary (the one deliberate exception: House of Bull's generational label is `BAR`/`BAR 2`, House of Bear's is `SAR`/`SAR 2`). **Both houses' engines always run, fully independently off the same raw price series, and always log — "active" means whichever house's own chain currently reaches furthest, not that the other stops being tracked or computed.** There is no cross-coupling in the implementation; the "shadow rebirth"/house-switch behavior described in §11 is an emergent consequence of both engines reading the same OHLC series with mirrored formulas, not a separate mechanism layered on top.

**House of Bull** (as built in §1–§9):
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
- Every downstream mechanic built for Bull in §4–§8 under the name `BAR`/`BAR 2` (the two-tier SL split, the outer/inner ratchet during shallow-SL recovery, the REAR/fresh-anchor dual-track race after a deep SL) applies **exactly, direction-flipped, to `SAR`/`SAR 2`** in House of Bear — read every `BAR`/`BAR 2`/`BAR SL`/`BAR 2 SL` in §4–§8 as `SAR`/`SAR 2`/`SAR SL`/`SAR 2 SL` when applying those rules under House of Bear. REAR's own name is unchanged in House of Bear (it is not renamed to anything SAR-flavored) — only its ratchet-event naming flips field-literally (`INVALID REAR LL` instead of `INVALID REAR HH`, tracking SAR 2's own reference Low).

## 11. House-switch mechanic

**Both houses' full engines run continuously and independently off raw price, from day 1, forever — neither is ever dormant, and both are logged every time either fires an event.** "Active" simply means whichever house's own chain reaches further/triggers first; that does not stop the other house's engine from computing and logging.

**Which house is active initially:** determined purely by whichever chain (TZ GREEN's or TZ RED's own independent anchor search) completes its own sequence through to a `BAR`/`SAR` first. Both can — and typically do — produce events on the very same early dates before this is settled (see the case-study table in §13).

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

**After a switch — reclaiming active status is different from mere tracking.** The house that just lost active status does **not** stop being tracked or logged. But to become the *active* house again, that house must complete a **brand-new anchor from scratch** (a fresh `TZ GREEN` for Bull, a fresh `TZ RED` for Bear), not a continuation of its old pre-switch lineage — unless it instead wins the §8 dual-track race via REAR, which is the other route back to being active without a brand-new anchor.

## 12. Output format — House column

A **House** column is added alongside the Event column in the report output.

- Every date lists **every** house whose engine produced an event that day — `BULL`, `BEAR`, or `BULL + BEAR` — with the corresponding event(s) listed side by side (e.g., `RED1 + TZ RED`, `BAR 2 SL + TZ RED`, `BAR + GREEN1`).
- On the exact date a house-switch confirms, the event printed for that date uses the **new** house's naming for that step, not the old house's.
- This is a continuous, permanent feature of the output — both houses' events keep appearing side-by-side for the life of the dataset, per §11's repeating rebirth/termination cycle, not only before the first switch ever happens.

## 13. Worked case-study excerpts (from the user, confirmed correct)

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

**Deep SL aftermath — pre-BAR2 (no REAR possible, fresh TZ GREEN is the only path), and the outer/inner ratchet:**
```
DATE      HOUSE OF     EVENT
15/02     BULL         BAR SL                 [pre-BAR2 SL: deep by default, no BAR2 reference exists]
17/02     BULL         TZ GREEN               [only path available: fresh anchor from scratch]
03/03     BEAR         SAR 2 SL + SAR HH      [shallow SL; outer ref ALSO ratchets same day]
22/03     BEAR         SAR HH: 616            [outer/deep ref ratchets during awaiting-recovery]
24/03     BEAR         SAR 2 HH: 614          [inner ref ratchets independently, still below outer]
01/04     BEAR         SAR AND SAR 2 HH       [High 616.05 clears BOTH — outer and inner converge;
                                                from here, any close past this level = plain SAR SL]
31/03     BULL + BEAR  GREEN2 fires same day SAR2 SL fires — the already-attached pullback
                        (GREEN1→GREEN2) is NOT cleared by its parent SAR's same-day SL.
```

**TZ GREEN's own two-tier SL, shallow-SL recovery, and retirement once BAR 2 takes over (01/2022 case study, confirmed exact numbers):**
```
DATE      HOUSE OF     EVENT
06/01     BEAR         TZ RED 2 SL             [shallow: inner ref_high 297.05 breached; outer (299.85,
                                                 frozen from TZ RED's own formation) untouched]
08/01     BEAR         TZ RED 2                [shallow-SL recovery: a fresh TZ RED 2 reforms directly,
                                                 NOT a mere LL update on the dead one]
09/01     BEAR         TZ RED 2 HH + TZ RED 2 LL  [new TZ RED 2's own ungoverned dual tracking]
10/01     BEAR         TZ RED 2 SL             [shallow again, on the recovered TZ RED 2]
11/01     BEAR         TZ RED SL               [escalation: outer threshold (299.85) also breached while
                                                 awaiting shallow recovery -- deep wins, COMPLETE LINEAGE
                                                 DIES, no REAR-equivalent recovery for the anchor]
23/01     BULL + BEAR  TZ GREEN 2 HH + BAR + TZ RED SL  [BAR forms same day a SEPARATE, later TZ RED
                                                 lineage's own deep SL fires -- outer and inner coincide
                                                 exactly (308) on this one, so deep wins per the same
                                                 same-day-priority rule]
24/01     BULL         BAR 2                   [BAR 2 forms -- TZ GREEN 2's own HH would be the SAME
                                                 number (311) from here on, so it is retired THIS SAME
                                                 day, not the next -- no redundant "TZ GREEN 2 HH" prints
                                                 alongside "BAR 2"]
```
(House of Bear mirror: read `TZ RED`/`TZ RED 2` for `TZ GREEN`/`TZ GREEN 2` and `SAR`/`SAR 2` for `BAR`/`BAR 2` throughout — the same dataset produces the Bull-side mirror at the corresponding dates.)

**Two-tier SL and shallow recovery (11/04–14/04):**
```
DATE      HOUSE OF     EVENT
11/04     BULL         BAR 2 HH
12/04     BULL + BEAR  BAR 2 SL + TZ RED       [shallow SL on Bull; independent fresh TZ RED on Bear]
13/04     BEAR         TZ RED HH
14/04     BULL + BEAR  BAR 2 + TZ RED SL       [NEW BAR 2 reforms directly, skipping a plain BAR]
```

## 14. Open items — pending case-study verification

- **REAR itself now confirmed firing** in the 2021 case-study dataset (a direct consequence of today's anchor two-tier rework changing the trajectory from 19/03 onward): House of Bear's SAR deep-SLs on 03/04-2021 (`SAR SL`), opening a REAR window that successfully reforms as `REAR` on 04/04-2021, reaching its own `REAR 2` on 05/04-2021. This validates the base REAR/REAR 2 mechanics of §8 against a real date for the first time.
- **`REAR RE ENTER` (the second rung of the ladder) has not yet been observed firing** — no date in either case-study dataset has produced a deep SL on a `REAR`/`REAR 2` structure itself (only on plain `BAR`/`SAR` or the anchor). Needs a case study where REAR's own generation deep-SLs to fully validate that escalation step.
- **Two simultaneously-alive lineages (the dormancy race itself) has not yet been observed** — REAR's confirmed appearance (04/04-05/04) resolved into RED2/SAR 2 normally rather than lingering alongside a competing fresh TZ RED(N+1) cycle long enough to test which side reaches its own "2" first. The active/dormant determination and the shared `gen_pending` cross-lineage consumption (§8) are implemented but still unexercised by a real date.
- Whether the $0.20 / $0.01 thresholds need to scale for weekly/monthly/yearly candles remains an open question inherited unchanged from the original rule book (§13 there).
- Reference implementation: `bar_rule_simulator.py` (this repo), run against both case-study datasets (01-01-2021–24-04-2021, 01-01-2022–27-01-2022). Not yet merged into `tz_engine_v9.py` as a production rule variant.
