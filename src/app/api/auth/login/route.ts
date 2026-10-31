import { randomBytes, createHash } from "node:crypto";
import { CodeChallengeMethod } from "google-auth-library";
import { NextResponse } from "next/server";
import { cookieOptions, FLOW_COOKIE, oauthClient } from "@/lib/google-auth";
import { configuration, googleConfig } from "@/lib/google-config";
import { signToken } from "@/lib/session-token";

export const runtime = "nodejs";
export async function GET() {
  if (!configuration().ready)
    return Response.json(
      { error: "Сначала настройте Google-вход." },
      { status: 503 },
    );
  const config = googleConfig();
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const url = oauthClient().generateAuthUrl({
    scope: ["openid", "email", "profile"],
    state,
    nonce,
    prompt: "select_account",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: CodeChallengeMethod.S256,
  });
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(
    FLOW_COOKIE,
    signToken(
      { kind: "oauth", state, nonce, verifier, exp: Date.now() / 1000 + 600 },
      config.secret,
    ),
    cookieOptions(600),
  );
  return response;
}
