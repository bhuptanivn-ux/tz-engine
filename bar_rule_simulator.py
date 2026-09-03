"""
BAR rule simulator v3 -- removes BAR SL2 entirely. Per the user's latest
correction: the cycle no longer has a terminal "SL2" failure state. Instead,
after a DEEP BAR/SAR SL (post-stage2, breaking the outer min/max threshold;
or any BAR/SAR SL before stage2 ever formed), TWO permanently co-existing
recovery paths open up:

  a) NEW TZ GREEN/TZ RED cycle -- a wholly fresh anchor search, independent
     of the dead generation's own reference (only possible if no gen was
     already stage2_formed... no, actually always possible; if the dead gen
     never reached BAR2, only this path exists).
  b) REAR BUY/SELL -- reforms directly above/below the dead generation's own
     BAR2/SAR2 reference (only possible if that generation HAD reached
     stage2). House-specific name: House of Bull uses REAR BUY, House of
     Bear uses REAR SELL -- same mechanism either way. Gets its own REAR
     BUY 2/REAR SELL 2 (identical mechanics to BAR 2: ungoverned dual HH/LL,
     two-tier SL), then RED1/RED2 (or GREEN1/GREEN2) attach to it exactly
     like BAR 2. Once RED2/GREEN2 fires there, the NEXT generation reverts
     to plain BAR/BAR 2 (or SAR/SAR 2) naming -- REAR BUY/SELL is only the
     label for the one generation immediately recovering from a deep SL.

Whichever of (a)/(b) reaches its own stage2 (BAR2(N+1) vs REAR BUY 2) FIRST
becomes "active"; the other does NOT terminate -- it goes DORMANT (per the
user: "stay dormant and not terminated"), and this is a PERMANENT ongoing
dual-track, not a one-time decision -- exactly mirroring the House of
Bull/Bear split, just one level down. A dormant lineage's own frozen
reference (BAR2's/REAR BUY 2's own High/Low) keeps ratcheting via ordinary
price action even while dormant (labeled "INVALID REAR BUY HH"/"INVALID
REAR BUY LL" while literally awaiting a REAR BUY reformation) -- so it's
available again with an up-to-date reference if the other, currently-active
lineage later fails. Confirmed for real against the 2022 case-study dataset
(27-02 through 06-03-2022): a fresh TZ GREEN and a REAR BUY lineage stay
alive at once, each independently firing its own RED1/RED2 on the same
days -- disambiguated in the printed output as "RED1 (REAR BUY)"/"RED1
(TZ GREEN)" (see pullback_track/pullback_buffer below) since the plain
event name alone would otherwise look like a duplicate.

gen_pending (from any lineage's RED2) is a per-HOUSE shared signal: ANY
lineage that is itself alive and past its own stage2 can independently
consume it to form its own next generation -- this models the user's
"if REAR 2 IS ALSO BAR 2(N+1), record that at the backend" / "any new green
can be BAR(N+1) since RED1 and RED2 has also occurred" notes.

REAR BUY/SELL SL is fully recursive/self-similar to BAR SL: if REAR
BUY/SELL's own generation later deep-SLs, the exact same race reopens (a
further TZ GREEN(N+2) vs a new REAR BUY reforming off REAR BUY 2's own
reference), on the SAME lineage object (REAR BUY/SELL is just a naming
state that toggles on/off within one lineage's life, not a separate
lineage kind). If REAR BUY/SELL's own gen SLs before its own 2 ever formed,
that lineage dies permanently (no reference exists to reform against) --
this matches the user's explicit worked example.
"""

from decimal import Decimal

# All threshold comparisons throughout this file must be EXACT decimal arithmetic, not raw
# binary floating point -- confirmed by the user against 27-06-2022: High(311.7) minus a SAR's
# ref_high(311.5) is exactly 0.20 in decimal, which should tie the SL threshold (>= THRESH), but
# raw Python floats compute 311.7 - 311.5 as 0.19999999999998863 (a hair under 0.20 due to binary
# float rounding), silently flipping the result from "SAR SL" to "SAR HH" -- "NO FLOATING
# ARITHMETIC... Can you change to proper mathematics." THRESH/ANY and every OHLC value are
# Decimal from here on, so every `-`/`+`/comparison downstream is exact for these 2-3-decimal-
# place prices, with zero changes needed to the comparison logic itself.
THRESH = Decimal("0.20")
ANY = Decimal("0.01")

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

rows = [(d, Decimal(str(o)), Decimal(str(h)), Decimal(str(l)), Decimal(str(c))) for d, o, h, l, c in rows]


class Struct:
    def __init__(self, ref_high, ref_low, name, formed_day=None):
        self.ref_high = ref_high
        self.ref_low = ref_low
        self.alive = True
        self.stage2_formed = False
        self.name = name
        self.bar_ref_low = None
        self.bar_ref_high = None
        # Day index this Struct was created -- used only to tell whether two DISTINCT
        # lineages' current fronts came into being on the exact same day (see
        # Lineage.created_day and the pullback-attach precedence rule below).
        self.formed_day = formed_day


class Lineage:
    def __init__(self, created_day=None):
        # Day index this Lineage object was created -- used only to break ties when 2+
        # lineages' current fronts came into being the same day and both independently
        # qualify for a fresh RED1/GREEN1 attach (see the precedence rule below).
        self.created_day = created_day
        self.anchor = None          # Struct, only for a lineage that began as a fresh TZ GREEN/TZ RED
        self.pullback = None        # RED1/GREEN1 tracker
        self.gen = None             # current BAR/SAR/REAR/REAR RE ENTER Struct
        self.gen_started = False    # True once this lineage's first gen has ever formed
        self.bar2_recovery = None   # shallow-SL "NEW X2 reforms directly" awaiting state
        self.rear_recovery = None   # deep-SL "escalate to next recovery level" awaiting state
        self.dead = False           # permanently dead -- no recovery reference exists
        # Ladder of deep-SL recovery labels: None (plain BAR/SAR) -> "REAR" -> "REAR RE ENTER",
        # where "REAR RE ENTER" is terminal (further deep SLs stay "REAR RE ENTER" forever).
        # Reset to None whenever a fresh gen forms off the ordinary gen_pending/RED2 path.
        self.recovery_label = None
        # True once this lineage's gen has died pre-"2" (no REAR/ladder recovery possible) but
        # its own anchor is still alive and ticking. Such a lineage is NOT a permanent dual-track
        # competitor (that only applies to the REAR-vs-fresh-anchor race at the gen level) -- it
        # gets retired the moment the next fresh anchor successfully forms, matching the
        # single-lineage-at-a-time behavior everywhere except that one deliberate race.
        self.orphaned_anchor = False
        # Once TRUE (permanently), the anchor's own SL/stage2/HH-LL tracking is no longer
        # checked/printed at all -- set the first time this lineage's gen reaches its own "2"
        # stage, at which point BAR 2 (or REAR 2/REAR RE ENTER 2) has its own separate
        # deep-SL reference and the anchor's own (now stale) one would be a redundant,
        # unrelated failure mode. NOTE: a RED1/GREEN1 pullback attaching against the anchor
        # does NOT retire it -- confirmed by the user (11-01-2022): the anchor's own DEEP SL
        # must keep being checked, and still fully terminates the lineage (pullback included),
        # for as long as gen_started is False. Only the anchor's SHALLOW SL is a no-op (§2).
        self.anchor_retired = False
        # True when a gen's shallow SL fired while gen_pending was ALREADY set (RED2 already
        # fired for this generation before the SL) -- per the original rule: "if RED2 occurs
        # but BAR 2 SL is pending, NEW BAR will start" -- a full fresh BAR/gen forms directly
        # off the already-set gen_pending instead of the lighter "NEW BAR 2 reforms directly"
        # path. Lets the fresh-gen-formation trigger fire even though gen_started blocks the
        # ordinary anchor-fallback ("active BAR required").
        self.gen_fresh_pending = False
        # The fresh-anchor lineage that THIS lineage's own dying gen most recently spawned as
        # its paired dual-track counterpart (via the gated re-arming below), if any -- used
        # to tell "this lineage's own further ladder failures" apart from "a totally
        # unrelated, independent history" when deciding whether the house-wide fresh-anchor
        # search needs reopening again. None until this lineage's gen has deep-SL'd (or
        # bar2_recovery-escalated) at least once.
        self.competitor = None
        # Which gen_pending "episode" (see run_house's gen_pending_episode counter) this
        # lineage most recently declined a fresh-gen-formation off of, because an OLDER
        # lineage's own rear_recovery resolved the exact same day (see the older-lineage-
        # precedence gating below). None until a decline has happened; compared against the
        # CURRENT episode counter so a later, genuinely NEW gen_pending (a fresh RED2/GREEN2)
        # re-opens eligibility rather than leaving this lineage permanently blocked.
        self.declined_gen_pending_episode = None
        # True once this lineage has LOST an older-lineage-precedence collision (its own gen-
        # formation declined in favor of an older lineage reaching the same or an equivalent-
        # shape outcome the same day). Permanent, unlike declined_gen_pending_episode -- this
        # lineage's own front must never independently start a FRESH pullback again, since its
        # future is redundant with the older lineage's from that point on. Deliberately does
        # NOT set `dead` -- this lineage's own anchor/gen HH/LL/SL tracking, and its role in
        # competitor-pairing elsewhere, are unrelated mechanics and must keep working exactly
        # as before; only starting a NEW pullback is what's actually redundant here. Confirmed
        # by the user against 21-05-2022/23-05-2022 ("2 different lineages... why mentioned
        # both?"): the lineage that lost the 18-05-2022 SAR-formation race kept independently
        # firing its own dual-tagged GREEN1/GREEN1 SL days later -- that's the specific thing
        # this flag stops, nothing more.
        self.superseded = False
        # The exact front Struct object whose RED2/GREEN2 has already confirmed once. A front
        # only ever gets ONE pullback cycle -- once RED2/GREEN2 fires against it, it cannot
        # host a SECOND, fresh RED1/GREEN1 attach without first changing identity (a genuinely
        # NEW Struct forming for this lineage, via any reform/formation path) -- confirmed by
        # the user against 11-02-2022: RED2 already confirmed 10-02-2022, "there is no BUY
        # event in between, hence RED1 and RED2 not possible" on 11-02-2022 against the SAME,
        # unchanged BAR2. Compared by object identity, so a later front change (a new Struct)
        # naturally re-opens eligibility without needing an explicit reset.
        self.pullback_used = None
        # True the first time THIS lineage's own gen or anchor reaches its own "2" -- once
        # proven this way, this lineage is a permanent, legitimate parallel thread and its
        # paired competitor (Lineage.competitor) can never retire it (see retire_other_pending).
        # A lineage that has NOT yet reached this milestone is still "unproven" -- if its paired
        # competitor wins the race first, this one is retired instead of exempted, regardless of
        # which side started first. Confirmed by the user: a fresh TZ RED that reached TZ RED 2
        # on 29-05-2022 (proven) is never retired by its paired lineage's own later REAR SELL 2
        # on 04-06-2022 ("no need to terminate the new lineage, keep it active") -- but a fresh
        # competitor that has NOT yet reached any "2" of its own when the OTHER side reaches its
        # new "2" first goes dormant instead ("new lineage will keep recording at the back end").
        self.ever_reached_stage2 = False


