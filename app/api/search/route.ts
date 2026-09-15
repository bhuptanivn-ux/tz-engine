import { NextRequest, NextResponse } from "next/server";
import { searchSymbols } from "@/lib/yahoo";

const REGION_RE = /^[A-Za-z]{2}$/;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() || "";
  const regionParam = req.nextUrl.searchParams.get("region")?.trim() || "";

  if (q.length < 1) {
    return NextResponse.json({ results: [] });
  }
  if (q.length > 50) {
    return NextResponse.json({ error: "Query too long" }, { status: 400 });
  }
  if (regionParam && !REGION_RE.test(regionParam)) {
    return NextResponse.json({ error: "Invalid region" }, { status: 400 });
  }

  try {
    const results = await searchSymbols(q, regionParam || undefined);
    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
