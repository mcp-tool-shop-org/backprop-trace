import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runMazurStep } from "../src/engine.js";
import { emitMazurReceipt } from "../src/emit.js";
import { MAZUR_INPUT } from "../src/mazur.js";
import { reconcileReceipt } from "../src/reconcile.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const outputPath = resolve(repoRoot, "tmp/mazur.generated.jsonl");
const goldenPath = resolve(repoRoot, "fixtures/mazur.golden.jsonl");
const publishedPath = resolve(repoRoot, "fixtures/mazur.published.json");

// Pinned engine value for post_update_loss.total.
// Source: V8/Node 22 IEEE-754 first-run output on the Mazur 2-2-2 fixture.
// This is the engine's canonical value; the widely-cited anchor 0.291027924
// differs by ~1.5e-7 and is documented in fixtures/mazur.published.json
// with reproduction_status = "drift_observed" and hard_gate = false.
const ENGINE_POST_UPDATE_LOSS_TOTAL = 0.29102777369359933;
const PUBLISHED_POST_UPDATE_LOSS_TOTAL = 0.291027924;

test("Mazur engine first-run: generate, emit, write, byte-equal vs golden, reconcile", () => {
  // 1. Run the engine
  const receipt = runMazurStep(MAZUR_INPUT);

  // 2. In-memory structural assertions
  assert.strictEqual(receipt.schema_version, "0.1.0", "schema_version pinned");
  assert.strictEqual(receipt.step, 1, "step is 1");
  assert.strictEqual(
    receipt.post_update_forward.status,
    "filled",
    "post_update_forward.status === 'filled'",
  );
  assert.strictEqual(
    receipt.post_update_loss.status,
    "filled",
    "post_update_loss.status === 'filled'",
  );

  // 3. Pinned engine value (V8/Node 22 deterministic)
  assert.strictEqual(
    receipt.post_update_loss.total,
    ENGINE_POST_UPDATE_LOSS_TOTAL,
    "engine post_update_loss.total must match the pinned V8/Node 22 value",
  );

  // 4. Emit and byte-level assertions
  const emitted = emitMazurReceipt(receipt);
  assert.ok(emitted.endsWith("\n"), "emitted text must end with LF");
  assert.ok(!emitted.includes("\r"), "emitted text must contain no CR (no CRLF)");
  assert.ok(
    !emitted.includes(": "),
    "emitted text must not contain whitespace after colons",
  );
  assert.ok(
    !emitted.includes(", "),
    "emitted text must not contain whitespace after commas",
  );
  assert.match(
    emitted,
    /"tolerance":0\.[0-9]+/,
    "tolerance must emit as plain-decimal value",
  );
  assert.ok(
    !/"tolerance":[+-]?[0-9.]+[eE]/.test(emitted),
    "tolerance must not emit as scientific notation",
  );

  // 5. Write to tmp/ (gitignored) and verify file-level invariants
  mkdirSync(resolve(repoRoot, "tmp"), { recursive: true });
  writeFileSync(outputPath, emitted, { encoding: "utf-8" });
  const onDisk = readFileSync(outputPath, "utf-8");
  assert.strictEqual(onDisk, emitted, "on-disk content must match emitted bytes");
  assert.ok(onDisk.endsWith("\n"), "on-disk file must end with LF");
  assert.ok(!onDisk.includes("\r"), "on-disk file must contain no CR");

  const nonEmpty = onDisk.split("\n").filter((l) => l.length > 0);
  assert.strictEqual(
    nonEmpty.length,
    1,
    "tmp/mazur.generated.jsonl must contain exactly one JSONL record",
  );

  // 6. Byte-equality against the committed golden
  const golden = readFileSync(goldenPath, "utf-8");
  assert.strictEqual(
    onDisk,
    golden,
    "engine output must byte-equal fixtures/mazur.golden.jsonl",
  );

  // 7. Reconcile the generated receipt (math holds)
  const reparsed: unknown = JSON.parse(onDisk);
  const result = reconcileReceipt(reparsed);
  if (!result.ok) {
    throw new Error(
      `Generated Mazur receipt failed reconciliation:\n${JSON.stringify(result.failures, null, 2)}`,
    );
  }
});

test("fixtures/mazur.published.json documents post_update_total_error drift as WARN-only", () => {
  type Claim = {
    id: string;
    value: number;
    claim_type: string;
    reproduction_status: string;
    hard_gate: boolean;
    engine_reproduced_value?: number;
    drift_absolute?: number;
    drift_note?: string;
  };
  type Published = { claims: Claim[] };

  const published = JSON.parse(readFileSync(publishedPath, "utf-8")) as Published;
  const claim = published.claims.find((c) => c.id === "post_update_total_error");
  assert.ok(claim, "post_update_total_error claim must exist in published ledger");

  assert.strictEqual(
    claim.value,
    PUBLISHED_POST_UPDATE_LOSS_TOTAL,
    "claim records the widely-cited anchor 0.291027924",
  );
  assert.strictEqual(
    claim.claim_type,
    "widely_cited_downstream_anchor",
    "claim is classified as widely_cited_downstream_anchor",
  );
  assert.strictEqual(
    claim.reproduction_status,
    "drift_observed",
    "claim records drift_observed (engine value differs from anchor)",
  );
  assert.strictEqual(
    claim.hard_gate,
    false,
    "drift on this claim is not a hard gate — bp verify mazur WARNs, does not FAIL",
  );
  assert.strictEqual(
    claim.engine_reproduced_value,
    ENGINE_POST_UPDATE_LOSS_TOTAL,
    "claim records the engine's actual computed value",
  );

  // Sanity: drift_absolute matches the computed difference.
  const expectedDrift = PUBLISHED_POST_UPDATE_LOSS_TOTAL - ENGINE_POST_UPDATE_LOSS_TOTAL;
  assert.ok(
    claim.drift_absolute !== undefined &&
      Math.abs(claim.drift_absolute - expectedDrift) < 1e-15,
    `drift_absolute must equal published - engine (expected ${expectedDrift}, got ${claim.drift_absolute})`,
  );
});
