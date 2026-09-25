import { NextResponse, type NextRequest } from "next/server";

const AT = "mo_at";
const RT = "mo_rt";

function jwtExp(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return Number(payload.exp) || 0;
  } catch {
    return 0;
  }
}

/**
 * Proxy (ex-middleware): protege /panel y renueva el access token de Supabase
 * de forma transparente cuando está por expirar.
 */
export async function proxy(req: NextRequest) {
  const at = req.cookies.get(AT)?.value;
  const rt = req.cookies.get(RT)?.value;

  if (!at && !rt) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  const now = Math.floor(Date.now() / 1000);
  if ((!at || jwtExp(at) - now < 60) && rt) {
    try {
      const r = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
        {
          method: "POST",
          headers: {
            apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
            "content-type": "application/json",
          },
          body: JSON.stringify({ refresh_token: rt }),
        }
      );
      if (r.ok) {
        const s = await r.json();
        req.cookies.set(AT, s.access_token);
        req.cookies.set(RT, s.refresh_token);
        const res = NextResponse.next({ request: { headers: req.headers } });
        const opts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };
        res.cookies.set(AT, s.access_token, { ...opts, maxAge: 60 * 60 * 24 * 7 });
        res.cookies.set(RT, s.refresh_token, { ...opts, maxAge: 60 * 60 * 24 * 30 });
        return res;
      }
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      const res = NextResponse.redirect(url);
      res.cookies.delete(AT);
      res.cookies.delete(RT);
      return res;
    } catch {
      /* red caída: dejamos pasar y la página decidirá */
    }
  }
  return NextResponse.next();
}

export const config = { matcher: ["/panel/:path*"] };
