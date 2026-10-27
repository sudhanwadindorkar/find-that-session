import { NextResponse } from "next/server";
import { setFavorite } from "@/lib/search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ projectSlug: string; sessionId: string }> };

export async function POST(_req: Request, { params }: Params) {
  const { projectSlug, sessionId } = await params;
  const ok = setFavorite(
    decodeURIComponent(projectSlug),
    decodeURIComponent(sessionId),
    true,
  );
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, favorite: true });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { projectSlug, sessionId } = await params;
  const ok = setFavorite(
    decodeURIComponent(projectSlug),
    decodeURIComponent(sessionId),
    false,
  );
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, favorite: false });
}
