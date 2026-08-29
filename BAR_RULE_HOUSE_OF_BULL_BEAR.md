# BAR Rule — House of Bull / House of Bear Reference

**Purpose:** This is a variant rule set for the TZ engine, built on top of the same OHLC state-machine primitives as the original 37-event rule book (`TZ_ENGINE_RULEBOOK_REFERENCE.md`), but with a different structure hierarchy and an added dual-trend ("house") mechanic. Everything not explicitly overridden below inherits from the original rule book: `THRESH = 0.20` (main qualifying threshold), `ANY = 0.01` (minimum move for HH/LL qualification), and the general RED1/RED2 shared mechanic (§3 of the original).

**Status:** Verified against the user's case-study OHLC datasets (01-01-2021 through 24-04-2021, and 01-01-2022 through 09-03-2022) via `bar_rule_simulator.py`, the reference implementation. **`BAR SL2` has been removed entirely.** REAR is back, in a new role: it is no longer a distinct pre-existing structure alongside TZ GREEN — it is specifically the label for the generation that recovers directly from a *deep* BAR/SAR SL, off that dead generation's own BAR 2/SAR 2 reference (see §8), and the REAR ladder itself now extends to a full REAR RE ENTER rung. **REAR is house-specific: `REAR BUY`/`REAR BUY RE ENTER` under House of Bull, `REAR SELL`/`REAR SELL RE ENTER` under House of Bear** — confirmed by the user (see §14). This revision folds in the two-tier BAR/BAR 2 stop-loss split, ungoverned BAR 2 HH/LL tracking, the outer/inner reference ratchet during shallow-SL recovery (including a fixed gap where escalation to a deep SL was never actually checked while awaiting a shallow recovery), the pullback-persists-past-parent-SL correction, the REAR/fresh-TZ-GREEN permanent dual-track that replaces `BAR SL2`, and — most recently — the correction that **the anchor's (TZ GREEN 2/TZ RED 2's) own shallow SL has no consequence at all** (§1/§2): the anchor's two-tier reference *structure* mirrors BAR/BAR 2, but only its *deep* SL matters; the shallow tier is logged but never restarts or pauses anything downstream, and the anchor retires the moment a RED1/GREEN1 pullback first attaches against it, not only once the gen reaches its own "2" stage — all confirmed against real dates (see §14), including a real case of both sides of the gen-level dual-track alive at once (§8, §14).

---

## 0. Structure hierarchy (BAR rule, House of Bull)

```
TZ GREEN → TZ GREEN 2 → RED1 → RED2 → [ BAR → BAR 2 ] ↻ (repeating engine)
                                            ↓
                          BAR 2 SL (shallow) → NEW BAR 2 reforms directly (§7)
                          BAR SL (deep)      → permanent dual-track race (§8):
                                                 a) fresh TZ GREEN(N+1) cycle, or
                                                 b) REAR BUY - REAR BUY 2 - RED1 - RED2 - BAR - BAR 2
                                               (whichever reaches its own "2" first is active;
                                                the other goes dormant, not terminated)
```

There is **no branch spawning and no branch-level dormancy at the TZ-GREEN-anchor level** (original §7a/§8 removed entirely) — only one TZ GREEN lineage is ever *searching* at a time. Dormancy *does* exist one level down, between a fresh anchor cycle and a REAR recovery racing off a dead generation (§8) — that is a deliberate, permanent, ongoing dual-track, not a one-time branch.

---

## 1. TZ GREEN(n) — structurally mirrors BAR/BAR 2's two-tier reference split, but the shallow tier has no consequence (§2)

