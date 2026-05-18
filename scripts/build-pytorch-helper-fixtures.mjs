#!/usr/bin/env node
/**
 * Build the v0.10 PyTorch live-helper fixture plate.
 *
 * Csmith/CompCert discipline: bad fixtures are NEVER captured from a live
 * broken helper — that would make them byte-unstable across helper
 * versions and platform-non-deterministic. This script:
 *
 *   1. Derives ONE good helper-emitted v0.7.0 sidecar from the existing
 *      pytorch.softmax-ce.sidecar.jsonl (v0.1.0 format → v0.7.0 with
 *      added helper block; source_framework.extractor name bumped to the
 *      v0.10 helper identity).
 *
 *   2. Derives 7 bad-helper fixtures by applying targeted byte-level
 *      mutations to the good helper-emitted sidecar. Each mutation
 *      simulates a documented PyTorch-extraction failure mode (see
 *      docs/live-helpers.md "Adversarial fixture catalog").
 *
 *   3. Writes the matching .meta.json files documenting what was mutated
 *      and which reconciler rule must fire when bp reconcile reads the
 *      sidecar through bp import pytorch.
 *
 * Reproducibility: CI re-runs this script and `git diff --exit-code`
 * confirms byte-identical regeneration. No RNG; no timestamps inside
 * the helper block (helper.extraction.timestamp is PINNED to a
 * deterministic constant for fixture reproducibility).
 *
 * The Python helper itself emits a wall-clock timestamp. Test fixtures
 * use a pinned timestamp so the byte hash is stable — operators
 * running the real helper see a real timestamp.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, "..")
const FIXTURES_EXT = resolve(REPO_ROOT, "fixtures", "external")
const FIXTURES_BAD = resolve(REPO_ROOT, "fixtures", "bad")

// Pinned values for byte-deterministic fixtures. The real helper emits
// the running torch.__version__ and wall-clock timestamp; fixtures use
// these constants so `git diff --exit-code` works in CI.
const FIXTURE_HELPER_BLOCK = {
  name: "backprop-trace-pytorch-helper",
  version: "0.10.0",
  distribution: "repo-script",
  // Pinned source_hash — represents the hash of scripts/extract/pytorch.py
  // at the time of fixture generation. The real helper computes its own
  // hash; this fixture uses a placeholder that is recognizably a fixture
  // (all-zeros bottom 32 chars after sha256: prefix would also be valid
  // shape; we use the actual hash format with pinned hex digits).
  source_hash:
    "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  framework: {
    name: "pytorch",
    version: "2.5.0",
  },
  runtime: {
    python_version: "3.12.0",
    torch_version: "2.5.0",
    deterministic_mode: {
      torch_use_deterministic_algorithms: true,
      cudnn_deterministic: true,
      cudnn_benchmark: false,
    },
  },
  extraction: {
    timestamp: "2026-05-18T12:00:00Z",
    device: "cpu",
  },
}

function readJSONLLine(path) {
  const text = readFileSync(path, "utf-8")
  const lines = text.split("\n").filter((l) => l.length > 0)
  if (lines.length !== 1) {
    throw new Error(`expected exactly 1 line in ${path}; got ${lines.length}`)
  }
  return JSON.parse(lines[0])
}

function writeJSONLLine(path, obj) {
  mkdirSync(dirname(path), { recursive: true })
  const text = JSON.stringify(obj) + "\n"
  writeFileSync(path, text, "utf-8")
}

function writeMetaJSON(path, meta) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(meta, null, 2) + "\n", "utf-8")
}

// --- Step 1: good helper-emitted sidecar ------------------------------------

function buildGoodHelperEmittedSidecar() {
  // Source: pytorch.softmax-ce.sidecar.jsonl (v0.1.0)
  // Target: pytorch.helper-emitted.sgd.softmax-ce.sidecar.jsonl (v0.7.0)
  const source = readJSONLLine(
    resolve(FIXTURES_EXT, "pytorch.softmax-ce.sidecar.jsonl"),
  )

  // Rebuild as v0.7.0 with the helper block. The schema's x-order pins
  // format → source_framework → helper → trace_id → ... so we assemble
  // the keys in that order via a fresh literal.
  const out = {
    format: "framework-trace.v0.7.0",
    source_framework: {
      ...source.source_framework,
      extractor: {
        name: "backprop-trace-pytorch-helper",
        version: "0.10.0",
      },
    },
    helper: FIXTURE_HELPER_BLOCK,
  }
  // Copy through all remaining v0.1.0 fields (topology, learning_rate,
  // numeric_policy, bias_policy, inputs, targets, parameters_before,
  // forward, loss, backward, updates, parameters_after, etc.)
  for (const key of [
    "trace_id",
    "step_index",
    "topology",
    "learning_rate",
    "optimizer",
    "numeric_policy",
    "bias_policy",
    "batch",
    "inputs",
    "targets",
    "parameters_before",
    "per_sample",
    "forward",
    "loss",
    "backward",
    "updates",
    "parameters_after",
    "post_update_forward",
    "post_update_loss",
  ]) {
    if (key in source) {
      out[key] = source[key]
    }
  }
  return out
}

const helperEmittedSidecarPath = resolve(
  FIXTURES_EXT,
  "pytorch.helper-emitted.sgd.softmax-ce.sidecar.jsonl",
)
const good = buildGoodHelperEmittedSidecar()
writeJSONLLine(helperEmittedSidecarPath, good)
console.log(`wrote good helper-emitted sidecar: ${helperEmittedSidecarPath}`)

// --- Step 2: bad-helper fixtures (7 mutations) ------------------------------

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

const BAD_FIXTURES = [
  {
    name: "pytorch-helper.bad-grad-captured-after-zero-grad",
    bug: "Helper read param.grad AFTER optimizer.zero_grad() instead of after loss.backward(). All gradients are zero; updates appear consistent with zero gradients (weights unchanged) — but stored weights_after diverge.",
    expectedRule: 4,
    expectedRuleName: "update gradient consistency",
    mutate: (sidecar) => {
      // Zero out every gradient + every update. Keep weights_before/after.
      // Rule 14 fires: engine recompute produces actual gradients ≠ stored 0s.
      for (const u of sidecar.updates) {
        u.gradient = 0
        u.update = 0
        // Keep weight_after to its real value so Rule 4 stored-vs-derived
        // disagreement is the gradient mismatch, not Rule 6's weight-after.
      }
    },
  },
  {
    name: "pytorch-helper.bad-detach-not-applied",
    bug: "Helper captured param.data as a view (not .detach().clone()); subsequent optimizer.step() mutated underlying storage; weights_before snapshot now reflects post-step values. Rule 6 (weight progression) fires because weight_before + update no longer equals weight_after.",
    expectedRule: 6,
    expectedRuleName: "weight progression",
    mutate: (sidecar) => {
      // Replace weights_before with weights_after (simulates view-mutation
      // bug where the pre-step snapshot ends up showing post-step values).
      sidecar.parameters_before = { ...sidecar.parameters_after }
      // Also propagate into per-update weight_before so Rule 4 fires:
      // stored gradient claims a value derived from real-pre-state factors,
      // but weight_before now declares post-state — Rule 4 recomputes
      // gradient from declared factors and finds mismatch.
      for (const u of sidecar.updates) {
        if (u.parameter_id in sidecar.parameters_after) {
          u.weight_before = sidecar.parameters_after[u.parameter_id]
        }
      }
    },
  },
  {
    name: "pytorch-helper.bad-param-ordering-swapped",
    bug: "Helper iterated state_dict() insertion order vs optimizer.param_groups order (PyTorch issue #1489); swapped two parameter ids so the topology cross-reference is wrong.",
    expectedRule: 4,
    expectedRuleName: "update gradient consistency (factor cross-reference)",
    mutate: (sidecar) => {
      // Swap the parameter_id strings on TWO updates so the named-factors
      // computation no longer cross-references the right hidden signal.
      // Rule 4 derives gradient = signal * activation; with swapped ids
      // the derived value diverges from the stored value.
      const idxA = sidecar.updates.findIndex(
        (u) => u.parameter_id === "w_x1_h1",
      )
      const idxB = sidecar.updates.findIndex(
        (u) => u.parameter_id === "w_x2_h1",
      )
      if (idxA === -1 || idxB === -1) {
        throw new Error("param-ordering bug: source ids not found")
      }
      // Swap stored weights so the cross-reference is corrupt: w_x1_h1's
      // entry now contains w_x2_h1's stored gradient & update, and vice versa.
      const a = sidecar.updates[idxA]
      const b = sidecar.updates[idxB]
      // Keep parameter_id labels untouched so the corruption is in the
      // numerical payload only — Rule 4's factor product disagrees.
      const tmp = { gradient: a.gradient, update: a.update, weight_after: a.weight_after }
      a.gradient = b.gradient
      a.update = b.update
      a.weight_after = b.weight_after
      b.gradient = tmp.gradient
      b.update = tmp.update
      b.weight_after = tmp.weight_after
    },
  },
  {
    name: "pytorch-helper.bad-loss-stale",
    bug: "Helper captured loss tensor BEFORE loss.backward() (typo or copy-paste error common in early extractor work); the stored loss.total is from a previous step or a different forward pass.",
    expectedRule: 12,
    expectedRuleName: "loss formula consistency",
    mutate: (sidecar) => {
      // Set loss.total to a clearly-stale value (off by ~40%).
      sidecar.loss.total = sidecar.loss.total * 0.6
      for (const k of Object.keys(sidecar.loss.per_output)) {
        sidecar.loss.per_output[k] = sidecar.loss.per_output[k] * 0.6
      }
    },
  },
  {
    name: "pytorch-helper.bad-forward-out-mismatch",
    bug: "Helper invoked model.forward() but cached the WRONG layer's output (e.g. mid-layer activation instead of final output). Rule 11 (softmax normalization — sum(probabilities) == 1) fires because the corrupted output breaks the simplex constraint.",
    expectedRule: 11,
    expectedRuleName: "softmax normalization",
    mutate: (sidecar) => {
      // Corrupt one output unit's forward.out by 10%
      const firstOut = Object.keys(sidecar.forward).find((k) => k.startsWith("o"))
      if (firstOut === undefined) {
        throw new Error("forward-out-mismatch: no output unit found")
      }
      sidecar.forward[firstOut].out = sidecar.forward[firstOut].out * 1.1
    },
  },
  {
    name: "pytorch-helper.bad-weight-after-divergence",
    bug: "Helper captured parameters_after BEFORE optimizer.step() returned (race / threading bug); weights_after match weights_before for one parameter that shouldn't have updated.",
    expectedRule: 6,
    expectedRuleName: "weight progression",
    mutate: (sidecar) => {
      // Set one parameters_after entry equal to parameters_before so Rule 6
      // (weight_after == weight_before + update) fails (update is non-zero).
      const someParam = "w_h1_o1"
      if (!(someParam in sidecar.parameters_before)) {
        throw new Error("weight-after-divergence: target param missing")
      }
      sidecar.parameters_after[someParam] = sidecar.parameters_before[someParam]
      // Also mirror into the per-update weight_after so the update entry
      // is self-consistent (the bug is in the parameters_after map only).
      const u = sidecar.updates.find((u) => u.parameter_id === someParam)
      if (u !== undefined) {
        u.weight_after = sidecar.parameters_before[someParam]
      }
    },
  },
  {
    name: "pytorch-helper.bad-hidden-signal-misrouted",
    bug: "Helper computed hidden error signal but misrouted the activation_derivative (used out instead of out*(1-out) for sigmoid). Rule 8 (provenance reference consistency — signal_value vs backpropagated_sum * activation_derivative product) fires.",
    expectedRule: 8,
    expectedRuleName: "provenance reference consistency",
    mutate: (sidecar) => {
      // Corrupt h1's activation_derivative to be `out` (sigmoid output)
      // instead of `out * (1 - out)` (sigmoid derivative). Rule 3 will
      // recompute and find divergence.
      const h1 = sidecar.backward.hidden_error_signals.h1
      const h1OutForward = sidecar.forward.h1.out
      h1.activation_derivative = h1OutForward // the bug: used out, not out*(1-out)
      h1.signal_value = h1.backpropagated_sum * h1.activation_derivative
    },
  },
]

for (const fixture of BAD_FIXTURES) {
  const mutated = deepClone(good)
  fixture.mutate(mutated)
  const fixturePath = resolve(FIXTURES_BAD, `${fixture.name}.jsonl`)
  const metaPath = resolve(FIXTURES_BAD, `${fixture.name}.meta.json`)
  writeJSONLLine(fixturePath, mutated)
  writeMetaJSON(metaPath, {
    fixture_id: fixture.name,
    authoring_state: "deliberately_broken",
    verification_state: "engine_must_reject",
    intent: `live-helper bug simulation: ${fixture.bug}`,
    expected_failures: [
      {
        rule: fixture.expectedRule,
        rule_name: fixture.expectedRuleName,
      },
    ],
    note:
      "Generated deterministically by scripts/build-pytorch-helper-fixtures.mjs. " +
      "The fixture simulates a bad LIVE HELPER emitting a wrong-but-schema-valid " +
      "sidecar; the real helper at scripts/extract/pytorch.py does not have this " +
      "bug. Rule 14 (or the named rule) must reject before the verifier reads this " +
      "meta.json — anti-circularity invariant.",
  })
  console.log(`wrote bad fixture: ${fixture.name}`)
}

console.log(`\nDone. ${BAD_FIXTURES.length} bad-helper fixtures + 1 good helper-emitted sidecar.`)
