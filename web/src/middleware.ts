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
    "/forgot-password",
    "/auth/reset-password",
    "/api/sync",
    "/api/sync/:path*",
    "/api/checkpoint",
    "/api/checkpoint/:path*",
    "/api/ledger",
    "/api/ledger/:path*",
    "/api/credentials",
    "/api/credentials/:path*",
  ],
};
