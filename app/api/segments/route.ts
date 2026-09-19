import { NextResponse } from "next/server";
import { SEGMENTS, TIMEFRAMES } from "@/lib/constants";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ segments: SEGMENTS, timeframes: TIMEFRAMES });
}
