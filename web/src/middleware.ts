import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/app",
    "/app/:path*",
    "/login",
    "/register",
    "/api/sync",
    "/api/sync/:path*",
    "/api/checkpoint",
    "/api/checkpoint/:path*",
    "/api/ledger",
    "/api/ledger/:path*",
  ],
};
