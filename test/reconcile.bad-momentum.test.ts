/**
 * v0.9.2 — Anti-circularity tests for the classical PyTorch-style SGD
 * momentum adversarial fixture plate.
 *
 * For each fixtures/bad/(momentum|momentum-multi-step)*.jsonl fixture, assert:
 *   (a) reconciler returns ok: false (the rule fires)
 *   (b) the failure's `rule` field matches the meta file's
 *       `reconciliation_check_targeted_first` (the PRIMARY rule)
 *
 * Doctrine: bad receipts precede good receipts (Csmith / CompCert).
 * Parallel to test/reconcile.bad-adam.test.ts for the v0.9.1 Adam plate.
 */

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { reconcileReceipt, reconcileMultiStep } from "../src/reconcile.js"
import { parseReceiptJsonl } from "../src/parse.js"

const FIXTURES_DIR = resolve("fixtures/bad")

type MomentumFixture = {
  filename: string
  primaryRule: number
  isMultiStep: boolean
}

function discoverMomentumFixtures(): MomentumFixture[] {
  if (!existsSync(FIXTURES_DIR)) return []
  const files = readdirSync(FIXTURES_DIR).filter(
    (f) =>
      (f.startsWith("momentum.bad-") || f.startsWith("momentum-multi-step.bad-")) &&
      f.endsWith(".jsonl"),
  )
  const fixtures: MomentumFixture[] = []
  for (const file of files) {
    const metaPath = resolve(FIXTURES_DIR, file.replace(/\.jsonl$/, ".meta.json"))
    let primaryRule = -1
    if (existsSync(metaPath)) {
      const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as {
        reconciliation_check_targeted_first?: string
      }
      const target = meta.reconciliation_check_targeted_first
      if (typeof target === "string") {
        const m = target.match(/Rule\s+(\d+)/i)
        if (m) primaryRule = parseInt(m[1]!, 10)
      }
    }
    if (primaryRule < 0) continue
    const path = resolve(FIXTURES_DIR, file)
    const bytes = readFileSync(path, "utf-8").trim()
    const isMultiStep = bytes.split("\n").length > 1
    fixtures.push({ filename: file, primaryRule, isMultiStep })
  }
  return fixtures
}

const fixtures = discoverMomentumFixtures()

if (fixtures.length === 0) {
  test("no momentum bad fixtures discovered", () => {
    assert.fail(
      "No momentum.bad-* or momentum-multi-step.bad-* fixtures found under fixtures/bad/. " +
        "v0.9.2 adversarial plate must ship at least one fixture per momentum-family rule.",
    )
  })
}

for (const fix of fixtures) {
  test(`${fix.filename}: reconciler returns ok=false and primary rule (Rule ${fix.primaryRule}) fires`, () => {
    const bytes = readFileSync(resolve(FIXTURES_DIR, fix.filename), "utf-8")
    let receipts: unknown[]
    if (fix.isMultiStep) {
      try {
        receipts = bytes
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
      } catch (err) {
        throw new Error(
          `${fix.filename} multi-record parse failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    } else {
      const parsed = parseReceiptJsonl(bytes)
      if (!parsed.ok) {
        // Schema-bypass fixtures that drop required fields (coefficient-omitted,
        // buffer-drop) fail at schema layer before the reconciler runs.
        // Allow parse-fail ONLY for fixtures explicitly designed to bypass canonical emit.
        const allowedSchemaFails = new Set([
          "momentum.bad-coefficient-omitted.jsonl",
        ])
        if (allowedSchemaFails.has(fix.filename)) {
          return
        }
        throw new Error(`${fix.filename} parse failed: ${parsed.error.message}`)
      }
      receipts = [parsed.receipt]
    }
    const result = fix.isMultiStep
      ? reconcileMultiStep(receipts)
      : reconcileReceipt(receipts[0])
    assert.equal(result.ok, false, `${fix.filename} must NOT reconcile (it is a bad fixture)`)
    if (result.ok) return
    const firedRules = new Set(result.failures.map((f) => f.rule))
    assert.ok(
      firedRules.has(fix.primaryRule),
      `${fix.filename} must fire its primary rule (Rule ${fix.primaryRule}); actual fired rules: ${
        JSON.stringify(Array.from(firedRules).sort((a, b) => a - b))
      }. Failures: ${
        JSON.stringify(
          result.failures.map((f) => ({ rule: f.rule, field: f.field_path })),
          null,
          2,
        )
      }`,
    )
  })
}
