import { NextRequest, NextResponse } from "next/server";
import { blobPath, findSegment, findTimeframe } from "@/lib/constants";
import { uploadCsv } from "@/lib/blob";
import { isAuthorized } from "@/lib/adminAuth";
import { parseOhlcCsv } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const form = await req.formData();
  const segmentSlug = String(form.get("segment") ?? "");
  const timeframeSlug = String(form.get("timeframe") ?? "");
  const segment = findSegment(segmentSlug);
  const timeframe = findTimeframe(timeframeSlug);
  if (!segment || !timeframe) {
    return NextResponse.json({ error: "Unknown segment or timeframe." }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files were sent." }, { status: 400 });
  }

  const results: { file: string; status: "ok" | "error"; message?: string; rows?: number }[] = [];

  for (const file of files) {
    const instrument = file.name.replace(/\.csv$/i, "");
    try {
      const text = await file.text();
      const rows = parseOhlcCsv(text); // validates it looks like an OHLC CSV
      const path = blobPath(segment.slug, timeframe.slug, instrument);
      await uploadCsv(path, text);
      results.push({ file: file.name, status: "ok", rows: rows.length });
    } catch (err) {
      results.push({
        file: file.name,
        status: "error",
        message: err instanceof Error ? err.message : "Upload failed.",
      });
    }
  }

  return NextResponse.json({ results });
}
