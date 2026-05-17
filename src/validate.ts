/**
 * Ajv-based JSON-Schema validator for backprop-trace receipts (FT-F-001).
 *
 * v0.3 widens this from a single-version validator (Mazur receipts only,
 * v0.1.0 schema) to a multi-version dispatcher. Both v0.1.0 and v0.2.0
 * schemas are compiled ONCE at module load via Ajv 2020-12 (the schemas
 * declare `$schema: "https://json-schema.org/draft/2020-12/schema"`), then
 * cached in a Map keyed by SchemaVersion. validateReceiptSchema dispatches
 * on either an explicit `opts.version` override or the receipt's own
 * `schema_version` field (a v0.1 / v0.2 / v0.3 receipt always declares which
 * schema it conforms to).
 *
 * Strict mode is ON — any unknown keyword or malformed type combination in
 * either schema would throw at compile time rather than silently accepting
 * bad input at validation time. The v0.2.0 schema introduces a new
 * vendor-annotation keyword (`x-changes-from-v0.1.0`) that must be declared
 * to Ajv alongside the existing `x-order` and `x-rule` keywords; all three
 * are pure annotations with no validation semantics.
 *
 * Validator config rationale:
 *   - strict: true       — schema authoring errors fail at module-load,
 *                           not at first input.
 *   - allErrors: false   — fail-fast on the first violation; the calling
 *                           layer (bp validate, bp verify *) renders one
 *                           focused diagnostic rather than a wall of
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
 * for call sites that prefer exception flow (e.g. tests). On both success
 * and failure, the result carries the `schemaVersion` actually dispatched
 * to so callers can route post-validation logic (e.g. emit / hash / verify)
 * to the right version-specific path.
 */

import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import type { MazurReceipt } from "./engine.js";
import {
  getReceiptSchema,
  SCHEMA_VERSIONS,
  type SchemaVersion,
} from "./schema-loader.js";

// Compile both schemas once at module load. Ajv compilation is hot:
// repeated calls cost a Map lookup, and the cached ValidateFunction is
// invoked directly by validateReceiptSchema below. A single shared Ajv
// instance with both schemas compiled into it is the recommended pattern
// (Ajv docs "Using Ajv with multiple schemas").
const ajv = new Ajv2020({
  strict: true,
  allErrors: false,
  useDefaults: false,
  coerceTypes: false,
  // strictRequired: false because v0.2.0 schema's top-level allOf clauses
  // use `required: ["step_index"]` and `required: ["trace_id"]` inside
  // anyOf/not branches to encode the "step_index iff trace_id" mutual
  // dependency. Those local subschemas don't redeclare the properties
  // (defined at the top-level properties object) so strictRequired flags
  // them. The schema is semantically correct — both fields ARE defined
  // in the top-level properties — so we allow the local-scope omission.
  strictRequired: false,
});
// Register vendor extensions used in schemas/receipt.v{0.1.0,0.2.0}.json as
// no-op keywords so `strict: true` does not reject them. Both have
// Ajv-keyword-name-conformant identifiers (`/^[a-z_$][a-z0-9_$:-]*$/i`) and
// are pure-annotation fields (no validation semantics):
//   - x-order : declares canonical-emission field order (consumed by
//               src/emit.ts, NOT by the validator). Same purpose as
//               OpenAPI's `x-*` vendor extensions.
//   - x-rule  : declares which reconciler rule a sub-tree belongs to
//               (consumed by future tooling; informational only).
// Without these declarations Ajv throws `strict mode: unknown keyword` at
// compile time. Declaring them as `{}` (no validator) makes Ajv accept the
// keyword without changing schema semantics.
//
// v0.2.0's schema additionally carries `x-changes-from-v0.1.0` — that name
// contains periods which violate Ajv's keyword-identifier regex
// (^[a-z_$][a-z0-9_$:-]*$) so it CANNOT be registered via addKeyword. We
// pre-strip the offending annotation from the loaded schema object below
// before Ajv sees it. The annotation is purely descriptive (docs-generator
// metadata) so removal is structurally invisible to downstream validators.
ajv.addKeyword({ keyword: "x-order" });
ajv.addKeyword({ keyword: "x-rule" });

/**
 * Strip the top-level `x-changes-from-v0.1.0` annotation from a loaded
 * schema object if present. The annotation's name contains periods, which
 * violate Ajv's keyword-identifier regex (^[a-z_$][a-z0-9_$:-]*$) so we
 * can't register it via addKeyword. It's purely descriptive metadata
 * (docs-generator change-log) — removing it does not affect any
 * validation semantics. Returns a shallow-clone with the annotation
 * removed; the original cached object is untouched.
 */
function stripInvalidKeywordAnnotations(schema: object): object {
  if (!("x-changes-from-v0.1.0" in schema)) return schema;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { ["x-changes-from-v0.1.0"]: _stripped, ...rest } = schema as Record<
    string,
    unknown
  >;
  return rest;
}

