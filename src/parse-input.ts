/**
 * parseTopologyInput — JSON parse + schema validation for the v0.4
 * topology-input file consumed by `bp generate from-config`.
 *
 * Parallel to src/parse.ts (which handles RECEIPTS). The two-stage
 * failure surface (JSON syntax vs schema violation) is identical in
 * shape, but the schema family is different: this parser dispatches to
 * the input schema family (`schemas/topology-input.v<version>.json`)
 * rather than the receipt schema family.
 *
 * The trust-boundary distinction matters (consolidator decision §7):
 * authored input files MUST NOT contain receipt-only fields
 * (forward, loss, updates, parameters_after, post_update_forward,
 * post_update_loss, fixture_status). The input schema's
 * `additionalProperties: false` enforces this — if a hand-edited
 * input file accidentally pastes engine output fields, parsing fails
 * loudly with a SCHEMA_VIOLATION pointing at the offending field path.
 * That preserves the rule "authored bytes never become receipt bytes":
 * the engine ALWAYS computes the receipt portion, and the input is
 * just the boundary conditions.
 *
 * Input files are single-document JSON (NOT JSONL): one config per
 * file. Multi-record JSONL chaining for `bp generate from-config`
 * is deferred to v0.4.1 per the consolidator decision §4.
 */

import type { GeneralInput } from "./general-engine.js";
import {
  validateTopologyInput,
  type SchemaError,
  type ValidateInputOptions,
} from "./validate.js";
import type { InputSchemaVersion } from "./schema-loader.js";

/**
 * Tagged union of the two failure classes parseTopologyInput can surface:
 *   - JSON_SYNTAX       : input is not valid JSON.
 *   - SCHEMA_VIOLATION  : input parses as JSON but fails validation
 *                          against the dispatched topology-input schema
 *                          (v0.4.0). Most common cause: hand-edited
 *                          file accidentally contains receipt-only
 *                          fields (forward / loss / updates / ...).
 *
 * jsonError carries the raw SyntaxError (for stack-trace recovery in
 * dev mode); schemaErrors carries the structured Ajv errors so the
 * CLI can render them per-instance-path. schemaVersion (only set on
 * SCHEMA_VIOLATION) records which input schema the validation was
 * dispatched against.
 */
export type ParseInputError = {
  kind: "JSON_SYNTAX" | "SCHEMA_VIOLATION";
  message: string;
  jsonError?: SyntaxError;
  schemaErrors?: SchemaError[];
  schemaVersion?: InputSchemaVersion;
};

/**
 * Discriminated-union result of parseTopologyInput.
 *
 * On `ok: true`, `input` is cast to `GeneralInput` (see
 * InputValidationResult in src/validate.ts for the cast caveat: the
 * JSON-shape conformance is enforced here; engine-semantic invariants
 * such as parameter cross-references are enforced by
 * assertTopologyValid inside runGeneralStep).
 */
export type ParseInputResult =
  | { ok: true; input: GeneralInput; schemaVersion: InputSchemaVersion }
  | { ok: false; error: ParseInputError };

/**
 * Strip a single leading UTF-8 byte-order mark (U+FEFF) from `text`.
 *
 * io-B-002: Windows / PowerShell `command > file.json` redirection and several
 * editors prepend a BOM to UTF-8 output. JSON.parse does NOT skip it — it
 * surfaces as an "Unexpected token" SyntaxError on otherwise byte-correct JSON,
 * a confusing failure for the user. Stripping a single leading BOM here lets a
 * redirected receipt / input parse identically to one without the mark.
 *
 * Only ONE leading mark is removed (a doubled BOM is itself malformed and the
 * residual mark surfaces as a normal JSON syntax error — the strip must not
 * silently launder arbitrarily-prefixed garbage). The function is a no-op when
 * `text` has no leading BOM, so it is safe to call unconditionally on every
 * parse path. Shared by src/parse.ts (receipts) and parseTopologyInput below
 * so both parse families behave identically (io-B-007 parity).
 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Parse a JSON document and validate it as a topology-input config.
 *
 * Two-stage failure: JSON.parse exceptions are caught and re-shaped as
 * `JSON_SYNTAX`; if parsing succeeds, the result is forwarded to
 * validateTopologyInput and any schema failure is re-shaped as
 * `SCHEMA_VIOLATION` (carrying the structured error list).
 *
 * @param text  Raw JSON text. Must encode a single object — input
 *              files are single-document JSON, not JSONL. Multi-record
 *              JSONL chaining is deferred to v0.4.1.
 * @param opts  Optional validation overrides (e.g. force a specific
 *              input schema version).
 * @returns     `{ ok: true, input, schemaVersion }` on success, or
 *              `{ ok: false, error }` with `kind` set to JSON_SYNTAX
 *              or SCHEMA_VIOLATION.
 */
export function parseTopologyInput(
  text: string,
  opts?: ValidateInputOptions,
): ParseInputResult {
  // io-B-007: parity with src/parse.ts — strip a leading BOM (io-B-002) and
  // diagnose empty / whitespace-only input explicitly, rather than letting
  // JSON.parse surface a raw "Unexpected end of JSON input" token. The
  // empty-input branch mirrors parseReceiptJsonl's "Empty JSONL input." path
  // so both parse families fail diagnosably on the same trivial mistake.
  const stripped = stripBom(text);
  if (stripped.trim().length === 0) {
    return {
      ok: false,
      error: {
        kind: "JSON_SYNTAX",
        message:
          `Empty topology input: the document is empty (or whitespace-only). ` +
          `Hint: topology input must be a single non-empty JSON document ` +
          `(topology + inputs + targets + parameters_before + ...). If you piped a ` +
          `file in, check it is not zero-length.`,
      },
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "JSON_SYNTAX",
        message:
          `Invalid JSON in topology input: ${(err as Error).message}. ` +
          `Hint: topology input must be a single JSON document.`,
        jsonError: err as SyntaxError,
      },
    };
  }
  const validation = validateTopologyInput(parsed, opts);
  if (validation.ok) {
    return {
      ok: true,
      input: validation.input,
      schemaVersion: validation.schemaVersion,
    };
  }
  return {
    ok: false,
    error: {
      kind: "SCHEMA_VIOLATION",
      message:
        `Topology input failed schema validation against ` +
        `schemas/topology-input.v${validation.schemaVersion}.json ` +
        `(${validation.errors.length} error${validation.errors.length === 1 ? "" : "s"}). ` +
        `Hint: the input must NOT contain receipt-only fields ` +
        `(forward, loss, updates, parameters_after, post_update_forward, ` +
        `post_update_loss, fixture_status); those are engine outputs.`,
      schemaErrors: validation.errors,
      schemaVersion: validation.schemaVersion,
    },
  };
}
