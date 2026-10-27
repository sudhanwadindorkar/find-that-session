import { NextRequest, NextResponse } from "next/server";
import { setArchivedBulk, type SessionRef } from "@/lib/archive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const obj = body as { sessions?: unknown; archived?: unknown };
  if (typeof obj.archived !== "boolean" || !Array.isArray(obj.sessions)) {
    return NextResponse.json(
      { error: "sessions[] and archived boolean required" },
      { status: 400 },
    );
  }
  const sessions: SessionRef[] = [];
  for (const item of obj.sessions) {
    if (!item || typeof item !== "object") continue;
    const s = item as { projectSlug?: unknown; sessionId?: unknown };
    if (typeof s.projectSlug === "string" && typeof s.sessionId === "string") {
      sessions.push({ projectSlug: s.projectSlug, sessionId: s.sessionId });
    }
  }
  if (sessions.length === 0) {
    return NextResponse.json({ error: "no valid sessions" }, { status: 400 });
  }
  const result = setArchivedBulk(sessions, obj.archived);
  return NextResponse.json({ ok: true, archived: obj.archived, ...result });
}
