import { NextRequest, NextResponse } from "next/server";
import { blobPath, findSegment, findTimeframe } from "@/lib/constants";
import { fetchBlobText, findBlobByExactPath } from "@/lib/blob";
import { buildWorkbookBuffer, parseOhlcCsv } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const segmentSlug = req.nextUrl.searchParams.get("segment") ?? "";
  const timeframeSlug = req.nextUrl.searchParams.get("timeframe") ?? "";
  const instrument = req.nextUrl.searchParams.get("instrument") ?? "";

  const segment = findSegment(segmentSlug);
  const timeframe = findTimeframe(timeframeSlug);
  if (!segment || !timeframe || !instrument) {
    return NextResponse.json(
      { error: "segment, timeframe and instrument are all required." },
      { status: 400 }
    );
  }

  const path = blobPath(segment.slug, timeframe.slug, instrument);
  const blob = await findBlobByExactPath(path);
  if (!blob) {
    return NextResponse.json(
      { error: `No file found for ${instrument} in ${segment.label} / ${timeframe.label}.` },
      { status: 404 }
    );
  }

  let rows;
  try {
    const csvText = await fetchBlobText(blob.url);
    rows = parseOhlcCsv(csvText);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to read the data file." },
      { status: 500 }
    );
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "The file has no readable OHLC rows." }, { status: 422 });
  }

  const buffer = await buildWorkbookBuffer(rows, {
    instrument,
    segment: segment.label,
    timeframe: timeframe.label,
  });

  const filename = `${instrument}_${timeframe.label}_OHLC.xlsx`.replace(/\s+/g, "_");

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
