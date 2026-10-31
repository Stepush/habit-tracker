import test from "node:test";
import assert from "node:assert/strict";
import { signToken, readToken } from "../src/lib/session-token";
import { sheetRows, parseSheet, revision } from "../src/lib/sheet-format";
import { memoryStorage } from "../src/lib/month-storage";
import { HABITS, emptyGrid } from "../src/lib/model";
import { parseMonth } from "../src/lib/backup";

const secret = "a".repeat(64);
const record = {
  ...parseMonth({
    version: 1,
    month: "2026-02",
    habits: HABITS.map((h) => ({ ...h })),
    grid: emptyGrid("2026-02"),
  }),
  savedAt: "2026-10-31T12:00:00.000Z",
};

test("session signatures reject tampering, expired tokens, wrong keys and malformed cookies", () => {
  const value = { kind: "session", sub: "123", exp: Date.now() / 1000 + 100 };
  const token = signToken(value, secret);
  assert.deepEqual(readToken(token, secret), value);
  assert.equal(readToken(token, "wrong"), null);
  assert.equal(
    readToken(
      `${Buffer.from(JSON.stringify({ ...value, sub: "456" })).toString("base64url")}.${token.split(".")[1]}`,
      secret,
    ),
    null,
  );
  assert.equal(
    readToken(signToken({ ...value, exp: 0 }, secret), secret),
    null,
  );
  for (const invalid of [
    undefined,
    "",
    "bad",
    "a.b.c",
    "a.!",
    "x".repeat(9000),
  ])
    assert.equal(readToken(invalid, secret), null);
});

test("sheet format round-trips short months, custom order, colors and formula-like literal names", () => {
  const next = structuredClone(record);
  next.habits[0].name = '=IMPORTXML("https://example.com")';
  next.grid[0][0] = "completed";
  const rows = sheetRows(next);
  assert.equal(rows.length, 11);
  assert.equal(rows[1][4], 1);
  assert.equal(rows[1][32], ""); // February has no day 29.
  assert.equal(rows[5][0], ""); // Old removed habits are cleared.
  assert.deepEqual(parseSheet(next.month, rows), next);
  assert.equal(revision(parseSheet(next.month, rows)), revision(next));
  assert.notEqual(revision(record), revision(next));
});

test("sheet reader rejects damaged marks, reordered headers, missing metadata and duplicate habit IDs", () => {
  const original = sheetRows(record);
  for (const damage of [
    (rows: (string | number)[][]) => {
      rows[1][4] = "";
    },
    (rows: (string | number)[][]) => {
      rows[0][0] = "renamed";
    },
    (rows: (string | number)[][]) => {
      rows[1][36] = "";
    },
    (rows: (string | number)[][]) => {
      rows[2][0] = rows[1][0];
    },
    (rows: (string | number)[][]) => {
      rows[1][35] = "wrong timestamp";
    },
  ]) {
    const rows = structuredClone(original);
    damage(rows);
    assert.throws(() => parseSheet(record.month, rows));
  }
});

test("in-memory cloud history never writes to browser local history", () => {
  const cloud = memoryStorage();
  const other = memoryStorage();
  cloud.setItem("month", "value");
  assert.equal(cloud.length, 1);
  assert.equal(cloud.key(0), "month");
  assert.equal(other.getItem("month"), null);
  cloud.removeItem("month");
  assert.equal(cloud.length, 0);
});
