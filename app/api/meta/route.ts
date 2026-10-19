import { NextRequest, NextResponse } from "next/server";
import { fetchFirstTradeDate } from "@/lib/marketData";

// Underscore and a longer max length accommodate the pseudo-suffixed Blob
// symbols in lib/otherMarkets.ts (e.g. "NIFTY_FINANCIAL_SERVICES.IDX"),
// alongside plain Yahoo tickers like "^NSEI" or "RELIANCE.NS".
const SYMBOL_RE = /^[A-Za-z0-9._\-^&]{1,40}$/;

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol")?.trim() || "";

  if (!SYMBOL_RE.test(symbol)) {
    return NextResponse.json({ error: "Invalid or missing symbol" }, { status: 400 });
  }

  try {
    const firstTradeDate = await fetchFirstTradeDate(symbol);
    // A symbol's first trade date is effectively immutable -- safe to let
    // the edge serve this for a full day without re-invoking the Function.
    return NextResponse.json(
      { symbol, firstTradeDate },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Metadata fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
