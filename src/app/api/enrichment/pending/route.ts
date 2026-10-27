import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { listPendingEnrichments } from "@/lib/enrichment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("limit");
  const limit = raw ? Math.min(50, Math.max(1, Number(raw) || 10)) : config.enrichPendingLimit;
  const sessions = listPendingEnrichments(limit);
  return NextResponse.json({ sessions });
}
