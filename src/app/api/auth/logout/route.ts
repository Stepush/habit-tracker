import { NextResponse } from "next/server";
import { configuration, googleConfig } from "@/lib/google-config";
import { cookieOptions, SESSION_COOKIE, sameOrigin } from "@/lib/google-auth";

export async function POST(request: Request) {
  if (!configuration().ready)
    return Response.json({ error: "Недоступно" }, { status: 503 });
  if (!sameOrigin(request))
    return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  const response = NextResponse.redirect(googleConfig().origin, 303);
  response.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
