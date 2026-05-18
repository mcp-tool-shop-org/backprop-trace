/**
 * v0.7.0 — bad-TensorFlow fixture test.
 *
 * The TensorFlow bad-fixture plate is intentionally small (1 fixture) for
 * the same reason JAX's was: the PyTorch plate already covers the
 * framework-agnostic attack classes (shape-not-math, framework-spoof,
 * collapsed-laundered, skip-without-basis, attested-mutated-after,
 * partial-tamper, trusted-source-bad-math, engine-reproduce-disagrees).
 * v0.7.0 only adds TF-DISTINCTIVE mistakes.
 *
 * The single fixture: tensorflow.bad-variable-list-order — a TensorFlow
 * extractor that sorted `model.trainable_variables` alphabetically by
 * `var.name` (instead of preserving the stable creation order TF returns
 * by default), then zipped the sorted list against parameter_ids and so
 * paired two weights with swapped slots. Same failure shape as JAX's
 * pytree-flatten-order, different root cause.
 *
 * This is the v0.7.0 third-adapter pressure test: does Rule 14 catch
 * a TF-specific extractor mistake via the same differential machinery
 * used for PyTorch (v0.6.0) and JAX (v0.6.1)? Answer: yes — no new rule,
 * no new schema, no new trust model.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reconcileReceipt } from "../src/reconcile.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")
const fpath = resolve(
  repoRoot,
  "fixtures/bad/tensorflow.bad-variable-list-order.jsonl",
)

test("tensorflow.bad-variable-list-order fires Rule 14 (differential catches swapped weights)", () => {
  if (!existsSync(fpath)) return
  const r = JSON.parse(readFileSync(fpath, "utf-8").trim())
  const result = reconcileReceipt(r)
  assert.strictEqual(result.ok, false, "must fail reconcile")
  if (result.ok) return
  const rule14 = result.failures.filter((f) => f.rule === 14)
  assert.ok(
    rule14.length >= 1,
    `expected Rule 14 failure (engine recompute disagrees on forward fields because ` +
      `parameters_before slots are swapped); got rules: ${[
        ...new Set(result.failures.map((f) => f.rule)),
      ]
        .sort()
        .join(",")}`,
  )
  // Specifically, forward.h1.net should disagree (the swap puts the wrong
  // weight at the wrong slot, so h1's net computation drifts).
  const h1NetFailure = rule14.find((f) => f.field_path === "forward.h1.net")
  assert.ok(
    h1NetFailure,
    `expected Rule 14 failure on forward.h1.net specifically (swapped weights propagate ` +
      `into h1's pre-activation net); got Rule 14 paths: ${JSON.stringify(
        rule14.map((f) => f.field_path),
      )}`,
  )
})

test("tensorflow.bad-variable-list-order also fires Rule 7 (final-state consistency on the chain)", () => {
  if (!existsSync(fpath)) return
  const r = JSON.parse(readFileSync(fpath, "utf-8").trim())
  const result = reconcileReceipt(r)
  if (result.ok) return
  const rule7 = result.failures.filter((f) => f.rule === 7)
  assert.ok(
    rule7.length >= 1,
    "Rule 7 (parameters_after consistency) should also fire — the swapped parameters_before " +
      "doesn't reconcile with parameters_after + updates because the updates were computed " +
      "from the original (un-swapped) weights",
  )
})

test("tensorflow.softmax-ce golden (observer-mode TensorFlow) reconciles cleanly", () => {
  const goldenPath = resolve(
    repoRoot,
    "fixtures/external/tensorflow.softmax-ce.golden.jsonl",
  )
  if (!existsSync(goldenPath)) return
  const r = JSON.parse(readFileSync(goldenPath, "utf-8").trim())
  const result = reconcileReceipt(r)
  assert.strictEqual(
    result.ok,
    true,
    `TensorFlow observer-mode golden must reconcile cleanly; got: ${
      result.ok === false
        ? JSON.stringify(
            result.failures.map((f) => ({
              rule: f.rule,
              field_path: f.field_path,
            })),
          )
        : "ok"
    }`,
  )
})
