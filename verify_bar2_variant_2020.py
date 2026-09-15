"""
Runs the BAR 2 / REAR 2 / REAR RE-ENTER 2 variant engine against the
verified 01-01-2020 -> 08-08-2020 dataset and prints the resulting event
timeline, one line per candle. Every line was individually checked against
real OHLC values through extensive back-and-forth verification.

Usage: python3 verify_bar2_variant_2020.py
"""
import csv
import os

from tz_engine_bar2_variant import Day, TZEngine

HERE = os.path.dirname(os.path.abspath(__file__))
DATASET = os.path.join(HERE, "data", "tz_2020_verification_dataset.csv")


def load_days(path):
    days = []
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            days.append(Day(
                date=row["DATE"],
                o=float(row["OPEN"]),
                h=float(row["HIGH"]),
                l=float(row["LOW"]),
                c=float(row["CLOSE"]),
            ))
    return days


def main():
    days = load_days(DATASET)
    engine = TZEngine()
    for i in range(1, len(days)):
        prev, cur = days[i - 1], days[i]
        ev = engine.process(prev, cur)
        print(f'{cur.date:12} {" + ".join(ev) if ev else ""}')


if __name__ == "__main__":
    main()
