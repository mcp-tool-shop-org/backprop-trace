/**
 * @mcptoolshop/backprop-trace — public library surface.
 *
 * The library exports:
 *   - reconcileReceipt + multiplyFactorsLeftToRight + multiplyFactorsRightToLeft
 *     + RULE_DESCRIPTIONS + types from ./reconcile
 *   - runMazurStep + MazurReceipt + supporting types from ./engine
 *   - MAZUR_INPUT + MazurInput from ./mazur
 *   - emitMazurReceipt + emitReceipts from ./emit
 *   - validateReceiptSchema + validateReceiptOrThrow + types from ./validate
 *   - parseReceipt + parseReceiptJsonl + types from ./parse
 *   - hashReceipt + HashAlgorithm from ./hash
 *   - getReceiptSchema + SCHEMA_VERSIONS + SchemaVersion from ./schema-loader
 *   - verifyEngineReproduces + VerifyEngineResult from ./verify-engine
 *   - extractEngineInput from ./extract
 *   - formatNumberForEngine + scientificToPlain from ./runtime-format
 *   - formatDecimalStringForFixture + FormatPolicyError + FormatErrorKind from ./format
 *
 * The CLI lives in ./bin/bp and is exposed via package.json bin.
 *
 * Receipt schema is shipped at schemas/receipt.v0.1.0.json (importable via
 * the "@mcptoolshop/backprop-trace/schema" subpath export).
 *
 * Quick usage:
 *
 *   // Run the Mazur 2-2-2 engine step and emit a canonical receipt:
 *   import { runMazurStep, emitMazurReceipt, MAZUR_INPUT } from "@mcptoolshop/backprop-trace";
 *   const receipt = runMazurStep(MAZUR_INPUT);
 *   const line = emitMazurReceipt(receipt); // canonical JSONL ending in "\n"
 *
 *   // Reconcile a parsed receipt against Rule 4 (gradient consistency):
 *   import { reconcileReceipt } from "@mcptoolshop/backprop-trace";
 *   const result = reconcileReceipt(parsedReceipt);
 *   if (!result.ok) for (const f of result.failures) console.error(f);
 *
 *   // Parse + validate a receipt file in one call (v0.2+):
 *   import { parseReceipt } from "@mcptoolshop/backprop-trace";
 *   const r = parseReceipt(readFileSync("fixtures/mazur.golden.jsonl", "utf-8"));
 *   if (!r.ok) console.error(r.error.kind, r.error.message);
 *
 *   // Hash a receipt for in-toto v1 attestation (v0.2+):
 *   import { hashReceipt } from "@mcptoolshop/backprop-trace";
 *   const sha = hashReceipt(receipt); // sha256 hex of canonical bytes
 *
 *   // Verify the engine reproduces a receipt byte-for-byte (v0.2+):
 *   import { verifyEngineReproduces } from "@mcptoolshop/backprop-trace";
 *   const v = verifyEngineReproduces(receipt);
 *   if (!v.matches) console.error("diverges at byte", v.firstDifferingByte);
 */

export {
  reconcileReceipt,
  multiplyFactorsLeftToRight,
  multiplyFactorsRightToLeft,
  RULE_DESCRIPTIONS,
} from "./reconcile.js"
export type { ReconciliationFailure, ReconciliationResult } from "./reconcile.js"

export { runMazurStep } from "./engine.js"
export type {
  MazurReceipt,
  ForwardUnit,
  NamedFactor,
  OutputErrorSignal,
  DownstreamContribution,
  HiddenErrorSignal,
  Optimizer,
  Update,
} from "./engine.js"

export { MAZUR_INPUT } from "./mazur.js"
export type { MazurInput } from "./mazur.js"

export { emitMazurReceipt, emitReceipts } from "./emit.js"

export { validateReceiptSchema, validateReceiptOrThrow } from "./validate.js"
export type { ValidationResult, SchemaError } from "./validate.js"

export { parseReceipt, parseReceiptJsonl } from "./parse.js"
export type { ParseResult, ParseError } from "./parse.js"

export { hashReceipt } from "./hash.js"
export type { HashAlgorithm } from "./hash.js"

export { getReceiptSchema, SCHEMA_VERSIONS } from "./schema-loader.js"
export type { SchemaVersion } from "./schema-loader.js"

export { verifyEngineReproduces } from "./verify-engine.js"
export type { VerifyEngineResult } from "./verify-engine.js"

export { extractEngineInput } from "./extract.js"

export { formatNumberForEngine, scientificToPlain } from "./runtime-format.js"

export { formatDecimalStringForFixture, FormatPolicyError } from "./format.js"
export type { FormatErrorKind } from "./format.js"
