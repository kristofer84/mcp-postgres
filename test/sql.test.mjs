import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeQuery,
  quoteIdent,
  sanitizeType,
  sanitizeDefault,
  assertSingleSelect,
  requireString,
  requireObject,
  optionalObject,
  clampLimit,
} from "../src/sql.mjs";
import { buildSslConfig, isAwsRdsEndpoint } from "../src/ssl.mjs";
import { TOOL_DEFINITIONS, TOOL_HANDLERS, WRITE_TOOLS, listTools } from "../src/tools/index.mjs";

test("normalizeQuery strips comments, whitespace, and case", () => {
  assert.equal(normalizeQuery("  SELECT 1  "), "select 1");
  assert.equal(normalizeQuery("SELECT 1 -- trailing comment"), "select 1");
  assert.equal(normalizeQuery("SELECT 1 /* block */ FROM t"), "select 1  from t");
});

test("quoteIdent wraps and escapes identifiers", () => {
  assert.equal(quoteIdent("users"), '"users"');
  assert.equal(quoteIdent('a"b'), '"a""b"');
  assert.equal(quoteIdent('x"; DROP TABLE y; --'), '"x""; DROP TABLE y; --"');
});

test("quoteIdent neutralizes an injection attempt", () => {
  const quoted = quoteIdent('t"; DROP TABLE users; --');
  // The only unescaped quotes are the wrapping pair at the ends
  assert.equal((quoted.match(/(?<!")"(?!")/g) || []).length, 2);
  assert.ok(quoted.startsWith('"') && quoted.endsWith('"'));
});

test("sanitizeType accepts valid types and rejects injection", () => {
  assert.equal(sanitizeType("INTEGER"), "INTEGER");
  assert.equal(sanitizeType("VARCHAR(100)"), "VARCHAR(100)");
  assert.equal(sanitizeType("DECIMAL(10,2)"), "DECIMAL(10,2)");
  assert.equal(sanitizeType("TEXT[]"), "TEXT[]");
  assert.throws(() => sanitizeType("INTEGER; DROP TABLE x"), /Invalid column type/);
  assert.throws(() => sanitizeType('VARCHAR(10)"'), /Invalid column type/);
});

test("sanitizeDefault blocks terminators and comment sequences", () => {
  assert.equal(sanitizeDefault("CURRENT_TIMESTAMP"), "CURRENT_TIMESTAMP");
  assert.equal(sanitizeDefault("0"), "0");
  assert.throws(() => sanitizeDefault("0; DROP TABLE x"), /Invalid default value/);
  assert.throws(() => sanitizeDefault("1 -- x"), /Invalid default value/);
  assert.throws(() => sanitizeDefault("/* x */"), /Invalid default value/);
});

test("assertSingleSelect allows a single select", () => {
  assert.doesNotThrow(() => assertSingleSelect("SELECT * FROM users"));
  assert.doesNotThrow(() => assertSingleSelect("select count(*) from t"));
});

test("assertSingleSelect allows semicolons inside string literals", () => {
  assert.doesNotThrow(() => assertSingleSelect("SELECT 'a;b' AS val"));
  assert.doesNotThrow(() => assertSingleSelect("SELECT 'it''s; fine' AS val"));
});

test("assertSingleSelect rejects non-select queries", () => {
  assert.throws(() => assertSingleSelect("DELETE FROM users"), /Only SELECT queries/);
  assert.throws(() => assertSingleSelect("  /* c */ UPDATE t SET a=1"), /Only SELECT queries/);
});

test("assertSingleSelect rejects multi-statement queries", () => {
  assert.throws(() => assertSingleSelect("SELECT 1; DROP TABLE users"), /Multi-statement/);
  assert.throws(() => assertSingleSelect("SELECT 1 /* x */; SELECT 2"), /Multi-statement/);
});

test("requireString enforces non-empty strings", () => {
  assert.equal(requireString("a", "field"), "a");
  assert.throws(() => requireString("", "field"), /field must be a non-empty string/);
  assert.throws(() => requireString("   ", "field"), /field must be a non-empty string/);
  assert.throws(() => requireString(5, "field"), /field must be a non-empty string/);
  assert.throws(() => requireString(null, "field"), /field must be a non-empty string/);
});

test("requireObject enforces non-empty plain objects", () => {
  assert.deepEqual(requireObject({ a: 1 }, "field"), { a: 1 });
  assert.throws(() => requireObject({}, "field"), /field must be a non-empty object/);
  assert.throws(() => requireObject([1], "field"), /field must be a non-empty object/);
  assert.throws(() => requireObject("x", "field"), /field must be a non-empty object/);
  assert.throws(() => requireObject(null, "field"), /field must be a non-empty object/);
});

test("optionalObject allows undefined but rejects non-objects", () => {
  assert.equal(optionalObject(undefined, "field"), undefined);
  assert.equal(optionalObject(null, "field"), undefined);
  assert.deepEqual(optionalObject({}, "field"), {});
  assert.throws(() => optionalObject("x", "field"), /field must be an object/);
  assert.throws(() => optionalObject([1], "field"), /field must be an object/);
});

test("clampLimit clamps to the valid range", () => {
  assert.equal(clampLimit(undefined, 10, 100), 10);
  assert.equal(clampLimit(-5, 10, 100), 10);
  assert.equal(clampLimit(0, 10, 100), 10);
  assert.equal(clampLimit(5, 10, 100), 5);
  assert.equal(clampLimit(500, 10, 100), 100);
  assert.equal(clampLimit("20", 10, 100), 20);
  assert.equal(clampLimit(Number.NaN, 10, 100), 10);
  assert.equal(clampLimit(3.9, 10, 100), 3);
});

test("isAwsRdsEndpoint detects RDS hostnames", () => {
  assert.ok(isAwsRdsEndpoint("db.cluster.rds.amazonaws.com"));
  assert.ok(!isAwsRdsEndpoint("localhost"));
  assert.ok(!isAwsRdsEndpoint(undefined));
});

test("buildSslConfig handles explicit modes without network access", async () => {
  assert.deepEqual(await buildSslConfig("require", "any.host"), { rejectUnauthorized: true });
  assert.equal(await buildSslConfig("disable", "any.host"), false);
  assert.equal(await buildSslConfig("prefer", "any.host"), true);
  assert.equal(await buildSslConfig(undefined, "localhost"), undefined);
  assert.equal(await buildSslConfig(null, "localhost"), undefined);
});

test("every tool definition has a registered handler", () => {
  for (const tool of TOOL_DEFINITIONS) {
    assert.equal(typeof TOOL_HANDLERS[tool.name], "function", `no handler for ${tool.name}`);
  }
});

test("every handler maps to a tool definition", () => {
  const names = new Set(TOOL_DEFINITIONS.map((t) => t.name));
  for (const name of Object.keys(TOOL_HANDLERS)) {
    assert.ok(names.has(name), `${name} has a handler but no tool definition`);
  }
});

test("every write tool is a known tool", () => {
  const names = new Set(TOOL_DEFINITIONS.map((t) => t.name));
  for (const name of WRITE_TOOLS) {
    assert.ok(names.has(name), `${name} is in WRITE_TOOLS but not in TOOL_DEFINITIONS`);
  }
});

test("listTools returns the full set when not in read-only mode", () => {
  assert.equal(listTools().length, TOOL_DEFINITIONS.length);
});
