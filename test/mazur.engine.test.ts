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

test("Mazur engine first-run: generate, emit, write to tmp/, reconcile", () => {
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

  // Log post_update_loss.total for diagnostic visibility. Comparison against
  // the widely-cited Mazur anchor 0.291027924 belongs to the later
  // published-anchor drift slice, not here.
  // eslint-disable-next-line no-console
  console.log(
    `[engine] post_update_loss.total = ${receipt.post_update_loss.total}`,
  );

  // 3. Emit
  const emitted = emitMazurReceipt(receipt);

  // 4. Byte-level assertions on emitted text (before disk write)
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

  // Tolerance must emit as plain decimal, not scientific notation.
  assert.match(
    emitted,
    /"tolerance":0\.[0-9]+/,
    "tolerance must emit as plain-decimal value",
  );
  assert.ok(
    !/"tolerance":[+-]?[0-9.]+[eE]/.test(emitted),
    "tolerance must not emit as scientific notation",
  );

  // 5. Write to tmp/ (gitignored)
  mkdirSync(resolve(repoRoot, "tmp"), { recursive: true });
  writeFileSync(outputPath, emitted, { encoding: "utf-8" });

  // 6. File-level invariants after disk round-trip
  const onDisk = readFileSync(outputPath, "utf-8");
  assert.strictEqual(onDisk, emitted, "on-disk content must match emitted bytes");
  assert.ok(onDisk.endsWith("\n"), "on-disk file must end with LF");
  assert.ok(!onDisk.includes("\r"), "on-disk file must contain no CR");

  // Exactly one JSONL record (one non-empty line, terminated by LF).
  const lines = onDisk.split("\n");
  const nonEmpty = lines.filter((l) => l.length > 0);
  assert.strictEqual(
    nonEmpty.length,
    1,
    "tmp/mazur.generated.jsonl must contain exactly one JSONL record",
  );

  // 7. Reconcile the generated receipt
  const reparsed: unknown = JSON.parse(onDisk);
  const result = reconcileReceipt(reparsed);
  if (!result.ok) {
    throw new Error(
      `Generated Mazur receipt failed reconciliation:\n${JSON.stringify(result.failures, null, 2)}`,
    );
  }
});
