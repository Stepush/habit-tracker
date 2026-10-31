import { NextRequest, NextResponse } from "next/server";
import {
  cookieOptions,
  FLOW_COOKIE,
  SESSION_COOKIE,
  oauthClient,
  type Flow,
} from "@/lib/google-auth";
import { configuration, googleConfig } from "@/lib/google-config";
import { readToken, signToken } from "@/lib/session-token";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  if (!configuration().ready)
    return NextResponse.json(
      { error: "Google-вход не настроен." },
      { status: 503 },
    );
  const config = googleConfig();
  const flow = readToken<Flow>(
    request.cookies.get(FLOW_COOKIE)?.value,
    config.secret,
  );
  let response: NextResponse;
  try {
    const code = request.nextUrl.searchParams.get("code");
    if (
      !flow ||
      flow.kind !== "oauth" ||
      request.nextUrl.searchParams.get("state") !== flow.state ||
      !code ||
      request.nextUrl.searchParams.has("error")
    )
      throw new Error("Invalid flow");
    const client = oauthClient();
    const { tokens } = await client.getToken({
      code,
      codeVerifier: flow.verifier,
    });
    if (!tokens.id_token) throw new Error("Missing identity");
    const payload = (
      await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: config.clientId,
      })
    ).getPayload();
    if (
      !payload ||
      payload.nonce !== flow.nonce ||
      !payload.email_verified ||
      !payload.email
    )
      throw new Error("Invalid identity");
    if (payload.sub !== config.owner) {
      response = NextResponse.json(
        {
          error: "Этот аккаунт не имеет доступа к трекеру.",
          ...(config.owner === "0"
            ? {
                setup:
                  "Запишите этот ID в GOOGLE_OWNER_SUB в .env.local и перезапустите сервер.",
                googleSubject: payload.sub,
                email: payload.email,
              }
            : {}),
        },
        { status: 403 },
      );
    } else {
      response = NextResponse.redirect(config.origin);
      response.cookies.set(
        SESSION_COOKIE,
        signToken(
          {
            kind: "session",
            sub: payload.sub,
            email: payload.email,
            name: payload.name ?? payload.email,
            exp: Date.now() / 1000 + 7 * 86400,
          },
          config.secret,
        ),
        cookieOptions(7 * 86400),
      );
    }
  } catch {
    response = NextResponse.redirect(`${config.origin}/?login=failed`);
  }
  response.cookies.set(FLOW_COOKIE, "", cookieOptions(0));
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
