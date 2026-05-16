/**
 * FT-F-006 emitReceipts multi-record framing tests.
 *
 * Pins the trailing-LF-per-record contract:
 *   - emitReceipts([r1, r2, r3]) === r1bytes + r2bytes + r3bytes
 *     where each rNbytes already ends in LF (canonical-emission discipline
 *     from emitMazurReceipt).
 *   - emitReceipts([single]) === emitMazurReceipt(single)
 *     (single-record framing must stay byte-identical so legacy callers
 *     and the fixtures/mazur.golden.jsonl byte-equality contract are
 *     preserved).
 *   - emitReceipts([]) === ""
 *     (every record contributes one LF, zero records contribute zero LFs).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { emitMazurReceipt, emitReceipts } from "../src/emit.js";
import type { MazurReceipt } from "../src/engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const goldenPath = resolve(__dirname, "../fixtures/mazur.golden.jsonl");

function loadGolden(): MazurReceipt {
  return JSON.parse(readFileSync(goldenPath, "utf-8")) as MazurReceipt;
}

test("emitReceipts emits N records each terminated by LF", () => {
  const r = loadGolden();
  const out = emitReceipts([r, r, r]);
  const oneRecord = emitMazurReceipt(r);
  const expected = oneRecord + oneRecord + oneRecord;
  assert.strictEqual(
    out,
    expected,
    "three-record framing must be the concatenation of three single-record emissions",
  );
  // And each "record" ends with LF.
  const lfCount = (out.match(/\n/g) ?? []).length;
  assert.strictEqual(
    lfCount,
    3,
    `expected exactly 3 LF terminators for 3 records; got ${lfCount}`,
  );
});

test("emitReceipts([single]) byte-equals emitMazurReceipt(single)", () => {
  const r = loadGolden();
  assert.strictEqual(
    emitReceipts([r]),
    emitMazurReceipt(r),
    "single-record framing must be byte-identical to the legacy emitter (preserves byte-equal-vs-golden contract)",
  );
});

test('emitReceipts([]) === ""', () => {
  assert.strictEqual(
    emitReceipts([]),
    "",
    "empty input emits the empty string (zero records contribute zero LFs)",
  );
});
