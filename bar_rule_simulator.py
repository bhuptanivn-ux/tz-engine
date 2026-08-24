"""
BAR rule simulator v2 -- corrected per user's cross-verification of the
16-day case study (08/11/12/16-01 corrections):

  - HH/LL are named by literal field (High=HH, Low=LL) in both houses.
  - Once a structure's own "...2" stage forms, it permanently governs
    (silences further display of) whichever side its OWN formation
    condition is about (High side for TZ GREEN2/BAR2/SAR2's mirror-
    opposite... concretely: TZ GREEN2/BAR2 govern the High side,
    TZ RED2/SAR2 govern the Low side). The other side keeps tracking
    and displaying independently, forever, on ANY new extension.
  - A pullback (RED1/GREEN1) cannot (re)attach for a generation until
    THAT generation's own "...2" has already formed.
  - RED1/GREEN1's own SL ("INVALID RED1/GREEN1") cannot fire once its
    own RED2/GREEN2 has already consumed it.
  - The anchor's own SL event is named "TZ GREEN SL" / "TZ RED SL",
    not "INVALID TZ GREEN/RED". Same convention applied to BAR/SAR SL.
  - SL is always checked first and returns immediately (no double
    counting with a child structure's own SL the same day).
"""

THRESH = 0.20
ANY = 0.01

