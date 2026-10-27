import { NextRequest, NextResponse } from "next/server";
import { saveEnrichmentError } from "@/lib/enrichment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ projectSlug: string; sessionId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { projectSlug, sessionId } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const obj = body as { sourceMtimeMs?: unknown; message?: unknown };
  if (typeof obj.sourceMtimeMs !== "number" || typeof obj.message !== "string") {
    return NextResponse.json(
      { error: "sourceMtimeMs and message required" },
      { status: 400 },
    );
  }

  const result = saveEnrichmentError(
    decodeURIComponent(projectSlug),
    decodeURIComponent(sessionId),
    obj.sourceMtimeMs,
    obj.message,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
