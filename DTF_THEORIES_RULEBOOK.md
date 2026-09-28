# DTF-only theories (specification only, NOT implemented)

This file holds theories that are defined **only for DTF (Daily Time Frame)
data** and are NOT the same theory as TZ BUY (`tz_engine_wtf.py` /
`WTF_RULEBOOK.md`) run on daily candles — unlike TZ BUY itself, which is
one theory applied at any candle period, each entry here changes the
underlying rules themselves, so it needs its own separate state machine.

Kept separate from `WTF_RULEBOOK.md` for the same reason PRIME TREND has
its own file (`PRIME_TREND_RULEBOOK.md`) instead of a new heading inside
the TZ BUY rulebook: a related but structurally different theory gets its
own file, not a section buried in another theory's book. Building any of
these does not change TZ BUY, PRIME TREND, or the TAR/TBAR /
BAR ENTRY/BAR 2 spec in `WTF_RULEBOOK.md` in any way.

Every theory in this file is specification only until explicitly built —
each section says so, and none should be treated as shipped or as
affecting `tz_engine_wtf.py` / `prime_trend.py` unless a later note here
says otherwise.

## DTF BAR (specification only, NOT implemented)

A restructured version of the TZ BUY skeleton, DTF-only: no TZ BUY 2 tier,
a mandatory RED1→RED2 cascade in place of the base engine's single RED
before TZ BUY can form, and a new TZ BUY SL 2 concept that plays the same
role BAR SL2 plays in the base engine.

- **TZ GREEN** — same as the base TZ BUY engine's own TZ GREEN.
- **RED1 → RED2 (mandatory, replaces the base engine's single RED)** —
  there is no plain single "RED" stage between TZ GREEN and TZ BUY in this
  theory. TZ GREEN's pullback must complete a full RED1→RED2 cascade
  (same mechanics as every other RED1/RED2 in this codebase: gap ≥ 0.20
  pts, Close confirms at/below the reference low, quiet-LL updates on any
  failed breach) before TZ BUY can ever form. If price never pulls back at
  all, TZ BUY never forms — there is no direct TZ GREEN → TZ BUY path in
  DTF BAR, unlike the base engine.
- **TZ BUY** — forms the same way as always (standard breakout shape),
  referenced off RED2's own (quietly climbing) reference high.
- **TZ BUY SL** — same as always: standard SL test against TZ BUY's own
  reference low.
- **TZ BUY reactivation** — above TZ BUY's own reference high, same
  reactivate-above-current-top-reference principle used everywhere else.
- **No TZ BUY 2 tier exists in this theory at all.** RED1/RED2 following
  TZ BUY pulls back directly against TZ BUY's own reference (not a "2"
  tier), and BAR1 → BAR2 forms directly underneath TZ BUY, the same
  mechanics as the base engine's BAR lineage normally sitting under TZ BUY
  2.
- **TZ BUY SL 2 (new term)** — mirrors BAR SL2's functional role exactly,
  not merely "TZ BUY SL happening a second time" as a label. TZ BUY SL
  fires (TZ BUY's first failure) → TZ BUY reactivates above its own
  reference high → if that reactivated TZ BUY fails again, that second
  failure is named **TZ BUY SL 2**, and it's what hands off into REAR —
  the same role BAR SL2 plays in the base engine.
- **REAR** — can form above TZ BUY's own reference high once TZ BUY SL 2
  fires (the "new cycle").
- **REAR 2 / REAR RE-ENTER are NOT compulsory** — the sequence can go
  straight from REAR into a fresh RED1→RED2→BAR1→BAR2 cascade without
  REAR 2 (or REAR RE-ENTER) needing to confirm first.
- **Reactivation, for every tier throughout** — reused unchanged from the
  base TZ BUY engine (react above whichever tier's reference is currently
  highest, quiet climbs, etc.).

**Confirmed worked example (the standard pattern):**

```
TZ GREEN → RED1 → RED2 → TZ BUY → RED1 → RED2 → BAR1 → BAR2 →
RED1 → RED2 → BAR1 → BAR2 → BAR SL2 → REAR (new cycle) → REAR2 →
RED1 → RED2 → BAR1 → BAR2
```
