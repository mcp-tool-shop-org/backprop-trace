/**
 * FT-C-003 `bp validate` CLI tests.
 *
 *   1. `bp validate fixtures/mazur.golden.jsonl` exits 0.
 *   2. `bp validate <bad-schema-fixture>` exits 1 with schema errors on stderr.
 *   3. `bp validate --json` writes a structured envelope to stdout.
 *
 * For (2) we construct a deliberately schema-bad receipt in tmp/ so the
 * test doesn't depend on the CI/Docs agent shipping a specific bad-schema
 * fixture.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const tmpDir = resolve(repoRoot, "tmp");

function runBp(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/bin/bp.ts", ...args],
    { cwd: repoRoot, encoding: "utf-8" },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function writeBadSchemaReceipt(): string {
  mkdirSync(tmpDir, { recursive: true });
  // Clone the golden and break it in a way the schema rejects: drop the
  // required `fixture_status` block.
  const goldenPath = resolve(repoRoot, "fixtures/mazur.golden.jsonl");
  const golden = JSON.parse(readFileSync(goldenPath, "utf-8")) as Record<
    string,
    unknown
  >;
  delete golden.fixture_status;
  const outPath = resolve(tmpDir, "bp-validate-bad-schema.json");
  writeFileSync(outPath, JSON.stringify(golden), { encoding: "utf-8" });
  return outPath;
}

test("bp validate fixtures/mazur.golden.jsonl exits 0", () => {
  const { status, stderr } = runBp([
    "validate",
    "fixtures/mazur.golden.jsonl",
  ]);
  assert.strictEqual(
    status,
    0,
    `bp validate <golden> must exit 0; got ${status}\nstderr: ${stderr}`,
  );
});

test("bp validate <bad-schema-fixture> exits 1 with errors", () => {
  const badPath = writeBadSchemaReceipt();
  const { status, stderr } = runBp(["validate", badPath]);
  assert.strictEqual(
    status,
    1,
    `bp validate <bad-schema> must exit 1; got ${status}\nstderr: ${stderr}`,
  );
  assert.match(
    stderr,
    /schema validation failed|error|required|fixture_status/i,
    `stderr should report the schema failure context; got: ${JSON.stringify(stderr)}`,
  );
});

test("bp validate --json emits {ok:true} for the golden", () => {
  const { status, stdout, stderr } = runBp([
    "validate",
    "--json",
    "fixtures/mazur.golden.jsonl",
  ]);
  assert.strictEqual(
    status,
    0,
    `bp validate --json <golden> must exit 0; got ${status}\nstderr: ${stderr}\nstdout: ${stdout}`,
  );
  const parsed = JSON.parse(stdout.trim()) as { ok: boolean };
  assert.strictEqual(parsed.ok, true, `envelope.ok must be true; got: ${JSON.stringify(parsed)}`);
});

test("bp validate --json on a bad-schema fixture emits ok:false with errors[]", () => {
  const badPath = writeBadSchemaReceipt();
  const { status, stdout, stderr } = runBp(["validate", "--json", badPath]);
  assert.strictEqual(
    status,
    1,
    `bp validate --json <bad-schema> must exit 1; got ${status}\nstderr: ${stderr}`,
  );
  const parsed = JSON.parse(stdout.trim()) as {
    ok: boolean;
    errors?: Array<{ schemaPath?: string; message?: string }>;
  };
  assert.strictEqual(parsed.ok, false, "ok must be false on schema violation");
  assert.ok(
    Array.isArray(parsed.errors) && parsed.errors.length >= 1,
    `errors[] must be non-empty; got: ${JSON.stringify(parsed)}`,
  );
});
