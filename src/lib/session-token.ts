import { createHmac, timingSafeEqual } from "node:crypto";

export function signToken(value: object, secret: string): string {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

export function readToken<T extends { exp: number }>(
  token: string | undefined,
  secret: string,
): T | null {
  if (!token || token.length > 8192) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const expected = createHmac("sha256", secret).update(parts[0]).digest();
  const actual = Buffer.from(parts[1], "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return null;
  try {
    const value = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    return value &&
      typeof value.exp === "number" &&
      value.exp > Date.now() / 1000
      ? value
      : null;
  } catch {
    return null;
  }
}
