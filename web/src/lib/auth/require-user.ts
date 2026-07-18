import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Fail-closed gate for sync/attest APIs.
 * Returns the authenticated user, or a 401 JSON response.
 */
export async function requireUser(): Promise<
  | { user: { id: string; email?: string }; error?: never }
  | { user?: never; error: NextResponse }
> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return {
      error: NextResponse.json(
        { error: "Sign-in isn’t available right now. Try again later." },
        { status: 401 },
      ),
    };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) {
      return {
        error: NextResponse.json(
          { error: "Sign in to sync or attest." },
          { status: 401 },
        ),
      };
    }
    return { user: { id: user.id, email: user.email } };
  } catch {
    return {
      error: NextResponse.json(
        { error: "Sign in to sync or attest." },
        { status: 401 },
      ),
    };
  }
}
