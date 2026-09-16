import { NextRequest, NextResponse } from "next/server";
import { fetchFirstTradeDate } from "@/lib/yahoo";

const SYMBOL_RE = /^[A-Za-z0-9.\-^&]{1,20}$/;

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol")?.trim() || "";

  if (!SYMBOL_RE.test(symbol)) {
    return NextResponse.json({ error: "Invalid or missing symbol" }, { status: 400 });
  }

  try {
    const firstTradeDate = await fetchFirstTradeDate(symbol);
    return NextResponse.json({ symbol, firstTradeDate });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Metadata fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
