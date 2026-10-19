import { NextRequest, NextResponse } from "next/server";
import { fetchHistoryWithSource, Interval } from "@/lib/marketData";

// Underscore and a longer max length accommodate the pseudo-suffixed Blob
// symbols in lib/otherMarkets.ts (e.g. "NIFTY_FINANCIAL_SERVICES.IDX"),
// alongside plain Yahoo tickers like "^NSEI" or "RELIANCE.NS".
const SYMBOL_RE = /^[A-Za-z0-9._\-^&]{1,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_INTERVALS: Interval[] = ["1d", "1wk", "1mo"];

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const symbol = params.get("symbol")?.trim() || "";
  const start = params.get("start")?.trim() || "";
  const end = params.get("end")?.trim() || "";
  const interval = (params.get("interval")?.trim() || "1d") as Interval;

  if (!SYMBOL_RE.test(symbol)) {
    return NextResponse.json({ error: "Invalid or missing symbol" }, { status: 400 });
  }
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
    return NextResponse.json(
      { error: "start and end must be dates in YYYY-MM-DD format" },
      { status: 400 }
    );
  }
  if (!VALID_INTERVALS.includes(interval)) {
    return NextResponse.json({ error: "Invalid interval" }, { status: 400 });
  }

  try {
    const { rows, source, blobError } = await fetchHistoryWithSource(symbol, start, end, interval);
    // Underlying data only changes once a day (the refresh-daily cron), so
    // letting Vercel's edge serve repeat identical requests for an hour
    // avoids re-invoking this Function (and re-shipping its full response
    // body) on every page load/interval change for the same symbol+range
    // -- that was counting against Fast Origin Transfer on every single
    // request, with no caching at all.
    return NextResponse.json(
      { symbol, interval, source, blobDebug: blobError, rows },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "History fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
