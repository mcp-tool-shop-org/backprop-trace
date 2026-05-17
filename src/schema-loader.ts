/**
 * Schema loader — versioned access to receipt JSON schemas (FT-F-005).
 *
 * Reads `schemas/receipt.v<version>.json` from the package's shipped
 * `schemas/` directory and caches the parsed object so repeat reads cost
 * one map lookup. The loader is the single source of truth for "which
 * receipt schemas this build ships with" — adding a new schema version
 * requires updating SCHEMA_VERSIONS and dropping the file in `schemas/`;
 * the loader code itself does not need to change.
 *
 * Module-cache parity: this is independent of the Ajv-compiled validator
 * in src/validate.ts. The validator is hard-pinned to v0.1.0 in v0.1;
 * this loader exists so external consumers can introspect the schema
 * itself (e.g. for documentation generation, OpenAPI integration, or
 * client-side validators in other languages).
 *
 * v0.4 adds a parallel loader for the *input* schema family
 * (`schemas/topology-input.v<version>.json`). Input schemas describe the
 * shape consumed by `bp generate from-config` BEFORE the engine runs;
 * they intentionally PROHIBIT receipt-only fields (forward, loss,
 * updates, parameters_after, post_update_forward, post_update_loss,
 * fixture_status) via the schema's `additionalProperties: false` +
 * explicit property list. This is the trust-boundary preservation pinned
 * in the v0.4 consolidator decision §7 (risk 1: canonical-emission
 * trust leakage). Receipt schemas and input schemas are versioned
 * independently — they share the same `schemas/` directory but live on
 * separate version tuples, separate caches, and separate getter
 * functions. A receipt schema bump does NOT force an input schema bump,
 * and vice versa.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Tuple of all receipt schema versions this package ships. New versions
 * append here AND require dropping `schemas/receipt.v<version>.json` in
 * the package payload. The tuple is `as const` so SchemaVersion is the
 * union of string literals (not just `string`).
 *
 * v0.5 ships three:
 *   - "0.1.0" — the Mazur-pinned single-topology schema (v0.1/v0.2 wave)
 *   - "0.2.0" — the generalized schema (REQUIRED unit_order + parameter_order,
 *     hybrid tolerance object form, optional trace_id/step_index for multi-step,
 *     bias_sharing per_layer or per_neuron, half_squared_error loss only)
 *   - "0.3.0" — v0.5 softmax+CE additive (topology.activation_output enum
 *     extended with "softmax"; topology.loss enum extended with
 *     "cross_entropy_softmax"; OutputErrorSignal gains optional dual_form
 *     for Rule 13 gated dual-form consistency).
 *
 * Receipts that say `schema_version: "0.1.0"` continue to validate against
 * the v0.1.0 schema for byte-equal preservation. v0.3-onward generalized
 * receipts (XOR, iris, multi-step, per-neuron-bias) declare "0.2.0".
 * v0.5 softmax+CE receipts declare "0.3.0".
 */
export const SCHEMA_VERSIONS = ["0.1.0", "0.2.0", "0.3.0"] as const;

/**
 * Union of currently-shipped receipt schema versions. Use this for any
 * caller that wants to opt-in to a specific version.
 */
export type SchemaVersion = (typeof SCHEMA_VERSIONS)[number];

// Resolve schemas/ relative to THIS module (same trick as src/validate.ts;
// see that file for the dist/ vs src/ resolution rationale).
const __dirname = dirname(fileURLToPath(import.meta.url));

const schemaCache = new Map<string, object>();

/**
 * Load and return the parsed receipt schema for the given version.
 *
 * Cached on first read; subsequent calls return the same object instance
 * (do NOT mutate the returned object — it is shared across callers).
 *
 * @param version  Schema version to load. Defaults to "0.1.0" for
 *                 backward compatibility with v0.1/v0.2 callers; v0.3
 *                 callers handling generalized receipts should pass
 *                 "0.2.0" explicitly.
 * @returns        The parsed JSON-Schema object (NOT the raw text).
 * @throws         Error if `version` is not in SCHEMA_VERSIONS, OR if
 *                 the corresponding file is missing / unreadable / not
 *                 valid JSON. Errors are designed to fail loudly at
 *                 module-load time of a downstream consumer (e.g. an
 *                 OpenAPI generator) so the broken state surfaces in CI
 *                 rather than at runtime against real input.
 */
export function getReceiptSchema(version: SchemaVersion = "0.1.0"): object {
  const cached = schemaCache.get(version);
  if (cached) return cached;
  if (!SCHEMA_VERSIONS.includes(version)) {
    throw new Error(
      `Unknown schema version: ${JSON.stringify(version)}. ` +
        `Known versions: ${SCHEMA_VERSIONS.join(", ")}.`,
    );
  }
  const schemaPath = resolve(
    __dirname,
    "..",
    "schemas",
    `receipt.v${version}.json`,
  );
  const loaded = JSON.parse(readFileSync(schemaPath, "utf-8")) as object;
  schemaCache.set(version, loaded);
  return loaded;
}

/**
 * Tuple of all topology-input schema versions this package ships. New
 * versions append here AND require dropping
 * `schemas/topology-input.v<version>.json` in the package payload.
 *
 * v0.4 ships:
 *   - "0.4.0" — the initial topology+input schema for
 *     `bp generate from-config`. Validates topology, inputs, targets,
 *     parameters_before, numeric_policy, bias_policy, learning_rate,
 *     and optional fixture/metadata/trace_id/step_index. Prohibits
 *     receipt-only fields via `additionalProperties: false`.
 *
 * Input schemas are versioned INDEPENDENTLY from receipt schemas: a
 * receipt-schema bump (e.g. v0.2.0 → v0.3.0) does NOT force an input
 * schema bump, and vice versa. Both families coexist in the same
 * `schemas/` directory but on disjoint version tuples.
 */
export const INPUT_SCHEMA_VERSIONS = ["0.4.0"] as const;

/**
 * Union of currently-shipped topology-input schema versions.
 */
export type InputSchemaVersion = (typeof INPUT_SCHEMA_VERSIONS)[number];

const inputSchemaCache = new Map<string, object>();

/**
 * Load and return the parsed topology-input schema for the given version.
 *
 * Cached on first read; subsequent calls return the same object instance
 * (do NOT mutate the returned object — it is shared across callers).
 *
 * Parallel to getReceiptSchema. Reads from
 * `schemas/topology-input.v<version>.json`.
 *
 * @param version  Schema version to load. Defaults to "0.4.0" (the
 *                 only shipped input schema as of v0.4).
 * @returns        The parsed JSON-Schema object (NOT the raw text).
 * @throws         Error if `version` is not in INPUT_SCHEMA_VERSIONS,
 *                 OR if the corresponding file is missing / unreadable /
 *                 not valid JSON. Same fail-loud-at-module-load posture
 *                 as getReceiptSchema.
 */
export function getInputSchema(
  version: InputSchemaVersion = "0.4.0",
): object {
  const cached = inputSchemaCache.get(version);
  if (cached) return cached;
  if (!INPUT_SCHEMA_VERSIONS.includes(version)) {
    throw new Error(
      `Unknown input schema version: ${JSON.stringify(version)}. ` +
        `Known versions: ${INPUT_SCHEMA_VERSIONS.join(", ")}.`,
    );
  }
  const schemaPath = resolve(
    __dirname,
    "..",
    "schemas",
    `topology-input.v${version}.json`,
  );
  const loaded = JSON.parse(readFileSync(schemaPath, "utf-8")) as object;
  inputSchemaCache.set(version, loaded);
  return loaded;
}