- Formation: Low ≥ PrevLow, High > PrevHigh by ≥ 0.20, Close ≥ PrevHigh.
- **Pre-TZ-GREEN-2**: a single, simple SL — Low breaks ref_low by ≥ 0.20, Close **at or below** it (`<=`, not strict `<`). Ordinary ungoverned HH/LL tracking, both sides, `ANY` = 0.01 threshold.
- **The anchor's reference structure is identical to BAR/BAR 2** (§4–§7): TZ GREEN 2's formation freezes TZ GREEN's own reference Low as the *outer* threshold and starts TZ GREEN 2's own fresh *inner* reference Low, exactly like BAR 2 freezing BAR's own reference. This replaces an earlier version of this spec that gave TZ GREEN 2 only a single relabeled SL with no outer/inner split — confirmed wrong via exact numbers (see §14). **But its two SL tiers do not behave like BAR/BAR 2's — see §2.**
- RED(n) itself does not exist in this chain (see §3) — replaced by RED1/RED2 attaching directly after TZ GREEN 2.

## 2. TZ GREEN 2(n) — same reference structure as BAR 2, but the shallow SL is a non-event

- Formation: current-day High > TZ GREEN's reference High by ≥ 0.20, current-day Low ≥ PrevLow, current-day Close ≥ TZ GREEN's reference High. Freezes TZ GREEN's own reference Low as the outer threshold; TZ GREEN 2 starts its own fresh inner reference Low/High from the formation candle's own Low/High.
- **Ungoverned dual HH/LL, exactly like BAR 2**: once TZ GREEN 2 forms, both `TZ GREEN 2 HH` and `TZ GREEN 2 LL` print on every new extension, forever, with no side silenced (until retirement — see below).
- **Two-tier detection, but only the deep tier has a consequence** — confirmed by the user's explicit correction (previously this spec had the shallow tier behave exactly like BAR 2's, with its own recovery-awaiting window; that was wrong):
  - `TZ GREEN 2 SL` (shallow): Low breaks TZ GREEN 2's own inner threshold by ≥ 0.20, Close doesn't reclaim, *and* the deep threshold isn't also breached the same day. **This does not stop or restart anything.** It is logged, but the anchor Struct is left exactly as it was — no recovery window, no reforming "TZ GREEN 2", no effect on `alive`. RED1/RED2/BAR/BAR 2/REAR BUY/REAR BUY 2/etc. (or their House-of-Bear mirrors) are never dependent on the anchor's own High/Low/reference once it has served its one-time gating role of letting the first RED1/GREEN1 attach (see §3).
  - `TZ GREEN SL` (deep): Low breaks `min(TZ GREEN's frozen outer ref_low, TZ GREEN 2's current inner ref_low)` by ≥ 0.20, Close doesn't reclaim. **This is the only anchor-level SL that makes a difference.** It is a total, unconditional termination — "complete lineage dies." There is no REAR-equivalent recovery for the anchor: a fresh `TZ GREEN(N+1)` can only form from here via the ordinary ground-up formation breakout.
  - **Same-day priority, confirmed explicitly**: if both the shallow and deep thresholds are breached the same day, `TZ GREEN SL` (deep) is what gets recorded — never `TZ GREEN 2 SL` alongside it.
- **Gates RED1 once**: RED1 cannot attach until TZ GREEN 2 has formed at least once — but that is the *only* role TZ GREEN 2's own state plays. Once a RED1/GREEN1 has successfully attached against it, nothing downstream (RED1 → RED2 → BAR → BAR 2 → … → REAR BUY/SELL ladder) ever depends on TZ GREEN 2's/TZ RED 2's own High, Low, or reference again.
- **No soft/close-based invalidation**: a Close below TZ GREEN 2's reference during RED1/RED2 formation does not end the cycle. Only the anchor's own deep SL can terminate everything.
- **Retirement — two independent triggers, whichever comes first**: the anchor's own SL/stage2/HH-LL tracking stops being checked or printed **permanently** the moment EITHER (a) this lineage's *generation* (BAR, or any rung of the REAR BUY/SELL ladder) reaches its own "2" stage for the first time, **or** (b) a RED1/GREEN1 pullback successfully attaches against the anchor as front for the first time (confirmed by the user: the anchor has now served its one-time gating role, so tracking it further is pure redundancy — nothing reads it again). In practice (b) fires first, since a pullback can only attach after TZ GREEN 2 exists and typically attaches on or shortly after that same day, well before any BAR/BAR 2 forms. Either trigger takes effect the *same day* it fires but starting from the *next* day — the day of the triggering event itself still shows whatever the anchor's own processing already produced that day (gen-level and pullback-attach processing both run after the anchor's own SL/HH/LL check each day, so a same-day formation/attach suppresses only *future* days' anchor events, not that day's).

