import { NextRequest, NextResponse } from "next/server";
import { searchNseSymbols } from "@/lib/yahoo";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() || "";

  if (q.length < 1) {
    return NextResponse.json({ results: [] });
  }
  if (q.length > 50) {
    return NextResponse.json({ error: "Query too long" }, { status: 400 });
  }

  try {
    const results = await searchNseSymbols(q);
    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
