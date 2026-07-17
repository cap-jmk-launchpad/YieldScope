import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** Exchange Supabase email-confirmation (or OAuth) codes for a session. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/app";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/app";
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  const login = new URL("/login", origin);
  login.searchParams.set("error", "auth_callback");
  return NextResponse.redirect(login);
}
