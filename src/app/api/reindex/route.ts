import { NextResponse } from "next/server";
import { requestReindex } from "@/lib/indexer/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const result = await requestReindex();
  return NextResponse.json(result);
}
