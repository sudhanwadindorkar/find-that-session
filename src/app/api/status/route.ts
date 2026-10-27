import { NextResponse } from "next/server";
import { getIndexStatus } from "@/lib/indexer/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getIndexStatus());
}
