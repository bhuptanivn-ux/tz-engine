import { NextRequest, NextResponse } from "next/server";
import { blobPrefix, findSegment, findTimeframe } from "@/lib/constants";
import { listUnderPrefix } from "@/lib/blob";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const segmentSlug = req.nextUrl.searchParams.get("segment") ?? "";
  const timeframeSlug = req.nextUrl.searchParams.get("timeframe") ?? "";

  const segment = findSegment(segmentSlug);
  const timeframe = findTimeframe(timeframeSlug);
  if (!segment || !timeframe) {
    return NextResponse.json({ error: "Unknown segment or timeframe." }, { status: 400 });
  }

  const prefix = blobPrefix(segment.slug, timeframe.slug);
  const blobs = await listUnderPrefix(prefix);

  const instruments = blobs
    .map((b) => b.pathname.slice(prefix.length).replace(/\.csv$/i, ""))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  return NextResponse.json({ instruments });
}