## 3. RED1(n) / RED2(n)

- RED1 attach: High ≤ PrevHigh, Low < PrevLow by ≥ 0.20, Close ≤ PrevLow.
- RED1 LL ("deepening"): Low breaks `red1.ref_low` further, without the full RED2 conjunction holding.
- RED1 HH ("weak extension", tracked per the original book's §3 even though it's the opposite side from the pullback's own direction): High extends above `red1.ref_high`.
- RED2: Low ≤ `red1.ref_low` AND High ≤ PrevDayHigh AND (PrevHigh − PrevLow) ≥ 0.20 AND Close ≤ `red1.ref_low + eps`.
- RED1 SL: High clears `red1.ref_high` by ≥ 0.20, Close **at or above** `red1.ref_high` (`>=`) → `red1.active = False`.
- **SL always beats RED1/RED2** — checked first every candle.
- **Fresh attach** requires an ACTIVE front — but "active" means "has not suffered its own *deep* SL," not "is a currently-live object": RED1/GREEN1 can attach once the current front's own "…2" exists (TZ GREEN 2 the anchor's first time; BAR 2 on every subsequent generation), **and** that front hasn't been through a *deep* SL. Once a *deep* BAR SL has fired and no fresh BAR has yet reformed, fresh RED1/RED2 attachment is blocked entirely (this does **not** fall back to using the anchor once at least one BAR has ever existed). A *shallow* SL never revokes fresh-attach eligibility at all — at the gen level (BAR 2's own shallow SL) it opens the lightweight recovery window instead (§7); at the anchor level (TZ GREEN 2/TZ RED 2's own shallow SL) it has no effect whatsoever (§2) and the anchor simply remains eligible, confirmed against 04-02-2022 (GREEN1 attaches the same day `TZ RED 2 SL` fires) and again against 22-03-2021 (`TZ GREEN 2 SL` fires, and a fresh RED1 attaches against the same, still-eligible anchor the very same day).
- **Persistence**: an **already-attached** RED1/GREEN1 pullback is NOT cleared when its parent BAR/SAR subsequently dies via SL. It continues resolving toward RED2/GREEN2 (or its own SL) on its own schedule, completely independent of whether its parent generation is still alive. The "active front required" gating in the previous bullet applies only to a *fresh* attach, never to an already-active pullback. This persistence does **not** extend past the *anchor's own deep SL*, though: that is "complete lineage death" (§1/§2), which ends the whole lineage — pullback included — the moment it fires, whether or not a pullback was mid-resolution (e.g. GREEN1 attached 04-02-2022 does not survive TZ RED's own deep SL the very next day, 05-02-2022; a *new*, unrelated GREEN1 attaching later to a *different* TZ RED 2 is not a continuation of it).
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

When `BAR 2 SL` (shallow) fires, BAR itself is not restarted — the engine instead awaits a **fresh BAR 2** reforming directly, without an intervening plain BAR. The recovery reuses the *same* label it came from — `BAR 2 SL` recovers as `BAR 2` again (not a differently-named "re-enter" event); this holds at every level (§8): `REAR BUY 2 SL` recovers as `REAR BUY 2`, `REAR BUY RE ENTER 2 SL` recovers as `REAR BUY RE ENTER 2` (House of Bear: `REAR SELL 2 SL`/`REAR SELL RE ENTER 2 SL` likewise).