def run_house(rows, bullish, gen_name, anchor_name):
    # Defensively re-convert to Decimal here too, so run_house is exact regardless of what its
    # caller passed in (see the module-level THRESH/ANY/rows comment for the full rationale).
    rows = [(d, Decimal(str(o)), Decimal(str(h)), Decimal(str(l)), Decimal(str(c))) for d, o, h, l, c in rows]
    events = [[] for _ in rows]
    pullback_buffer = [[] for _ in rows]
    lineages = []
    gen_pending = False        # set by a RED2/GREEN2 confirming; consumable only by its OWN lineage (gen_pending_owner)
    # WHICH lineage's own RED1/RED2 (GREEN1/GREEN2) pullback actually produced the currently
    # pending signal. A lineage may only form its fresh plain gen (BAR/SAR) off ITS OWN
    # pullback confirmation -- never off another lineage's, however long that other signal has
    # been sitting unconsumed. Confirmed by the user against 03-03-2021 ("NEW LINEAGE TZ GREEN
    # 01/03 has not received RED 2. How is BAR POSSIBLE?") read together with 22-03-2021 ("this
    # SAR is a result of TZ RED - TZ RED 2 - GREEN1 (17/03) - GREEN 2 (19/03)"): the two cases
    # are otherwise structurally identical (a fresh anchor, paired as the dual-track competitor
    # of an older lineage that still holds a pending REAR recovery, reaching its own anchor "2"
    # and then trying to form its first plain gen) and differ ONLY in whether that lineage had
    # earned its own RED2/GREEN2 first. The older lineage's own pending recovery has nothing to
    # do with it: "BAR SL of earlier lineage cannot stop from having SAR."
    gen_pending_owner = None
    # Bumped every time gen_pending newly turns True (a fresh RED2/GREEN2) -- lets a lineage's
    # declined-due-to-collision state (Lineage.declined_gen_pending_episode) tell "the same
    # still-pending signal I already declined" apart from "a genuinely new one," so a forfeited
    # opportunity stays forfeited only for its own episode, not forever.
    gen_pending_episode = 0
    awaiting_fresh_anchor = True
    # Set (to the dying lineage) at the moment a gen-deep-SL/bar2_recovery-escalation reopens
    # awaiting_fresh_anchor via the gated paths below; consumed the moment the resulting fresh
    # anchor actually forms, pairing the two as dual-track counterparts (see Lineage.competitor).
    pending_competitor_source = None

    def up_break(ph, pl, h, l, c):
        return l >= pl and h > ph + THRESH and c >= ph

    def down_break(ph, pl, h, l, c):
        return h <= ph and l < pl - THRESH and c <= pl

    def formation_break(ph, pl, h, l, c):
        return up_break(ph, pl, h, l, c) if bullish else down_break(ph, pl, h, l, c)

    def rear_recovery_would_resolve(rec, h, l, c, ph, pl):
        ref = rec["ref"]
        if bullish:
            return l >= pl and h > ref + THRESH and c >= ref
        return h <= ph and l < ref - THRESH and c <= ref

    def recovery_would_resolve(rec, h, l, c, ph, pl):
        """Dispatches to the right resolution test for a lineage's rear_recovery -- the ordinary
        single-threshold breach against the dead gen's own favorable-side reference, UNLESS this
        is a `direct_reform` entry (a PLAIN gen, recovery_label None, that died before ever
        reaching its own "2" -- see the gen-deep-SL handling below), which instead uses the
        SAME formation_break() breakout that would otherwise form a brand-new TZ GREEN/TZ RED
        anchor. Confirmed by the user: "IMMEDIATELY ANY DAY WHICH IS FULFILLING TZ RED CONDITIONS
        WILL BE A SAR... NOT NECESSARY WAIT FOR SAR REF HIGH" -- a plain gen's own direct reform
        is not gated on any specific reference of its own at all, unlike every other recovery
        window in this file."""
        if rec.get("direct_reform"):
            return formation_break(ph, pl, h, l, c)
        return rear_recovery_would_resolve(rec, h, l, c, ph, pl)

    def would_deep_sl(s, h, l, c):
        """Side-effect-free peek at whether s (a gen or anchor Struct) would deep-SL today,
        mirroring process_gen's own deep_sl condition exactly. Used to check the ANCHOR's own
        deep-SL condition BEFORE processing its lineage's gen for the day (see the gen-skip
        below), without mutating anything or printing."""
        if not s.stage2_formed:
            if bullish:
                return (s.ref_low - l) >= THRESH and c <= s.ref_low
            return (h - s.ref_high) >= THRESH and c >= s.ref_high
        if bullish:
            deep_threshold = min(s.bar_ref_low, s.ref_low)
            return (deep_threshold - l) >= THRESH and c <= deep_threshold
        deep_threshold = max(s.bar_ref_high, s.ref_high)
        return (h - deep_threshold) >= THRESH and c >= deep_threshold

    def current_label(lin):
        return lin.recovery_label or gen_name

    def escalated_label(lin):
        """The label a deep-SL recovery escalates TO. None -> REAR BUY/SELL -> REAR BUY/SELL
        RE ENTER (terminal). House-specific: House of Bull uses REAR BUY, House of Bear uses
        REAR SELL -- same mechanism, side-specific name."""
        rear = "REAR BUY" if bullish else "REAR SELL"
        return rear if lin.recovery_label is None else f"{rear} RE ENTER"

    def retire_other_pending(winner):
        """The moment ANY lineage re-establishes itself past its own "2" (gen or anchor), every
        OTHER lineage's still-pending recovery search (rear_recovery/bar2_recovery) is retired
        outright UNLESS that other lineage is winner's own directly-paired dual-track competitor
        AND has ALREADY independently reached its own "2" at some earlier point (Lineage.
        ever_reached_stage2) -- i.e. has already proven itself a permanent, legitimate parallel
        thread. Whichever side of a paired dyad reaches "2" FIRST is safe forever from here on,
        regardless of which side (older or newer) that turns out to be; the OTHER side, once it
        also independently proves itself later, is likewise safe from then on too. What is NOT
        safe is a paired competitor that has NEVER YET reached its own "2" when the other side
        gets there first -- that one is retired along with any unrelated, already-superseded
        lineage, not exempted merely for being "the" paired competitor. Confirmed by the user: a
        fresh TZ RED that reached TZ RED 2 on 29-05-2022 (already proven) is never retired by its
        paired lineage's own later REAR SELL 2 on 04-06-2022 ("no need to terminate the new
        lineage, keep it active") -- but a fresh competitor that has NOT yet reached any "2" of
        its own when the OTHER side reaches its new "2" first is retired instead ("new lineage
        will keep recording at the back end [i.e. stops being shown]"). Separately, an unrelated,
        older lineage from a PREVIOUS, already-resolved race entirely -- e.g. one formed back on
        08-02-2022 whose own paired competitor died long ago -- must not persist either, still
        sitting dormant and resurfacing many cycles later, well after a completely different,
        currently-active lineage has already re-reached its own "2" one or more times over.
        Confirmed by the user against 17-06-2022/24-06-2022.

        Retires an unproven OTHER lineage outright regardless of whether it currently holds a
        pending rear_recovery/bar2_recovery or is simply still alive and building toward its own
        "2" (e.g. a freshly-started competing anchor that hasn't gotten there yet) -- either way,
        once some OTHER lineage in the house wins the race, an unproven one has nothing further
        worth recording.
        """
        winner.ever_reached_stage2 = True
        for other in lineages:
            if other is winner or other.dead:
                continue
            if (other is winner.competitor or other.competitor is winner) and other.ever_reached_stage2:
                continue
            other.rear_recovery = None
            other.bar2_recovery = None
            other.dead = True

    def process_gen(s, i, h, l, c, label, terminal_on_shallow=True, governed=False, mute_ratchet=False):
        """Two-tier deep SL detection shared by the anchor (TZ GREEN/TZ RED) and the gen
        (BAR/SAR/REAR/REAR RE ENTER), but the two diverge once stage2 has formed:
        - gen (governed=False, terminal_on_shallow=True, the default): ungoverned dual
          HH/LL forever, outer frozen forever once set -- unchanged, reconfirmed by the user.
        - anchor (governed=True, terminal_on_shallow=False): a shallow SL is a logged
          non-terminal event; only the FAVORABLE-side inner reference keeps ratcheting
          (the adverse-inner side is silenced); the OUTER keeps ratcheting continuously on
          the ADVERSE side (unlike the gen's frozen outer) -- confirmed by the user against
          14-02-2022 (outer "TZ RED HH" needed for the deep-SL threshold) and 15-02-2022
          (adverse-inner "TZ RED 2 HH" not required).
        Returns 'deep', 'shallow', or None."""
        if not s.stage2_formed:
            if bullish:
                sl_hit = (s.ref_low - l) >= THRESH and c <= s.ref_low
            else:
                sl_hit = (h - s.ref_high) >= THRESH and c >= s.ref_high
            if sl_hit:
                events[i].append(f"{label} SL")
                s.alive = False
                return "deep"
            if bullish:
                stage2 = (h > s.ref_high + THRESH) and (l >= rows[i - 1][3]) and (c >= s.ref_high)
            else:
                stage2 = (l < s.ref_low - THRESH) and (h <= rows[i - 1][2]) and (c <= s.ref_low)
            if stage2:
                if bullish:
                    s.bar_ref_low = s.ref_low
                    s.ref_high = h
                    s.ref_low = l
                else:
                    s.bar_ref_high = s.ref_high
                    s.ref_low = l
                    s.ref_high = h
                s.stage2_formed = True
                events[i].append(f"{label} 2")
                return None
            if h > s.ref_high + ANY:
                s.ref_high = h
                events[i].append(f"{label} HH")
            if l < s.ref_low - ANY:
                s.ref_low = l
                events[i].append(f"{label} LL")
            return None

        if bullish:
            deep_threshold = min(s.bar_ref_low, s.ref_low)
            shallow_sl = (s.ref_low - l) >= THRESH and c <= s.ref_low
            deep_sl = (deep_threshold - l) >= THRESH and c <= deep_threshold
        else:
            deep_threshold = max(s.bar_ref_high, s.ref_high)
            shallow_sl = (h - s.ref_high) >= THRESH and c >= s.ref_high
            deep_sl = (h - deep_threshold) >= THRESH and c >= deep_threshold

        if deep_sl:
            events[i].append(f"{label} SL")
            if not governed:
                # Only the side OPPOSITE whichever side triggered this deep SL is genuinely
                # independent new information. The SAME side is automatically implied --
                # breaching the more extreme OUTER threshold necessarily also breaches the
                # closer INNER one on that same side, so printing it is just restating the SL
                # that already fired. Confirmed by the user against 24-02-2021 ("BAR 2 LL will
                # have no impact... Deep SL has triggered"), correcting an earlier version of
                # this fix (26-05-2022) that checked BOTH sides unconditionally -- what made
                # that instance genuinely correct was that "SAR 2 LL" there was the OPPOSITE
                # side of the HIGH that triggered the SL, never the same side.
                if bullish:
                    if h > s.ref_high + ANY:
                        s.ref_high = h
                        events[i].append(f"{label} 2 HH")
                else:
                    if l < s.ref_low - ANY:
                        s.ref_low = l
                        events[i].append(f"{label} 2 LL")
            s.alive = False
            return "deep"

        if not governed:
            # Gen (BAR 2/SAR 2/REAR BUY 2/etc.): ungoverned dual HH/LL forever, outer frozen
            # forever once set at stage2 formation -- unchanged, reconfirmed by the user.
            if shallow_sl:
                events[i].append(f"{label} 2 SL")
                # Unlike the deep-SL case above, the SAME side that triggered a shallow SL is
                # NOT redundant with the SL and IS still printed -- confirmed by the user
                # against 03-03-2021 ("SAR HH not recorded? Such a basic"), reasserted even
                # after an intermediate version of this fix wrongly extended the deep-SL
                # same-side suppression to this branch too. The deep-SL suppression is
                # justified specifically because that reference becomes genuinely moot the
                # instant the lineage dies into a completely different tracking mechanism
                # (rear_recovery, keyed off the FAVORABLE side only, §8); a shallow SL's same-
                # side reference, by contrast, is exactly what bar2_recovery's own
                # `inner_adverse` keeps reading on EVERY subsequent day for its escalation
                # check (§7) -- a live, ongoing fact worth reporting each time it moves, not a
                # one-off capture into a dead structure. Both sides are therefore checked and
                # printed unconditionally here, identical to the ordinary (non-SL) ratchet
                # check just below.
                if h > s.ref_high + ANY:
                    s.ref_high = h
                    events[i].append(f"{label} 2 HH")
                if l < s.ref_low - ANY:
                    s.ref_low = l
                    events[i].append(f"{label} 2 LL")
                if terminal_on_shallow:
                    s.alive = False
                return "shallow"
            if h > s.ref_high + ANY:
                s.ref_high = h
                events[i].append(f"{label} 2 HH")
            if l < s.ref_low - ANY:
                s.ref_low = l
                events[i].append(f"{label} 2 LL")
            return None

        # Anchor (TZ GREEN 2/TZ RED 2): NONE of its own "2"-suffixed HH/LL/SL ever print, full
        # stop -- confirmed by the user: "once TZ RED 2 occurs, TZ RED 2 SL/LL/HH does not
        # matter... no need to record TZ RED 2 HH/LL/SL." (An earlier version of this fix still
        # printed the favorable-inner side -- e.g. TZ RED 2 LL -- which was still wrong; even
        # that has zero consequence and must not be recorded.) The inner reference (s.ref_high/
        # ref_low) is therefore left exactly as it was set at "2" formation, forever -- it is
        # only ever read below via deep_threshold, and the OUTER's own continuous adverse-side
        # ratchet (next) independently catches up to and then exceeds any stale inner value
        # once price extends far enough, so deep_threshold stays correct without needing the
        # inner side to keep moving. shallow_sl itself is still computed above (it's cheap and
        # shares the deep_threshold's inputs) but deliberately never printed or acted on --
        # confirmed by the user (10-01-2022): a repeat "TZ RED 2 SL" would be doubly wrong,
        # since it cannot even repeat without an interceding re-entry, and there is no such
        # re-entry concept for the anchor at all.
        # mute_ratchet (set once this lineage's gen has reached its own "2", i.e.
        # Lineage.anchor_retired): the outer keeps ratcheting -- it must, since the anchor's
        # own DEEP-SL threshold derived from it stays live and can still fire a TOTAL lineage
        # death even after retirement (see the call site) -- but the routine HH/LL display is
        # suppressed, since the anchor's own routine progress is no longer the "operative"
        # narrative once the gen has taken over. Confirmed by the user against 16-01-2021.
        if bullish:
            if s.bar_ref_low - l >= ANY:
                s.bar_ref_low = l
                if not mute_ratchet:
                    events[i].append(f"{label} LL")
        else:
            if h - s.bar_ref_high >= ANY:
                s.bar_ref_high = h
                if not mute_ratchet:
                    events[i].append(f"{label} HH")
        return None

    def pullback_track(lin):
        """Which structure this lineage's pullback is currently attached to -- used only to
        disambiguate output on a day where 2+ DISTINCT lineages each independently fire a
        pullback event (the permanent BAR/SAR-vs-REAR BUY/SELL dual-track): the lineage's own
        current gen label once a gen has started, else its anchor name."""
        return current_label(lin) if lin.gen_started else anchor_name

    def process_pullback(lin, i, h, l, c, ph, pl, front=None):
        nonlocal gen_pending, gen_pending_episode, gen_pending_owner
        pullback = lin.pullback
        if pullback is None or not pullback["active"]:
            if bullish:
                attach = h <= ph and (pl - l) >= THRESH and c <= pl
            else:
                attach = l >= pl and (h - ph) >= THRESH and c >= ph
            if attach:
                lin.pullback = {"ref_high": h, "ref_low": l, "active": True, "front": front}
                pullback_buffer[i].append((lin, "RED1" if bullish else "GREEN1"))
                return True
            return False

        pb = pullback
        if bullish:
            red2 = l <= pb["ref_low"] and h <= ph and (ph - pl) >= THRESH and c <= pb["ref_low"] + Decimal("0.001")
        else:
            red2 = h >= pb["ref_high"] and l >= pl and (ph - pl) >= THRESH and c >= pb["ref_high"] - Decimal("0.001")
        if red2:
            pullback_buffer[i].append((lin, "RED2" if bullish else "GREEN2"))
            pb["active"] = False
            # This front's ONE pullback cycle is now used up -- confirmed by the user against
            # 11-02-2022 (see Lineage.pullback_used): it cannot host a second, fresh RED1/
            # GREEN1 attach without first changing identity (a genuinely new front).
            lin.pullback_used = pb.get("front")
            gen_pending = True
            gen_pending_owner = lin
            gen_pending_episode += 1
            return True

        if bullish:
            invalid = (h - pb["ref_high"]) >= THRESH and c >= pb["ref_high"]
        else:
            invalid = (pb["ref_low"] - l) >= THRESH and c <= pb["ref_low"]
        if invalid:
            pullback_buffer[i].append((lin, "RED1 SL" if bullish else "GREEN1 SL"))
            pb["active"] = False
            return True

        fired = False
        if bullish and l < pb["ref_low"]:
            pb["ref_low"] = l
            pullback_buffer[i].append((lin, "RED1 LL"))
            fired = True
        elif (not bullish) and h > pb["ref_high"]:
            pb["ref_high"] = h
            pullback_buffer[i].append((lin, "GREEN1 HH"))
            fired = True
        if bullish and h > pb["ref_high"]:
            pb["ref_high"] = h
            pullback_buffer[i].append((lin, "RED1 HH"))
            fired = True
        elif (not bullish) and l < pb["ref_low"]:
            pb["ref_low"] = l
            pullback_buffer[i].append((lin, "GREEN1 LL"))
            fired = True
        return fired

    for i in range(1, len(rows)):
        _, o, h, l, c = rows[i]
        _, po, ph, pl, pc = rows[i - 1]

        newly_formed = set()
        consumed_gen_pending_today = False
        fresh_attach_candidates = []
        gen_formation_candidates = []

        # 0. Fresh anchor search -- always live once triggered by an SL, until it succeeds.
        # Forfeited outright -- not merely deferred -- on a day where this exact breakout
        # ALSO coincides with an EXISTING lineage's own pending REAR BUY/SELL (or RE ENTER)
        # recovery resolving. Confirmed by the user against 10-03-2022/11-03-2022: an
        # intermediate version of this fix let the fresh anchor keep waiting and form on the
        # very next non-colliding day (11-03-2022) -- rejected: "You cannot adjust to further
        # dates just because it was not shown during earlier dates... does not mean it can be
        # carried forward to next dates just like that." The reasoning given: once the older
        # lineage's own future descendants (RED1/RED2/BAR/...) would follow identical rules,
        # a parallel TZ GREEN adds nothing worth recording, so the opportunity is simply
        # consumed/forfeited, not rescheduled -- awaiting_fresh_anchor is cleared here without
        # ever forming an anchor. A later, NEW deep SL still reopens the search as usual.
        blocked_by_older_recovery = any(
            lin.rear_recovery is not None and recovery_would_resolve(lin.rear_recovery, h, l, c, ph, pl)
            for lin in lineages if not lin.dead
        )
        # A fresh TZ GREEN/TZ RED anchor cannot form on a day where ANY (non-dead) lineage is
        # sitting in gen_fresh_pending -- that state means RED2/GREEN2 has ALREADY fired for
        # that lineage's dead "2", so its own recovery is GUARANTEED to be a full fresh restart
        # on the SAME lineage (plain BAR/SAR reforming) the moment formation_break allows it --
        # never a brand-new competing anchor. Confirmed by the user: "if a REAR 2 has occurred,
        # or SAR 2 has occurred and there is an SL of [that] 2nd and there is GREEN 2, then TZ
        # GREEN CANNOT OCCUR" -- against 24-06-2022, where an unrelated, long-dormant lineage's
        # own independently-pending fresh-anchor search (open since 20-06-2022) coincidentally
        # resolved into a fresh "TZ RED" the SAME day the actually-current lineage's SAR 2 SL
        # (23-06-2022, itself already past GREEN 2) forced its own guaranteed full restart into
        # plain "SAR" -- the TZ RED must not print at all that day.
        blocked_by_gen_fresh_pending = any(lin.gen_fresh_pending for lin in lineages if not lin.dead)
        # Snapshot, BEFORE any lineage is processed today, which lineages hold a rear_recovery
        # that would RESOLVE today -- used below to gate a DIFFERENT, younger lineage's fresh-
        # gen-formation on the same-day older-lineage-precedence principle (see there, and
        # 02-03-2022). Must be captured here, not re-checked per-lineage later in the loop
        # below, since an older lineage's own rear_recovery gets cleared to None during ITS OWN
        # turn in that same loop, before a younger lineage processed afterward would see it.
        #
        # Deliberately NOT broadened to "pending at all." An intermediate version of this was,
        # on a misreading of 03-03-2021 -- the actual reason the fresh BAR was wrong that day is
        # that the TZ GREEN lineage was consuming ANOTHER lineage's RED2 ("NEW LINEAGE TZ GREEN
        # 01/03 has not received RED 2. How is BAR POSSIBLE?"), now enforced properly by
        # gen_pending_owner. An older lineage's merely-pending recovery has no say over a
        # separate lineage that HAS earned its own RED2/GREEN2: "BAR SL of earlier lineage
        # cannot stop from having SAR" (22-03-2021). Broadening it here suppressed that whole
        # lineage's SAR for 08-03--28-03-2021 and the BULL house's BAR from 08-04-2021 on.
        pending_rear_recovery_created_days = [
            lin.created_day for lin in lineages
            if lin.rear_recovery is not None and not lin.dead
            and recovery_would_resolve(lin.rear_recovery, h, l, c, ph, pl)
        ]
        if awaiting_fresh_anchor and formation_break(ph, pl, h, l, c) and (blocked_by_older_recovery or blocked_by_gen_fresh_pending):
            awaiting_fresh_anchor = False
        elif awaiting_fresh_anchor and formation_break(ph, pl, h, l, c):
            # Retire any orphaned-anchor lineage(s) -- a gen that died pre-"2" (no REAR/ladder
            # recovery possible) is not a permanent dual-track competitor; only the REAR-vs-
            # fresh-anchor race at the gen level is. This new anchor replaces it outright.
            for old in lineages:
                if old.orphaned_anchor:
                    old.dead = True
            lin = Lineage(created_day=i)
            lin.anchor = Struct(h, l, anchor_name, formed_day=i)
            lineages.append(lin)
            awaiting_fresh_anchor = False
            events[i].append(anchor_name)
            newly_formed.add(id(lin))
            if pending_competitor_source is not None:
                pending_competitor_source.competitor = lin
                pending_competitor_source = None
            else:
                # This search wasn't opened by a gen-deep-SL/bar2_recovery-escalation (which
                # always sets pending_competitor_source) -- it was an anchor's own unconditional
                # total death instead, which pairs with nothing. If some OTHER lineage already
                # holds a currently-pending recovery search at this exact moment, it is the
                # genuinely current, still-relevant one (not a stale leftover) -- pair it as this
                # new anchor's competitor so retire_other_pending (see there) does not mistake it
                # for an unrelated older race the first time this brand-new anchor reaches its
                # own "2". Confirmed against 06-05-2022/07-05-2022: the currently-active lineage
                # (formed 13-04-2022) had a legitimate rear_recovery pending when an unrelated
                # anchor total-death spawned a fresh TZ RED that day -- without this pairing, that
                # TZ RED reaching TZ RED 2 the very next day wrongly retired the still-relevant
                # rear_recovery, silently erasing the later, correct "REAR SELL" reform.
                for other in lineages:
                    if other is not lin and not other.dead and (
                        other.rear_recovery is not None or other.bar2_recovery is not None
                    ):
                        other.competitor = lin
                        break

        for lin in lineages:
            if lin.dead or id(lin) in newly_formed:
                continue

            # Snapshot, BEFORE today's own processing, whether this lineage's front (gen if
            # started, else anchor) was ALREADY past its own "2" stage as of yesterday. Used
            # only to gate fresh-gen-formation off a stale/carried-over gen_pending signal --
            # confirmed by the user (06-03-2022): a brand-new TZ RED reaching its OWN TZ RED 2
            # for the very first time must NOT, the same day, immediately consume an unrelated,
            # already-pending gen_pending left over from a completely different, earlier-dead
            # lineage's GREEN2 to spawn a fresh SAR out of thin air -- "TZ RED 2 & SAR
            # together? Not possible." The ordinary pullback-attach gate is unaffected by this
            # and still uses the live (same-day) value, since RED1/GREEN1 attaching the very
            # same day the anchor's own "2" forms is separately confirmed correct.
            front_before_today = lin.gen if (lin.gen is not None and lin.gen.alive) else (
                lin.anchor if (not lin.gen_started and lin.anchor is not None and lin.anchor.alive) else None
            )
            front_stage2_before_today = front_before_today is not None and front_before_today.stage2_formed

            # Peek (side-effect-free) whether this lineage's ANCHOR would deep-SL today, BEFORE
            # any other processing for this lineage this iteration -- including bar2_recovery's
            # escalation check and rear_recovery's resolution check, not just the ordinary gen
            # block. The anchor's own deep-SL is TOTAL, unconditional lineage death (no REAR
            # possible -- only a wholly fresh new lineage can start), and that must take absolute
            # precedence over whatever a same-day bar2_recovery escalation or rear_recovery
            # resolution would otherwise produce -- confirmed by the user against 16-01-2021:
            # TZ RED's own retired-but-still-live deep-SL threshold (609.1) was breached the same
            # day as SAR 2's own escalation threshold, and the earlier version of this fix (which
            # only gated the ordinary gen-processing block, further below) missed this because
            # by 16-01-2021 lin.gen was already None -- the gen had shallow-SL'd into
            # bar2_recovery the PRIOR day, so it was bar2_recovery's own escalation check
            # (unrelated to anchor_dying_today) that wrongly claimed the day and printed "SAR SL"
            # instead, one day before the anchor's own check (previously positioned after both
            # recovery blocks) ever got a chance to run. This check is NOT limited to a
            # not-yet-retired anchor -- see the anchor-processing block further below for the
            # full rationale on why the anchor's deep-SL threshold stays live (and its outer
            # keeps ratcheting silently) even after `anchor_retired`.
            anchor_dying_today = (
                lin.anchor is not None and lin.anchor.alive
                and would_deep_sl(lin.anchor, h, l, c)
            )
            if anchor_dying_today:
                was_anchor_stage2 = lin.anchor.stage2_formed
                anchor_sl_kind = process_gen(
                    lin.anchor, i, h, l, c, anchor_name,
                    terminal_on_shallow=False, governed=True, mute_ratchet=lin.anchor_retired,
                )
                if lin.anchor.stage2_formed and not was_anchor_stage2:
                    retire_other_pending(lin)
                if anchor_sl_kind == "deep":
                    lin.dead = True
                    awaiting_fresh_anchor = True
                    gen_pending = False
                    # This lineage's own bar2_recovery/rear_recovery (if it had one pending)
                    # is now moot -- the anchor's total death overrides it outright (no REAR
                    # possible). Cleared explicitly, not just left stale, since dead lineages
                    # are never revisited by the per-lineage loop again (see `if lin.dead:
                    # continue` at its top) but are NOT removed from `lineages`, so a couple of
                    # house-wide scans elsewhere (`blocked_by_older_recovery`,
                    # `pending_rear_recovery_created_days`) still read every lineage's
                    # rear_recovery field regardless of `dead` -- a stale non-None value here
                    # would otherwise permanently block every OTHER lineage in the house from
                    # ever forming a fresh gen again, forever, over a recovery that can now
                    # never actually resolve. Confirmed via 2022 regression: this exact
                    # combination (an already-anchor_retired lineage's pending rear_recovery,
                    # whose anchor THEN also deep-SLs thanks to the 16-01-2021 fix above) is a
                    # new code path -- unreachable before that fix, since anchor_retired
                    # previously blocked the anchor from ever dying at all -- so it was never
                    # exercised until now.
                    lin.rear_recovery = None
                    lin.bar2_recovery = None
                    continue

            # --- Shallow-SL recovery window: NEW BAR2/REAR2 reforms directly ---
            if lin.bar2_recovery is not None and gen_pending:
                # RED2/GREEN2 has fired (on an earlier day, or later the same day the shallow
                # SL originally fired) while this lighter recovery was still pending -- per the
                # original rule, that forecloses the LIGHTER "NEW BAR2 reforms directly" outcome
                # specifically; a full fresh BAR/gen forms instead once formation_break allows
                # it (gen_fresh_pending, checked below). This does NOT abandon bar2_recovery
                # itself, though -- the deep/outer threshold it tracks is a real, independent
                # price fact (whether BAR's own outer reference is ALSO breached) that must keep
                # being checked regardless of which reform path eventually applies -- confirmed
                # by the user against 24-04-2022: the deep threshold (329) was breached that
                # day and `BAR SL` was wrongly missing because an earlier version of this fix
                # nulled bar2_recovery outright the moment gen_pending fired, silently
                # discarding the escalation check below along with it.
                lin.gen_fresh_pending = True
            if lin.bar2_recovery is not None:
                rec = lin.bar2_recovery
                ref = rec["ref"]
                # Escalation (checked first, deep-before-shallow convention): if the outer/
                # deep threshold is ALSO breached while awaiting the lighter shallow recovery,
                # that converts straight into the full-restart deep-SL path instead.
                deep_threshold = (
                    min(rec["outer"], rec["inner_adverse"]) if bullish
                    else max(rec["outer"], rec["inner_adverse"])
                )
                if bullish:
                    escalates = (deep_threshold - l) >= THRESH and c <= deep_threshold
                else:
                    escalates = (h - deep_threshold) >= THRESH and c >= deep_threshold
                if escalates:
                    events[i].append(f"{current_label(lin)} SL")
                    # Escalating into the heavier ladder recovery supersedes the lighter
                    # "ordinary fresh restart off gen_pending" path entirely -- clear
                    # gen_fresh_pending so the "fresh gen formation" trigger further below
                    # can't ALSO independently fire for this SAME lineage while its
                    # rear_recovery is still pending (which would leave both a freshly-formed
                    # gen AND a dangling rear_recovery on the same lineage at once).
                    lin.gen_fresh_pending = False
                    # Recovery target is the dead "X 2"'s own FAVORABLE-side reference
                    # (rec["ref"], already tracked/ratcheted by the "INVALID {base} HH/LL"
                    # code above -- e.g. BAR 2's own High) -- confirmed by the user against
                    # 21-02-2022/27-02-2022: NOT rec["inner_adverse"] (BAR 2's own Low),
                    # which this previously and wrongly used.
                    lin.rear_recovery = {
                        "ref": rec["ref"],
                        "target_label": escalated_label(lin),
                        "source_2": f"{current_label(lin)} 2",
                    }
                    lin.bar2_recovery = None
                    # Only reopen the house-wide fresh-anchor search if THIS lineage doesn't
                    # already have a live paired competitor from an EARLIER round of its own
                    # recovery race -- confirmed by the user (03-05-2022): once a fresh anchor
                    # already exists from an earlier failure of this SAME dying lineage's own
                    # ladder, a further failure of that ladder must not spawn a SECOND,
                    # redundant competing fresh anchor while the first one is still alive
                    # ("SAR has already occurred for GREEN2. New TZ RED cannot co-occur.
                    # Basics"). This is scoped to THIS lineage's own paired competitor, not
                    # "any other lineage in the house" -- an unrelated, long-dormant lineage
                    # elsewhere (e.g. one quietly waiting on its own never-reached rear_recovery
                    # target) must not block a completely separate lineage's legitimate first
                    # race. The anchor's own deep SL (below) stays unconditional -- that is
                    # total, unconditional lineage death, not a partial one, so it always needs
                    # a fresh search regardless of pairing.
                    # A competitor that has been superseded (permanently lost an older-lineage-
                    # precedence collision -- see Lineage.superseded) is, for this purpose, a
                    # dead end exactly like a fully dead one: its own future is redundant with
                    # the lineage that beat it, so it can never independently reform or matter
                    # again even though nothing ever sets its `dead` flag. Without this, a
                    # superseded competitor's own anchor sits "alive" forever, permanently
                    # blocking this lineage from ever reopening a fresh-anchor search again --
                    # confirmed against 26-05-2022/28-05-2022: the lineage formed 06-05-2022
                    # was superseded on 18-05-2022, but without this check its still-`alive`
                    # anchor wrongly blocked the legitimate fresh "TZ RED" that should reopen
                    # and form again on 28-05-2022.
                    if lin.competitor is None or lin.competitor.dead or lin.competitor.superseded:
                        awaiting_fresh_anchor = True
                        pending_competitor_source = lin
                    # This is a state TRANSITION for the gen (shallow SL escalating into the
                    # deeper ladder recovery), not a total lineage death -- only the ANCHOR's
                    # own deep SL is that (see the unconditional `continue` there). An ALREADY-
                    # ACTIVE pullback must still get to resolve/ratchet today regardless,
                    # exactly like it already does across an ordinary gen deep SL (confirmed
                    # 01-03-2022, GREEN2 alongside SAR SL) -- this mirrors that same rule at
                    # this transition point too.
                    if lin.pullback is not None and lin.pullback["active"]:
                        process_pullback(lin, i, h, l, c, ph, pl)
                    continue
                if bullish:
                    recovers = l >= pl and h > ref + THRESH and c >= ref
                else:
                    recovers = h <= ph and l < ref - THRESH and c <= ref
                if recovers:
                    if lin.gen_fresh_pending:
                        # RED2/GREEN2 already fired before this recovery -- per the rule above,
                        # the lighter "NEW BAR2 reforms directly" reform is foreclosed even
                        # though price DID recover past the shallow reference; simply drop the
                        # now-resolved recovery and let the ordinary fresh-gen-formation trigger
                        # (below, off its own formation_break condition) decide when the actual
                        # fresh BAR/gen forms, on this day or a later one.
                        lin.bar2_recovery = None
                        if lin.pullback is not None and lin.pullback["active"]:
                            process_pullback(lin, i, h, l, c, ph, pl)
                    else:
                        new_gen = Struct(h, l, gen_name, formed_day=i)
                        new_gen.stage2_formed = True
                        if bullish:
                            new_gen.bar_ref_low = rec["outer"]
                        else:
                            new_gen.bar_ref_high = rec["outer"]
                        lin.gen = new_gen
                        lin.bar2_recovery = None
                        events[i].append(f"{current_label(lin)} 2")
                        retire_other_pending(lin)
                        # Same rationale as above -- reforming the gen today isn't a total
                        # death, so an already-active pullback still gets to resolve/ratchet
                        # today too.
                        if lin.pullback is not None and lin.pullback["active"]:
                            process_pullback(lin, i, h, l, c, ph, pl)
                    continue
                else:
                    base = current_label(lin)
                    inner_label = f"{base} 2"
                    inner_adverse = rec["inner_adverse"]
                    # Once gen_pending has already foreclosed the lighter "NEW BAR2 reforms
                    # directly" outcome (gen_fresh_pending), these routine ratchet EVENTS are
                    # tracking a recovery target that will never actually be used -- only a
                    # full fresh restart (via formation_break) or the deep escalation above
                    # still matter from here. Printing them is misleading noise (implying an
                    # active, meaningful recovery target that no longer exists) -- confirmed by
                    # the user against 18-02-2022 ("BAR 2 SL already triggered [17-02], how is
                    # BAR 2 LL now possible?"). The underlying rec[...] VALUES still update
                    # unconditionally below regardless -- they still feed the deep-threshold
                    # escalation check above, which must keep working exactly as before.
                    silent = lin.gen_fresh_pending
                    # Favorable-side (recovery-target) reference: an attempt at reforming the
                    # "2" that ticks the reference further out without yet fully qualifying
                    # (Low/Close conditions not checked here -- same simple ANY-threshold
                    # ratchet as the deep-SL "INVALID {X} HH/LL" below).
                    if bullish:
                        if h - ref >= ANY:
                            rec["ref"] = h
                            if not silent:
                                events[i].append(f"INVALID {base} HH")
                    else:
                        if ref - l >= ANY:
                            rec["ref"] = l
                            if not silent:
                                events[i].append(f"INVALID {base} LL")
                    # Adverse-side outer/inner references. The OUTER ratchet (`{base} HH`/
                    # `{base} LL`, tracking rec["outer"]) is NEVER silenced by `silent` -- unlike
                    # the favorable and inner-adverse prints above, it isn't just internal
                    # bookkeeping for a recovery target that gen_pending has already foreclosed:
                    # it's the live, continuously-relevant reference the support/resistance
                    # highlighting reads (§15, "BAR LL/REAR BUY LL are exactly the gen's own
                    # outer-reference ratchet"), and it stays meaningful regardless of which
                    # reform path eventually applies. Confirmed by the user against 01-04-2021
                    # ("FAILED TO RECOGNISE SAR HH. WHY?"): SAR's own bar2_recovery outer moved
                    # that day (616 -> 616.05) while gen_fresh_pending happened to ALSO be true
                    # (this SAME lineage's own GREEN2, the day before, had already foreclosed the
                    # lighter reform) -- the 18-02-2022 precedent that introduced `silent` was
                    # specifically about the INNER print ("BAR 2 LL"), never this outer one.
                    if bullish:
                        if rec["outer"] - l >= ANY:
                            rec["outer"] = l
                            events[i].append(f"{base} LL")
                        if inner_adverse - l >= ANY:
                            rec["inner_adverse"] = l
                            if not silent:
                                events[i].append(f"{inner_label} LL")
                    else:
                        if h - rec["outer"] >= ANY:
                            rec["outer"] = h
                            events[i].append(f"{base} HH")
                        if h - inner_adverse >= ANY:
                            rec["inner_adverse"] = h
                            if not silent:
                                events[i].append(f"{inner_label} HH")

            # --- Deep-SL recovery window: escalate to the next recovery level directly ---
            if lin.rear_recovery is not None:
                rec = lin.rear_recovery
                target = rec["target_label"]
                recovers = recovery_would_resolve(rec, h, l, c, ph, pl)
                if recovers:
                    new_gen = Struct(h, l, target, formed_day=i)
                    lin.gen = new_gen
                    lin.gen_started = True
                    # A direct_reform entry reforms as the PLAIN gen name -- recovery_label stays
                    # None (not "SAR"/"BAR" as a literal string), exactly matching a lineage's
                    # very first-ever promotion, so a LATER escalation still correctly treats
                    # this as the first rung (escalated_label -> "REAR BUY/SELL", not "RE ENTER")
                    # rather than as already-on-the-ladder history.
                    lin.recovery_label = None if rec.get("direct_reform") else target
                    lin.rear_recovery = None
                    events[i].append(target)
                    # Same rationale as the bar2_recovery transitions above -- reforming the
                    # gen today (REAR BUY/SELL or a RE ENTER rung) isn't a total lineage death,
                    # so an already-active pullback still gets to resolve/ratchet today too.
                    if lin.pullback is not None and lin.pullback["active"]:
                        process_pullback(lin, i, h, l, c, ph, pl)
                    continue
                elif not rec.get("direct_reform"):
                    # Ratchet is named after the SOURCE reference being tracked (the dead
                    # "X 2"'s own High/Low, e.g. "INVALID BAR 2 HH") not the escalation's
                    # target label -- confirmed by the user: "record INVALID as INVALID
                    # BAR 2 HH not INVALID REAR BUY HH". A direct_reform entry has no reference
                    # of its own to ratchet at all (its resolution is a raw formation_break()
                    # breakout, not a threshold breach against a stored value) -- confirmed by
                    # the user ("not necessary wait for SAR ref high"), so this ratchet is
                    # skipped entirely for it.
                    ref = rec["ref"]
                    source_2 = rec["source_2"]
                    if bullish:
                        if h - ref >= ANY:
                            rec["ref"] = h
                            events[i].append(f"INVALID {source_2} HH")
                    else:
                        if ref - l >= ANY:
                            rec["ref"] = l
                            events[i].append(f"INVALID {source_2} LL")

            # anchor_dying_today was already computed (and, if True, already handled and
            # `continue`d past) at the very top of this lineage's per-day processing, above --
            # by this point it is guaranteed False. It's still used below purely to skip the
            # gen's own SL processing on a day the anchor is ALSO dying, which can no longer
            # actually happen here (kept for clarity/symmetry with that gating condition).

            # Whether THIS lineage's gen deep-SL'd today -- used below to block a FRESH
            # RED1/GREEN1 attach from starting the same day (see the fresh-attach eligibility
            # comment further down). An ALREADY-active pullback is unaffected by this flag; it
            # keeps resolving/ratcheting through a deep SL regardless (confirmed 01-03-2022).
            gen_deep_sl_today = False

            # --- gen's own SL/stage2/HH-LL ---
            if lin.gen is not None and lin.gen.alive and not anchor_dying_today:
                label = current_label(lin)
                was_stage2 = lin.gen.stage2_formed
                gen_sl_kind = process_gen(lin.gen, i, h, l, c, label)
                if lin.gen.stage2_formed:
                    lin.anchor_retired = True
                    if not was_stage2:
                        retire_other_pending(lin)
                if gen_sl_kind == "deep":
                    gen_deep_sl_today = True
                    # A recovery window opens EITHER because this gen reached its own "2" (the
                    # ordinary rule), OR because this gen was already a ladder rung (REAR
                    # BUY/SELL or their RE ENTER) -- confirmed by the user against 06-03-2022/
                    # 10-03-2022: once a lineage is already on the ladder, a further rung dying
                    # BEFORE reaching its own "2" still gets a recovery window, using that
                    # rung's own plain (pre-"2") reference.
                    #
                    # The recovery's NAME only escalates one rung up the ladder if this gen
                    # actually reached its own "2" before dying; a rung dying pre-its-own-"2"
                    # reforms under the SAME label it already had, no escalation -- confirmed
                    # by the user, correcting an intermediate version of this fix: REAR BUY
                    # (formed 02-03-2022) died pre-its-own-"2" on 06-03-2022, and the recovery
                    # reforming above its own High (315) on 10-03-2022 is labeled plain
                    # "REAR BUY" again, NOT "REAR BUY RE ENTER" ("since REAR BUY 2 never
                    # formed" -- RE ENTER is reserved for escalating OFF an actual "2").
                    if lin.gen.stage2_formed or lin.recovery_label is not None:
                        ref_val = lin.gen.ref_high if bullish else lin.gen.ref_low
                        lin.rear_recovery = {
                            "ref": ref_val,
                            "target_label": escalated_label(lin) if lin.gen.stage2_formed else label,
                            "source_2": f"{label} 2" if lin.gen.stage2_formed else label,
                        }
                    else:
                        # A PLAIN gen (first rung, no ladder history yet -- recovery_label is
                        # None) dying before ever reaching its own "2" still gets a direct reform
                        # chance, correcting an earlier, now-superseded reading of 15-02-2021
                        # (that case is unaffected either way -- the very FIRST gen the house
                        # ever forms still needs a fresh TZ GREEN/TZ RED first, since there is no
                        # prior gen to reform from at all). Per the user: "SAR - SAR SL DOES NOT
                        # LEAD TO TZ RED. IMMEDIATELY ANY DAY WHICH IS FULFILLING TZ RED
                        # CONDITIONS WILL BE A SAR... SAR - SAR SL - NEW SAR (not necessary wait
                        # for SAR ref high)" -- confirmed against 24-06-2022/26-06-2022: a plain
                        # SAR formed 24-06-2022 died pre-its-own-"2" on 25-06-2022, and the
                        # 26-06-2022 breakout (which would otherwise form a fresh TZ RED) instead
                        # reforms directly as plain `SAR` again, on this SAME lineage. Unlike
                        # every other recovery window in this file, this one is not gated on any
                        # reference of its own (`direct_reform`, resolved via recovery_would_
                        # resolve() -> formation_break() instead of a threshold breach).
                        lin.rear_recovery = {
                            "ref": None,
                            "target_label": gen_name,
                            "source_2": label,
                            "direct_reform": True,
                        }
                    # Same gating (by this lineage's own paired competitor, not any other
                    # lineage), including the superseded-counts-as-dead extension, as the
                    # bar2_recovery-escalation site above -- see that comment for the full
                    # rationale (03-05-2022; 26-05-2022/28-05-2022).
                    if lin.competitor is None or lin.competitor.dead or lin.competitor.superseded:
                        awaiting_fresh_anchor = True
                        pending_competitor_source = lin
                    lin.gen = None
                elif gen_sl_kind == "shallow":
                    # bar2_recovery is now opened unconditionally, even when gen_pending is
                    # ALREADY true the SAME day this shallow SL fires -- previously that case
                    # discarded the recovery structure entirely (only gen_fresh_pending was
                    # set), silently dropping the deep/outer escalation check along with it.
                    # That check is exactly as real and independent a price fact here as in
                    # the already-fixed "preempted on a LATER day" case (24-04-2022) -- the
                    # ONLY thing gen_pending forecloses is the LIGHTER "NEW BAR 2 reforms
                    # directly" outcome specifically, never the escalation tracking itself.
                    # Confirmed by the user against 04-03-2021: this SAR2's own deep/outer
                    # threshold was breached the very next day, and the correct outcome
                    # ("SAR SL", escalating into REAR SELL) was silently missing before this
                    # fix, mirroring the exact class of bug already fixed for the later-day
                    # case.
                    label = current_label(lin)
                    inner_adverse = lin.gen.ref_low if bullish else lin.gen.ref_high
                    outer_before = lin.gen.bar_ref_low if bullish else lin.gen.bar_ref_high
                    outer_now = outer_before
                    # This transition's own "{label} LL/HH" ratchet is the SAME outer reference
                    # bar2_recovery's own ratchet loop tracks further down (rec["outer"]) --
                    # never silenced, regardless of gen_pending/gen_fresh_pending, since it is
                    # the live reference that will become the future deep-SL/escalation
                    # threshold for this exact recovery, not internal bookkeeping for a
                    # foreclosed lighter-tier target. Confirmed by the user against 01-04-2021
                    # ("Make sure SAR HH is always recorded since it will be the reference high
                    # for SAR SL") -- an earlier version of this fix silenced this transition
                    # print too, on the mistaken assumption it shared the routine ratchet loop's
                    # "noise once foreclosed" rationale; it doesn't, for the same reason the
                    # outer print there doesn't either (see that fix's own comment).
                    if bullish:
                        if outer_before - l >= ANY:
                            outer_now = l
                            events[i].append(f"{label} LL")
                    else:
                        if h - outer_before >= ANY:
                            outer_now = h
                            events[i].append(f"{label} HH")
                    lin.bar2_recovery = {
                        "ref": lin.gen.ref_high if bullish else lin.gen.ref_low,
                        "inner_adverse": inner_adverse,
                        "outer": outer_now,
                    }
                    if gen_pending:
                        # RED2 already fired for this generation before the shallow SL --
                        # per the original rule, that forecloses the lightweight "NEW BAR 2
                        # reforms directly" outcome specifically; a full fresh BAR/gen starts
                        # instead, directly off the already-set gen_pending, once the ordinary
                        # fresh-gen-formation trigger's own formation_break() allows it.
                        lin.gen_fresh_pending = True
                    lin.gen = None

            # --- Anchor-level processing: two-tier deep/shallow SL, ungoverned dual HH/LL,
            # exactly mirroring the gen (BAR/BAR 2) EXCEPT for the shallow tier's consequence.
            # Per the user's explicit correction: a shallow anchor SL ("TZ GREEN 2 SL"/"TZ RED 2
            # SL") does NOT stop or restart anything -- it is logged (`terminal_on_shallow=False`
            # below keeps the Struct alive and untouched -- no recovery window, no reforming
            # "TZ GREEN 2"/"TZ RED 2"). The anchor's DEEP SL is the ONLY anchor-level SL that
            # matters, and it must keep being checked for as long as this lineage's gen hasn't
            # taken over -- confirmed by the user against 11-01-2022: even with a GREEN1/GREEN2
            # pullback already attached and resolving, the anchor's own deep SL (`TZ RED SL`)
            # still fires that day and kills the ENTIRE lineage, pullback included, before that
            # day's GREEN2 gets a chance to matter (the `continue` below skips this lineage's
            # pullback processing for the day the deep SL fires, exactly like every other
            # complete-lineage-death path in this file). A pullback attaching does NOT retire
            # the anchor -- only the gen reaching its own "2" stage does (anchor_retired, below):
            # from that point BAR 2/REAR 2/etc. has its own separate deep-SL reference and the
            # anchor's own (now long-stale) one would be a redundant, unrelated failure mode.
            # (A deep SL here is no longer actually reachable -- the higher-precedence peek at
            # the top of this lineage's per-day processing already caught and handled that case
            # before bar2_recovery/rear_recovery/gen ever ran; the `anchor_sl_kind == "deep"`
            # branch below is kept only as a defensive fallback.)
            if lin.anchor is not None and lin.anchor.alive:
                was_anchor_stage2 = lin.anchor.stage2_formed
                anchor_sl_kind = process_gen(
                    lin.anchor, i, h, l, c, anchor_name,
                    terminal_on_shallow=False, governed=True, mute_ratchet=lin.anchor_retired,
                )
                if lin.anchor.stage2_formed and not was_anchor_stage2:
                    retire_other_pending(lin)
                if anchor_sl_kind == "deep":
                    lin.dead = True
                    awaiting_fresh_anchor = True
                    gen_pending = False  # complete lineage death -- see the matching note above
                    lin.rear_recovery = None  # see the matching note at the top-level check above
                    lin.bar2_recovery = None
                    continue

            # --- pullback attach/continue ---
            front = None
            if lin.gen is not None and lin.gen.alive:
                front = lin.gen
            elif not lin.gen_started and lin.anchor is not None and lin.anchor.alive:
                front = lin.anchor

            # Fresh-attach eligibility for RED1/GREEN1 uses the SAME pre-today snapshot as
            # fresh-gen-formation (front_stage2_before_today), not today's post-SL live state --
            # confirmed by the user (22-04-2022/23-04-2022): a fresh RED1 attach is a raw,
            # same-day price-action pattern (today's H/L/C vs. yesterday's H/L) unrelated to
            # whatever today's gen SL does to the Struct object; a gen's own SHALLOW SL already
            # dying today must not retroactively block a fresh attach that the day's own price
            # action otherwise supports. `attach_front` falls back to yesterday's front object
            # (whose `.formed_day` the precedence-tiebreak grouping needs) when today's own
            # front is now None because its gen just died today.
            #
            # This does NOT extend to a DEEP SL day, though -- confirmed by the user against
            # 25-04-2022 ("SAR SL occurred, then why GREEN1? Deep SL then what is the point of
            # GREEN1?"): a deep SL is total generation failure (opening the REAR-ladder/fresh-
            # anchor dual-track, §8), and a BRAND-NEW pullback has no live front left worth
            # starting to track against that same day -- unlike an ALREADY-active pullback,
            # which keeps resolving/ratcheting through a deep SL regardless because it has its
            # own independent standing from before the death (confirmed 01-03-2022, GREEN2
            # alongside SAR SL -- see `gen_deep_sl_today`, which only gates the FRESH-attach
            # branch below, not the already-active continuation branch).
            # A lineage that has LOST an older-lineage-precedence collision (Lineage.superseded)
            # must never independently start a FRESH pullback again either -- confirmed by the
            # user against 21-05-2022/23-05-2022 (see that field's own comment for the full
            # rationale). An ALREADY-active pullback (checked separately, above/below) is
            # unaffected -- this only blocks a brand-new attach.
            # A front whose own RED2/GREEN2 has ALREADY confirmed once cannot host a second,
            # fresh attach without first changing identity -- confirmed by the user against
            # 11-02-2022 (see Lineage.pullback_used): RED2 already confirmed 10-02-2022, and
            # with no new BAR forming in between, a fresh RED1 re-attaching to the SAME,
            # unchanged BAR2 on 11-02-2022 is not possible.
            attach_front = front if front is not None else front_before_today
            front_already_used = attach_front is not None and attach_front is lin.pullback_used
            front_ok_for_attach = (
                attach_front is not None and not gen_deep_sl_today and not lin.superseded
                and not front_already_used
                and (front_stage2_before_today or (front is not None and front.stage2_formed))
            )

            if lin.pullback is not None and lin.pullback["active"]:
                process_pullback(lin, i, h, l, c, ph, pl)
            elif front_ok_for_attach:
                # NOT gated on `gen_pending` -- confirmed by the user (01-03-2022: "TZ GREEN 2
                # completed, hence RED1 and RED2 is valid"): gen_pending is a single, PER-HOUSE
                # shared flag, set by whichever lineage's RED2/GREEN2 happens to fire, and can
                # sit unconsumed for weeks (nothing else in the house independently triggers a
                # fresh-gen-formation). Gating a completely different, independently-eligible
                # lineage's fresh attach on that unrelated flag blocked TZ GREEN2's own RED1
                # for the entire 02-03 through 07-03-2022 stretch, even though its own front had
                # been eligible since 01-03 -- confirmed numerically (front_ok_for_attach was
                # True every one of those days; gen_pending, stale since 17-02-2022, was the
                # only thing blocking it).
                #
                # Deferred, not attached immediately -- see the precedence resolution after
                # this loop: if another lineage's front was born the exact same day as this
                # one's, only the OLDER lineage gets to attach a fresh RED1/GREEN1 today.
                fresh_attach_candidates.append((lin, attach_front))

            # --- fresh gen formation off this lineage's OWN RED2/GREEN2 signal ---
            # The signal must be THIS lineage's own (gen_pending_owner) -- see that field's
            # comment for the 03-03-2021 vs. 22-03-2021 pair that pins this down. The
            # gen_fresh_pending path is the same-lineage guaranteed restart after its own "2"
            # died shallow (§7) and is self-evidently its own signal, so it qualifies either way.
            # This trigger fires REGARDLESS of whether this lineage's own gen is currently
            # alive -- a fresh BAR/SAR forms every time this lineage earns its own RED2/GREEN2,
            # superseding whatever gen currently exists (dead or alive), with no limit on how
            # many times this repeats: "TZ GREEN - TZ GREEN 2 - RED1 - RED2 - BAR - BAR 2 -
            # RED1 - RED2 - BAR - BAR 2 ... N number of BAR can occur. There is no limit." A
            # prior version of this trigger added a `lin.gen is None` guard here on the
            # mistaken assumption that superseding a still-alive gen was inherently a data-loss
            # bug -- it isn't: only an ACTUAL price-driven `BAR SL` (not this ordinary
            # supersession) gates the separate REAR-ladder reform and the dual-track fresh-
            # anchor search ("unless there is a BAR SL, neither a new lineage can start nor can
            # REAR occur"); a ordinary new BAR forming here needs no such gate and can occur
            # "below the earlier BAR 2's own ref high," i.e. without touching that reference at
            # all. Confirmed by the user against their 2023 test data (BAR formed 08-01-2023,
            # reached BAR 2 09-01-2023, still alive when a second RED1/RED2 cycle -- 12-01/
            # 13-01-2023 -- earned this lineage a fresh BAR again on 14-01-2023).
            if (
                gen_pending
                and (gen_pending_owner is lin or lin.gen_fresh_pending)
                and (front_stage2_before_today or lin.gen_fresh_pending)
                and lin.declined_gen_pending_episode != gen_pending_episode
            ):
                if formation_break(ph, pl, h, l, c):
                    # Older-lineage precedence, same principle as the top-level fresh-anchor-
                    # vs-older-recovery gate (§8): if an OLDER lineage's own rear_recovery is
                    # ALSO resolving this exact day, this lineage's fresh gen would have "the
                    # same future impact" from here (own "2" -> SL -> RED1/GREEN1 -> reform,
                    # under whatever name) as the older lineage's own reform -- confirmed by
                    # the user against 02-03-2022 ("REAR BUY + BAR" -- only REAR BUY should
                    # print; the older lineage is proper).
                    blocked_by_older_recovery_here = any(
                        cd is not None and lin.created_day is not None and cd < lin.created_day
                        for cd in pending_rear_recovery_created_days
                    )
                    if blocked_by_older_recovery_here:
                        # Per-day decline ONLY -- does NOT set `superseded`. This collision type
                        # (an older lineage's REAR-ladder reform vs. a younger lineage's
                        # would-be plain gen) is provisional, not a declaration that the two
                        # lineages now share one identity: the older lineage (REAR BUY/SELL)
                        # hasn't necessarily reached its own "2" yet, so there is no guarantee
                        # it will ever independently do what the younger lineage's OWN front
                        # might do later. Confirmed by the user against 04-03-2022 (and the
                        # same principle at 23-03/24-03-2022, 17-04/18-04-2022): TZ GREEN
                        # (declined here on 02-03-2022 in favor of REAR BUY, which never
                        # reaches REAR BUY 2 before dying) must still independently attach its
                        # own RED1 on 04-03-2022 -- "if REAR BUY 2 would have occurred before
                        # 04-03, then excluding TZ GREEN makes sense" -- since REAR BUY 2 never
                        # happens, there is no actual collision with TZ GREEN's own RED1 at
                        # all, ever, in this window. Contrast the OTHER decline branch below
                        # (gen_formation_candidates), where BOTH lineages reach the IDENTICAL
                        # plain name via the SAME mechanism -- a real, permanent merge.
                        lin.declined_gen_pending_episode = gen_pending_episode
                    else:
                        # Deferred, not formed immediately -- see the precedence resolution
                        # after this loop: if ANOTHER lineage would ALSO independently form a
                        # plain gen off this SAME gen_pending signal today, only the OLDEST
                        # lineage actually forms it (both would reach the identical plain name
                        # and an identical future shape from here, so the younger one is
                        # redundant) -- confirmed by the user against 18-05-2022 ("2 different
                        # lineages were at the same occurrence of SAR -- mention the earlier
                        # one"). Genuinely different same-day events (one lineage reaching a
                        # ladder reform, another's pullback ticking) are unaffected -- those are
                        # already handled separately (dual-tagged pullback events, or the
                        # rear_recovery-collision gate above).
                        gen_formation_candidates.append(lin)

        # Fresh RED1/GREEN1 attach precedence: the attach formula itself is a raw price-
        # action check (doesn't reference any lineage-specific reference), so every eligible
        # lineage would independently "notice" the same breakout candle. When 2+ eligible
        # lineages' CURRENT fronts were born the exact same day, only the OLDER lineage (by
        # created_day) actually attaches -- confirmed by the user against the 10-03-2022 dual
        # formation (TZ GREEN and REAR BUY RE ENTER both born that day): "it will attach to
        # REAR BUY [the older lineage]." When fronts were born on DIFFERENT days (even if
        # both lineages are simultaneously eligible), both attach independently and get the
        # dual-tag treatment instead -- confirmed against 04-03-2022, unaffected by this.
        by_front_day = {}
        lin_to_front = dict(fresh_attach_candidates)
        for lin, front in fresh_attach_candidates:
            by_front_day.setdefault(front.formed_day, []).append(lin)
        for day, same_day_lins in by_front_day.items():
            if len(same_day_lins) > 1:
                winner = min(same_day_lins, key=lambda l: (l.created_day if l.created_day is not None else -1))
                process_pullback(winner, i, h, l, c, ph, pl, front=lin_to_front[winner])
            else:
                process_pullback(same_day_lins[0], i, h, l, c, ph, pl, front=lin_to_front[same_day_lins[0]])

        # Older-lineage precedence among 2+ lineages that would ALL independently form a
        # plain gen off the SAME gen_pending signal today (see the comment at the collection
        # site above) -- only the oldest actually forms it; the rest decline this episode.
        if gen_formation_candidates:
            winner = min(
                gen_formation_candidates,
                key=lambda l: (l.created_day if l.created_day is not None else -1),
            )
            for lin in gen_formation_candidates:
                if lin is winner:
                    new_gen = Struct(h, l, gen_name, formed_day=i)
                    lin.gen = new_gen
                    lin.gen_started = True
                    lin.recovery_label = None
                    lin.gen_fresh_pending = False
                    # A prior generation's bar2_recovery is now fully superseded by this brand-
                    # new gen and must be abandoned, not left ticking in parallel -- this
                    # trigger path (fresh gen off gen_pending) is a SEPARATE mechanism from
                    # bar2_recovery's own escalate/recover/ratchet handling, and doesn't
                    # otherwise touch it at all. Found via 15-06-2022 printing "INVALID SAR LL +
                    # SAR LL" under the SAME lineage that had already formed a brand-new SAR on
                    # 12-06-2022 -- a stale prior-generation reference was still ticking under
                    # the new gen's own current label days after the new gen made it moot. Left
                    # unabandoned, it could also later "recover" on its own criteria and silently
                    # overwrite this brand-new, unrelated gen.
                    lin.bar2_recovery = None
                    events[i].append(gen_name)
                    consumed_gen_pending_today = True
                else:
                    lin.declined_gen_pending_episode = gen_pending_episode
                    # Also permanent -- see Lineage.superseded.
                    lin.superseded = True

        # gen_pending is a persistent, shared-per-house signal: it stays available across
        # days (any lineage that becomes eligible later can still consume it) until at least
        # one lineage actually consumes it -- all lineages eligible on the SAME day consume it
        # simultaneously (per the user's "recorded at the backend" note) before this clears.
        if consumed_gen_pending_today:
            gen_pending = False

        # Flush this day's pullback events: only tag with the owning lineage's current track
        # when 2+ DISTINCT lineages actually fired a pullback event the same day (the
        # permanent BAR/SAR-vs-REAR BUY/SELL dual-track producing e.g. two independent RED1
        # attaches at once) -- otherwise the plain, untagged name is unambiguous as-is.
        distinct_lins = {id(lin) for lin, _ in pullback_buffer[i]}
        for lin, text in pullback_buffer[i]:
            if len(distinct_lins) > 1:
                events[i].append(f"{text} ({pullback_track(lin)})")
            else:
                events[i].append(text)

    return events


bull_events = run_house(rows, True, "BAR", "TZ GREEN")
bear_events = run_house(rows, False, "SAR", "TZ RED")

print(f"{'DATE':12}{'OPEN':8}{'HIGH':8}{'LOW':8}{'CLOSE':8}{'BULL EVENT':40}BEAR EVENT")
for i, (d, o, h, l, c) in enumerate(rows):
    be = " + ".join(bull_events[i])
    re = " + ".join(bear_events[i])
    print(f"{d:12}{o:<8}{h:<8}{l:<8}{c:<8}{be:40}{re}")
