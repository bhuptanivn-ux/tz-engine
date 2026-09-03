"""Regression test guarding the threshold-inclusivity invariant declared next to THRESH/ANY
in bar_rule_simulator.py: every comparison against THRESH or ANY must be inclusive
(difference >= constant), never strict (a > b + constant / a < b - constant). An exact tie
against the threshold must qualify.

Run with: python3 test_threshold_boundaries.py

Two independent checks:
1. A static source scan for the strict-comparison anti-pattern (`x > y + THRESH`, etc.) --
   catches a NEW formula written the wrong way, even one this file's numeric case below
   doesn't happen to exercise.
2. A concrete numeric regression, locking in the exact real-world case that first exposed
   this bug (2023 test data shared by the user): an anchor's own formation condition needs
   the prior day's Low to drop by AT LEAST 0.20 -- an exact 0.20 drop must qualify, not just
   a drop of more than 0.20.
"""
import re
import sys

SIM_PATH = "bar_rule_simulator.py"


def check_static_patterns():
    with open(SIM_PATH) as f:
        lines = f.readlines()

    # Matches `x > y + THRESH` / `x < y - THRESH` / `x > y + ANY` / `x < y - ANY` -- a strict
    # `<`/`>` (never `<=`/`>=`/`==`) immediately followed by an operand and then `+`/`-` THRESH
    # or ANY. This is narrow by construction (anchored on the strict comparison operator
    # itself), so it doesn't need a separate exclusion pass for the safe inclusive forms
    # (`x - y >= THRESH`), which never match it at all.
    strict_pattern = re.compile(r"(?<![<>=])[<>](?!=)\s*[\w.\[\]\"']+\s*[+-]\s*(THRESH|ANY)\b")
    violations = []
    for lineno, line in enumerate(lines, start=1):
        stripped = line.strip()
        if stripped.startswith("#"):
            continue
        code_part = line.split("#", 1)[0]
        if "THRESH" not in code_part and "ANY" not in code_part:
            continue
        if strict_pattern.search(code_part):
            violations.append((lineno, stripped))

    if violations:
        print("STATIC SCAN FAILED -- strict comparison(s) found against THRESH/ANY:")
        for lineno, text in violations:
            print(f"  line {lineno}: {text}")
        return False
    print("Static scan OK -- no strict THRESH/ANY comparisons found.")
    return True


def check_exact_tie_regression():
    sys.path.insert(0, ".")
    import importlib.util

    spec = importlib.util.spec_from_file_location("bar_rule_simulator", SIM_PATH)
    # bar_rule_simulator.py runs its own baked-in dataset at import time and prints it;
    # suppress that noise for this test.
    import io
    import contextlib

    module = importlib.util.module_from_spec(spec)
    with contextlib.redirect_stdout(io.StringIO()):
        spec.loader.exec_module(module)

    # Exact case from the user's 2023 test dataset: the anchor's own formation condition
    # (down_break, bearish) needs `pl - l >= THRESH`. Here pl=202.2, l=202 -- a drop of
    # EXACTLY 0.20 -- must qualify, forming TZ RED on this exact day, not one day later.
    rows = [
        ("01-01-2023", 400, 402, 399.25, 401.25),
        ("02-01-2023", 401, 403, 400.55, 402.75),
        ("03-01-2023", 402.5, 404.25, 402.2, 403.95),
        ("04-01-2023", 403.5, 404, 402, 402.2),
        ("05-01-2023", 403.05, 403.35, 401.75, 402),
    ]
    bear_events = module.run_house(rows, False, "SAR", "TZ RED")
    if "TZ RED" not in bear_events[3]:
        print(
            "EXACT-TIE REGRESSION FAILED -- TZ RED did not form on the exact-0.20-tie day "
            f"(04-01-2023). Events that day: {bear_events[3]}"
        )
        return False
    print("Exact-tie regression OK -- TZ RED forms on the exact 0.20 tie (04-01-2023).")
    return True


if __name__ == "__main__":
    ok = check_static_patterns()
    ok = check_exact_tie_regression() and ok
    sys.exit(0 if ok else 1)
