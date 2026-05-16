/**
 * FT-F-012 extractEngineInput tests.
 *
 * Pins the round-trip contract: extracting the engine input from a
 * canonical receipt, feeding it back to runMazurStep, and re-emitting
 * must produce byte-identical output to the original golden file. This
 * is the "receipt is self-sufficient for replay" property — the same
 * input the receipt records is sufficient to reproduce the math.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { extractEngineInput } from "../src/extract.js";
import { runMazurStep } from "../src/engine.js";
import { emitMazurReceipt } from "../src/emit.js";
import type { MazurReceipt } from "../src/engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const goldenPath = resolve(__dirname, "../fixtures/mazur.golden.jsonl");

test("extractEngineInput round-trips through engine -> emit byte-equal to golden", () => {
  const goldenText = readFileSync(goldenPath, "utf-8");
  const goldenReceipt = JSON.parse(goldenText) as MazurReceipt;

  const input = extractEngineInput(goldenReceipt);
  // Sanity: extract preserves the canonical fields.
  assert.strictEqual(
    input.learning_rate,
    goldenReceipt.learning_rate,
    "extract preserves learning_rate",
  );
  assert.deepStrictEqual(
    input.inputs,
    goldenReceipt.inputs,
    "extract preserves inputs",
  );
  assert.deepStrictEqual(
    input.targets,
    goldenReceipt.targets,
    "extract preserves targets",
  );
  assert.deepStrictEqual(
    input.parameters_before,
    goldenReceipt.parameters_before,
    "extract preserves parameters_before",
  );

  // Round-trip: feed back to engine + emit.
  const reReceipt = runMazurStep(input);
  const reBytes = emitMazurReceipt(reReceipt);
  assert.strictEqual(
    reBytes,
    goldenText,
    "extract -> runMazurStep -> emitMazurReceipt must byte-equal the golden fixture (self-sufficient replay)",
  );
});
