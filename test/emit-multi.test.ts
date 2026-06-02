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
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  emitMazurReceipt,
  emitReceipts,
  emitGeneralReceipt,
  EmitError,
} from "../src/emit.js";
import { FormatPolicyError } from "../src/format.js";
import type { MazurReceipt } from "../src/engine.js";
import type { GeneralReceipt } from "../src/general-engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const goldenPath = resolve(__dirname, "../fixtures/mazur.golden.jsonl");
const xorGoldenPath = resolve(__dirname, "../fixtures/xor.golden.jsonl");

function loadGolden(): MazurReceipt {
  return JSON.parse(readFileSync(goldenPath, "utf-8")) as MazurReceipt;
}

// xor.golden.jsonl is a v0.2.0 GeneralReceipt — the canonical fixture for
// exercising the emitGeneralReceipt path. It is engine-authored + committed,
// so loading it unconditionally is correct (no existsSync skip-guard: the
// byte-equal contract requires this file to exist). The existsSync import is
// retained only for the one G-022 general-path test below, where a missing
// fixture is a genuine repo-integrity failure we assert against rather than
// silently skip.
function loadXorGolden(): GeneralReceipt {
  return JSON.parse(readFileSync(xorGoldenPath, "utf-8")) as GeneralReceipt;
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

// =============================================================================
// G-022: bare-interpolation integer fields are finiteness/integer-guarded.
//
// Before this fix the integer fields (step, precision_significant_digits,
// topology *_size, step_index, batch.size, optimizer_config.t) were
// interpolated as `${r.step}` etc. A non-integer or non-finite value (NaN,
// Infinity, 1.5) would stringify to "NaN" / "Infinity" / "1.5" and emit
// MALFORMED bytes — "NaN"/"Infinity" are not valid JSON tokens, and a
// fractional value violates the schema's `type: integer`. The guard converts
// each such value into a throw at emit time instead of producing a corrupt
// receipt. This is the byte-determinism analogue of formatNumberForEngine's
// finiteness reject: a malformed receipt must FAIL LOUDLY, never serialize.
// =============================================================================

test("G-022: emitMazurReceipt throws on non-integer step (no malformed bytes)", () => {
  const r = loadGolden();
  // Force a fractional step. MazurReceipt types step as the literal 1, so
  // a structuredClone + cast is required to inject the malformed value the
  // way a hand-authored / transcoded receipt could.
  const bad = structuredClone(r) as unknown as { step: number };
  bad.step = 1.5;
  assert.throws(
    () => emitMazurReceipt(bad as unknown as MazurReceipt),
    /step|integer/i,
    "fractional step must throw at emit, not emit '1.5' into a type:integer field",
  );
});

test("G-022: emitMazurReceipt throws on non-finite step (NaN)", () => {
  const r = loadGolden();
  const bad = structuredClone(r) as unknown as { step: number };
  bad.step = NaN;
  assert.throws(
    () => emitMazurReceipt(bad as unknown as MazurReceipt),
    /step|integer|finite/i,
    "NaN step must throw at emit, not emit the non-JSON token 'NaN'",
  );
});

test("G-022: emitMazurReceipt throws on non-integer precision_significant_digits", () => {
  const r = loadGolden();
  const bad = structuredClone(r);
  (bad.numeric_policy as unknown as { precision_significant_digits: number }).precision_significant_digits = 9.5;
  assert.throws(
    () => emitMazurReceipt(bad),
    /precision_significant_digits|integer/i,
    "fractional precision_significant_digits must throw at emit",
  );
});

test("G-022: emitMazurReceipt throws on non-integer topology input_size", () => {
  const r = loadGolden();
  const bad = structuredClone(r);
  (bad.topology as unknown as { input_size: number }).input_size = Infinity;
  assert.throws(
    () => emitMazurReceipt(bad),
    /input_size|integer|finite/i,
    "non-finite topology input_size must throw at emit, not emit 'Infinity'",
  );
});

test("G-022: emitGeneralReceipt throws on non-integer step (general path)", () => {
  assert.ok(
    existsSync(xorGoldenPath),
    `xor.golden.jsonl must exist at ${xorGoldenPath} — it is a committed, engine-authored byte-equal fixture; a missing file is a repo-integrity failure, not a skip condition`,
  );
  const r = loadXorGolden();
  const bad = structuredClone(r) as unknown as { step: number };
  bad.step = 2.5;
  assert.throws(
    () => emitGeneralReceipt(bad as unknown as GeneralReceipt),
    /step|integer/i,
    "fractional step must throw in the general emit path too",
  );
});

test("G-022: emitGeneralReceipt throws on non-integer step_index when present", () => {
  const r = loadXorGolden();
  // Inject a step_index (single-step xor golden omits it) with a fractional
  // value. The guard must fire on the optional field exactly when present.
  const bad = structuredClone(r) as unknown as { step_index: number };
  bad.step_index = 0.5;
  assert.throws(
    () => emitGeneralReceipt(bad as unknown as GeneralReceipt),
    /step_index|integer/i,
    "fractional step_index (when present) must throw in the general emit path",
  );
});

// =============================================================================
// G-043: a schema-valid receipt whose data leaf has a magnitude outside the
// formatter's plain-decimal range [1e-13, 1e7) must surface a CLEAR TYPED
// error at emit time, not an unannotated raw FormatPolicyError that callers
// have to sniff. emitMazurReceipt / emitGeneralReceipt catch FormatPolicyError
// from the number formatter and re-surface it as EmitError with a field-path
// hint and the underlying cause preserved.
// =============================================================================

test("G-043: emitMazurReceipt re-surfaces out-of-range data leaf as EmitError", () => {
  const r = loadGolden();
  const bad = structuredClone(r);
  // learning_rate routes through the number formatter; 1e9 is far above the
  // 1e7 ceiling. This is a schema-valid number (the schema does not cap
  // magnitude) but out of the formatter's plain-decimal scope.
  (bad as unknown as { learning_rate: number }).learning_rate = 1e9;
  let caught: unknown;
  try {
    emitMazurReceipt(bad);
  } catch (e) {
    caught = e;
  }
  assert.ok(
    caught instanceof EmitError,
    `out-of-range data leaf must surface as EmitError, got ${String(caught)}`,
  );
  assert.ok(
    (caught as EmitError).cause instanceof FormatPolicyError,
    "EmitError must preserve the underlying FormatPolicyError as its cause",
  );
  assert.match(
    (caught as EmitError).message,
    /plain-decimal|magnitude|range|out.of.scope/i,
    "EmitError message must explain the magnitude/range problem",
  );
});

test("G-043: emitGeneralReceipt re-surfaces out-of-range data leaf as EmitError", () => {
  const r = loadXorGolden();
  const bad = structuredClone(r);
  (bad as unknown as { learning_rate: number }).learning_rate = 1e9;
  let caught: unknown;
  try {
    emitGeneralReceipt(bad);
  } catch (e) {
    caught = e;
  }
  assert.ok(
    caught instanceof EmitError,
    `out-of-range data leaf must surface as EmitError in the general path, got ${String(caught)}`,
  );
  assert.ok(
    (caught as EmitError).cause instanceof FormatPolicyError,
    "EmitError must preserve the underlying FormatPolicyError as its cause",
  );
});

// G-043 negative control: a clean golden must NOT throw — the catch path is
// strictly additive and must not perturb the happy path / byte output.
test("G-043: clean golden still emits byte-identically (catch path is additive)", () => {
  const r = loadGolden();
  const goldenBytes = readFileSync(goldenPath, "utf-8");
  assert.strictEqual(
    emitMazurReceipt(r),
    goldenBytes,
    "wrapping emit in a FormatPolicyError catch must not change the clean-path bytes",
  );
});
