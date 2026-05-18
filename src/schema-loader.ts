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
 * v0.9.1 ships five:
 *   - "0.1.0" — the Mazur-pinned single-topology schema (v0.1/v0.2 wave)
 *   - "0.2.0" — the generalized schema (REQUIRED unit_order + parameter_order,
 *     hybrid tolerance object form, optional trace_id/step_index for multi-step,
 *     bias_sharing per_layer or per_neuron, half_squared_error loss only)
 *   - "0.3.0" — v0.5 softmax+CE additive (topology.activation_output enum
 *     extended with "softmax"; topology.loss enum extended with
 *     "cross_entropy_softmax"; OutputErrorSignal gains optional dual_form
 *     for Rule 13 gated dual-form consistency).
 *   - "0.4.0" — v0.6 external ingestion additive (top-level optional
 *     source_framework + attestor blocks for observer-mode receipts;
 *     fixture_status.authoring_state enum gains "external_imported";
 *     fixture_status.verification_state enum gains three external states).
 *     Extended in-place v0.8 (attestor.bundle_root_digest for Rule 17)
 *     and v0.9 (top-level batch + per_sample + loss.{reduction, per_sample}
 *     for Rules 18, 19). See docs/schema.md compatibility note.
 *   - "0.5.0" — v0.9.1 Adam + AdamW optimizer extension (FORCED bump:
 *     Update.optimizer.name was closed enum ["sgd"] and Update.optimizer
 *     had additionalProperties:false; widening to ["sgd","adam","adamw"]
 *     plus per-update state_before/state_after plus top-level
 *     optimizer_config block could not happen in-place. SGD-only receipts
 *     stay at "0.4.0" byte-equal; Adam/AdamW receipts declare "0.5.0".
 *     Rules 20, 22, 23, 24, 25, 26 fire on this version.
 *   - "0.6.0" — v0.9.2 classical PyTorch-style SGD momentum extension
 *     (FORCED bump: Update.optimizer.name was closed enum
 *     ["sgd","adam","adamw"] and AdamState had additionalProperties:false
 *     on required [m, v]; widening to ["sgd","adam","adamw","sgd_momentum"]
 *     plus new MomentumState shape {buffer} could not happen in-place).
 *     SGD/Adam/AdamW receipts stay at v0.4.0/v0.5.0 byte-equal;
 *     classical sgd_momentum receipts declare "0.6.0". Rule 21 (classical
 *     PyTorch-style recurrence + parameter update) fires on this version.
 *     Reserves nesterov: const false + dampening: const 0 for v0.9.3
 *     forward-compat. Rejects weight_decay on sgd_momentum at schema
 *     level (SGD coupled L2 deferred to v0.10).
 *   - "0.7.0" — v0.9.3 Nesterov + dampening extension for sgd_momentum
 *     (FORCED bump: v0.6.0 reserved nesterov: const false and dampening:
 *     const 0; widening these consts to boolean and number-in-[0,1) is
 *     schema-breaking for v0.6.0-pinned validators). v0.6.0 classical
 *     sgd_momentum receipts stay byte-equal; v0.9.3 receipts with
 *     nesterov: true OR dampening != 0 declare "0.7.0". Rule 21 splits
 *     into sub-checks 21a (buffer recurrence widened for dampening),
 *     21b (effective gradient direction — Nesterov vs classical), 21c
 *     (parameter update). PyTorch's torch.optim.SGD.__init__ raises
 *     ValueError on nesterov=true && dampening>0; v0.7.0 mirrors this
 *     rejection at schema (allOf if/then) + engine boundary.
 *
 * Receipts that say `schema_version: "0.1.0"` continue to validate against
 * the v0.1.0 schema for byte-equal preservation. v0.3-onward generalized
 * receipts (XOR, iris, multi-step, per-neuron-bias) declare "0.2.0".
 * v0.5 softmax+CE receipts declare "0.3.0". v0.6 external observer-mode
 * receipts (output of `bp import pytorch`) declare "0.4.0". v0.9.1 Adam +
 * AdamW receipts declare "0.5.0" (SGD-only observer-mode receipts stay
 * at "0.4.0" for byte-equal preservation). v0.9.2 classical PyTorch-style
 * sgd_momentum receipts declare "0.6.0". v0.9.3 Nesterov OR dampening
 * sgd_momentum receipts declare "0.7.0" (classical sgd_momentum stays at
 * "0.6.0"; SGD at "0.4.0"; Adam/AdamW at "0.5.0"; all byte-equal preserved).
 */
export const SCHEMA_VERSIONS = ["0.1.0", "0.2.0", "0.3.0", "0.4.0", "0.5.0", "0.6.0", "0.7.0"] as const;

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
 *
 * Note: v0.6 adds a SEPARATE input-schema family for external trace
 * ingestion (`framework-trace.v0.1.0.json`) consumed by `bp import`.
 * That family lives in its own tuple (FRAMEWORK_TRACE_SCHEMA_VERSIONS)
 * because its purpose is different — it describes foreign-framework
 * sidecars, not topology authoring inputs.
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

// --- v0.6 framework-trace sidecar schema family --------------------------

/**
 * Tuple of all framework-trace sidecar schema versions this package ships.
 * The sidecar is the input format consumed by `bp import <framework>` —
 * a USER-AUTHORED JSON capture of a foreign framework's per-step training
 * trace (forward / loss / backward / updates / parameters_after). It is
 * distinct from the topology-input schema family: topology-input describes
 * what the user authors BEFORE the engine runs; framework-trace describes
 * what a foreign framework computed AFTER its engine ran. The two have
 * different fields, different consumers, and different version lineages.
 *
 * v0.9.1 ships four:
 *   - "0.1.0" — initial PyTorch/JAX-shaped single-step sidecar. Carries
 *     topology + inputs + targets + parameters_before + claimed forward
 *     + claimed loss + claimed backward + claimed updates + claimed
 *     parameters_after. The importer adds source_framework + attestor +
 *     fixture_status and runs runGeneralStep as the differential witness.
 *   - "0.2.0" — v0.8 multi-step JSONL stream additive (optional trace_id +
 *     step_index with co-presence guard).
 *   - "0.3.0" — v0.9 batched sidecar additive (optional top-level batch
 *     block + per_sample block + extended Loss).
 *   - "0.4.0" — v0.9.1 Adam + AdamW additive (optional top-level optimizer
 *     block with hyperparameters + per-update state_before/state_after on
 *     Update.optimizer; optimizer.name widened to ['sgd','adam','adamw']).
 *     Existing v0.3.0 SGD sidecars stay on v0.3.0 byte-equal; Adam/AdamW
 *     sidecars declare format: "framework-trace.v0.4.0".
 *   - "0.5.0" — v0.9.2 classical PyTorch-style sgd_momentum additive
 *     (optimizer.name widened to ['sgd','adam','adamw','sgd_momentum'];
 *     OptimizerConfig.momentum required when name === 'sgd_momentum';
 *     nesterov: const false + dampening: const 0 reserved for v0.9.3;
 *     weight_decay rejected for sgd_momentum at schema level — SGD coupled
 *     L2 deferred to v0.10; MomentumState shape {buffer} as state_before/
 *     state_after on the Update.optimizer). Existing v0.4.0 Adam/AdamW
 *     sidecars stay byte-equal; classical sgd_momentum sidecars declare
 *     format: "framework-trace.v0.5.0".
 *   - "0.6.0" — v0.9.3 Nesterov + dampening additive for sgd_momentum
 *     (FORCED bump: v0.5.0's reserved consts widen — nesterov from
 *     const false to boolean, dampening from const 0 to number in
 *     [0, 1)). PyTorch's torch.optim.SGD.__init__ rejection of
 *     nesterov=true && dampening>0 mirrored at schema via allOf
 *     if/then clause + engine boundary. v0.5.0 classical sgd_momentum
 *     sidecars stay byte-equal; sidecars with nesterov=true OR
 *     dampening>0 declare format: "framework-trace.v0.6.0".
 */
export const FRAMEWORK_TRACE_SCHEMA_VERSIONS = ["0.1.0", "0.2.0", "0.3.0", "0.4.0", "0.5.0", "0.6.0"] as const;

/**
 * Union of currently-shipped framework-trace sidecar schema versions.
 */
export type FrameworkTraceSchemaVersion =
  (typeof FRAMEWORK_TRACE_SCHEMA_VERSIONS)[number];

const frameworkTraceSchemaCache = new Map<string, object>();

/**
 * Load and return the parsed framework-trace sidecar schema for the given
 * version. Cached on first read; subsequent calls return the same instance.
 *
 * Parallels getReceiptSchema + getInputSchema. Reads from
 * `schemas/framework-trace.v<version>.json`.
 *
 * @param version  Schema version to load. Defaults to "0.1.0" (the only
 *                 shipped framework-trace schema as of v0.6).
 * @throws         Error if `version` is not in
 *                 FRAMEWORK_TRACE_SCHEMA_VERSIONS or the file is missing.
 */
export function getFrameworkTraceSchema(
  version: FrameworkTraceSchemaVersion = "0.1.0",
): object {
  const cached = frameworkTraceSchemaCache.get(version);
  if (cached) return cached;
  if (!FRAMEWORK_TRACE_SCHEMA_VERSIONS.includes(version)) {
    throw new Error(
      `Unknown framework-trace schema version: ${JSON.stringify(version)}. ` +
        `Known versions: ${FRAMEWORK_TRACE_SCHEMA_VERSIONS.join(", ")}.`,
    );
  }
  const schemaPath = resolve(
    __dirname,
    "..",
    "schemas",
    `framework-trace.v${version}.json`,
  );
  const loaded = JSON.parse(readFileSync(schemaPath, "utf-8")) as object;
  frameworkTraceSchemaCache.set(version, loaded);
  return loaded;
}
