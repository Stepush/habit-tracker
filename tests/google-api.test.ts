import test from "node:test";
import assert from "node:assert/strict";
import { JWT, OAuth2Client } from "google-auth-library";
import { NextRequest } from "next/server";
import {
  loadMonths,
  saveMonths,
  ConflictError,
} from "../src/lib/google-sheets";
import { configuration } from "../src/lib/google-config";
import {
  sameOrigin,
  FLOW_COOKIE,
  SESSION_COOKIE,
} from "../src/lib/google-auth";
import { signToken, readToken } from "../src/lib/session-token";
import { GET as callback } from "../src/app/api/auth/callback/route";
import {
  GET as getMonths,
  POST as postMonths,
} from "../src/app/api/months/route";
import { parseMonth } from "../src/lib/backup";
import { HABITS, emptyGrid } from "../src/lib/model";
import { sheetRows, revision } from "../src/lib/sheet-format";

const config = {
  NODE_ENV: "test",
  APP_URL: "http://127.0.0.1:3000",
  SESSION_SECRET: "a".repeat(64),
  GOOGLE_CLIENT_ID: "client",
  GOOGLE_CLIENT_SECRET: "secret",
  GOOGLE_OWNER_SUB: "123",
  GOOGLE_SERVICE_ACCOUNT_EMAIL: "fake@example.test",
  GOOGLE_PRIVATE_KEY: "not-a-real-key",
  GOOGLE_SPREADSHEET_ID: "test-sheet",
};
async function withConfig(run: () => Promise<void>) {
  const before = Object.fromEntries(
    Object.keys(config).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, config);
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
const record = {
  ...parseMonth({
    version: 1,
    month: "2026-10",
    habits: HABITS.map((h) => ({ ...h })),
    grid: emptyGrid("2026-10"),
  }),
  savedAt: "2026-10-31T12:00:00.000Z",
};

test("production fails closed without Google configuration; API refuses access", async () => {
  await withConfig(async () => {
    for (const key of Object.keys(config))
      if (key !== "NODE_ENV") delete process.env[key];
    Object.assign(process.env, { NODE_ENV: "production" });
    assert.equal(configuration().local, false);
    assert.equal(configuration().ready, false);
    assert.equal((await getMonths()).status, 401);
    assert.equal(
      (
        await postMonths(
          new Request("https://example.test/api/months", { method: "POST" }),
        )
      ).status,
      401,
    );
  });
});

test("writes require the configured exact origin", async () => {
  await withConfig(async () => {
    assert.equal(
      sameOrigin(
        new Request(config.APP_URL, { headers: { Origin: config.APP_URL } }),
      ),
      true,
    );
    for (const origin of [
      "https://attacker.test",
      "null",
      "http://localhost:3000",
    ])
      assert.equal(
        sameOrigin(
          new Request(config.APP_URL, { headers: { Origin: origin } }),
        ),
        false,
      );
    assert.equal(sameOrigin(new Request(config.APP_URL)), false);
  });
});

test("OAuth rejects state/nonce errors and foreign owners; creates session only for verified owner", async (t) => {
  await withConfig(async () => {
    let calls = 0;
    const exchange = t.mock.method(
      OAuth2Client.prototype,
      "getToken",
      async () => {
        calls++;
        return { tokens: { id_token: "fake" } };
      },
    );
    const payload = {
      sub: config.GOOGLE_OWNER_SUB,
      aud: config.GOOGLE_CLIENT_ID,
      iss: "https://accounts.google.com",
      iat: 1,
      exp: Date.now() / 1000 + 100,
      email: "owner@example.test",
      email_verified: true,
      name: "Owner",
      nonce: "nonce",
    };
    const verify = t.mock.method(
      OAuth2Client.prototype,
      "verifyIdToken",
      async () => ({ getPayload: () => payload }),
    );
    const flow = signToken(
      {
        kind: "oauth",
        state: "state",
        nonce: "nonce",
        verifier: "verifier",
        exp: Date.now() / 1000 + 600,
      },
      config.SESSION_SECRET,
    );
    function request(state = "state") {
      return new NextRequest(
        `${config.APP_URL}/api/auth/callback?state=${state}&code=code`,
        { headers: { Cookie: `${FLOW_COOKIE}=${flow}` } },
      );
    }
    try {
      const badState = await callback(request("wrong"));
      assert.equal(calls, 0);
      assert.equal(badState.cookies.has(SESSION_COOKIE), false);
      assert.match(badState.headers.get("location")!, /login=failed/);
      payload.nonce = "wrong";
      assert.equal(
        (await callback(request())).cookies.has(SESSION_COOKIE),
        false,
      );
      payload.nonce = "nonce";
      payload.email_verified = false;
      assert.equal(
        (await callback(request())).cookies.has(SESSION_COOKIE),
        false,
      );
      payload.email_verified = true;
      payload.sub = "456";
      const denied = await callback(request());
      assert.equal(denied.status, 403);
      assert.equal(denied.cookies.has(SESSION_COOKIE), false);
      payload.sub = config.GOOGLE_OWNER_SUB;
      const allowed = await callback(request());
      assert.equal(allowed.headers.get("location"), `${config.APP_URL}/`);
      assert.equal(
        readToken<{ sub: string; exp: number }>(
          allowed.cookies.get(SESSION_COOKIE)?.value,
          config.SESSION_SECRET,
        )?.sub,
        config.GOOGLE_OWNER_SUB,
      );
      assert.equal(allowed.cookies.get(FLOW_COOKIE)?.maxAge, 0);
    } finally {
      exchange.mock.restore();
      verify.mock.restore();
    }
  });
});

test("Sheets save creates tab and updates all rows in a single batch; stale writes do not mutate", async (t) => {
  await withConfig(async () => {
    const credentials = t.mock.method(
      JWT.prototype,
      "getAccessToken",
      async () => ({ token: "fake" }),
    );
    const writes: unknown[] = [];
    let existing = false;
    const network = t.mock.method(
      globalThis,
      "fetch",
      async (url: string | URL | Request, options?: RequestInit) => {
        const address = String(url);
        if (options?.method === "POST") {
          writes.push(JSON.parse(String(options.body)));
          return Response.json({});
        }
        if (address.includes("/values:batchGet"))
          return Response.json({
            valueRanges: [{ values: sheetRows(record) }],
          });
        return Response.json({
          sheets: existing
            ? [{ properties: { sheetId: 202610, title: "2026-10" } }]
            : [],
        });
      },
    );
    try {
      const saved = await saveMonths([record], { "2026-10": null });
      assert.equal(saved.records.length, 1);
      assert.equal(writes.length, 1);
      const batch = writes[0] as {
        requests: {
          addSheet?: unknown;
          updateCells?: { rows: { values: { userEnteredValue: object }[] }[] };
        }[];
      };
      assert.equal(batch.requests.length, 2);
      assert.ok(batch.requests[0].addSheet);
      assert.equal(batch.requests[1].updateCells?.rows.length, 11);
      assert.deepEqual(
        batch.requests[1].updateCells?.rows[1].values[1].userEnteredValue,
        { stringValue: record.habits[0].name },
      );
      existing = true;
      const loaded = await loadMonths();
      assert.deepEqual(loaded.records[record.month], record);
      await assert.rejects(
        saveMonths([record], { "2026-10": null }),
        ConflictError,
      );
      assert.equal(writes.length, 1);
      await saveMonths([record], { "2026-10": revision(record) });
      assert.equal(writes.length, 2);
      assert.equal((writes[1] as { requests: unknown[] }).requests.length, 1);
    } finally {
      credentials.mock.restore();
      network.mock.restore();
    }
  });
});
