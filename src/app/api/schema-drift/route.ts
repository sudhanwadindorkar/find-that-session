import { NextRequest, NextResponse } from "next/server";
import { saveSchemaDrift } from "@/lib/schema-drift";
import type { SchemaDriftReport } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return null;
  return value.map((item) => item.slice(0, 200)).slice(0, 50);
}

function count(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

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
  const obj = body as Record<string, unknown>;
  const versions = stringList(obj.versions);
  const unknownTypes = stringList(obj.unknown_types);
  const contentMismatchCount = count(obj.content_mismatch_count);
  const messageEventCount = count(obj.message_event_count);
  const titleMismatchCount = count(obj.title_mismatch_count);
  const sampleCount = count(obj.sample_count);
  if (
    typeof obj.fingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(obj.fingerprint) ||
    typeof obj.schema_id !== "string" ||
    !obj.schema_id.trim() ||
    typeof obj.summary !== "string" ||
    !obj.summary.trim() ||
    !versions ||
    !unknownTypes ||
    contentMismatchCount === null ||
    messageEventCount === null ||
    titleMismatchCount === null ||
    sampleCount === null
  ) {
    return NextResponse.json({ error: "Invalid schema drift report" }, { status: 400 });
  }

  const report: SchemaDriftReport = {
    fingerprint: obj.fingerprint,
    versions,
    schema_id: obj.schema_id.slice(0, 120),
    unknown_types: unknownTypes,
    content_mismatch_count: contentMismatchCount,
    message_event_count: messageEventCount,
    title_mismatch_count: titleMismatchCount,
    sample_count: sampleCount,
    summary: obj.summary.trim().slice(0, 500),
    reported_at: new Date().toISOString(),
  };
  saveSchemaDrift(report);
  return NextResponse.json({ ok: true });
}
