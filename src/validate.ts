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
import type { GeneralInput } from "./general-engine.js";
import {
  getReceiptSchema,
  SCHEMA_VERSIONS,
  type SchemaVersion,
  getInputSchema,
  INPUT_SCHEMA_VERSIONS,
  type InputSchemaVersion,
  getFrameworkTraceSchema,
  FRAMEWORK_TRACE_SCHEMA_VERSIONS,
  type FrameworkTraceSchemaVersion,
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
// v0.6: framework-trace.v0.1.0.json declares an `x-purpose` annotation
// at the schema root naming the schema's audience + role. Pure-annotation
// (no validation semantics), register as no-op for Ajv strict mode.
ajv.addKeyword({ keyword: "x-purpose" });

/**
 * Strip top-level `x-changes-from-*` annotations from a loaded schema
 * object if present. Those annotation names contain periods (e.g.
 * `x-changes-from-v0.1.0`, `x-changes-from-v0.2.0-initial`) which
 * violate Ajv's keyword-identifier regex (^[a-z_$][a-z0-9_$:-]*$) so
 * they can't be registered via addKeyword. They are purely descriptive
 * metadata (docs-generator change-log) — removing them does not affect
 * any validation semantics.
 *
 * The matcher is the prefix `x-changes-from-` rather than a hard-coded
 * list so future schema bumps (`x-changes-from-v0.2.0`,
 * `x-changes-from-v0.3.0`, etc.) drop in without code changes here.
 * Returns a shallow-clone with matching annotations removed; the
 * original cached object is untouched.
 */
function stripInvalidKeywordAnnotations(schema: object): object {
  const entries = Object.entries(schema as Record<string, unknown>);
  const hasInvalid = entries.some(([k]) => k.startsWith("x-changes-from-"));
  if (!hasInvalid) return schema;
  const rest: Record<string, unknown> = {};
  for (const [k, v] of entries) {
    if (k.startsWith("x-changes-from-")) continue;
    rest[k] = v;
  }
  return rest;
}

const validators = new Map<SchemaVersion, ValidateFunction>();
for (const v of SCHEMA_VERSIONS) {
  validators.set(
    v,
    ajv.compile(stripInvalidKeywordAnnotations(getReceiptSchema(v))),
  );
}

// Compile input-schema validators alongside the receipt validators on the
// SAME Ajv instance. Mirrors the receipt-validator pattern: compile once
// at module load, cache by version, fail-fast on Ajv-strict violations
// during compilation. v0.4 ships exactly one input schema ("0.4.0");
// future input-schema versions append to INPUT_SCHEMA_VERSIONS in
// schema-loader.ts and land here automatically via the loop.
const inputValidators = new Map<InputSchemaVersion, ValidateFunction>();
for (const v of INPUT_SCHEMA_VERSIONS) {
  inputValidators.set(
    v,
    ajv.compile(stripInvalidKeywordAnnotations(getInputSchema(v))),
  );
}

// Compile framework-trace sidecar validators (v0.6) on the SAME Ajv
// instance. The framework-trace schema family lives parallel to the
// topology-input schema family — see schema-loader.ts for the
// rationale. v0.6 ships exactly one ("0.1.0").
const frameworkTraceValidators = new Map<
  FrameworkTraceSchemaVersion,
  ValidateFunction
>();
for (const v of FRAMEWORK_TRACE_SCHEMA_VERSIONS) {
  frameworkTraceValidators.set(
    v,
    ajv.compile(stripInvalidKeywordAnnotations(getFrameworkTraceSchema(v))),
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
  // explicitly, so this branch is reached only by (a) new callers writing
  // generalized receipts without an explicit version and (b) malformed
  // input that the validator will reject below. The default is kept at
  // "0.2.0" rather than the latest schema so unversioned generalized
  // receipts continue to land on the same dispatcher that has shipped
  // since v0.3 — bumping the default would silently re-route legitimate
  // callers and risk masking a forgotten schema_version field.
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

// --- v0.4 topology-input validator ----------------------------------------

/**
 * Discriminated-union result of validateTopologyInput.
 *
 * On `ok: true`, `input` is cast to `GeneralInput`. The cast is sound at
 * the JSON-shape level: the input schema enforces the same key set + types
 * that GeneralInput declares. The cast is NOT sound at the engine-semantic
 * level — Topology's parameter cross-references (parameter_order matches
 * parameters[].id, from_unit/to_unit reference declared units, etc.) are
 * NOT enforced by the JSON schema. Those structural invariants are
 * enforced at engine entry by `assertTopologyValid` inside runGeneralStep.
 * Callers passing the validated input straight to runGeneralStep get the
 * full safety net; callers using the input for documentation / display
 * before engine entry should not assume engine-semantic validity.
 *
 * On `ok: false`, `schemaVersion` records which input schema the
 * validation was dispatched against, mirroring ValidationResult.
 */
export type InputValidationResult =
  | { ok: true; input: GeneralInput; schemaVersion: InputSchemaVersion }
  | { ok: false; errors: SchemaError[]; schemaVersion: InputSchemaVersion };

/**
 * Optional caller-supplied overrides for validateTopologyInput.
 */
export type ValidateInputOptions = {
  version?: InputSchemaVersion;
};

/**
 * Validate an unknown value against the topology-input schema family.
 *
 * Parallel to validateReceiptSchema but pinned to the input schema
 * family (`schemas/topology-input.v<version>.json`). The dispatch order
 * is simpler than the receipt validator because the input schema does
 * NOT carry an in-band `schema_version` discriminator (input files are
 * authored, not engine-generated; we don't want authors to have to
 * declare which input-schema version they target — the only one shipped
 * is v0.4.0):
 *   1. If `opts.version` is supplied, validate against that exact schema.
 *   2. Else, default to the latest input schema ("0.4.0").
 *
 * Does NOT throw on validation failure. Use validateTopologyInputOrThrow
 * for the exception-flow convenience wrapper.
 *
 * @param input  Any JS value, typically the result of `JSON.parse(file)`.
 *               Pass it through parseTopologyInput (src/parse-input.ts)
 *               if you want JSON-syntax errors and schema errors handled
 *               together.
 * @param opts   Optional validation overrides.
 * @returns      `{ ok: true, input, schemaVersion }` on success with the
 *               input cast to GeneralInput (see InputValidationResult
 *               for the cast caveat), or
 *               `{ ok: false, errors, schemaVersion }` with at most one
 *               error (allErrors: false ⇒ fail-fast).
 */
export function validateTopologyInput(
  input: unknown,
  opts?: ValidateInputOptions,
): InputValidationResult {
  const version: InputSchemaVersion = opts?.version ?? "0.4.0";
  const validator = inputValidators.get(version);
  if (!validator) {
    throw new Error(
      `Internal: no compiled validator for input schema version ${JSON.stringify(version)}. ` +
        `This indicates schema-loader.ts INPUT_SCHEMA_VERSIONS was updated without a ` +
        `matching schemas/topology-input.v${version}.json file.`,
    );
  }
  if (validator(input)) {
    // The cast is the runtime-trust seam noted in InputValidationResult:
    // JSON-shape conformance is enforced by Ajv; engine-semantic
    // invariants (parameter cross-references, finiteness of every
    // weight, etc.) are enforced by assertTopologyValid inside
    // runGeneralStep when the input reaches the engine.
    return {
      ok: true,
      input: input as unknown as GeneralInput,
      schemaVersion: version,
    };
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
 * Convenience wrapper that throws if topology-input validation fails.
 * Error message summarizes every error (1 in fail-fast mode) as
 * `path: message` joined with `; `. The full structured error list
 * remains accessible via validateTopologyInput for callers that need
 * to render JSON / SARIF.
 *
 * Returns GeneralInput on success. As with validateTopologyInput, the
 * type cast is at the JSON-shape level only; engine-semantic
 * invariants are enforced by assertTopologyValid inside runGeneralStep.
 *
 * @throws Error if the input does not satisfy the topology-input
 *         schema. The thrown Error names the dispatched schema version
 *         (e.g. "Topology input schema validation failed (v0.4.0): ...").
 */
export function validateTopologyInputOrThrow(
  input: unknown,
  opts?: ValidateInputOptions,
): GeneralInput {
  const result = validateTopologyInput(input, opts);
  if (result.ok) return result.input;
  const summary = result.errors
    .map((e) => `${e.instancePath || "/"}: ${e.message}`)
    .join("; ");
  throw new Error(
    `Topology input schema validation failed (v${result.schemaVersion}): ${summary}. ` +
      `Hint: full error list available via validateTopologyInput(). ` +
      `The input must NOT contain receipt-only fields (forward, loss, ` +
      `updates, parameters_after, post_update_forward, post_update_loss, ` +
      `fixture_status); those are engine outputs.`,
  );
}

// --- v0.6 framework-trace sidecar validator ------------------------------

/**
 * Discriminated-union result of validateFrameworkTraceSidecar.
 *
 * On `ok: true` the input is structurally guaranteed (at the JSON-shape
 * level) to conform to the named framework-trace schema. The cast to
 * `unknown` mirrors validateReceiptSchema — the importer code is
 * responsible for the engine-semantic invariants (topology cross-
 * references, finite scalars, etc.).
 */
export type FrameworkTraceValidationResult =
  | { ok: true; sidecar: unknown; schemaVersion: FrameworkTraceSchemaVersion }
  | { ok: false; errors: SchemaError[]; schemaVersion: FrameworkTraceSchemaVersion };

export type ValidateFrameworkTraceOptions = {
  version?: FrameworkTraceSchemaVersion;
};

/**
 * Validate an unknown value against the framework-trace sidecar schema
 * family (v0.6 external trace ingestion input contract).
 *
 * Dispatch order:
 *   1. If `opts.version` is supplied, validate against that exact schema.
 *   2. Else, default to "0.1.0" (the only shipped version).
 *
 * Sidecars do NOT carry a `schema_version` discriminator field —
 * instead they declare a `format` constant ("framework-trace.v0.1.0").
 * The dispatcher does not branch on the format string; that's a separate
 * check the importer performs to fail loudly when a sidecar's declared
 * format doesn't match the schema version actually validating it.
 *
 * Does NOT throw on validation failure.
 */
export function validateFrameworkTraceSidecar(
  input: unknown,
  opts?: ValidateFrameworkTraceOptions,
): FrameworkTraceValidationResult {
  // v0.8 dispatch: if opts.version is explicit, use it. Else sniff
  // input.format to dispatch on the "framework-trace.v<V>" const declared
  // in the sidecar itself (this is the load-bearing path — single-step
  // callers see v0.1.0, multi-step callers see v0.2.0). Else default to
  // "0.1.0" for legacy single-step callers that pre-date the format
  // const dispatch (defensive — no current caller hits this branch).
  let version: FrameworkTraceSchemaVersion = opts?.version ?? "0.1.0";
  if (opts?.version === undefined && typeof input === "object" && input !== null) {
    const format = (input as Record<string, unknown>).format;
    if (format === "framework-trace.v0.7.0") version = "0.7.0";
    else if (format === "framework-trace.v0.6.0") version = "0.6.0";
    else if (format === "framework-trace.v0.5.0") version = "0.5.0";
    else if (format === "framework-trace.v0.4.0") version = "0.4.0";
    else if (format === "framework-trace.v0.3.0") version = "0.3.0";
    else if (format === "framework-trace.v0.2.0") version = "0.2.0";
    else if (format === "framework-trace.v0.1.0") version = "0.1.0";
  }
  const validator = frameworkTraceValidators.get(version);
  if (!validator) {
    throw new Error(
      `Internal: no compiled validator for framework-trace schema version ${JSON.stringify(version)}. ` +
        `This indicates schema-loader.ts FRAMEWORK_TRACE_SCHEMA_VERSIONS was updated without a ` +
        `matching schemas/framework-trace.v${version}.json file.`,
    );
  }
  if (validator(input)) {
    return { ok: true, sidecar: input, schemaVersion: version };
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
 * Convenience wrapper that throws if framework-trace sidecar validation
 * fails. Mirrors validateReceiptOrThrow / validateTopologyInputOrThrow.
 *
 * @throws Error if the input does not satisfy the framework-trace sidecar
 *         schema. The thrown Error names the dispatched schema version.
 */
export function validateFrameworkTraceSidecarOrThrow(
  input: unknown,
  opts?: ValidateFrameworkTraceOptions,
): unknown {
  const result = validateFrameworkTraceSidecar(input, opts);
  if (result.ok) return result.sidecar;
  const summary = result.errors
    .map((e) => `${e.instancePath || "/"}: ${e.message}`)
    .join("; ");
  throw new Error(
    `Framework-trace sidecar schema validation failed (v${result.schemaVersion}): ${summary}. ` +
      `Hint: full error list available via validateFrameworkTraceSidecar(). ` +
      `The sidecar MUST declare format: "framework-trace.v${result.schemaVersion}" and carry ` +
      `topology + inputs + targets + parameters_before + forward + loss + backward + ` +
      `updates + parameters_after.`,
  );
}
