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
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Tuple of all receipt schema versions this package ships. New versions
 * append here AND require dropping `schemas/receipt.v<version>.json` in
 * the package payload. The tuple is `as const` so SchemaVersion is the
 * union of string literals (not just `string`).
 */
export const SCHEMA_VERSIONS = ["0.1.0"] as const;

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
 * @param version  Schema version to load. Defaults to "0.1.0" — the only
 *                 version shipped in v0.1.
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
