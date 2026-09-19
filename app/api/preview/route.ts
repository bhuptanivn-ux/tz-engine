import { NextRequest, NextResponse } from "next/server";
import { blobPath, findSegment, findTimeframe } from "@/lib/constants";
import { fetchBlobText, findBlobByExactPath } from "@/lib/blob";
import { parseOhlcCsv } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const segmentSlug = req.nextUrl.searchParams.get("segment") ?? "";
  const timeframeSlug = req.nextUrl.searchParams.get("timeframe") ?? "";
  const instrument = req.nextUrl.searchParams.get("instrument") ?? "";

  const segment = findSegment(segmentSlug);
  const timeframe = findTimeframe(timeframeSlug);
  if (!segment || !timeframe || !instrument) {
    return NextResponse.json({ error: "Missing parameters." }, { status: 400 });
  }

  const path = blobPath(segment.slug, timeframe.slug, instrument);
  const blob = await findBlobByExactPath(path);
  if (!blob) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  try {
    const text = await fetchBlobText(blob.url);
    const rows = parseOhlcCsv(text);
    if (rows.length === 0) {
      return NextResponse.json({ error: "No readable rows in this file." }, { status: 422 });
    }
    return NextResponse.json({
      firstDate: rows[0].date,
      lastDate: rows[rows.length - 1].date,
      rows: rows.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to read file." },
      { status: 500 }
    );
  }
}
