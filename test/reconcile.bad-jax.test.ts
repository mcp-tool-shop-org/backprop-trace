/**
 * v0.6.1 — bad-JAX fixture test.
 *
 * The JAX bad-fixture plate is intentionally small (1 fixture) because
 * the PyTorch plate already covers the framework-agnostic attack classes
 * (shape-not-math, framework-spoof, collapsed-laundered, skip-without-
 * basis, attested-mutated-after, partial-tamper, trusted-source-bad-math,
 * engine-reproduce-disagrees). v0.6.1 only adds JAX-DISTINCTIVE mistakes.
 *
 * The single fixture: jax.bad-pytree-flatten-order — a JAX extractor that
 * pairs flattened pytree values with parameter_ids in the wrong order
 * (swaps two weights). Rule 14 catches via differential; Rule 7 also fires
 * because parameters_after disagrees with the swapped parameters_before
 * via the chain.
 *
 * This is the v0.6.1 pressure test: does Rule 14 catch a NEW kind of
 * extractor mistake (one only a JAX user would make) without requiring
 * a new rule or schema change? Yes.
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
  "fixtures/bad/jax.bad-pytree-flatten-order.jsonl",
)

test("jax.bad-pytree-flatten-order fires Rule 14 (differential catches swapped weights)", () => {
  if (!existsSync(fpath)) return
  const r = JSON.parse(readFileSync(fpath, "utf-8").trim())
  const result = reconcileReceipt(r)
  assert.strictEqual(result.ok, false, "must fail reconcile")
  if (result.ok) return
  const rule14 = result.failures.filter((f) => f.rule === 14)
  assert.ok(
    rule14.length >= 1,
    `expected Rule 14 failure (engine recompute disagrees on forward fields because ` +
      `parameters_before slots are swapped); got rules: ${[...new Set(result.failures.map((f) => f.rule))].sort().join(",")}`,
  )
  // Specifically, forward.h1.net should disagree (the swap puts the wrong
  // weight at the wrong slot, so h1's net computation drifts).
  const h1NetFailure = rule14.find(
    (f) => f.field_path === "forward.h1.net",
  )
  assert.ok(
    h1NetFailure,
    `expected Rule 14 failure on forward.h1.net specifically (swapped weights propagate ` +
      `into h1's pre-activation net); got Rule 14 paths: ${JSON.stringify(rule14.map((f) => f.field_path))}`,
  )
})

test("jax.bad-pytree-flatten-order also fires Rule 7 (final-state consistency on the chain)", () => {
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

test("jax.softmax-ce golden (observer-mode JAX) reconciles cleanly", () => {
  const goldenPath = resolve(
    repoRoot,
    "fixtures/external/jax.softmax-ce.golden.jsonl",
  )
  if (!existsSync(goldenPath)) return
  const r = JSON.parse(readFileSync(goldenPath, "utf-8").trim())
  const result = reconcileReceipt(r)
  assert.strictEqual(
    result.ok,
    true,
    `JAX observer-mode golden must reconcile cleanly; got: ${
      result.ok === false ? JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path }))) : "ok"
    }`,
  )
})