**Exception — RED2 forecloses this recovery, checked continuously**: this lightweight "NEW BAR 2 reforms directly" path is only available for as long as RED1→RED2 has **not** confirmed for this generation. The moment `gen_pending` is set — whether that happens *before* the shallow SL, the *same day* it fires, or on any *later* day while the recovery is still being awaited — the lighter recovery is abandoned entirely (not just skipped at creation time) and a **full fresh BAR** starts instead, directly off `gen_pending`, the moment the ordinary breakout condition next confirms. Confirmed against 08-01-2022 through 19-02-2022: RED1 attaches to BAR 2 on 08-02, RED2 confirms 10-02, `BAR 2 SL` (shallow) fires 11-02 — 12-02 starts a full new `BAR` cycle. Separately, on the Bear side: GREEN1 attaches 12-02, GREEN2 confirms the same day `SAR 2`'s own shallow SL fires (14-02) — since that SL happened before GREEN2 fired that same day, the recovery is created as usual, but is then abandoned the very next eligible check once `gen_pending` is seen: `SAR` forms 16-02, reaching `SAR 2` on 17-02.

**This foreclosure is a gen-level mechanic only — it does NOT apply to the anchor.** An earlier draft of this spec claimed the anchor's own shallow SL (TZ GREEN 2/TZ RED 2's) had an identical "NEW TZ GREEN 2/TZ RED 2 reforms directly" recovery that RED2 could likewise foreclose. That was wrong: per the user's explicit correction, the anchor's shallow SL has **no recovery of its own to foreclose in the first place** — it is a pure non-event (§2). There is nothing here for RED2 to interact with at the anchor level.

