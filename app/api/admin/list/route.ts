import { NextRequest, NextResponse } from "next/server";
import { blobPrefix, findSegment, findTimeframe } from "@/lib/constants";
import { listUnderPrefix } from "@/lib/blob";
import { isAuthorized } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const segmentSlug = req.nextUrl.searchParams.get("segment") ?? "";
  const timeframeSlug = req.nextUrl.searchParams.get("timeframe") ?? "";
  const segment = findSegment(segmentSlug);
  const timeframe = findTimeframe(timeframeSlug);
  if (!segment || !timeframe) {
    return NextResponse.json({ error: "Unknown segment or timeframe." }, { status: 400 });
  }

  const prefix = blobPrefix(segment.slug, timeframe.slug);
  const blobs = await listUnderPrefix(prefix);

  const files = blobs
    .map((b) => ({
      instrument: b.pathname.slice(prefix.length).replace(/\.csv$/i, ""),
      size: b.size,
      uploadedAt: b.uploadedAt,
    }))
    .sort((a, b) => a.instrument.localeCompare(b.instrument));

  return NextResponse.json({ files });
}
