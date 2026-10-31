import { cookies } from "next/headers";
import { OAuth2Client } from "google-auth-library";
import { googleConfig, configuration } from "./google-config";
import { readToken } from "./session-token";

export const SESSION_COOKIE = "ritm_session";
export const FLOW_COOKIE = "ritm_oauth";
export type Session = {
  sub: string;
  email: string;
  name: string;
  exp: number;
  kind: "session";
};
export type Flow = {
  state: string;
  verifier: string;
  nonce: string;
  exp: number;
  kind: "oauth";
};
export function oauthClient() {
  const config = googleConfig();
  return new OAuth2Client(
    config.clientId,
    config.clientSecret,
    `${config.origin}/api/auth/callback`,
  );
}
export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: googleConfig().origin.startsWith("https:"),
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
export async function session(): Promise<Session | null> {
  if (!configuration().ready) return null;
  const config = googleConfig();
  const value = readToken<Session>(
    (await cookies()).get(SESSION_COOKIE)?.value,
    config.secret,
  );
  return value?.kind === "session" &&
    value.sub === config.owner &&
    typeof value.email === "string" &&
    typeof value.name === "string"
    ? value
    : null;
}
export function sameOrigin(request: Request) {
  return request.headers.get("origin") === googleConfig().origin;
}
