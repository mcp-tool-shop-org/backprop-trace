/**
 * EMS-1 / EMS-2 — emit must NEVER serialize the bare `undefined` token into
 * canonical bytes, and must NEVER throw a raw TypeError on a schema-valid-but-
 * thin receipt. Both holes share one root: emit dereferenced schema-OPTIONAL
 * fields unconditionally via the S() helper (S(undefined) → the literal token
 * "undefined") or dereferenced an absent optional nested object (→ raw
 * TypeError reading a property of undefined).
 *
 * The invariant pinned here is two-sided per fix:
 *
 *   EMS-1 (poisoned hash): a thin receipt (e.g. metadata:{}) must NOT emit
 *   bytes that fail JSON.parse. emit throws a typed EmitError instead; AND
 *   the honest golden still emits byte-identically (the guard fires only on
 *   thin/invalid receipts). Defense in depth: hashReceipt must NEVER return a
 *   digest of non-JSON bytes — if handed non-canonical raw bytes that fail
 *   JSON.parse it throws rather than poisoning the in-toto subject digest.
 *
 *   EMS-2 (raw TypeError): a receipt that omits an optional NESTED OBJECT
 *   (metadata absent entirely; numeric_policy.byte_output absent) must throw
 *   a typed EmitError naming the field path, not a raw TypeError; AND the
 *   honest golden still emits byte-identically.
 *
 * Both halves (reject the thin/tampered receipt AND keep the honest golden
 * byte-identical) are asserted so a future change cannot satisfy one by
 * breaking the other.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  emitMazurReceipt,
  emitGeneralReceipt,
  EmitError,
} from "../src/emit.js";
import { hashReceipt } from "../src/hash.js";
import type { MazurReceipt } from "../src/engine.js";
import type { GeneralReceipt } from "../src/general-engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mazurGoldenPath = resolve(__dirname, "../fixtures/mazur.golden.jsonl");
const xorGoldenPath = resolve(__dirname, "../fixtures/xor.golden.jsonl");

function loadMazurGolden(): MazurReceipt {
  return JSON.parse(readFileSync(mazurGoldenPath, "utf-8")) as MazurReceipt;
}
function loadXorGolden(): GeneralReceipt {
  return JSON.parse(readFileSync(xorGoldenPath, "utf-8")) as GeneralReceipt;
}

// ---------------------------------------------------------------------------
// EMS-1 — thin metadata (optional subfields absent) must NOT poison the bytes.
// ---------------------------------------------------------------------------

test("EMS-1: emitMazurReceipt throws EmitError (not poisoned bytes) when metadata.source is absent", () => {
  const r = structuredClone(loadMazurGolden());
  // metadata is NOT in the schema top-level required set, and source/
  // gradient_convention are optional subfields. A thin {} metadata previously
  // produced "metadata":{"source":undefined,...} — non-JSON bytes that
  // JSON.parse rejects but hashReceipt silently digested (poisoned subject).
  (r as unknown as { metadata: Record<string, unknown> }).metadata = {};

  let caught: unknown;
  let out: string | undefined;
  try {
    out = emitMazurReceipt(r);
  } catch (e) {
    caught = e;
  }
  assert.strictEqual(
    out,
    undefined,
    "emit must NOT return bytes for a thin receipt — it must throw",
  );
  assert.ok(
    caught instanceof EmitError,
    `thin metadata must surface as EmitError, got ${String(caught)}`,
  );
  assert.match(
    (caught as EmitError).message,
    /metadata\.source/,
    "EmitError must name the offending field path",
  );
});

test("EMS-1: emit never returns a string that fails JSON.parse for a thin receipt", () => {
  const r = structuredClone(loadMazurGolden());
  (r as unknown as { metadata: Record<string, unknown> }).metadata = {};
  // The contract: either throw, or return JSON-parseable bytes — never the
  // poisoned middle ground (returns a string containing the bare token).
  let out: string | undefined;
  try {
    out = emitMazurReceipt(r);
  } catch {
    // throwing is the correct behavior; nothing further to assert here.
    return;
  }
  // If it ever returns (it must not), the bytes must at least be valid JSON.
  assert.doesNotThrow(
    () => JSON.parse(out as string),
    "emit must never return a string that fails JSON.parse",
  );
});

test("EMS-1 defense-in-depth: hashReceipt throws rather than digest non-JSON bytes", () => {
  // The poisoned bytes that the pre-fix emit produced, passed directly to
  // hashReceipt's string/Buffer overload. hashReceipt must NEVER return a
  // digest over bytes that fail JSON.parse — that would poison the in-toto
  // subject digest. (This guards the raw-bytes overload independently of the
  // emit-object path; a non-canonical caller can still hand it bad bytes.)
  const poisoned = '{"source":undefined,"url_reference":"x"}\n';
  assert.throws(
    () => hashReceipt(poisoned),
    (e: unknown) => e instanceof EmitError || e instanceof Error,
    "hashReceipt must throw on non-JSON bytes, not return a digest",
  );
});

test("EMS-1: emitGeneralReceipt throws EmitError (not poisoned bytes) when metadata.source is absent", () => {
  const r = structuredClone(loadXorGolden());
  (r as unknown as { metadata: Record<string, unknown> }).metadata = {};
  let caught: unknown;
  let out: string | undefined;
  try {
    out = emitGeneralReceipt(r);
  } catch (e) {
    caught = e;
  }
  assert.strictEqual(out, undefined, "general emit must throw, not return poisoned bytes");
  assert.ok(
    caught instanceof EmitError,
    `thin metadata (general) must surface as EmitError, got ${String(caught)}`,
  );
  assert.match(
    (caught as EmitError).message,
    /metadata\.source/,
    "EmitError must name the offending field path",
  );
});

// ---------------------------------------------------------------------------
// EMS-2 — omitting an optional NESTED OBJECT must throw EmitError, not a raw
// TypeError ("Cannot read properties of undefined").
// ---------------------------------------------------------------------------

test("EMS-2: emitMazurReceipt throws EmitError (not TypeError) when metadata is absent entirely", () => {
  const r = structuredClone(loadMazurGolden());
  delete (r as unknown as { metadata?: unknown }).metadata;
  let caught: unknown;
  try {
    emitMazurReceipt(r);
  } catch (e) {
    caught = e;
  }
  assert.ok(
    caught instanceof EmitError,
    `absent metadata object must surface as EmitError, got ${caught instanceof Error ? caught.constructor.name : String(caught)}`,
  );
  assert.ok(
    !(caught instanceof TypeError),
    "must not be a raw TypeError",
  );
  assert.match((caught as EmitError).message, /metadata/, "must name the field path");
});

test("EMS-2: emitMazurReceipt throws EmitError (not TypeError) when numeric_policy.byte_output is absent", () => {
  const r = structuredClone(loadMazurGolden());
  delete (r as unknown as { numeric_policy: { byte_output?: unknown } }).numeric_policy.byte_output;
  let caught: unknown;
  try {
    emitMazurReceipt(r);
  } catch (e) {
    caught = e;
  }
  assert.ok(
    caught instanceof EmitError,
    `absent byte_output object must surface as EmitError, got ${caught instanceof Error ? caught.constructor.name : String(caught)}`,
  );
  assert.ok(!(caught instanceof TypeError), "must not be a raw TypeError");
  assert.match(
    (caught as EmitError).message,
    /byte_output/,
    "must name the field path",
  );
});

test("EMS-2: emitGeneralReceipt throws EmitError (not TypeError) when numeric_policy.byte_output is absent", () => {
  const r = structuredClone(loadXorGolden());
  delete (r as unknown as { numeric_policy: { byte_output?: unknown } }).numeric_policy.byte_output;
  let caught: unknown;
  try {
    emitGeneralReceipt(r);
  } catch (e) {
    caught = e;
  }
  assert.ok(
    caught instanceof EmitError,
    `absent byte_output object (general) must surface as EmitError, got ${caught instanceof Error ? caught.constructor.name : String(caught)}`,
  );
  assert.ok(!(caught instanceof TypeError), "must not be a raw TypeError");
});

// ---------------------------------------------------------------------------
// Negative controls — the honest goldens must STILL emit byte-identically and
// re-hash byte-identically. The guards must fire ONLY on thin/invalid
// receipts, never on valid ones.
// ---------------------------------------------------------------------------

test("EMS-1/2 negative control: honest Mazur golden still emits byte-identically", () => {
  const r = loadMazurGolden();
  const goldenBytes = readFileSync(mazurGoldenPath, "utf-8");
  assert.strictEqual(
    emitMazurReceipt(r),
    goldenBytes,
    "the guards must not perturb the honest golden's canonical bytes",
  );
});

test("EMS-1/2 negative control: honest General (xor) golden still emits byte-identically", () => {
  const r = loadXorGolden();
  const goldenBytes = readFileSync(xorGoldenPath, "utf-8");
  assert.strictEqual(
    emitGeneralReceipt(r),
    goldenBytes,
    "the guards must not perturb the honest general golden's canonical bytes",
  );
});

test("EMS-1 defense-in-depth negative control: hashReceipt over the honest golden is unchanged", () => {
  const r = loadMazurGolden();
  // Pinned in test/hash.test.ts; recomputing here proves the parseability
  // self-check does not alter the digest for valid receipts.
  const GOLDEN_SHA256 =
    "e781a6d214acc29ec113f40664b2994fa3d50b4d60663115f7d7ac227954b71a";
  assert.strictEqual(
    hashReceipt(r),
    GOLDEN_SHA256,
    "the hashReceipt parseability check must leave the honest digest byte-identical",
  );
});
