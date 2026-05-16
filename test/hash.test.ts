/**
 * FT-F-003 hashReceipt tests.
 *
 * Pins the canonical-bytes digest contract that the attestation seam
 * (docs/attestation.md / in-toto v1) relies on:
 *
 *   - hashReceipt(receipt)        produces a 64-char lowercase hex string
 *                                  (sha256 default).
 *   - hashReceipt(text)           pre-canonicalized bytes hash directly.
 *   - hashReceipt(receipt) === hashReceipt(rawCanonicalText)  — the receipt
 *                                  re-emits to the same canonical bytes,
 *                                  so the digest matches the on-disk file.
 *   - Any field mutation changes the digest (collision sensitivity).
 *   - sha512 returns 128-char hex.
 *
 * The pinned hash is computed once over fixtures/mazur.golden.jsonl and
 * locked here. If the golden file changes (e.g. via a re-canonicalization
 * pass), this constant must be regenerated:
 *
 *   node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('fixtures/mazur.golden.jsonl')).digest('hex'))"
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { hashReceipt } from "../src/hash.js";
import type { MazurReceipt } from "../src/engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const goldenPath = resolve(__dirname, "../fixtures/mazur.golden.jsonl");

const GOLDEN_SHA256 =
  "e781a6d214acc29ec113f40664b2994fa3d50b4d60663115f7d7ac227954b71a";

function loadGoldenReceipt(): MazurReceipt {
  return JSON.parse(readFileSync(goldenPath, "utf-8")) as MazurReceipt;
}

test("hashReceipt produces stable 64-char sha256 hex on the golden", () => {
  const receipt = loadGoldenReceipt();
  const digest = hashReceipt(receipt);
  assert.strictEqual(digest.length, 64, "sha256 hex is 64 chars");
  assert.match(
    digest,
    /^[0-9a-f]{64}$/,
    `sha256 hex must be lowercase hex; got: ${digest}`,
  );
  assert.strictEqual(
    digest,
    GOLDEN_SHA256,
    `pinned golden sha256 must match; got: ${digest}.\n` +
      `If you re-canonicalized fixtures/mazur.golden.jsonl, update GOLDEN_SHA256 ` +
      `in this file via: node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('fixtures/mazur.golden.jsonl')).digest('hex'))"`,
  );
});

test("hashReceipt of raw canonical bytes matches hashReceipt of parsed receipt", () => {
  const rawText = readFileSync(goldenPath, "utf-8");
  const parsed = JSON.parse(rawText) as MazurReceipt;
  assert.strictEqual(
    hashReceipt(rawText),
    hashReceipt(parsed),
    "hashReceipt(rawText) must equal hashReceipt(parsed) since parsed re-emits to the same bytes",
  );
});

test("hashReceipt sensitivity: mutating any field changes the digest", () => {
  const original = loadGoldenReceipt();
  const originalDigest = hashReceipt(original);

  const mutated = loadGoldenReceipt();
  // Bump the first weight by a tiny amount — canonical-emission will
  // render different bytes, so the digest must change.
  mutated.parameters_after.w1 = mutated.parameters_after.w1 + 1e-9;
  const mutatedDigest = hashReceipt(mutated);
  assert.notStrictEqual(
    mutatedDigest,
    originalDigest,
    "digest must change when any field changes — receipts are byte-bound, not field-bound",
  );
});

test("hashReceipt with sha512 returns 128-char lowercase hex", () => {
  const receipt = loadGoldenReceipt();
  const digest = hashReceipt(receipt, "sha512");
  assert.strictEqual(digest.length, 128, "sha512 hex is 128 chars");
  assert.match(
    digest,
    /^[0-9a-f]{128}$/,
    `sha512 hex must be lowercase hex; got: ${digest}`,
  );
});
