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
 * JSONL note: parseReceiptJsonl is the strict single-record helper. v0.1
 * fixtures contain exactly one record per file (the Mazur receipt). Multi-
 * record JSONL is a v0.3+ deferred feature (FT-F-007 parseReceiptStream)
 * — until then we reject >1 records explicitly so a caller doesn't get
 * silently incorrect "only validated the first record" behavior.
 */

import type { MazurReceipt } from "./engine.js";
import { validateReceiptSchema, type SchemaError } from "./validate.js";

/**
 * Tagged union of the two failure classes parseReceipt can surface:
 *   - JSON_SYNTAX        : input is not valid JSON (or, for parseReceiptJsonl,
 *                          input is empty / contains multiple non-blank lines).
 *   - SCHEMA_VIOLATION   : input parses as JSON but fails validation against
 *                          schemas/receipt.v0.1.0.json.
 *
 * jsonError carries the raw SyntaxError (for stack-trace recovery in
 * dev mode); schemaErrors carries the structured Ajv errors so the CLI
 * can render them per-instance-path.
 */
export type ParseError = {
  kind: "JSON_SYNTAX" | "SCHEMA_VIOLATION";
  message: string;
  jsonError?: SyntaxError;
  schemaErrors?: SchemaError[];
};

/**
 * Discriminated-union result of parseReceipt / parseReceiptJsonl. On
 * `ok: true` the receipt is type-narrowed to MazurReceipt.
 */
export type ParseResult =
  | { ok: true; receipt: MazurReceipt }
  | { ok: false; error: ParseError };

/**
 * Parse a JSON document and validate it as a Mazur receipt.
 *
 * Two-stage failure: JSON.parse exceptions are caught and re-shaped as
 * `JSON_SYNTAX`; if parsing succeeds, the result is forwarded to
 * validateReceiptSchema and any schema failure is re-shaped as
 * `SCHEMA_VIOLATION` (carrying the structured error list).
 *
 * @param text  Raw JSON text. Must encode a single object — callers with
 *              JSONL input should use parseReceiptJsonl instead (it
 *              enforces the single-record invariant and would otherwise
 *              fail with a JSON syntax error on a multi-line input).
 * @returns     `{ ok: true, receipt }` on success, or `{ ok: false, error }`
 *              with `kind` set to JSON_SYNTAX or SCHEMA_VIOLATION.
 */
export function parseReceipt(text: string): ParseResult {
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
  const validation = validateReceiptSchema(parsed);
  if (validation.ok) return { ok: true, receipt: validation.receipt };
  return {
    ok: false,
    error: {
      kind: "SCHEMA_VIOLATION",
      message: `Receipt failed schema validation against schemas/receipt.v0.1.0.json (${validation.errors.length} error${validation.errors.length === 1 ? "" : "s"}).`,
      schemaErrors: validation.errors,
    },
  };
}

/**
 * Parse a single-record JSONL document. v0.1 fixtures contain exactly one
 * record per file. Multi-record JSONL is reserved for v0.3+ — until then
 * we fail loudly rather than silently validating only the first line.
 *
 * Tolerates CRLF line endings on input (split on /\r?\n/) but the canonical
 * emitter still produces LF-only output (see docs/canonical-emission.md);
 * this leniency is for hand-edited / Windows-edited inputs only.
 *
 * @param text  Raw JSONL text. Trailing-LF after the single record is
 *              expected (canonical emission appends one), but not required;
 *              blank lines are filtered before the single-record check.
 * @returns     ParseResult — same shape as parseReceipt.
 */
export function parseReceiptJsonl(text: string): ParseResult {
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
        message: `Multi-record JSONL not supported in v0.1 (got ${lines.length} records). Use parseReceipt on a single-record document.`,
      },
    };
  }
  return parseReceipt(lines[0]!);
}
