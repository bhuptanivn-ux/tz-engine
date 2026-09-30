#!/usr/bin/env python3
"""Incrementally update OHLC CSVs after each timeframe closes.

Daily: after the session, once official/adjusted closes are on TradingView.
Weekly: after the last working day of the week (Friday, or earlier if Friday is off).
Monthly / yearly: after the period has ended.

Usage:
  python3 scripts/tv_ohlc_update.py --timeframe DAILY
  python3 scripts/tv_ohlc_update.py --timeframe auto
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tv_ohlc_download as tv  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

LOOKBACK = {
    "DAILY": 40,
    "WEEKLY": 12,
    "MONTHLY": 8,
    "YEARLY": 4,
}

WEEKDAY_FOLDERS = {"NSE", "SME", "Indexes", "Commodities"}
ALWAYS_FOLDERS = {"CRYPTO", "Forex", "International Indexes"}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Update existing OHLC CSVs from TradingView")
    p.add_argument(
        "--timeframe",
        default="auto",
        help="DAILY, WEEKLY, MONTHLY, YEARLY, or auto (from IST clock)",
    )
    p.add_argument("--folder", default=None, help="Only this category folder, e.g. NSE")
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--sleep", type=float, default=0.08)
    p.add_argument("--retries", type=int, default=2)
    return p.parse_args()


def ist_now() -> dt.datetime:
    return dt.datetime.now(tv.IST)


def auto_timeframes(now: dt.datetime) -> list[str]:
    """Pick timeframes whose period has just closed (IST)."""
    tfs: list[str] = []
    weekday = now.weekday()  # Mon=0
    hour = now.hour
    # Evening run (~19:00 IST): daily closes, plus weekly on Friday.
    if hour >= 18:
        tfs.append("DAILY")
        if weekday == 4:
            tfs.append("WEEKLY")
    # Saturday morning: last working day's weekly bar is complete
    # even if Friday was a holiday.
    if weekday == 5 and hour < 12:
        tfs.append("WEEKLY")
    if now.day == 1 and hour < 12:
        tfs.append("MONTHLY")
        if now.month == 1:
            tfs.append("YEARLY")
    seen: set[str] = set()
    out: list[str] = []
    for tf in tfs:
        if tf not in seen:
            seen.add(tf)
            out.append(tf)
    return out or ["DAILY"]


def load_explicit_map() -> dict[tuple[str, str], list[str]]:
    """(folder, filename) -> tv symbol candidates."""
    mapping: dict[tuple[str, str], list[str]] = {}
    folder_by_cat = tv.CATEGORY_DIRS
    csv_paths = [
        DATA / "extra_instruments.csv",
        DATA / "extra_instruments_tv.csv",
        DATA / "extra_commodities_public.csv",
        DATA / "hyphen_retry_universe.csv",
        DATA / "bitcoin_bitstamp_universe.csv",
        DATA / "sme_universe.csv",
    ]
    sources = DATA / "Commodities" / "SOURCES.csv"
    if sources.is_file():
        with sources.open(newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                stem = (row.get("file_stem") or "").strip()
                sym = (row.get("source_tv_symbol") or "").strip()
                if stem and sym:
                    mapping[("Commodities", stem)] = [sym]
    for path in csv_paths:
        if not path.is_file():
            continue
        with path.open(newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                cat = (row.get("category") or "").strip()
                filename = (row.get("filename") or "").strip()
                raw = (row.get("tv_symbol") or "").strip()
                if not filename or not raw:
                    continue
                folder = folder_by_cat.get(cat, cat)
                mapping[(folder, filename)] = [c.strip() for c in raw.split("|") if c.strip()]
    mapping[("CRYPTO", "BTCUSD")] = ["BITSTAMP:BTCUSD"]
    mapping[("CRYPTO", "BITCOIN")] = ["BITSTAMP:BTCUSD"]
    mapping[("international", "SPX")] = ["TVC:SPX"]
    mapping[("International Indexes", "SPX")] = ["TVC:SPX"]
    mapping[("International Indexes", "DJI")] = ["TVC:DJI"]
    mapping[("International Indexes", "IXIC")] = ["NASDAQ:IXIC"]
    return mapping


def candidates_for(folder: str, filename: str, explicit: dict[tuple[str, str], list[str]]) -> list[str]:
    if (folder, filename) in explicit:
        return explicit[(folder, filename)]
    if folder in {"NSE", "SME"}:
        underscored = filename.replace("-", "_")
        cands = [f"NSE:{underscored}"]
        if underscored != filename:
            cands.append(f"NSE:{filename}")
        return cands
    if folder == "Indexes":
        return [f"NSE:{filename}", f"BSE:{filename}"]
    if folder == "Forex":
        return [f"FX_IDC:{filename}"]
    if folder == "CRYPTO":
        return [f"BINANCE:{filename}USDT", f"BITSTAMP:{filename}"]
    return [f"NSE:{filename.replace('-', '_')}"]


def read_csv_rows(path: Path) -> dict[str, list[str]]:
    rows: dict[str, list[str]] = {}
    if not path.is_file():
        return rows
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            date = (row.get("Date") or "").strip()
            if not date:
                continue
            rows[date] = [
                date,
                row.get("Open") or "",
                row.get("High") or "",
                row.get("Low") or "",
                row.get("Close") or "",
                row.get("Volume") or "0",
            ]
    return rows


def write_merged(path: Path, by_date: dict[str, list[str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".csv.tmp")
    with tmp.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Date", "Open", "High", "Low", "Close", "Volume"])
        for date in sorted(by_date):
            w.writerow(by_date[date])
    tmp.replace(path)


def update_file(
    path: Path,
    candidates: list[str],
    interval: str,
    n_bars: int,
    token: str,
    retries: int,
) -> str:
    last_exc: Exception | None = None
    bars = None
    used = candidates[0]
    for cand in candidates:
        try:
            bars = tv.fetch_with_retry(cand, interval, n_bars, token, retries)
            used = cand
            break
        except Exception as exc:
            last_exc = exc
    if bars is None:
        raise last_exc or RuntimeError("no candidates")
    new_rows = tv.bars_to_rows(bars)
    existing = read_csv_rows(path)
    before = dict(existing)
    for when, o, h, l, c, v in new_rows:
        date = when.strftime("%Y-%m-%d")
        existing[date] = [date, f"{o:.2f}", f"{h:.2f}", f"{l:.2f}", f"{c:.2f}", str(v)]
    if existing == before:
        return f"unchanged ({used})"
    write_merged(path, existing)
    return f"updated {len(new_rows)} bars via {used} last={max(existing)}"


def list_targets(timeframe: str, folder_filter: str | None) -> list[tuple[str, Path]]:
    out: list[tuple[str, Path]] = []
    for folder in list(tv.CATEGORY_DIRS.values()):
        if folder_filter and folder != folder_filter:
            continue
        tf_dir = DATA / folder / timeframe
        if not tf_dir.is_dir():
            continue
        for csv_path in sorted(tf_dir.glob("*.csv")):
            if csv_path.name.upper() == "SOURCES.CSV":
                continue
            out.append((folder, csv_path))
    return out


def main() -> int:
    args = parse_args()
    now = ist_now()
    raw = args.timeframe.strip().upper()
    if raw == "AUTO":
        timeframes = auto_timeframes(now)
    else:
        timeframes = [raw]
    for tf in timeframes:
        if tf not in tv.TIMEFRAMES:
            raise SystemExit(f"Unknown timeframe {tf}")

    token = "unauthorized_user_token"
    explicit = load_explicit_map()
    print(f"IST {now.isoformat()}  timeframes={timeframes}")

    failures = 0
    updates = 0
    unchanged = 0
    for tf in timeframes:
        interval, _full = tv.TIMEFRAMES[tf]
        n_bars = LOOKBACK[tf]
        targets = list_targets(tf, args.folder)
        if args.limit is not None:
            targets = targets[: args.limit]
        print(f"\n=== {tf} ({len(targets)} files) ===")
        for i, (folder, path) in enumerate(targets, 1):
            cands = candidates_for(folder, path.stem, explicit)
            try:
                msg = update_file(path, cands, interval, n_bars, token, args.retries)
                if msg.startswith("updated"):
                    updates += 1
                else:
                    unchanged += 1
                if i % 50 == 0 or not msg.startswith("unchanged"):
                    print(f"  [{i}/{len(targets)}] {folder}/{path.stem}: {msg}")
            except Exception as exc:
                failures += 1
                print(f"  [{i}/{len(targets)}] {folder}/{path.stem}: FAILED {exc}")
            time.sleep(args.sleep)

    log = DATA / "last_update.json"
    import json

    log.write_text(
        json.dumps(
            {
                "ist": now.isoformat(),
                "timeframes": timeframes,
                "updated": updates,
                "unchanged": unchanged,
                "failures": failures,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"\nDone. updated={updates} unchanged={unchanged} failures={failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
