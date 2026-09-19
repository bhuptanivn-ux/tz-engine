#!/usr/bin/env python3
"""Download NSE OHLC from TradingView into CSV files (DAILY/WEEKLY/MONTHLY/YEARLY).

Based on the provided tv_ohlc_download script; writes CSV instead of Excel.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import random
import re
import string
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

try:
    import requests
except ImportError:
    requests = None  # type: ignore

try:
    from websocket import create_connection
except ImportError:
    print("Install dependencies first:  pip install websocket-client requests", file=sys.stderr)
    raise

SIGNIN_URL = "https://www.tradingview.com/accounts/signin/"
WS_URL = "wss://data.tradingview.com/socket.io/websocket"
WS_ORIGIN = "https://data.tradingview.com"

CURRENCY_BY_EXCHANGE = {
    "NSE": "INR",
    "BSE": "INR",
    "MCX": "INR",
    "NASDAQ": "USD",
    "NYSE": "USD",
    "AMEX": "USD",
    "LSE": "GBP",
    "TSE": "JPY",
    "HKEX": "HKD",
}

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))

TIMEFRAMES = {
    "DAILY": ("1D", 20000),
    "WEEKLY": ("1W", 2000),
    "MONTHLY": ("1M", 500),
    "YEARLY": ("12M", 80),
}

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_EQUITY = ROOT / "data" / "EQUITY_L.csv"
DEFAULT_OUT = ROOT / "data"

CATEGORY_DIRS = {
    "equities": "NSE",
    "sme": "SME",
    "commodities": "Commodities",
    "indexes": "Indexes",
    "crypto": "CRYPTO",
    "forex": "Forex",
    "international": "International Indexes",
}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Download NSE historical OHLC CSVs from TradingView")
    p.add_argument("--username", "-u", default="", help="TradingView email or username (optional)")
    p.add_argument("--password", "-p", default=None, help="TradingView password (optional)")
    p.add_argument("--equity", default=str(DEFAULT_EQUITY), help="Path to EQUITY_L.csv")
    p.add_argument("--out", default=str(DEFAULT_OUT), help="Output root with DAILY/WEEKLY/MONTHLY/YEARLY folders")
    p.add_argument("--start", default="01/01/2002", help="Start date DD/MM/YYYY")
    p.add_argument("--end", default=None, help="End date DD/MM/YYYY (default: today)")
    p.add_argument("--batch-size", type=int, default=10, help="Stocks per batch")
    p.add_argument("--batch", type=int, default=None, help="0-based batch index; omit to run all remaining")
    p.add_argument("--offset", type=int, default=0, help="Skip this many symbols from the start of the list")
    p.add_argument("--limit", type=int, default=None, help="Max number of symbols to process this run")
    p.add_argument("--sleep", type=float, default=0.4, help="Pause between requests")
    p.add_argument("--retries", type=int, default=3, help="Retries per symbol/timeframe")
    p.add_argument("--force", action="store_true", help="Re-download even if CSV already exists")
    p.add_argument(
        "--universe",
        default=None,
        help="CSV with category,filename,tv_symbol,name (tv_symbol may be pipe-separated fallbacks)",
    )
    return p.parse_args()


def parse_date(value: str | None, end_of_day: bool = False) -> float | None:
    if not value:
        return None
    d = dt.datetime.strptime(value.strip(), "%d/%m/%Y")
    if end_of_day:
        d = d.replace(hour=23, minute=59, second=59)
    return d.replace(tzinfo=dt.timezone.utc).timestamp()


def parse_listing(value: str) -> dt.date | None:
    value = (value or "").strip()
    if not value:
        return None
    for fmt in ("%d-%b-%Y", "%d-%B-%Y", "%d/%m/%Y", "%d-%b-%y", "%d-%B-%y"):
        try:
            return dt.datetime.strptime(value, fmt).date()
        except ValueError:
            try:
                return dt.datetime.strptime(value.title(), fmt).date()
            except ValueError:
                continue
    return None


def load_universe(path: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            filename = (row.get("filename") or "").strip()
            tv_symbol = (row.get("tv_symbol") or "").strip()
            if not filename or not tv_symbol:
                continue
            rows.append(
                {
                    "symbol": filename,
                    "tv_symbol": tv_symbol,
                    "name": (row.get("name") or "").strip(),
                    "listing": (row.get("listing") or "").strip(),
                    "category": (row.get("category") or "other").strip(),
                }
            )
    return rows


def load_symbols(path: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            symbol = (row.get("SYMBOL") or "").strip()
            if not symbol:
                continue
            name = (
                row.get("NAME OF COMPANY")
                or row.get("NAME_OF_COMPANY")
                or ""
            ).strip()
            listing = (
                row.get(" DATE OF LISTING")
                or row.get("DATE OF LISTING")
                or row.get("DATE_OF_LISTING")
                or ""
            ).strip()
            rows.append(
                {
                    "symbol": symbol,
                    "name": name,
                    "listing": listing,
                }
            )
    return rows


def resolve_spec(symbol: str) -> str:
    exchange = symbol.split(":", 1)[0].upper() if ":" in symbol else ""
    currency = CURRENCY_BY_EXCHANGE.get(exchange)
    payload: dict[str, str] = {
        "adjustment": "splits",
        "session": "regular",
        "symbol": symbol,
    }
    if currency:
        payload["currency-id"] = currency
    return "=" + json.dumps(payload, separators=(",", ":"))


def tv_login(username: str, password: str) -> str | None:
    if requests is None or not username or not password:
        return None
    try:
        resp = requests.post(
            SIGNIN_URL,
            data={"username": username, "password": password, "remember": "on"},
            headers={"Referer": "https://www.tradingview.com"},
            timeout=20,
        )
        data = resp.json()
        token = (data.get("user") or {}).get("auth_token")
        if token:
            print("Signed in to TradingView.")
            return token
        print("Sign-in did not return a token; continuing as public user.")
    except Exception as exc:
        print(f"Sign-in failed ({exc}); continuing as public user.")
    return None


def ws_msg(func: str, params: list[Any]) -> str:
    body = json.dumps({"m": func, "p": params}, separators=(",", ":"))
    return f"~m~{len(body)}~m~{body}"


def session_id(prefix: str) -> str:
    return prefix + "".join(random.choice(string.ascii_lowercase) for _ in range(12))


def fetch_bars(symbol: str, interval: str, n_bars: int, token: str) -> list[list[float]]:
    spec = resolve_spec(symbol)
    cs = session_id("cs_")
    ws = create_connection(WS_URL, header=[f"Origin: {WS_ORIGIN}"], timeout=30)
    try:
        ws.recv()
        ws.send(ws_msg("set_auth_token", [token]))
        ws.send(ws_msg("chart_create_session", [cs, ""]))
        ws.send(ws_msg("resolve_symbol", [cs, "symbol_1", spec]))
        ws.send(ws_msg("create_series", [cs, "s1", "s1", "symbol_1", interval, n_bars]))

        raw = ""
        deadline = dt.datetime.now() + dt.timedelta(seconds=45)
        while dt.datetime.now() < deadline:
            chunk = ws.recv()
            raw += chunk + "\n"
            if chunk.startswith("~m~") and re.match(r"^~m~\d+~m~~h~\d+", chunk):
                ws.send(chunk)
            if "series_completed" in chunk:
                break
            if "symbol_error" in chunk or "series_error" in chunk:
                raise RuntimeError(f"TradingView rejected the symbol {symbol!r}")
    finally:
        ws.close()

    bars: dict[int, list[float]] = {}
    for part in re.split(r"~m~\d+~m~", raw):
        part = part.strip()
        if not part.startswith("{"):
            continue
        try:
            msg = json.loads(part)
        except json.JSONDecodeError:
            continue
        if msg.get("m") != "timescale_update":
            continue
        payload = (msg.get("p") or [None, {}])[1] or {}
        series = payload.get("s1") or {}
        for row in series.get("s") or []:
            values = row.get("v") if isinstance(row, dict) else None
            if isinstance(values, list) and len(values) >= 5:
                bars[int(values[0])] = values[:6]
    if not bars:
        raise RuntimeError("No OHLC bars returned. Check the symbol and interval.")
    return [bars[k] for k in sorted(bars)]


# TradingView stamps weekly/monthly/yearly bars at period start. Keep a bar
# if that period can overlap [start, end] (e.g. a 2026 yearly bar for an April listing).
INTERVAL_SPAN = {
    "1D": 86400,
    "1W": 7 * 86400,
    "1M": 32 * 86400,
    "12M": 366 * 86400,
}


def filter_range(
    bars: list[list[float]],
    start_ts: float | None,
    end_ts: float | None,
    interval: str = "1D",
) -> list[list[float]]:
    span = INTERVAL_SPAN.get(interval, 86400)
    out = []
    for row in bars:
        ts = float(row[0])
        if start_ts is not None and ts + span < start_ts:
            continue
        if end_ts is not None and ts > end_ts:
            continue
        out.append(row)
    return out


def bars_to_rows(bars: list[list[float]]) -> list[tuple[dt.datetime, float, float, float, float, int]]:
    rows = []
    for bar in bars:
        when = dt.datetime.fromtimestamp(float(bar[0]), tz=IST)
        volume = int(round(float(bar[5]))) if len(bar) > 5 else 0
        rows.append((when, float(bar[1]), float(bar[2]), float(bar[3]), float(bar[4]), volume))
    return rows


def write_csv(path: Path, rows: list[tuple[dt.datetime, float, float, float, float, int]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".csv.tmp")
    with tmp.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Date", "Open", "High", "Low", "Close", "Volume"])
        for when, o, h, l, c, v in rows:
            w.writerow(
                [
                    when.strftime("%Y-%m-%d"),
                    f"{o:.2f}",
                    f"{h:.2f}",
                    f"{l:.2f}",
                    f"{c:.2f}",
                    v,
                ]
            )
    tmp.replace(path)


def effective_start(global_start: str, listing: str) -> str:
    start_d = dt.datetime.strptime(global_start, "%d/%m/%Y").date()
    listed = parse_listing(listing)
    if listed and listed > start_d:
        return listed.strftime("%d/%m/%Y")
    return global_start


def already_done(out_root: Path, ticker: str) -> bool:
    return all((out_root / tf / f"{ticker}.csv").is_file() for tf in TIMEFRAMES)


def category_out_root(base: Path, category: str | None) -> Path:
    folder = CATEGORY_DIRS.get(category or "equities")
    if folder:
        return base / folder
    return base / (category or "other")


def pick_working_symbol(candidates: list[str], token: str, retries: int) -> str:
    last: Exception | None = None
    for cand in candidates:
        try:
            fetch_with_retry(cand, "1D", 80, token, max(1, retries))
            return cand
        except Exception as exc:
            last = exc
            print(f"    candidate {cand} failed: {exc}")
    assert last is not None
    raise last


def fetch_with_retry(symbol: str, interval: str, n_bars: int, token: str, retries: int) -> list[list[float]]:
    last: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            return fetch_bars(symbol, interval, n_bars, token)
        except Exception as exc:
            last = exc
            wait = min(8, 1.5 * attempt)
            print(f"    retry {attempt}/{retries} after {exc} (sleep {wait:.1f}s)")
            time.sleep(wait)
    assert last is not None
    raise last


def main() -> int:
    args = parse_args()
    equity_path = Path(args.equity)
    out_base = Path(args.out)

    if args.universe:
        symbols = load_universe(Path(args.universe))
    else:
        symbols = load_symbols(equity_path)
        for item in symbols:
            item["tv_symbol"] = f"NSE:{item['symbol']}"
            item["category"] = "equities"

    if args.batch is not None:
        start = args.batch * args.batch_size
        symbols = symbols[start : start + args.batch_size]
    else:
        symbols = symbols[args.offset :]
        if args.limit is not None:
            symbols = symbols[: args.limit]

    if not symbols:
        print("No symbols in this batch.")
        return 0

    cats = {item.get("category") or "equities" for item in symbols}
    for cat in cats:
        root = category_out_root(out_base, cat)
        for tf in TIMEFRAMES:
            (root / tf).mkdir(parents=True, exist_ok=True)

    end = args.end or dt.datetime.now(IST).strftime("%d/%m/%Y")
    end_ts = parse_date(end, end_of_day=True)
    token = "unauthorized_user_token"
    if args.username:
        token = tv_login(args.username, args.password or "") or token

    log_path = out_base / "download_failures.csv"
    failures: list[list[str]] = []
    ok = 0
    skipped = 0

    print(f"Processing {len(symbols)} symbols -> {out_base}")
    for i, item in enumerate(symbols, 1):
        ticker = item["symbol"]
        category = item.get("category") or "equities"
        dest_root = category_out_root(out_base, category)
        candidates = [c.strip() for c in item["tv_symbol"].split("|") if c.strip()]
        start = effective_start(args.start, item.get("listing") or "")
        start_ts = parse_date(start)
        print(
            f"[{i}/{len(symbols)}] {ticker}  category={category}  "
            f"candidates={candidates}  start={start}"
        )

        if not args.force and already_done(dest_root, ticker):
            print("  skip (already downloaded)")
            skipped += 1
            continue

        try:
            tv_symbol = pick_working_symbol(candidates, token, args.retries) if len(candidates) > 1 else candidates[0]
            if len(candidates) > 1:
                print(f"  using {tv_symbol}")
        except Exception as exc:
            for tf_name in TIMEFRAMES:
                failures.append([ticker, tf_name, str(exc)])
            print(f"  FAILED to resolve symbol: {exc}")
            continue

        all_ok = True
        for tf_name, (interval, n_bars) in TIMEFRAMES.items():
            dest = dest_root / tf_name / f"{ticker}.csv"
            if dest.is_file() and not args.force:
                print(f"  {tf_name}: exists")
                continue
            try:
                bars = fetch_with_retry(tv_symbol, interval, n_bars, token, args.retries)
                bars = filter_range(bars, start_ts, end_ts, interval)
                if not bars:
                    raise RuntimeError("No bars in the requested date range.")
                rows = bars_to_rows(bars)
                write_csv(dest, rows)
                print(
                    f"  {tf_name}: {len(rows)} rows  "
                    f"{rows[0][0].strftime('%Y-%m-%d')} -> {rows[-1][0].strftime('%Y-%m-%d')}"
                )
            except Exception as exc:
                all_ok = False
                failures.append([ticker, tf_name, str(exc)])
                print(f"  {tf_name}: FAILED {exc}")
            time.sleep(args.sleep)
        if all_ok:
            ok += 1

    if failures:
        write_header = not log_path.is_file()
        with log_path.open("a", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            if write_header:
                w.writerow(["symbol", "timeframe", "error"])
            w.writerows(failures)

    print(f"Done. ok={ok} skipped={skipped} failures={len(failures)}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
