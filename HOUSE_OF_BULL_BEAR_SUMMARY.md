# House of Bull / House of Bear — Summary

A condensed recap of the current rule set. For full mechanics, every confirmed date, and the history of fixes/corrections behind each rule, see `BAR_RULE_HOUSE_OF_BULL_BEAR.md` (the authoritative spec) and the reference implementation `bar_rule_simulator.py`.

## House of Bull — the BAR cycle

```
TZ GREEN → TZ GREEN 2 → RED1 → RED2 → BAR → BAR 2 ↻ (repeats, no limit)
```

- **TZ GREEN**: fresh anchor forms on a breakout — Low ≥ prior Low, High − prior High ≥ 0.20, Close ≥ prior High.
- **TZ GREEN 2**: the anchor's own "2" stage (same breakout logic, off TZ GREEN's own High). Once formed, TZ GREEN's shallow SL becomes a total non-event — only TZ GREEN's **deep** SL still matters, and it's absolute: it kills the entire lineage, pullback and all, for as long as no BAR has yet taken over.
- **RED1 → RED2**: the standard pullback (adverse move, then a confirming reversal back). RED2 is what "unlocks" the next generation.
- **BAR**: forms once RED2 confirms. **BAR 2**: BAR's own "2" stage.
- **BAR 2 SL (shallow)**: opens a light recovery — a new BAR 2 reforms directly off the old one's reference — *unless* RED2 has already fired for this generation, in which case a full fresh BAR restarts instead.
- **BAR SL (deep)**: total failure of that generation. Opens a **permanent dual-track**: (a) a wholly fresh `TZ GREEN(N+1)` search, and (b) `REAR BUY` reforming directly off the dead BAR 2's own High. Whichever reaches its own "2" first stays active; the other goes **dormant, not dead** — it keeps ratcheting silently in the background and can still resurface later.
- **REAR BUY ladder**: `REAR BUY → REAR BUY 2 → RED1/RED2 → BAR` (reverts to plain naming once RED2 fires again). A further deep SL escalates one rung to `REAR BUY RE ENTER` (terminal — stays RE ENTER forever after).
- **N number of BARs, no limit**: a lineage can form a brand-new BAR off its own RED2 even while its current BAR/BAR 2 is still alive — this just supersedes it. Only an actual **BAR SL** unlocks REAR or a fresh anchor search; ordinary supersession needs no such gate.
- **Dormant recovery**: if the superseded BAR 2 had already shallow-SL'd (its own recovery was live) at the moment it got superseded, that recovery doesn't just vanish — it goes dormant, silently ticking, and can independently terminate the lineage later (overriding whatever the newer BAR is doing that day), opening the same dual-track as an ordinary deep SL.

## House of Bear — exact mirror

```
TZ RED → TZ RED 2 → GREEN1 → GREEN2 → SAR → SAR 2 ↻
```

Same rules throughout, side-flipped: `SAR SL` → dual-track of fresh `TZ RED` vs. `REAR SELL → REAR SELL 2 → GREEN1/GREEN2 → SAR`, ladder escalates to `REAR SELL RE ENTER`.

## Cross-cutting rules

- **Thresholds**: `0.20` for every SL/breakout/formation check, `0.01` for HH/LL ratchets — always **inclusive** (an exact tie qualifies), exact Decimal arithmetic throughout.
- **Older-lineage precedence**: if an older lineage's own recovery resolves the same day a younger one would independently form/reform, the younger one is forfeited for that signal (not merely deferred) — unless it's the older lineage's own legitimately-paired dual-track competitor.
- **A lineage may only consume its own RED2/GREEN2**, never another lineage's stale signal.
- **Permanent dual-track pairing is recursive/self-similar**: a REAR lineage's own further deep SL can spawn yet another fresh-anchor competitor, cascading indefinitely.
