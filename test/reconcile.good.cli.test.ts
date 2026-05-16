/**
 * T-A-004: end-to-end success path for `bp reconcile receipt`.
 *
 * Pins the no-news-is-good-news contract: when a receipt's math holds, the
 * CLI exits 0 silently (no stdout, no stderr). Pre-amend the CLI had no
 * test for the success path at all — only the deliberate-failure fixture
 * had CLI coverage, so an accidental regression that printed something
 * useful-looking to stdout on a passing run would have gone undetected.
 *
 * Uses the canonical Mazur golden fixture, which is engine-generated and
 * passes Rule 4 by construction.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

test(
  "bp reconcile receipt fixtures/mazur.golden.jsonl exits 0 with empty stdout and empty stderr",
  () => {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/bin/bp.ts",
        "reconcile",
        "receipt",
        "fixtures/mazur.golden.jsonl",
      ],
      { cwd: repoRoot, encoding: "utf-8" },
    );

    assert.strictEqual(
      result.status,
      0,
      `success path must exit 0 (got ${result.status}); stderr=${JSON.stringify(result.stderr)}`,
    );
    assert.strictEqual(
      result.stdout,
      "",
      `success path must produce empty stdout (no-news-is-good-news); got: ${JSON.stringify(result.stdout)}`,
    );
    assert.strictEqual(
      result.stderr,
      "",
      `success path must produce empty stderr; got: ${JSON.stringify(result.stderr)}`,
    );
  },
);
