/**
 * parseReceipt / parseReceiptJsonl — JSON parse + schema validation (FT-F-002).
 *
 * Combines `JSON.parse` with validateReceiptSchema so callers get one
 * discriminated-union result for both failure classes (syntax vs schema)
 * rather than having to wrap `JSON.parse` in try/catch and then re-check
 * validation. The unified ParseError carries a `kind` discriminator so
 * the CLI can render different exit codes / messages per class without
 * sniffing error subtypes.
 *
 * v0.3 widens this from MazurReceipt-only to multi-version: parseReceipt
 * dispatches through the multi-version validateReceiptSchema and returns
 * the dispatched schemaVersion alongside the receipt. Existing callers
 * that assume MazurReceipt can use parseMazurReceipt for the typed-narrowed
 * v0.1.0-only path.
 *
 * JSONL note: parseReceiptJsonl is the strict single-record helper. v0.1/v0.2
 * fixtures contain exactly one record per file (the Mazur receipt). Multi-
 * record JSONL is wired by parseReceiptJsonlMulti in v0.3+ — until callers
 * adopt that helper we reject >1 records explicitly so a caller doesn't get
 * silently incorrect "only validated the first record" behavior.
 */

import type { MazurReceipt } from "./engine.js";
import {
  validateReceiptSchema,
  type SchemaError,
  type ValidateOptions,
} from "./validate.js";
import type { SchemaVersion } from "./schema-loader.js";

/**
 * Tagged union of the two failure classes parseReceipt can surface:
 *   - JSON_SYNTAX        : input is not valid JSON (or, for parseReceiptJsonl,
 *                          input is empty / contains multiple non-blank lines).
 *   - SCHEMA_VIOLATION   : input parses as JSON but fails validation against
 *                          the dispatched receipt schema (v0.1.0 or v0.2.0).
 *
 * jsonError carries the raw SyntaxError (for stack-trace recovery in
 * dev mode); schemaErrors carries the structured Ajv errors so the CLI
 * can render them per-instance-path. schemaVersion (only set on
 * SCHEMA_VIOLATION) records WHICH schema the validation was dispatched
 * against, so the CLI can render "failed against schema vX.Y.Z" diagnostics.
 */
export type ParseError = {
  kind: "JSON_SYNTAX" | "SCHEMA_VIOLATION";
  message: string;
  jsonError?: SyntaxError;
  schemaErrors?: SchemaError[];
  schemaVersion?: SchemaVersion;
};

/**
 * Minimal receipt-like shape carried in the success branch of ParseResult.
 *
 * Ajv has structurally verified the input matches one of the shipped
 * receipt schemas, so AT MINIMUM the `schema_version` discriminator field
 * is present and is a SchemaVersion. Callers branch on `schemaVersion` to
 * narrow further:
 *
 *   if (result.ok) {
 *     if (result.schemaVersion === "0.1.0") {
 *       const mazur = result.receipt as MazurReceipt; // safe by construction
 *     } else if (result.schemaVersion === "0.2.0") {
 *       // GeneralReceipt — typed when Math agent's general-engine.ts lands
 *     }
 *   }
 *
 * v0.1 callers that always want MazurReceipt should use parseMazurReceipt.
 *
 * Additional fields are NOT promised by the type — `[k: string]: unknown`
 * absorbs them so existing read-access in v0.1 tests (e.g.
 * `result.receipt.schema_version`) keeps working without per-test casts.
 */
export type ParsedReceiptShape = {
  schema_version: SchemaVersion;
  [k: string]: unknown;
};

/**
 * Discriminated-union result of parseReceipt / parseReceiptJsonl.
 *
 * On `ok: true` the receipt is typed `ParsedReceiptShape` — Ajv has
 * structurally verified it matches one of the shipped schemas, so the
 * minimum-bound type carries the `schema_version` discriminator + an
 * open index signature for the remaining (schema-version-dependent)
 * fields. Callers should branch on `schemaVersion` and cast to the
 * concrete type (MazurReceipt for "0.1.0", GeneralReceipt for "0.2.0").
 * Use parseMazurReceipt for the v0.1.0-narrowed convenience path.
 */
export type ParseResult =
  | { ok: true; receipt: ParsedReceiptShape; schemaVersion: SchemaVersion }
  | { ok: false; error: ParseError };