- **Recovery**: a fresh breakout above BAR 2's own last (pre-SL) reference High (Low ≥ PrevLow, High > that reference + 0.20, Close ≥ that reference) forms a brand-new BAR 2 immediately — it inherits the still-live outer/deep reference as its own frozen `bar_ref_low`.
- **Escalation**: if instead price breaks the outer/deep threshold (§6) by ≥ 0.20 with Close confirming — whether on the same day the shallow SL fired or on a later day while still awaiting recovery — that converts straight into the full-restart `BAR SL` (deep) path, and §8's escalation ladder begins.
- **Ongoing ratchet while awaiting recovery** — three references move independently, all using the ordinary `ANY` (0.01) threshold, none requiring Low/Close to also hold:
  - The **favorable/recovery-target** reference (BAR 2's own last reference High) — an attempt at reforming BAR 2 that clears this by a little but doesn't fully qualify (Low/Close not required for this ratchet itself) still pushes the target further out. Printed as **`INVALID BAR HH`** (bullish) / **`INVALID BAR LL`** (bearish). This is the same naming convention used for the deep-SL awaiting window in §8, generalized: `INVALID {X} HH/LL` where `X` is the base name of whatever the recovery would be named (its trailing " 2" stripped) — here, `X` = `BAR` because the recovery is `BAR 2`.
  - The **outer** (adverse-side) reference prints `BAR LL` (bullish) / `BAR HH` (bearish) as it extends.
  - The **inner** (adverse-side) reference prints `BAR 2 LL` (bullish) / `BAR 2 HH` (bearish) as it extends.

  All three ratchets are unconditional — they happen whether or not recovery/escalation actually confirms that day, **including the very same day the shallow SL first fires**.
- **Convergence**: once the outer and inner adverse-side references ratchet to the same value, the shallow/deep distinction collapses — any further close past that shared level triggers `BAR SL` (deep) directly, since there is no longer a separate inner threshold to breach first.

(House of Bear mirror: `SAR HH`/`SAR 2 HH` ratchet on the adverse — upside — side while awaiting recovery; `INVALID SAR LL` ratchets the favorable/recovery-target Low; convergence then routes any further close above the adverse level straight to `SAR SL`.)

## 8. Deep BAR SL aftermath — the REAR BUY/SELL ladder / fresh-TZ-GREEN dual-track race

**`BAR SL2` has been removed. The cycle halts (no further HH/LL/SL tracking) on the dead generation itself the moment a deep SL fires** (whether that SL happened before the "2" stage ever formed, or after). Two paths open up, and — unlike anything earlier in this document — **both stay permanently live at once**, not just until one of them wins:

- **(a) Fresh TZ GREEN(N+1) cycle**: a wholly new anchor search, unrelated to the dead generation's own reference — the ordinary base-case breakout (Low ≥ PrevLow, High > PrevHigh + 0.20, Close ≥ PrevHigh), exactly like day 1. This is the *only* available path if the dead generation never reached its own "2" stage (no reference exists to reform against).
- **(b) The escalation ladder**: only available if the dead generation *had* reached its own "2" stage. The recovery reforms directly above that "2" stage's own last reference High (same breakout shape, applied to that frozen reference instead of yesterday's High: Low ≥ PrevLow, High > the reference + 0.20, Close ≥ that reference), and the recovery's *name* escalates one rung up a capped ladder depending on what level just failed. **The name is house-specific — House of Bull uses `REAR BUY`, House of Bear uses `REAR SELL`** (confirmed by the user; earlier drafts of this spec used a single generic `REAR` name for both houses, which was wrong):
  - `BAR`/`BAR 2` deep SL → recovers as **`REAR BUY`** (House of Bear: `SAR`/`SAR 2` deep SL → **`REAR SELL`**).
  - `REAR BUY`/`REAR BUY 2` deep SL → recovers as **`REAR BUY RE ENTER`** (House of Bear: `REAR SELL RE ENTER`).
  - `REAR BUY RE ENTER`/`REAR BUY RE ENTER 2` deep SL → recovers as **`REAR BUY RE ENTER`** again — the ladder **caps here**; it never escalates further (there is no "RE ENTER RE ENTER"). Same capping, House of Bear: `REAR SELL RE ENTER`/`REAR SELL RE ENTER 2` deep SL recovers as `REAR SELL RE ENTER` again.

  Each rung of the ladder is a **full generation**, structurally identical to BAR/BAR 2: `REAR BUY` gets its own **`REAR BUY 2`** (ungoverned dual HH/LL, two-tier SL, shallow-SL recovery — §5–§7, direction-flipped as needed), and `REAR BUY RE ENTER` likewise gets its own **`REAR BUY RE ENTER 2`** with the exact same mechanics (House of Bear: `REAR SELL 2` / `REAR SELL RE ENTER 2`). RED1/RED2 (or GREEN1/GREEN2 under Bear) attach to whichever "2" is currently live exactly as they would to BAR 2. **Once RED2/GREEN2 fires and a fresh generation forms off it, the label reverts to plain `BAR`/`BAR 2` (or `SAR`/`SAR 2`)** regardless of which rung the lineage was just on — REAR BUY/SELL and their RE ENTER rungs are only the labels for the generation immediately recovering from a deep SL, never for an ordinarily-triggered one (see the hierarchy in §0(b): `REAR BUY - REAR BUY 2 - RED1 - RED2 - BAR - BAR 2`).
  - **While awaiting a rung's recovery**, that rung's own reference High keeps ratcheting on ordinary price action (`ANY` = 0.01 threshold, no Low/Close requirement) — even though the generation is dead, this reference stays live so the recovery remains reachable against an up-to-date target. The ratchet is printed as **`INVALID {X} HH`** (House of Bear mirror: **`INVALID {X} LL`**), where `X` is the name the recovery *will* be if it confirms: `INVALID REAR BUY HH` while awaiting a `BAR`/`BAR 2` deep-SL recovery, `INVALID REAR BUY RE ENTER HH` while awaiting a `REAR BUY`/`REAR BUY 2` **or** `REAR BUY RE ENTER`/`REAR BUY RE ENTER 2` deep-SL recovery (both land on the same rung, so they share the same ratchet name); House of Bear mirrors field-literally as `INVALID REAR SELL LL` / `INVALID REAR SELL RE ENTER LL`.

