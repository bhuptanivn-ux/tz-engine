import { NextRequest, NextResponse } from "next/server";
import { SCREENER_UNIVERSE } from "@/lib/screenerUniverse";

// Scrip search for the Prime Trend page -- filters the full NSE equity
// list (lib/screenerUniverse.ts, ~2,600 entries) server-side by symbol or
// name substring, so the client never has to bundle that array. Local
// in-memory filter, no live network call, so it's fast even against the
// full list.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim().toLowerCase() || "";
  if (q.length < 1) return NextResponse.json({ results: [] });

  const results = SCREENER_UNIVERSE.filter(
    (e) => e.symbol.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)
  ).slice(0, 20);

  return NextResponse.json({ results });
}
