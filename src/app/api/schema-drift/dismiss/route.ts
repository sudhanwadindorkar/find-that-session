import { NextResponse } from "next/server";
import { dismissSchemaDrift } from "@/lib/schema-drift";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  dismissSchemaDrift();
  return NextResponse.json({ ok: true });
}
