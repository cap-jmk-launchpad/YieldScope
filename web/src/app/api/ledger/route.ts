import { NextResponse } from "next/server";
import { snapshot } from "@/lib/sync";

export async function GET() {
  return NextResponse.json(snapshot());
}