rows = [
    ("01-01-2021", 602,    605.5,  601.65, 604),
    ("02-01-2021", 603.5,  608,    603,    607),
    ("03-01-2021", 606.95, 609,    601,    606.25),
    ("04-01-2021", 606,    607,    605.9,  606),
    ("05-01-2021", 606.15, 606.25, 605.5,  605.9),
    ("06-01-2021", 605.95, 609,    605,    606),
    ("07-01-2021", 605.8,  606,    603,    605),
    ("08-01-2021", 604.95, 605.1,  602,    603),
    ("09-01-2021", 603.05, 605.5,  602.85, 605.25),
    ("10-01-2021", 605,    608,    604.85, 607.85),
    ("11-01-2021", 607.5,  609.1,  607,    608.65),
    ("12-01-2021", 608,    608.5,  606,    606.5),
    ("13-01-2021", 606,    607,    605.85, 606),
    ("14-01-2021", 606.25, 606.75, 605,    605.3),
    ("15-01-2021", 605,    608,    604,    607.75),
    ("16-01-2021", 608,    610,    607.5,  609.5),
    ("17-01-2021", 609,    614,    608.5,  610.3),
    ("18-01-2021", 610,    615,    609.5,  614),
    ("19-01-2021", 613.55, 616.5,  613,    616),
    ("20-01-2021", 615.45, 616.75, 615,    615.25),
    ("21-01-2021", 615,    616.25, 613.35, 614),
    ("22-01-2021", 614.35, 615.5,  613,    613.85),
    ("23-01-2021", 614,    615,    612.25, 612.65),
    ("24-01-2021", 612,    614,    611,    611.35),
    ("25-01-2021", 611.5,  614.5,  611,    613),
    ("26-01-2021", 612.25, 616,    612,    615.5),
    ("27-01-2021", 615.75, 617.25, 615,    615.25),
    ("28-01-2021", 615,    618,    614.85, 617.85),
    ("29-01-2021", 617.5,  620.2,  617,    619),
    ("30-01-2021", 619.5,  622.15, 619,    622),
    ("31-01-2021", 621,    624,    620.05, 623),
    ("01-02-2021", 622,    622.5,  620,    621),
    ("02-02-2021", 620.5,  625.5,  620.05, 624.8),
    ("03-02-2021", 624,    627,    623.5,  626),
    ("04-02-2021", 625.35, 626.75, 623,    623.6),
    ("05-02-2021", 624,    627,    623.75, 626.7),
    ("06-02-2021", 626.25, 629,    626,    628.85),
    ("07-02-2021", 629,    631,    625.5,  626),
    ("08-02-2021", 626.45, 627,    625,    625.45),
    ("09-02-2021", 625.75, 626.15, 624,    624.25),
    ("10-02-2021", 624,    624.7,  621.5,  622.5),
    ("11-02-2021", 623,    623.15, 619.85, 620),
    ("12-02-2021", 620.15, 622.95, 620,    622.5),
    ("13-02-2021", 622.15, 624,    622,    623.5),
    ("14-02-2021", 623.15, 623.5,  621,    622.05),
    ("15-02-2021", 622,    622.5,  620,    620.05),
    ("16-02-2021", 620,    623,    619.65, 622.5),
    ("17-02-2021", 622,    624,    621.5,  623.15),
    ("18-02-2021", 623,    625.25, 622.35, 625),
    ("19-02-2021", 625.05, 630,    624.9,  626),
    ("20-02-2021", 625.85, 626.35, 624.4,  624.65),
    ("21-02-2021", 624.5,  626.95, 624,    626.5),
    ("22-02-2021", 626.5,  627,    625,    625.25),
    ("23-02-2021", 625.5,  626.15, 624,    624.2),
    ("24-02-2021", 624.5,  625.25, 621,    621.5),
    ("25-02-2021", 621.2,  622.05, 619,    619.5),
    ("26-02-2021", 619,    619.5,  617.05, 617.5),
    ("27-02-2021", 617.05, 618.5,  614.5,  614.8),
    ("28-02-2021", 615,    617.75, 614.25, 617),
    ("01-03-2021", 616.85, 619.5,  616.5,  619),
    ("02-03-2021", 618.8,  622.5,  618,    622),
    ("03-03-2021", 623,    627,    622.05, 626),
    ("04-03-2021", 625,    627.35, 624.25, 627),
    ("05-03-2021", 627,    628.5,  626.5,  628),
    ("06-03-2021", 627.35, 628,    625,    625.25),
    ("07-03-2021", 625,    625.35, 621,    622.05),
    ("08-03-2021", 622.1,  623,    617.65, 618.05),
    ("09-03-2021", 618,    619,    614,    615),
    ("10-03-2021", 614.5,  614.5,  612,    613.5),
    ("11-03-2021", 613.25, 615,    611,    612.05),
    ("12-03-2021", 612.5,  614,    611,    611.5),
    ("13-03-2021", 611.25, 612,    609.25, 610),
    ("14-03-2021", 611.05, 613.75, 610.75, 613),
    ("15-03-2021", 612.5,  614,    610,    610.15),
    ("16-03-2021", 610,    613,    609,    612),
    ("17-03-2021", 612.05, 615.25, 611.55, 615),
    ("18-03-2021", 614.05, 615.5,  613.8,  615),
    ("19-03-2021", 614.55, 616,    614,    615.5),
    ("20-03-2021", 615,    617.85, 614.35, 617),
    ("21-03-2021", 616.55, 617,    614,    614.5),
    ("22-03-2021", 615,    616,    613.5,  613.85),
    ("23-03-2021", 614,    615.75, 613,    614),
    ("24-03-2021", 613.5,  614,    611,    612),
    ("25-03-2021", 612.55, 613,    610.25, 610.5),
    ("26-03-2021", 611,    612.85, 610.5,  612),
    ("27-03-2021", 612.15, 613,    609.65, 610.05),
    ("28-03-2021", 610,    611,    608.5,  609),
    ("29-03-2021", 609.5,  610.5,  607.5,  609.95),
    ("30-03-2021", 610,    611,    609.5,  611),
    ("31-03-2021", 611.05, 615,    610.05, 614.2),
    ("01-04-2021", 613.85, 616.05, 613.25, 615.25),
    ("02-04-2021", 615,    616,    613.75, 614),
    ("03-04-2021", 614.25, 617,    614,    616.5),
    ("04-04-2021", 616,    616.05, 614.55, 615),
    ("05-04-2021", 615.05, 615.25, 613,    613.55),
    ("06-04-2021", 614,    614.25, 612.55, 612.75),
    ("07-04-2021", 612.5,  616,    612.35, 615.7),
    ("08-04-2021", 616,    618,    615.2,  617.5),
    ("09-04-2021", 617,    619,    616.5,  616.5),
    ("10-04-2021", 616.75, 620.65, 616.55, 620),
    ("11-04-2021", 620.05, 621,    618.4,  619),
    ("12-04-2021", 618.5,  620,    616,    616.5),
    ("13-04-2021", 617,    620.35, 616.8,  619.85),
    ("14-04-2021", 619.65, 622,    619.5,  621.5),
    ("15-04-2021", 621,    623,    619,    622.05),
    ("16-04-2021", 622,    625,    621.05, 624.55),
    ("17-04-2021", 624,    626.7,  623.25, 626),
    ("18-04-2021", 626.05, 629,    626,    628.5),
    ("19-04-2021", 628,    629.5,  627,    627.05),
    ("20-04-2021", 627,    628.15, 626,    626.45),
    ("21-04-2021", 626.35, 627,    624.75, 625.25),
    ("22-04-2021", 625.05, 626.05, 624,    624.85),
    ("23-04-2021", 625,    627,    624.35, 626.85),
    ("24-04-2021", 626.5,  629,    626.35, 628.65),
]


