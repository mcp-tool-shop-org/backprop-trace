import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

test(
  "bp reconcile receipt fixtures/bad/mazur.bad-gradient.jsonl exits nonzero with single-target Rule 4 stderr",
  () => {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/bin/bp.ts",
        "reconcile",
        "receipt",
        "fixtures/bad/mazur.bad-gradient.jsonl",
      ],
      { cwd: repoRoot, encoding: "utf-8" },
    );

    assert.notStrictEqual(result.status, 0, "exit code must be nonzero");
    assert.strictEqual(result.stdout, "", "stdout must be empty");

    const stderr = result.stderr;
    assert.match(stderr, /reconciliation failed/, "stderr must contain 'reconciliation failed'");
    assert.match(stderr, /Rule 4/, "stderr must name Rule 4");
    assert.match(stderr, /w5/, "stderr must identify parameter w5");
    assert.match(
      stderr,
      /stored gradient:\s+-0\.082166041/,
      "stderr must include the stored gradient value",
    );
    assert.match(
      stderr,
      /recomputed gradient:\s+-0\.0821670/,
      "stderr must include the recomputed gradient value (prefix match for float serialization)",
    );
    assert.match(stderr, /tolerance/, "stderr must mention tolerance");

    // Single-target invariant: exactly one Rule 4 section, only naming w5.
    // Anti-circularity gate must isolate the deliberate failure from
    // incidental precision noise on other parameters.
    const rule4Sections = stderr.match(/^Rule 4:/gm) || [];
    assert.strictEqual(
      rule4Sections.length,
      1,
      `exactly one Rule 4 failure expected (w5 only); stderr had ${rule4Sections.length} Rule 4 sections`,
    );
    assert.doesNotMatch(
      stderr,
      /\bw6\b|\bw8\b/,
      "no other parameters (w6, w8) should appear in failure stderr — bad fixture must isolate to w5",
    );
  },
);