const validators = new Map<SchemaVersion, ValidateFunction>();
for (const v of SCHEMA_VERSIONS) {
  validators.set(
    v,
    ajv.compile(stripInvalidKeywordAnnotations(getReceiptSchema(v))),
  );
}

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
 * Discriminated-union result of validateReceiptSchema.
 *
 * On `ok: true` the receipt is type-narrowed only to `unknown` because the
 * concrete receipt shape (MazurReceipt vs GeneralReceipt vs future variants)
 * depends on which schemaVersion was dispatched to. Callers should branch
 * on `schemaVersion`:
 *
 *   if (result.ok) {
 *     if (result.schemaVersion === "0.1.0") {
 *       const mazur = result.receipt as MazurReceipt; // safe — Ajv ensured shape
 *       ...
 *     } else {
 *       // v0.2.0 — generalized receipt (XOR, iris, multi-step)
 *     }
 *   }
 *
 * On `ok: false` `schemaVersion` records WHICH schema the validation was
 * dispatched against (either the caller-supplied opts.version, the
 * receipt's own schema_version if recognized, or the default v0.2.0). This
 * lets callers render "failed against schema vX.Y.Z" diagnostics.
 */
export type ValidationResult =
  | { ok: true; receipt: unknown; schemaVersion: SchemaVersion }
  | { ok: false; errors: SchemaError[]; schemaVersion: SchemaVersion };

/**
 * Optional caller-supplied overrides for validateReceiptSchema.
 *
 * `version` forces validation against a specific schema regardless of the
 * receipt's own `schema_version` field — useful when a caller knows the
 * intended schema (e.g. the CLI's `bp validate --schema-version 0.1.0`)
 * or when validating an in-progress receipt that doesn't yet have a
 * schema_version field.
 */
export type ValidateOptions = {
  version?: SchemaVersion;
};

/**
 * Validate an unknown value against the receipt schema family.
 *
 * Dispatch order:
 *   1. If `opts.version` is supplied, validate against that exact schema.
 *   2. Else, sniff `input.schema_version`: if it's a recognized
 *      SchemaVersion ("0.1.0" or "0.2.0"), validate against that.
 *   3. Else, default to the latest schema ("0.2.0") so new callers writing
 *      generalized receipts without an explicit version land on the right
 *      target. Mazur callers ALWAYS declare schema_version: "0.1.0" in
 *      their receipts (per src/engine.ts MazurReceipt's type literal), so
 *      they hit branch 2.
 *
 * Returns a discriminated-union result with the dispatched schemaVersion
 * recorded. Does NOT throw on validation failure — schema violations are
 * data, not exceptions. Use validateReceiptOrThrow if exception flow is
 * preferred.
 *
 * @param input  Any JS value, typically the result of `JSON.parse(file)`.
 *               Pass it through parseReceipt (src/parse.ts) if you want
 *               JSON-syntax errors and schema errors handled together.
 * @param opts   Optional validation overrides. See ValidateOptions.
 * @returns      `{ ok: true, receipt, schemaVersion }` on success with the
 *               input structurally guaranteed to conform to the named
 *               schema, or `{ ok: false, errors, schemaVersion }` with at
 *               most one error (allErrors: false ⇒ fail-fast).
 */
export function validateReceiptSchema(
  input: unknown,
  opts?: ValidateOptions,
): ValidationResult {
  const version = pickSchemaVersion(input, opts);
  const validator = validators.get(version);
  // validators is populated from SCHEMA_VERSIONS at module load — every
  // SchemaVersion is guaranteed present. The non-null assertion is faithful;
  // we still guard for the "future SCHEMA_VERSIONS append without a
  // validator entry" footgun with an explicit throw.
  if (!validator) {
    throw new Error(
      `Internal: no compiled validator for schema version ${JSON.stringify(version)}. ` +
        `This indicates schema-loader.ts SCHEMA_VERSIONS was updated without a ` +
        `matching schemas/receipt.v${version}.json file.`,
    );
  }
  if (validator(input)) {
    return { ok: true, receipt: input, schemaVersion: version };
  }
  const errors = (validator.errors ?? []).map((e) => ({
    instancePath: e.instancePath ?? "",
    schemaPath: e.schemaPath ?? "",
    keyword: e.keyword ?? "",
    message: e.message ?? "",
    params: (e.params ?? {}) as Record<string, unknown>,
  }));
  return { ok: false, errors, schemaVersion: version };
}

/**
 * Resolve which schema version to dispatch to. See validateReceiptSchema
 * for the dispatch-order rationale.
 */
function pickSchemaVersion(
  input: unknown,
  opts: ValidateOptions | undefined,
): SchemaVersion {
  if (opts?.version) return opts.version;
  const sv = (input as { schema_version?: unknown } | null | undefined)
    ?.schema_version;
  if (typeof sv === "string") {
    // Type-narrow via membership check rather than a cast, so a malformed
    // schema_version string (e.g. "0.0.99") still falls through to the
    // default branch and the validator surfaces a proper schema error.
    for (const v of SCHEMA_VERSIONS) {
      if (sv === v) return v;
    }
  }
  // Default to latest. v0.1 callers always set schema_version: "0.1.0"
  // explicitly, so this branch is reached only by (a) new v0.3 callers
  // writing generalized receipts and (b) malformed input that the
  // validator will reject below.
  return "0.2.0";
}

/**
 * Convenience wrapper that throws if validation fails. Error message
 * summarizes every error (1 in fail-fast mode) as `path: message` joined
 * with `; `. The full structured error list remains accessible via
 * validateReceiptSchema for callers that need to render JSON / SARIF.
 *
 * The return type is `MazurReceipt` for backward compatibility with v0.1
 * callers. v0.3 callers that need the generalized-receipt path should use
 * validateReceiptSchema directly and branch on result.schemaVersion.
 *
 * @throws Error if the input does not satisfy the dispatched receipt
 *         schema. The thrown Error's message names the dispatched schema
 *         version (e.g. "Receipt schema validation failed (v0.1.0): ...").
 */
export function validateReceiptOrThrow(
  input: unknown,
  opts?: ValidateOptions,
): MazurReceipt {
  const result = validateReceiptSchema(input, opts);
  if (result.ok) return result.receipt as MazurReceipt;
  const summary = result.errors
    .map((e) => `${e.instancePath || "/"}: ${e.message}`)
    .join("; ");
  throw new Error(
    `Receipt schema validation failed (v${result.schemaVersion}): ${summary}. ` +
      `Hint: full error list available via validateReceiptSchema().`,
  );
}