class Struct:
    """One ref_high/ref_low-bearing structure: TZ GREEN/TZ RED, or a BAR/SAR lineage."""
    def __init__(self, ref_high, ref_low, name):
        self.ref_high = ref_high
        self.ref_low = ref_low
        self.alive = True
        self.stage2_formed = False
        self.name = name  # "TZ GREEN" / "TZ RED" / "BAR" / "SAR"
        # Gen-only, set once stage2 (BAR2/SAR2) forms: the OUTER/deeper reference frozen from
        # BAR's own life before BAR2 reset ref_high/ref_low to its own fresh inner tracking.
        self.bar_ref_low = None   # bullish: BAR's own (pre-BAR2) ref_low, frozen at BAR2 formation
        self.bar_ref_high = None  # bearish mirror: SAR's own (pre-SAR2) ref_high
        self.deep_sl = None       # set True/False when this gen's SL fires, post-stage2


def run_house(rows, bullish, gen_name, debug=False):
    events = [[] for _ in rows]
    anchor_name = "TZ GREEN" if bullish else "TZ RED"
    anchor = None
    pullback = None       # RED1/GREEN1 tracker: dict(ref_high, ref_low, active)
    gen_pending = False    # bar_pending / sar_pending
    gen = None             # current BAR/SAR Struct
    gen_started = False    # True once a BAR/SAR has EVER formed -- enables the SL-recovery
                            # path (a fresh gen via plain breakout, independent of gen_pending)
                            # once an earlier generation has existed and died via its own SL.
    sl_struct = None       # post-SL tracker: its own ref_high/ref_low, checked for SL2 each day
    bar2_recovery = None   # post-shallow-SL tracker: awaiting a NEW BAR2/SAR2 reforming directly

    def up_break(ph, pl, h, l, c):
        return l >= pl and h > ph + THRESH and c >= ph

    def down_break(ph, pl, h, l, c):
        return h <= ph and l < pl - THRESH and c <= pl

    def formation_break(ph, pl, h, l, c):
        return up_break(ph, pl, h, l, c) if bullish else down_break(ph, pl, h, l, c)

    def process_anchor(s, i, h, l, c, label_prefix):
        """SL check, stage2 check, HH/LL tracking for the anchor (TZ GREEN/TZ RED). Returns True
        if SL fired. TZ GREEN2/TZ RED2 governs (silences) one side of the anchor's own ongoing
        tracking once it forms -- see spec SS1/SS2."""
        if bullish:
            sl_hit = (s.ref_low - l) >= THRESH and c <= s.ref_low
        else:
            sl_hit = (h - s.ref_high) >= THRESH and c >= s.ref_high
        if sl_hit:
            events[i].append(f"{label_prefix} SL")
            s.alive = False
            return True

        if not s.stage2_formed:
            if bullish:
                stage2 = (h > s.ref_high + THRESH) and (l >= rows[i - 1][3]) and (c >= s.ref_high)
            else:
                stage2 = (l < s.ref_low - THRESH) and (h <= rows[i - 1][2]) and (c <= s.ref_low)
            if stage2:
                if bullish:
                    s.ref_high = h
                else:
                    s.ref_low = l
                s.stage2_formed = True
                events[i].append(f"{label_prefix} 2")
                return False  # no HH/LL same day as stage2 formation

        high_governed = s.stage2_formed and bullish
        if not high_governed and h > s.ref_high + ANY:
            s.ref_high = h
            events[i].append(f"{label_prefix} HH")

        low_governed = s.stage2_formed and not bullish
        if not low_governed and l < s.ref_low - ANY:
            s.ref_low = l
            events[i].append(f"{label_prefix} LL")

        return False

    def process_gen(s, i, h, l, c):
        """SL check, stage2 (BAR2/SAR2) check, HH/LL tracking for the gen (BAR/SAR). Returns
        True if SL fired (either tier). Unlike the anchor, BAR2/SAR2 record BOTH HH and LL fully,
        forever, ungoverned (spec SS5). Post-BAR2, SL is two-tiered: a SHALLOW breach of BAR2's
        own (inner) reference is "{gen_name} 2 SL" (recovery = a fresh BAR2 reforms directly); a
        DEEP breach of BAR's own frozen (outer) reference -- which only gets LOWER over time as
        BAR2's own inner reference ratchets past it -- is "{gen_name} SL" (recovery = a full
        fresh BAR generation from scratch)."""
        if not s.stage2_formed:
            if bullish:
                sl_hit = (s.ref_low - l) >= THRESH and c <= s.ref_low
            else:
                sl_hit = (h - s.ref_high) >= THRESH and c >= s.ref_high
            if sl_hit:
                events[i].append(f"{gen_name} SL")
                s.alive = False
                s.deep_sl = True  # pre-BAR2 SL is always the "deep"/full-restart kind
                return True

            if bullish:
                stage2 = (h > s.ref_high + THRESH) and (l >= rows[i - 1][3]) and (c >= s.ref_high)
            else:
                stage2 = (l < s.ref_low - THRESH) and (h <= rows[i - 1][2]) and (c <= s.ref_low)
            if stage2:
                if bullish:
                    s.bar_ref_low = s.ref_low  # freeze BAR's own outer threshold
                    s.ref_high = h
                    s.ref_low = l              # BAR2's own fresh inner threshold starts here
                else:
                    s.bar_ref_high = s.ref_high
                    s.ref_low = l
                    s.ref_high = h
                s.stage2_formed = True
                events[i].append(f"{gen_name} 2")
                return False

            if h > s.ref_high + ANY:
                s.ref_high = h
                events[i].append(f"{gen_name} HH")
            if l < s.ref_low - ANY:
                s.ref_low = l
                events[i].append(f"{gen_name} LL")
            return False

        # Post-BAR2/SAR2: two-tier SL.
        if bullish:
            deep_threshold = min(s.bar_ref_low, s.ref_low)
            shallow_sl = (s.ref_low - l) >= THRESH and c <= s.ref_low
            deep_sl = (deep_threshold - l) >= THRESH and c <= deep_threshold
        else:
            deep_threshold = max(s.bar_ref_high, s.ref_high)
            shallow_sl = (h - s.ref_high) >= THRESH and c >= s.ref_high
            deep_sl = (h - deep_threshold) >= THRESH and c >= deep_threshold

        if deep_sl:
            events[i].append(f"{gen_name} SL")
            s.alive = False
            s.deep_sl = True
            return True
        if shallow_sl:
            events[i].append(f"{gen_name} 2 SL")
            s.alive = False
            s.deep_sl = False
            return True

        if h > s.ref_high + ANY:
            s.ref_high = h
            events[i].append(f"{gen_name} 2 HH")
        if l < s.ref_low - ANY:
            s.ref_low = l
            events[i].append(f"{gen_name} 2 LL")
        return False

    for i in range(1, len(rows)):
        _, o, h, l, c = rows[i]
        _, po, ph, pl, pc = rows[i - 1]

        if debug:
            print(f"  {rows[i][0]}: anchor={None if anchor is None else (anchor.ref_high, anchor.ref_low, anchor.alive, anchor.stage2_formed)} pullback={pullback} gen_pending={gen_pending} gen={None if gen is None else (gen.ref_high, gen.ref_low, gen.alive, gen.stage2_formed)}")

        if anchor is None or not anchor.alive:
            if formation_break(ph, pl, h, l, c):
                anchor = Struct(h, l, anchor_name)
                pullback = None
                gen_pending = False
                gen = None
                gen_started = False
                sl_struct = None
                bar2_recovery = None
                events[i].append(anchor_name)
            continue

        sl_fired = process_anchor(anchor, i, h, l, c, anchor_name)
        if sl_fired:
            anchor = None
            pullback = None
            gen_pending = False
            gen = None
            gen_started = False
            sl_struct = None
            bar2_recovery = None
            continue

        def process_pullback():
            """Returns True if it consumed the day's event slot (attach/RED2/invalid all do)."""
            nonlocal pullback, gen_pending
            if pullback is None or not pullback["active"]:
                if bullish:
                    attach = h <= ph and (pl - l) >= THRESH and c <= pl
                else:
                    attach = l >= pl and (h - ph) >= THRESH and c >= ph
                if attach:
                    pullback = {"ref_high": h, "ref_low": l, "active": True}
                    events[i].append("RED1" if bullish else "GREEN1")
                    return True
                return False

            pb = pullback
            if bullish:
                red2 = l <= pb["ref_low"] and h <= ph and (ph - pl) >= THRESH and c <= pb["ref_low"] + 0.001
            else:
                red2 = h >= pb["ref_high"] and l >= pl and (ph - pl) >= THRESH and c >= pb["ref_high"] - 0.001
            if red2:
                events[i].append("RED2" if bullish else "GREEN2")
                pb["active"] = False
                gen_pending = True
                return True

            if bullish:
                invalid = (h - pb["ref_high"]) >= THRESH and c >= pb["ref_high"]
            else:
                invalid = (pb["ref_low"] - l) >= THRESH and c <= pb["ref_low"]
            if invalid:
                events[i].append("RED1 SL" if bullish else "GREEN1 SL")
                pb["active"] = False
                return True

            fired = False
            # "Deepening" side (further into the pullback, not yet confirming RED2/GREEN2):
            # Low deepens for RED1 (a down-pullback); High deepens for GREEN1 (an up-pullback).
            if bullish and l < pb["ref_low"]:
                pb["ref_low"] = l
                events[i].append("RED1 LL")
                fired = True
            elif (not bullish) and h > pb["ref_high"]:
                pb["ref_high"] = h
                events[i].append("GREEN1 HH")
                fired = True
            # "Weak extension" side (per original rulebook §3: tracked even though it's the
            # opposite side from the pullback's own direction): High for RED1, Low for GREEN1.
            if bullish and h > pb["ref_high"]:
                pb["ref_high"] = h
                events[i].append("RED1 HH")
                fired = True
            elif (not bullish) and l < pb["ref_low"]:
                pb["ref_low"] = l
                events[i].append("GREEN1 LL")
                fired = True
            return fired

        # Awaiting a "NEW BAR 2" reforming directly (the shallow-SL recovery path): each day,
        # check first for the recovery itself (clearing BAR2's own frozen reference high/low),
        # then for escalation into the deep/full-restart path if price breaks the frozen deep
        # threshold too (per user: the deep breach "whether earlier or same day" still applies).
        if bar2_recovery is not None:
            ref = bar2_recovery["ref"]
            deep_threshold = bar2_recovery["deep_threshold"]
            if bullish:
                recovers = l >= pl and h > ref + THRESH and c >= ref
                escalates = (deep_threshold - l) >= THRESH and c <= deep_threshold
            else:
                recovers = h <= ph and l < ref - THRESH and c <= ref
                escalates = (h - deep_threshold) >= THRESH and c >= deep_threshold
            if recovers:
                gen = Struct(h, l, gen_name)
                gen.stage2_formed = True
                if bullish:
                    gen.bar_ref_low = bar2_recovery["outer"]
                else:
                    gen.bar_ref_high = bar2_recovery["outer"]
                bar2_recovery = None
                events[i].append(f"{gen_name} 2")
                continue
            if escalates:
                sl_struct = Struct(h, l, f"{gen_name} SL")
                bar2_recovery = None
                events[i].append(f"{gen_name} SL")
                continue
            # else: still awaiting recovery. Both the outer ("{gen_name} HH"/"LL") and inner
            # ("{gen_name} 2 HH"/"LL") thresholds keep ratcheting on the adverse side (High for
            # bearish, Low for bullish) independently, using the ordinary ANY threshold -- this
            # is what "{gen_name} HH is continuously evaluated for {gen_name} SL" means: once
            # the two converge to the same value, any further close past it is a plain
            # "{gen_name} SL" (deep), since there's no more shallow/deep distinction.
            inner_adverse = bar2_recovery["inner_adverse"]
            if bullish:
                if bar2_recovery["outer"] - l >= ANY:
                    bar2_recovery["outer"] = l
                    events[i].append(f"{gen_name} LL")
                if inner_adverse - l >= ANY:
                    bar2_recovery["inner_adverse"] = l
                    events[i].append(f"{gen_name} 2 LL")
            else:
                if h - bar2_recovery["outer"] >= ANY:
                    bar2_recovery["outer"] = h
                    events[i].append(f"{gen_name} HH")
                if h - inner_adverse >= ANY:
                    bar2_recovery["inner_adverse"] = h
                    events[i].append(f"{gen_name} 2 HH")
            bar2_recovery["deep_threshold"] = (
                min(bar2_recovery["outer"], bar2_recovery["inner_adverse"]) if bullish
                else max(bar2_recovery["outer"], bar2_recovery["inner_adverse"])
            )

        # Process the current gen's own SL every day it exists and is alive (its own SL always
        # applies regardless of gen_pending, per the original book's "SL always checked").
        gen_sl_fired_today = False
        if gen is not None and gen.alive:
            outer_before = gen.bar_ref_low if bullish else gen.bar_ref_high
            gen_sl = process_gen(gen, i, h, l, c)
            if gen_sl:
                if gen.deep_sl:
                    sl_struct = Struct(h, l, f"{gen_name} SL")  # full-restart path, as before
                else:
                    # Shallow: await a NEW BAR 2 reforming directly above BAR2's own last high
                    # (bullish) / below BAR2's own last low (bearish); track the deep threshold
                    # too, in case price escalates into the full-restart path instead.
                    inner_adverse = gen.ref_low if bullish else gen.ref_high
                    # The outer threshold can ALSO ratchet on the very same day the shallow SL
                    # fires (it's continuously evaluated, independent of the SL confirming) --
                    # e.g. High clears the outer reference by ANY but Close doesn't hold above it
                    # (so no deep SL confirms), yet the outer reference still extends and shows.
                    outer_now = outer_before
                    if bullish:
                        if outer_before - l >= ANY:
                            outer_now = l
                            events[i].append(f"{gen_name} LL")
                    else:
                        if h - outer_before >= ANY:
                            outer_now = h
                            events[i].append(f"{gen_name} HH")
                    if bullish:
                        deep_threshold = min(outer_now, inner_adverse)
                    else:
                        deep_threshold = max(outer_now, inner_adverse)
                    bar2_recovery = {
                        "ref": gen.ref_high if bullish else gen.ref_low,  # favorable side (recovery)
                        "inner_adverse": inner_adverse,  # adverse side, inner ("{gen_name} 2 LL/HH")
                        "deep_threshold": deep_threshold,
                        "outer": outer_now,  # adverse side, outer ("{gen_name} LL/HH")
                    }
                gen = None
                # NOTE: an already-active pullback (RED1/GREEN1 already attached) is NOT cleared
                # here -- it continues resolving toward RED2/GREEN2 (or its own SL) independent
                # of whether its parent BAR/SAR is still alive. Only a fresh (not-yet-attached)
                # pullback is blocked from attaching without an active parent -- see the gating
                # below. This matches the user's correction: GREEN1/GREEN2 keep being looked for
                # "as long as SAR is active" for ATTACH, but an already-attached one continues
                # regardless once formed.
                # BAR/SAR SL does not kill the anchor or reset gen_pending here. Note: full
                # multi-generation racing (an old BAR(n) continuing after BAR(n+1) forms, per
                # the spec's SS8) is NOT modeled -- this simulator tracks only one "current
                # front" generation at a time. Out of scope for this dataset so far.
                gen_sl_fired_today = True

        # Post-SL tracking: SL2 check (permanent terminal), gated by reactivation NOT already
        # firing this same day (checked first, below, via trigger_b -- reactivation always wins).
        # Skipped on the same day gen's own SL just fired (that SL/recovery-setup IS today's
        # event for this sub-structure; SL2 only applies on later days).
        if sl_struct is not None and gen is None and not gen_sl_fired_today:
            if bullish:
                sl2 = (sl_struct.ref_low - l) >= THRESH and c <= sl_struct.ref_low
            else:
                sl2 = (h - sl_struct.ref_high) >= THRESH and c >= sl_struct.ref_high
            reactivates_today = gen_started and formation_break(ph, pl, h, l, c)
            if sl2 and not reactivates_today:
                events[i].append(f"{gen_name} SL2")
                # No REAR/REAR RE-ENTER in this logic -- SL2 always resets straight to a fresh
                # TZ GREEN/TZ RED anchor search, unconditionally.
                anchor = None
                pullback = None
                gen_pending = False
                gen = None
                gen_started = False
                sl_struct = None
                bar2_recovery = None
                continue
            if not reactivates_today:
                # Ordinary SL-HH/SL-LL tracking (both sides, simple ANY threshold -- no "...2"
                # object exists at this level to govern/silence either side).
                if h > sl_struct.ref_high + ANY:
                    sl_struct.ref_high = h
                    events[i].append(f"{gen_name} SL HH")
                if l < sl_struct.ref_low - ANY:
                    sl_struct.ref_low = l
                    events[i].append(f"{gen_name} SL LL")

        # Pullback (RED1/GREEN1) attaches/continues off whichever structure is currently the
        # "front" of the chain -- gated uniformly on that structure's own "...2" having formed,
        # AND on gen_pending being False. Per the original rule book: once a BAR/SAR SL has
        # fired, RED1/RED2 (GREEN1/GREEN2) formation is NOT possible -- an ACTIVE BAR/SAR is
        # required. The anchor only serves as "front" before any BAR/SAR has EVER existed
        # (gen_started == False); once a generation has existed, only a live, alive gen can be
        # "front" -- there is no falling back to the anchor after a BAR/SAR SL.
        if gen is not None and gen.alive:
            front = gen
        elif not gen_started:
            front = anchor
        else:
            front = None  # BAR/SAR SL'd, no active generation -- pullback formation blocked.

        if pullback is not None and pullback["active"]:
            # Already-attached pullback: continues resolving toward RED2/GREEN2 (or its own SL)
            # regardless of whether its parent gen is still alive.
            process_pullback()
        elif front is not None and front.stage2_formed and not gen_pending:
            # Fresh attach still requires an active front (per the "active BAR required" rule).
            process_pullback()

        # BAR/SAR formation -- forms a NEW generation (replacing `gen` as the front), via a
        # plain breakout check. Two independent triggers, per spec SS8:
        # (A) gen_pending (RED2/GREEN2 fired): allowed even while an old gen is still technically
        #     "alive" as long as ITS OWN stage2 already formed (its pullback-gating role is done;
        #     BAR(N+1) can coexist with a still-racing BAR(n), per SS8).
        # (B) gen_started (a prior generation existed and later died via its own SL): the direct
        #     recovery path, independent of gen_pending/RED1-RED2 -- only once gen is truly dead.
        trigger_a = gen_pending and (gen is None or not gen.alive or gen.stage2_formed)
        trigger_b = gen_started and (gen is None or not gen.alive)
        if trigger_a or trigger_b:
            if formation_break(ph, pl, h, l, c):
                gen = Struct(h, l, gen_name)
                gen_pending = False
                gen_started = True
                sl_struct = None
                bar2_recovery = None
                events[i].append(gen_name)

    return events


bull_events = run_house(rows, True, "BAR")
bear_events = run_house(rows, False, "SAR")

print(f"{'DATE':12}{'OPEN':8}{'HIGH':8}{'LOW':8}{'CLOSE':8}{'HOUSE':14}EVENT")
for i, (d, o, h, l, c) in enumerate(rows):
    be = bull_events[i]
    re = bear_events[i]
    if be and re:
        house = "BULL + BEAR"
    elif be:
        house = "BULL"
    elif re:
        house = "BEAR"
    else:
        house = ""
    ev = " + ".join(be + re)
    print(f"{d:12}{o:<8}{h:<8}{l:<8}{c:<8}{house:14}{ev}")