**Permanent dual-track, not a one-time decision**: whichever of (a)/(b) reaches its own "2" stage first becomes *active*; the other does **not** terminate — it goes **dormant**, exactly mirroring the House of Bull/Bear split (§11) one level down. A dormant lineage keeps existing and can become active again later if the currently-active one later fails — this is recursive and can repeat indefinitely.

**This permanent dual-track is scoped specifically to path (b), the ladder recovery — it does not apply to a bare pre-"2" deep SL.** When a generation dies before its own "2" stage ever formed (no ladder recovery possible, path (a) is the *only* option), its lineage's own anchor is not killed immediately — it keeps ticking its ordinary HH/LL/SL for as long as it takes the fresh anchor search to succeed — but that lineage is **not** kept alive as a permanent competitor once the new anchor forms: it is retired at that point. Only a lineage that reached the ladder (REAR BUY/SELL or their RE ENTER rungs, path (b)) persists indefinitely alongside a fresh TZ GREEN(N+1)/TZ RED(N+1) cycle.

**`gen_pending` (a fresh RED2/GREEN2 firing) is a signal shared across both lineages of a house**, not scoped to just one: any lineage that is itself alive and past its own "2" stage — active or dormant — may independently consume it to form its own next generation. It persists, unconsumed, across days until at least one eligible lineage consumes it (so a lineage that only becomes eligible later can still benefit from an earlier RED2/GREEN2); if multiple lineages are simultaneously eligible the same day, they consume it together, same day (matching the "recorded at the backend" case where a rung's own RED2 also lets the dormant TZ GREEN(N+1)'s own BAR 2(N+1) form the same day).

**Every rung's own deep SL is fully recursive/self-similar**: if a rung's generation later deep-SLs, the exact same race reopens *on that same lineage* — a further TZ GREEN(N+2) vs. the next rung up the ladder (capped at `REAR BUY/SELL RE ENTER`, per above). If a rung's generation SLs *before its own* "2" stage ever formed, that lineage's generation-path dies permanently (no reference exists to reform against, same as any pre-"2" deep SL) — but if that lineage's own anchor (from when it started life as a fresh TZ GREEN/TZ RED cycle) is still alive, the anchor itself is unaffected and keeps ticking its ordinary HH/LL/SL (§1/§2 tracking was never gated on generation state).

**The anchor's own SL remains an unconditional, total termination of its entire lineage** (§1) — including any generation-level state riding on it, such as a still-pending ladder recovery. This can extinguish a recovery opportunity before it ever gets a chance to fire, even though the recovery's own reference is otherwise unrelated to whatever broke the anchor's own Low. Confirmed case: a BAR SL on 22-03-2021 opened a REAR BUY window (target 617.85); the underlying TZ GREEN anchor (born 17-03) then hit its own SL on 25-03-2021 before REAR BUY ever recovered, killing the pending recovery opportunity along with the rest of that lineage.

**Output disambiguation when both tracks are alive at once**: on a day where 2+ *distinct* lineages of the same house each independently fire their own RED1/RED2 (or GREEN1/GREEN2) pullback event, the plain event name alone would be a visually identical duplicate even though the two firings belong to different structures. The report tags each such event with `(<lineage's current label>)` — the lineage's own gen label if a gen has started (e.g. `REAR BUY`), else its anchor name (e.g. `TZ GREEN`) — so `RED1 + RED1` prints instead as `RED1 (REAR BUY) + RED1 (TZ GREEN)`. This tag is added **only** on days where the ambiguity actually occurs; a single active lineage's pullback events print exactly as before, untagged.

## 9. Summary — the repeating generational engine

