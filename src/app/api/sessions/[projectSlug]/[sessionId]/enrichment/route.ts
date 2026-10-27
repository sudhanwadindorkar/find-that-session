import { NextRequest, NextResponse } from "next/server";
import { saveEnrichment } from "@/lib/enrichment";
import { kickEmbeddingWorker } from "@/lib/indexer/service";

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

  const obj = body as {
    displayTitle?: unknown;
    summary?: unknown;
    sourceMtimeMs?: unknown;
  };

  if (
    typeof obj.displayTitle !== "string" ||
    !Array.isArray(obj.summary) ||
    typeof obj.sourceMtimeMs !== "number"
  ) {
    return NextResponse.json(
      { error: "displayTitle, summary[], sourceMtimeMs required" },
      { status: 400 },
    );
  }

  const summary = obj.summary.filter((x): x is string => typeof x === "string");
  const result = saveEnrichment(
    decodeURIComponent(projectSlug),
    decodeURIComponent(sessionId),
    {
      displayTitle: obj.displayTitle,
      summary,
      sourceMtimeMs: obj.sourceMtimeMs,
    },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  kickEmbeddingWorker();
  return NextResponse.json({ ok: true });
}
