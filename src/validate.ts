/**
 * Ajv-based JSON-Schema validator for Mazur receipts (FT-F-001).
 *
 * Compiles the receipt schema (schemas/receipt.v0.1.0.json) ONCE at module
 * load. The schema declares `$schema: "https://json-schema.org/draft/2020-12/schema"`
 * so we use Ajv's 2020-12 entrypoint (ajv/dist/2020) rather than the
 * Draft-07 default. Strict mode is ON — any unknown keyword or malformed
 * type combination in the schema would throw at compile time rather than
 * silently accepting bad input at validation time.
 *
 * Validator config rationale:
 *   - strict: true       — schema authoring errors fail at module-load,
 *                           not at first input.
 *   - allErrors: false   — fail-fast on the first violation; the calling
 *                           layer (bp validate, bp verify mazur) renders
 *                           one focused diagnostic rather than a wall of
 *                           cascading errors. (`bp validate --all` could
 *                           call a separate validator in v0.3+.)
 *   - useDefaults: false — defaults in the schema MUST NOT mutate the
 *                           caller's receipt object; receipts are canonical
 *                           artifacts (byte-equal vs golden is the
 *                           load-bearing contract), so silently populating
 *                           a missing field would break that contract.
 *   - coerceTypes: false — never coerce `"1"` to `1`; numeric fields must
 *                           arrive as JSON numbers. Coercion would let a
 *                           string-typed weight slip past validation and
 *                           then poison reconciliation with NaN downstream.
 *
 * Result shape is a discriminated union — callers pattern-match on `ok`
 * rather than try/catch. validateReceiptOrThrow is the convenience helper
 * for call sites that prefer exception flow (e.g. tests).
 */

import { Ajv2020 } from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { MazurReceipt } from "./engine.js";

// Resolve schema relative to THIS module so the path works in both modes:
//   - tsx-from-src     : src/validate.ts    -> src/../schemas/receipt.v0.1.0.json -> schemas/...
//   - node-from-dist   : dist/validate.js   -> dist/../schemas/receipt.v0.1.0.json -> schemas/...
// Both resolve to <repo-root>/schemas/receipt.v0.1.0.json. tsconfig.build.json
// excludes the schema file from compilation, but the relative import is
// resolved at runtime, not build time, so the path is stable across builds.
const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, "..", "schemas", "receipt.v0.1.0.json");
const schema = JSON.parse(readFileSync(schemaPath, "utf-8")) as object;

const ajv = new Ajv2020({
  strict: true,
  allErrors: false,
  useDefaults: false,
  coerceTypes: false,
});
// Register vendor extensions used in schemas/receipt.v0.1.0.json as no-op
// keywords so `strict: true` does not reject them. Both are pure-annotation
// fields (no validation semantics):
//   - x-order : declares canonical-emission field order (consumed by
//               src/emit.ts, NOT by the validator). Same purpose as
//               OpenAPI's `x-*` vendor extensions.
//   - x-rule  : declares which reconciler rule a sub-tree belongs to
//               (consumed by future tooling; informational only).
// Without these declarations Ajv throws `strict mode: unknown keyword`
// at compile time. Declaring them as `{}` (no validator) makes Ajv accept
// the keyword without changing schema semantics.
ajv.addKeyword({ keyword: "x-order" });
ajv.addKeyword({ keyword: "x-rule" });
const validate = ajv.compile<MazurReceipt>(schema);

/**
 * One JSON-Schema validation error as surfaced by validateReceiptSchema.
 *
 * Re-shaped from Ajv's ErrorObject to a plain dict so the failure can be
 * serialized to JSON (e.g. `bp validate --format=json`) without losing
 * structure to Ajv-internal fields. instancePath uses JSON-Pointer syntax
 * (e.g. `/numeric_policy/tolerance`); empty string means the root.
 */
export type SchemaError = {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message: string;
  params: Record<string, unknown>;
};

/**
 * Discriminated-union result of validateReceiptSchema. On `ok: true` the
 * receipt is type-narrowed to MazurReceipt — Ajv guarantees the input
 * structurally conforms to the schema; the type assertion is faithful
 * because schemas/receipt.v0.1.0.json is the source of truth for
 * MazurReceipt's shape.
 */
export type ValidationResult =
  | { ok: true; receipt: MazurReceipt }
  | { ok: false; errors: SchemaError[] };

/**
 * Validate an unknown value against schemas/receipt.v0.1.0.json.
 *
 * Returns a discriminated-union result. Does NOT throw on validation
 * failure — schema violations are data, not exceptions. Use
 * validateReceiptOrThrow if exception flow is preferred.
 *
 * @param input  Any JS value, typically the result of `JSON.parse(file)`.
 *               Pass it through parseReceipt (src/parse.ts) if you want
 *               JSON-syntax errors and schema errors handled together.
 * @returns      `{ ok: true, receipt }` with the input type-narrowed to
 *               MazurReceipt on success, or `{ ok: false, errors }` with
 *               at most one error (allErrors: false ⇒ fail-fast).
 */
export function validateReceiptSchema(input: unknown): ValidationResult {
  if (validate(input)) {
    return { ok: true, receipt: input as MazurReceipt };
  }
  const errors = (validate.errors ?? []).map((e) => ({
    instancePath: e.instancePath ?? "",
    schemaPath: e.schemaPath ?? "",
    keyword: e.keyword ?? "",
    message: e.message ?? "",
    params: (e.params ?? {}) as Record<string, unknown>,
  }));
  return { ok: false, errors };
}

/**
 * Convenience wrapper that throws if validation fails. Error message
 * summarizes every error (1 in fail-fast mode) as `path: message` joined
 * with `; `. The full structured error list remains accessible via
 * validateReceiptSchema for callers that need to render JSON / SARIF.
 *
 * @throws Error if the input does not satisfy the receipt schema.
 */
export function validateReceiptOrThrow(input: unknown): MazurReceipt {
  const result = validateReceiptSchema(input);
  if (result.ok) return result.receipt;
  const summary = result.errors
    .map((e) => `${e.instancePath || "/"}: ${e.message}`)
    .join("; ");
  throw new Error(
    `Receipt schema validation failed: ${summary}. ` +
      `Hint: full error list available via validateReceiptSchema().`,
  );
}