There is really **one generational engine**: `BAR → BAR 2 → RED1 → RED2 → next BAR`, repeating for as long as recovery succeeds. TZ GREEN/TZ GREEN 2 is the very start of a cycle. Post-BAR 2, SL is two-tiered (§6/§7): a shallow breach recovers lightly (a NEW BAR 2 reforms directly); a deep breach — whose threshold can itself get deeper over time as BAR 2's own inner reference ratchets past BAR's frozen outer one — opens the permanent dual-track race described in §8 (a fresh TZ GREEN cycle vs. REAR BUY reforming off the dead generation's own reference), which is itself fully recursive on the REAR BUY side. There is no terminal "SL2" state anymore — the engine simply keeps racing between fresh-anchor and REAR-BUY-recovery attempts, forever, one level below the House of Bull/Bear split. (§1–§9 describe this engine as it runs under House of Bull, where the generational label is `BAR`/`BAR 2`/`REAR BUY`/`REAR BUY 2`; §10 defines House of Bear's mirror, where the same engine's label is `SAR`/`SAR 2`/`REAR SELL`/`REAR SELL 2` instead — REAR's own name flips between houses (`BUY` vs `SELL`) exactly like the ordinary generational label does.)

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
- Every downstream mechanic built for Bull in §4–§8 under the name `BAR`/`BAR 2` (the two-tier SL split, the outer/inner ratchet during shallow-SL recovery, the REAR/fresh-anchor dual-track race after a deep SL) applies **exactly, direction-flipped, to `SAR`/`SAR 2`** in House of Bear — read every `BAR`/`BAR 2`/`BAR SL`/`BAR 2 SL` in §4–§8 as `SAR`/`SAR 2`/`SAR SL`/`SAR 2 SL` when applying those rules under House of Bear. **`REAR`'s own name IS house-specific**: House of Bull's ladder is `REAR BUY`/`REAR BUY 2`/`REAR BUY RE ENTER`; House of Bear's is `REAR SELL`/`REAR SELL 2`/`REAR SELL RE ENTER` — same mechanism, side-specific name (confirmed by the user; an earlier draft of this spec had REAR's name NOT flipping between houses, which was wrong). Its ratchet-event naming also flips field-literally (`INVALID REAR SELL LL` instead of `INVALID REAR BUY HH`, tracking SAR 2's own reference Low).

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

**TZ GREEN 2's shallow SL is a non-event, and anchor retirement via first-pullback-attach (01/2022 case study, confirmed exact numbers, corrected per the user's explicit rule statement):**
```
DATE      HOUSE OF     EVENT
06/01     BULL + BEAR  TZ GREEN + TZ RED 2 SL + GREEN1  [TZ RED 2's shallow SL fires -- pure log, no
                                                 consequence -- and GREEN1 attaches against the SAME,
                                                 untouched TZ RED 2 the very same day]
08/01     BULL + BEAR  TZ GREEN SL + GREEN1 SL  [GREEN1 (attached 06/01) hits its OWN SL on its own
                                                 schedule -- nothing to do with TZ RED 2's state.
                                                 Earlier drafts of this spec had this print
                                                 "TZ GREEN SL + TZ RED 2" (a fresh TZ RED 2
                                                 "recovering") -- confirmed wrong: TZ RED 2 SL has no
                                                 recovery of its own to await]
09/01     --           (nothing for Bear -- GREEN1 is dead, no fresh attach qualifies that day)
10/01     BULL + BEAR  TZ GREEN + GREEN1        [a FRESH GREEN1 attach -- not GREEN2 continuing off the
                                                 dead 06/01 GREEN1; a dead pullback cannot resolve into
                                                 GREEN2, only a live one can]
11/01     BULL + BEAR  TZ GREEN 2 + GREEN2      [this fresh GREEN1's own resolution to GREEN2]
15/01     BULL + BEAR  RED1 + SAR               [Bull's FIRST-EVER RED1 attaches against TZ GREEN 2 as
                                                 front -- this is what retires the Bull anchor]
16/01     BULL + BEAR  RED1 HH + SAR HH         [TZ GREEN 2 HH does NOT print anymore, even though the
                                                 High (308) did clear TZ GREEN 2's old reference -- the
                                                 anchor retired starting this day, the day after 15/01's
                                                 attach, per the same "same-day event still shows,
                                                 following days suppressed" convention as the older
                                                 gen-reaches-its-own-"2" retirement trigger]
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

- **The anchor's (TZ GREEN 2/TZ RED 2's) own shallow SL has no consequence — confirmed by the user, correcting an earlier wrong version of this spec.** Previously the anchor mirrored BAR/BAR 2's two-tier SL *exactly*, including a "NEW TZ GREEN 2/TZ RED 2 reforms directly" recovery window on a shallow SL. That was wrong: the anchor's shallow SL is now a pure log entry with zero effect (§1/§2) — confirmed against 06-01-2022 through 11-01-2022 (`TZ RED 2 SL` on 06-01 does not stop GREEN1, attached the same day, from later dying on its own schedule via `GREEN1 SL` on 08-01; a *fresh* GREEN1 then attaches 10-01, resolving to GREEN2 on 11-01 — none of this ever depended on TZ RED 2's own state past 06-01) and against 22-03-2021 (`TZ GREEN 2 SL` fires and a fresh RED1 attaches against the same, unkilled anchor the same day). **This is a substantial correction that changes the computed trajectory for both case-study datasets from any date where an anchor-level shallow SL previously occurred** — the 2021 dataset in particular has not yet been walked back through with the user date-by-date under the corrected mechanic (only spot-checked here); a full re-verification pass is recommended before treating the 2021 trajectory as re-confirmed.
- **REAR renamed to REAR BUY / REAR SELL, confirmed by the user.** The ladder mechanism itself (§8) is unchanged; only the label is now house-specific instead of a single generic `REAR` shared by both houses.
- **Two simultaneously-alive lineages (the dormancy race itself) — now confirmed against real dates, 2022 case study.** House of Bull's `BAR SL` (deep) on 22-02-2022 opens a `REAR BUY` window; `REAR BUY` forms 01-03, reaches `REAR BUY 2` on 02-03. Meanwhile a wholly independent fresh `TZ GREEN` anchor also forms 27-02 (path (a)) and progresses to its own `TZ GREEN 2` on 01-03 — both lineages alive and independently ticking at once, exactly the permanent dual-track described in §8. On 04-03-2022 **both** lineages independently fire their own RED1 the same day (one against `REAR BUY 2`'s own reference, the other against `TZ GREEN 2`'s), continuing in parallel through RED1 LL (05-03) and RED2 (06-03) — disambiguated in the report as `RED1 (REAR BUY)` / `RED1 (TZ GREEN)` per §8's tagging convention. This validates the active/dormant determination and the shared `gen_pending` cross-lineage consumption against a real date for the first time.
- **`REAR BUY RE ENTER` (the second rung of the ladder) has not yet been observed firing** — no date in either case-study dataset has produced a deep SL on a `REAR BUY`/`REAR BUY 2` (or `REAR SELL`/`REAR SELL 2`) structure itself (only on plain `BAR`/`SAR`, the anchor, or the still-open `REAR BUY 2` lineage above). Needs a case study where a REAR BUY/SELL generation's own deep SL fires to fully validate that escalation step.
- Whether the $0.20 / $0.01 thresholds need to scale for weekly/monthly/yearly candles remains an open question inherited unchanged from the original rule book (§13 there).
- Reference implementation: `bar_rule_simulator.py` (this repo), run against both case-study datasets (01-01-2021–24-04-2021, 01-01-2022–09-03-2022). Not yet merged into `tz_engine_v9.py` as a production rule variant.
