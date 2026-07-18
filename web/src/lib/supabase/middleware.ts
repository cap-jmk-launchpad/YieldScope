import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    // Fail closed when auth is not configured
    if (isApiProtected(request.nextUrl.pathname)) {
      return NextResponse.json(
        { error: "Sign-in isn’t available right now. Try again later." },
        { status: 401 },
      );
    }
    if (isProtectedPath(request.nextUrl.pathname)) {
      const login = request.nextUrl.clone();
      login.pathname = "/login";
      login.searchParams.set("error", "auth_unconfigured");
      login.searchParams.set("next", request.nextUrl.pathname);
      return NextResponse.redirect(login);
    }
    return supabaseResponse;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        supabaseResponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && isApiProtected(request.nextUrl.pathname)) {
    return NextResponse.json(
      { error: "Sign in to sync or attest." },
      { status: 401 },
    );
  }

  if (!user && isProtectedPath(request.nextUrl.pathname)) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }

  if (user && isAuthPage(request.nextUrl.pathname)) {
    const app = request.nextUrl.clone();
    app.pathname = "/app";
    app.search = "";
    return NextResponse.redirect(app);
  }

  return supabaseResponse;
}

function isProtectedPath(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/");
}

function isApiProtected(pathname: string): boolean {
  return (
    pathname.startsWith("/api/sync") ||
    pathname.startsWith("/api/checkpoint") ||
    pathname.startsWith("/api/ledger") ||
    pathname.startsWith("/api/credentials")
  );
}

function isAuthPage(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/forgot-password"
  );
}
