/**
 * ci-future-B-006 — exports/packaging drift gate.
 *
 * package.json `exports` and scripts/pack-install-smoke.mjs's
 * REQUIRED_TARBALL_ENTRIES hand-enumerate ~19 module subpaths + ~15 schema
 * subpaths. Hand-maintained lists drift: someone adds schemas/foo.json or a
 * new src/foo.ts module and forgets the matching `exports` entry, so the
 * subpath silently 404s for consumers — and nothing catches it until a user
 * files a bug.
 *
 * This test is that catch. It is DETERMINISTIC (globs the repo, no network,
 * no torch) and OWNS one direction of the contract per assertion:
 *
 *   1. SCHEMA COVERAGE: every schemas/*.json on disk MUST be reachable via
 *      some `exports["./schema*"]` target. A new schema file with no export
 *      entry fails here. (This is the high-value direction: schema files are
 *      the public receipt/trace contract; an unexported schema is a broken
 *      promise.)
 *   2. NO DANGLING SCHEMA EXPORTS: every `exports` target that points into
 *      schemas/ MUST resolve to a file that exists on disk. A typo or a
 *      deleted-but-still-exported schema fails here.
 *   3. MODULE SOURCE BACKING: every `./foo` module export targets
 *      ./dist/foo.js, which is compiled from src/foo.ts. The source file MUST
 *      exist. A renamed/removed src module whose export entry lingers fails
 *      here (build would emit no dist/foo.js, so the export would dangle at
 *      runtime).
 *
 * Why a test and not a lint rule: the drift class spans two files
 * (package.json + the schemas/ + src/ trees) and is exactly the regression
 * the pack-smoke wildcard count assertion was reaching for but cannot express
 * for the EXPORTS map specifically. node:test keeps it in the same suite the
 * rest of CI already runs, so it goes RED on the same lane.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")

const pkg = JSON.parse(
  readFileSync(resolve(repoRoot, "package.json"), "utf-8"),
) as { exports: Record<string, unknown> }

/**
 * Flatten an exports map into a list of concrete relative target paths.
 * Handles both the string form (`"./schema": "./schemas/x.json"`) and the
 * conditional-object form (`{ "import": "./dist/x.js", "types": "..." }`).
 */
function exportTargets(exportsMap: Record<string, unknown>): string[] {
  const targets: string[] = []
  for (const value of Object.values(exportsMap)) {
    if (typeof value === "string") {
      targets.push(value)
    } else if (value && typeof value === "object") {
      for (const inner of Object.values(value as Record<string, unknown>)) {
        if (typeof inner === "string") targets.push(inner)
      }
    }
  }
  return targets
}

const allTargets = exportTargets(pkg.exports)

test("ci-future-B-006: every schemas/*.json is reachable via an exports entry", () => {
  const schemaFiles = readdirSync(resolve(repoRoot, "schemas")).filter((f) =>
    f.endsWith(".json"),
  )
  assert.ok(
    schemaFiles.length > 0,
    "expected at least one schema file under schemas/",
  )

  // The set of schema basenames that some exports target points at.
  const exportedSchemaBasenames = new Set(
    allTargets
      .filter((t) => t.startsWith("./schemas/"))
      .map((t) => t.slice("./schemas/".length)),
  )

  const unexported = schemaFiles.filter(
    (f) => !exportedSchemaBasenames.has(f),
  )
  assert.deepStrictEqual(
    unexported,
    [],
    `schemas/ files with NO package.json exports entry (drift — add a ` +
      `"./schema/..." subpath in package.json exports):\n  - ${unexported.join(
        "\n  - ",
      )}`,
  )
})

test("ci-future-B-006: every schema exports target resolves to a file on disk", () => {
  const schemaTargets = allTargets.filter((t) => t.startsWith("./schemas/"))
  assert.ok(
    schemaTargets.length > 0,
    "expected at least one ./schemas/ exports target",
  )

  const dangling = schemaTargets.filter(
    (t) => !existsSync(resolve(repoRoot, t)),
  )
  assert.deepStrictEqual(
    dangling,
    [],
    `package.json exports points at schema files that do NOT exist on disk ` +
      `(typo or deleted schema):\n  - ${dangling.join("\n  - ")}`,
  )
})

test("ci-future-B-006: every ./dist module export is backed by a src/*.ts source", () => {
  // Module exports target ./dist/<name>.js (and a parallel .d.ts). dist/ is a
  // build artifact and may be absent in a fresh checkout, so we verify the
  // SOURCE that produces it (src/<name>.ts) exists instead — that's the file a
  // contributor actually adds/removes, and the real drift surface.
  const distJsTargets = allTargets.filter(
    (t) => t.startsWith("./dist/") && t.endsWith(".js"),
  )
  assert.ok(
    distJsTargets.length > 0,
    "expected at least one ./dist/*.js exports target",
  )

  const missingSource: string[] = []
  for (const t of distJsTargets) {
    // ./dist/bin/bp.js -> src/bin/bp.ts ; ./dist/index.js -> src/index.ts
    const rel = t.slice("./dist/".length).replace(/\.js$/, ".ts")
    const srcPath = resolve(repoRoot, "src", rel)
    if (!existsSync(srcPath)) missingSource.push(`${t}  (expected src/${rel})`)
  }
  assert.deepStrictEqual(
    missingSource,
    [],
    `package.json exports points at dist modules with NO backing src/*.ts ` +
      `(renamed/removed module left a dangling export):\n  - ${missingSource.join(
        "\n  - ",
      )}`,
  )
})
