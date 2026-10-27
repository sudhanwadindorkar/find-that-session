import { NextResponse } from "next/server";
import { setArchived } from "@/lib/archive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ projectSlug: string; sessionId: string }> };

export async function POST(_req: Request, { params }: Params) {
  const { projectSlug, sessionId } = await params;
  const ok = setArchived(
    decodeURIComponent(projectSlug),
    decodeURIComponent(sessionId),
    true,
  );
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, archived: true });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { projectSlug, sessionId } = await params;
  const ok = setArchived(
    decodeURIComponent(projectSlug),
    decodeURIComponent(sessionId),
    false,
  );
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, archived: false });
}
