const REQUIRED = [
  "APP_URL",
  "SESSION_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_OWNER_SUB",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_PRIVATE_KEY",
  "GOOGLE_SPREADSHEET_ID",
] as const;

export function configuration() {
  const missing = REQUIRED.filter((key) => !process.env[key]?.trim());
  const requested = REQUIRED.some((key) => Boolean(process.env[key]));
  const local = !requested && process.env.NODE_ENV !== "production";
  let valid = missing.length === 0;
  if (valid) {
    try {
      const url = new URL(process.env.APP_URL!);
      valid =
        url.origin === process.env.APP_URL &&
        (url.protocol === "https:" ||
          (process.env.NODE_ENV !== "production" &&
            url.protocol === "http:" &&
            ["127.0.0.1", "localhost"].includes(url.hostname))) &&
        process.env.SESSION_SECRET!.length >= 32 &&
        /^\d+$/.test(process.env.GOOGLE_OWNER_SUB!) &&
        /^[\w-]+$/.test(process.env.GOOGLE_SPREADSHEET_ID!);
    } catch {
      valid = false;
    }
  }
  return { local, ready: valid, missing };
}

export function googleConfig() {
  if (!configuration().ready)
    throw new Error("Google integration is not configured");
  return {
    origin: process.env.APP_URL!,
    secret: process.env.SESSION_SECRET!,
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    owner: process.env.GOOGLE_OWNER_SUB!,
    serviceEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!,
    privateKey: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID!,
  };
}
