/**
 * FT-F-009 verifyEngineReproduces tests.
 *
 * Pins the engine-reproduces-receipt-byte-for-byte contract:
 *   - On the canonical golden: matches === true with bytes + digest populated.
 *   - On a mutated golden: matches === false with firstDifferingByte > 0.
 *   - With explicit MazurInput override: same result as the extract-from-receipt path.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { verifyEngineReproduces } from "../src/verify-engine.js";
import { MAZUR_INPUT } from "../src/mazur.js";
import type { MazurReceipt } from "../src/engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const goldenPath = resolve(__dirname, "../fixtures/mazur.golden.jsonl");

function loadGolden(): MazurReceipt {
  return JSON.parse(readFileSync(goldenPath, "utf-8")) as MazurReceipt;
}

test("verifyEngineReproduces matches on mazur.golden.jsonl", () => {
  const receipt = loadGolden();
  const result = verifyEngineReproduces(receipt);
  assert.strictEqual(
    result.matches,
    true,
    `golden must reproduce byte-for-byte; result: ${
      result.matches
        ? "matches"
        : `diverges at byte ${result.firstDifferingByte}`
    }`,
  );
  if (!result.matches) return;
  assert.ok(
    result.bytes.length > 0,
    "matches=true must carry the canonical bytes",
  );
  assert.match(
    result.digest,
    /^[0-9a-f]{64}$/,
    `matches=true must carry a 64-char hex digest; got: ${result.digest}`,
  );
});

test("verifyEngineReproduces detects mutation with firstDifferingByte > 0", () => {
  const receipt = loadGolden();
  // Mutate a recorded loss value — engine will recompute the original
  // value, the receipt has the mutated value, so emission diverges.
  receipt.loss.total = receipt.loss.total + 1e-9;
  const result = verifyEngineReproduces(receipt);
  assert.strictEqual(
    result.matches,
    false,
    "mutated receipt must NOT byte-equal the engine's re-emission",
  );
  if (result.matches) return;
  assert.ok(
    result.firstDifferingByte > 0,
    `firstDifferingByte must be > 0 (the receipts share the common prefix); got: ${result.firstDifferingByte}`,
  );
  assert.ok(
    result.ourBytes.length > 0 && result.theirBytes.length > 0,
    "both byte strings must be populated for the diff renderer",
  );
});

test("verifyEngineReproduces with explicit MazurInput override yields same result", () => {
  const receipt = loadGolden();
  const result = verifyEngineReproduces(receipt, MAZUR_INPUT);
  assert.strictEqual(
    result.matches,
    true,
    `golden + explicit MAZUR_INPUT must reproduce byte-for-byte; result: ${
      result.matches
        ? "matches"
        : `diverges at byte ${result.firstDifferingByte}`
    }`,
  );
});
