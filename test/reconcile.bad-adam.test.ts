/**
 * v0.9.1 — Anti-circularity tests for the Adam + AdamW adversarial fixture plate.
 *
 * For each fixtures/bad/(adam|adamw)*.jsonl fixture, assert:
 *   (a) reconciler returns ok: false (the rule fires)
 *   (b) the failure's `rule` field matches the meta file's
 *       `reconciliation_check_targeted_first` (the PRIMARY rule the
 *       fixture is designed to trip)
 *
 * Doctrine: bad receipts precede good receipts (Csmith / CompCert). The
 * doctrine test (test/reconcile.doctrine.test.ts) cross-checks that every
 * implemented rule has at least one fixture. This file cross-checks that
 * every Adam fixture fires its expected rule.
 */

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { reconcileReceipt, reconcileMultiStep } from "../src/reconcile.js"
import { parseReceiptJsonl } from "../src/parse.js"

const FIXTURES_DIR = resolve("fixtures/bad")

type AdamFixture = {
  filename: string
  primaryRule: number
  isMultiStep: boolean
}

function discoverAdamFixtures(): AdamFixture[] {
  if (!existsSync(FIXTURES_DIR)) return []
  const files = readdirSync(FIXTURES_DIR).filter(
    (f) =>
      (f.startsWith("adam.bad-") || f.startsWith("adamw.bad-")) &&
      f.endsWith(".jsonl"),
  )
  const fixtures: AdamFixture[] = []
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

const fixtures = discoverAdamFixtures()

if (fixtures.length === 0) {
  test("no Adam bad fixtures discovered", () => {
    assert.fail(
      "No adam.bad-* or adamw.bad-* fixtures found under fixtures/bad/. " +
        "v0.9.1 adversarial plate must ship at least one fixture per Adam-family rule.",
    )
  })
}

for (const fix of fixtures) {
  test(`${fix.filename}: reconciler returns ok=false and primary rule (Rule ${fix.primaryRule}) fires`, () => {
    const bytes = readFileSync(resolve(FIXTURES_DIR, fix.filename), "utf-8")
    let receipts: unknown[]
    if (fix.isMultiStep) {
      // Multi-record JSONL: split + JSON.parse per existing v0.8/v0.9 test pattern.
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
        // Some fixtures bypass canonical emit (structurally malformed). Those
        // SHOULD fail to parse, so failure here IS the expected behavior — but
        // we want a deterministic test outcome regardless of fixture type.
        // Allow parse failure ONLY for fixtures that explicitly bypass emit.
        // (For Adam fixtures: only adam.bad-amsgrad-confusion bypasses to drop
        // the state_before block.)
        if (fix.filename === "adam.bad-amsgrad-confusion.jsonl") {
          // Validation-layer failure is acceptable for this fixture; the schema
          // rejects the malformed shape before the reconciler runs. Skip the
          // primary-rule check — the schema fires first.
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
    if (result.ok) return // Type narrowing; never reached due to assert above
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