/**
 * Parse a JSON document and validate it as a backprop-trace receipt.
 *
 * Two-stage failure: JSON.parse exceptions are caught and re-shaped as
 * `JSON_SYNTAX`; if parsing succeeds, the result is forwarded to
 * validateReceiptSchema and any schema failure is re-shaped as
 * `SCHEMA_VIOLATION` (carrying the structured error list).
 *
 * The validator dispatches on either an explicit `opts.version` override
 * or the receipt's own `schema_version` field — see src/validate.ts
 * validateReceiptSchema for the full dispatch order.
 *
 * @param text  Raw JSON text. Must encode a single object — callers with
 *              JSONL input should use parseReceiptJsonl instead (it
 *              enforces the single-record invariant and would otherwise
 *              fail with a JSON syntax error on a multi-line input).
 * @param opts  Optional validation overrides (e.g. force a specific
 *              schema version). See src/validate.ts ValidateOptions.
 * @returns     `{ ok: true, receipt, schemaVersion }` on success, or
 *              `{ ok: false, error }` with `kind` set to JSON_SYNTAX or
 *              SCHEMA_VIOLATION.
 */
export function parseReceipt(
  text: string,
  opts?: ValidateOptions,
): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "JSON_SYNTAX",
        message: `Invalid JSON: ${(err as Error).message}`,
        jsonError: err as SyntaxError,
      },
    };
  }
  const validation = validateReceiptSchema(parsed, opts);
  if (validation.ok) {
    // validation.receipt is typed `unknown` by the multi-version validator,
    // but Ajv has structurally verified it conforms to the dispatched
    // schema — which guarantees schema_version is a SchemaVersion. Cast
    // to ParsedReceiptShape (which carries only that one promise) is
    // sound; callers cast further to MazurReceipt / GeneralReceipt as
    // appropriate.
    return {
      ok: true,
      receipt: validation.receipt as ParsedReceiptShape,
      schemaVersion: validation.schemaVersion,
    };
  }
  return {
    ok: false,
    error: {
      kind: "SCHEMA_VIOLATION",
      message: `Receipt failed schema validation against schemas/receipt.v${validation.schemaVersion}.json (${validation.errors.length} error${validation.errors.length === 1 ? "" : "s"}).`,
      schemaErrors: validation.errors,
      schemaVersion: validation.schemaVersion,
    },
  };
}

/**
 * Parse a single-record JSONL document. v0.1/v0.2 fixtures contain exactly
 * one record per file. Multi-record JSONL is wired by parseReceiptJsonlMulti
 * in v0.3+ — until callers adopt that helper we fail loudly here rather than
 * silently validating only the first line.
 *
 * Tolerates CRLF line endings on input (split on /\r?\n/) but the canonical
 * emitter still produces LF-only output (see docs/canonical-emission.md);
 * this leniency is for hand-edited / Windows-edited inputs only.
 *
 * @param text  Raw JSONL text. Trailing-LF after the single record is
 *              expected (canonical emission appends one), but not required;
 *              blank lines are filtered before the single-record check.
 * @param opts  Optional validation overrides forwarded to parseReceipt.
 * @returns     ParseResult — same shape as parseReceipt.
 */
export function parseReceiptJsonl(
  text: string,
  opts?: ValidateOptions,
): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return {
      ok: false,
      error: { kind: "JSON_SYNTAX", message: "Empty JSONL input." },
    };
  }
  if (lines.length > 1) {
    return {
      ok: false,
      error: {
        kind: "JSON_SYNTAX",
        message: `Multi-record JSONL not supported by parseReceiptJsonl (got ${lines.length} records). Use parseReceipt on a single-record document, or parseReceiptJsonlMulti for multi-record input.`,
      },
    };
  }
  return parseReceipt(lines[0]!, opts);
}

/**
 * Convenience wrapper: parse + force-validate against v0.1.0 schema and
 * type-narrow the resulting receipt to MazurReceipt.
 *
 * Use this when the caller knows the input is a Mazur receipt and wants
 * the typed shape without writing a per-call cast. The function dispatches
 * the v0.1.0 schema explicitly, so any input that doesn't match v0.1.0
 * fails with SCHEMA_VIOLATION regardless of its own schema_version field
 * (a v0.2 receipt would correctly be rejected as not matching v0.1.0).
 *
 * Returns the same ParseResult shape as parseReceipt; on success the
 * receipt field is typed as MazurReceipt (callers that need to inspect
 * schemaVersion still get it from the result).
 */
export function parseMazurReceipt(
  text: string,
): { ok: true; receipt: MazurReceipt; schemaVersion: SchemaVersion } | { ok: false; error: ParseError } {
  const result = parseReceipt(text, { version: "0.1.0" });
  if (!result.ok) return result;
  return {
    ok: true,
    receipt: result.receipt as MazurReceipt,
    schemaVersion: result.schemaVersion,
  };
}
