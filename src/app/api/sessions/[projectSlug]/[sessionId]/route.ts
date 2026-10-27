import { NextResponse } from "next/server";
import { getSessionDetail } from "@/lib/search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ projectSlug: string; sessionId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { projectSlug, sessionId } = await params;
  const detail = getSessionDetail(
    decodeURIComponent(projectSlug),
    decodeURIComponent(sessionId),
  );
  if (!detail) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(detail);
}
