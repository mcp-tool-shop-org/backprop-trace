# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Note: the `schema_version` field inside receipts (`"0.1.0"`, `"0.2.0"`) is the
receipt-format version, which is versioned independently of this npm package
version. A receipt written today against schema 0.1.0 will still validate
against schema 0.1.0 in v0.5 of the package; v0.3 adds schema 0.2.0 for the
generalized topology + multi-step path without retiring schema 0.1.0. v0.4
introduces a SEPARATE input-config schema (`topology-input.v0.4.0.json`) that
validates engine INPUTS — distinct from the receipt schemas that validate
engine OUTPUTS.

## [0.5.1] - 2026-05-17

Focused ratchet on v0.5.0. No new math semantics. Closes the two v0.3-era
carry-over skips, audits the v0.3.0 export surface, adds a softmax+CE
worked example to docs + library JSDoc, and adds a generator script for
the new XOR multi-step good golden so it's reproducible from clean.

### Added

- **`fixtures/xor.multi-step.jsonl`** — canonical 2-record multi-step
  golden (XOR-sigmoid 2-2-1). Step 0 is the XOR_INPUT first run with
  `trace_id` + `step_index=0`; step 1 reuses the same XOR sample with
  `parameters_before` == step 0's `parameters_after` byte-for-byte. All
  per-record rules pass AND Rules 9 (parameter chain) and 10 (trace
  identity + sequential step_index) pass cleanly. Pairs with the existing
  `fixtures/bad/multi-step.bad-{chain,trace-id}.jsonl` plate as the
  "all-rules-pass" baseline.
- **`scripts/generate-xor-multi-step-golden.ts`** — reproducible
  generator for the multi-step golden. Reads no files; runs
  `runGeneralStep` over `XOR_INPUT` twice with a pinned `trace_id` and
  chains the parameters. Re-running it from clean produces byte-identical
  output to the shipped golden.
- **v0.5 surface re-exports** in `src/index.ts`:
  - `SOFTMAX_CE_TOPOLOGY`, `SOFTMAX_CE_INPUT`, `SHARED_NUMERIC_POLICY_V05_SOFTMAX_CE` from `./mazur`.
  - `softmaxVector` + `OutputActivationName` type from `./activations`.
  - `DualForm` + `JacobianTerm` types from `./general-engine` (canonical declaration lives in `./engine` for emit-side type sharing).
  - Updated quick-usage JSDoc with a softmax+CE worked example block (engine run, dual_form access, custom-topology authoring, Rule 13 gated-skip note).
- **`bp verify general` v0.1 redirect** — when a receipt declares
  `schema_version: "0.1.0"` (the Mazur 2-2-2 pinned schema), the verifier
  early-exits with status 1 and a "use `bp verify mazur`" diagnostic on
  the schema-dispatch check. Detection is purely string-level on the
  `schema_version` field (no Ajv invocation, no engine call) so the
  redirect is fast and decoupled from validator state. Receipts without
  a `schema_version` field fall through to normal validation, which
  reports the missing field through the schema check.
- **Softmax+CE worked example** in `docs/reconciliation.md` "Command
  surface" section. Shows the engine-run → validate → reconcile → verify
  general pipeline, plus the GATED Rule 13 note (collapsed-only receipts
  silently skip Rule 13).

### Changed

- `docs/reconciliation.md` "Command surface" expanded: `bp verify general`,
  `bp verify multi`, and `bp reconcile receipt` now have full descriptions
  including the v0.1 redirect, multi-record verification, and Rule
  enumeration. The "eight rules" naming is preserved for back-compat with
  v0.2 readers, but the section header was already "13 rules" since v0.5.

### Tests

- 322 total tests unchanged. 320 → 322 passing. 0 fail.
  **Both carry-over skips closed** (2 → 0):
  - `bp verify general on mazur (v0.1) — policy decision deferred`
    replaced with an active test that asserts the v0.5.1 v0.1 redirect:
    exit 1 + diagnostic naming `bp verify mazur` and the offending
    `schema_version`.
  - `bp verify multi <good multi-step file> exits 0` was previously
    skipped because the fixture didn't exist. With
    `fixtures/xor.multi-step.jsonl` now present, the test runs and
    passes — per-record Rules 1-8/11/12/13 + cross-step Rules 9/10 all
    green on the 2-record XOR multi-step run.
- All v0.1-v0.5.0 fixtures byte-identical. Engine bytes unchanged.

### Migration notes (v0.5.0 → v0.5.1)

- Pure additive. No schema bump, no rule additions, no engine math
  changes. All v0.5.0 receipts validate, reconcile, and emit byte-identically.
- Consumers using `bp verify general` on v0.1.0 Mazur receipts (uncommon
  — Mazur receipts should use `bp verify mazur`) now get an exit 1 with
  a redirect message instead of a cryptic engine-reproduce schema error.
  The shipped Mazur golden is the only v0.1.0 receipt in the repo; no
  downstream consumer is known to call `bp verify general` on a v0.1
  receipt.

### Out of scope (deferred by standing constraint or intent)

- v0.6 external trace ingestion (PyTorch / JAX collapsed-only softmax+CE
  receipts) — the next study-swarm subject. Rule 13's GATED design was
  built exactly to support that adoption path.
- npm publish / git tag / `gh release create` — user-deferred.
- Translations / landing / handbook / SHIP_GATE walkthrough — user-deferred.

---

## [0.5.0] - 2026-05-17

The softmax + cross-entropy wave. v0.4.2's Rule 12 polymorphic dispatcher
was deliberately shaped so v0.5 could extend it with a
`cross_entropy_softmax` branch without reshaping any rule signatures or
schema fields. This release fills in that branch and lands the three other
softmax+CE verifier rules + the engine path + the schema additive bump that
the v0.5 study-swarm locked.

Design decisions baked in (per the v0.5 consolidator memo + user-locked
Q1/Q2/Q3 decisions before greenlight):
- **Q1: Rule 13 is GATED**, not mandatory. Fires only when
  `OutputErrorSignal.dual_form` is present. Receipts authored from PyTorch
  / JAX / other frameworks can omit `dual_form` and Rule 13 silently
  skips. The engine emits `dual_form` for every softmax+CE receipt it
  generates so the in-house path is fully verified.
- **Q2: NO engine auto-synthesis** of Jacobian factors. The engine emits
  the collapsed `dL/dz_u = y_u - p_u` form (descent direction) as the
  primary `OutputErrorSignal.factors`. The dual-form Jacobian
  decomposition is emitted ALONGSIDE the collapsed form when the engine
  generates softmax+CE receipts; it is never back-filled onto receipts
  that lack it.
- **Q3: SPLIT** — v0.4.2 shipped Rule 12's half_squared_error branch as a
  focused trust patch BEFORE this wave. v0.5 is the full softmax+CE wave.

### Added

- **Schema v0.3.0** (additive over v0.2.0):
  - `topology.activation_output` enum widened from `[sigmoid, identity, relu]` to `[sigmoid, identity, relu, softmax]`.
  - `topology.loss` enum widened from `[half_squared_error]` to `[half_squared_error, cross_entropy_softmax]`.
  - `OutputErrorSignal` gains optional `dual_form` (DualForm) for Rule 13 verification surface. Receipts that don't carry `dual_form` continue to validate against v0.3.0 unchanged.
  - New `$defs/DualForm` (jacobian_terms[], product_order, summation_order, summed_value) and `$defs/JacobianTerm` (target_unit, factors[], term_value).
  - Receipt schema_version: `0.3.0`. v0.2.0 receipts continue to validate against the v0.2.0 schema unchanged.
- **Rule 0.8 — Softmax probability bounds** (a Rule 0 sub-check). When `topology.activation_output === "softmax"`, every `forward[output].out` MUST be in `[0, 1]` within the receipt's atol slack. Fires inside `checkRule0Structural` Phase 0 and short-circuits before Rules 1-13. Failure record uses `rule: 0` with `"Rule 0.8 (probability bounds)"` in the message — the doctrine ratchet (which scans integer rule numbers) sees Rule 0 with a paired `softmax-ce.bad-prob-bound` fixture and is satisfied.
- **Rule 11 — Softmax normalization**. When `topology.activation_output === "softmax"`, `sum(forward[output_unit].out) == 1.0` within tolerance. Sum is computed left-to-right in `topology.unit_order.output` order for deterministic reproduction. Independent of Rule 0.8 (a receipt could pass either while failing the other).
- **Rule 12 cross_entropy_softmax branch**. Fills in the v0.4.2 stub:
  - Per-output: `loss.per_output[u] == (y_u == 0 ? 0 : -y_u * log(p_u))`. The `y_u === 0` short-circuit is mathematically faithful (the `y * log(p) → 0` limit holds at any `p`) AND defends against the `-0 * log(0) = NaN` JavaScript footgun. The engine and the reconciler apply the same short-circuit so engine-emitted receipts pass cleanly.
  - Total: `loss.total == sum_u loss.per_output[u]` (recomputed from forward + targets, independent of `loss.per_output[*]`).
- **Rule 13 — Gated dual-form consistency** (softmax+CE). Three sub-checks:
  - 13a per-term multiplication: each `jacobian_terms[j].term_value == multiply(jacobian_terms[j].factors, left_to_right)`.
  - 13b summation: `dual_form.summed_value == sum(jacobian_terms[*].term_value)` in `dual_form.summation_order`.
  - 13c collapsed-vs-dual: `dual_form.summed_value == OutputErrorSignal.signal_value`.
  GATED: silently skips when `dual_form` is absent.
- **Softmax engine path** (`src/general-engine.ts`):
  - Forward output layer branches on `activation_output === "softmax"`. Phase 1 computes logits per unit left-to-right in `unit_order.output`; Phase 2 invokes `softmaxVector` once over the assembled logit vector (LSE-stable: subtract max, exp, sum, divide).
  - Loss branches on `topology.loss === "cross_entropy_softmax"` for the CE formula.
  - Backward output_error_signals branches on softmax+CE: collapsed `signal_value = y_u - p_u` (descent direction; the textbook `p_u - y_u` is the positive-direction gradient, negated to match the existing `gradient_convention: "descent_direction"`). Single factor `target_minus_probability`.
  - Engine ALWAYS emits `dual_form` for every output unit when topology declares softmax+CE. Each term contains two factors (`y_j` with provenance `targets.<j>`, and `delta_ju_minus_p_u` derived). `summed_value` equals `signal_value` by construction.
  - Post-update forward + loss also branch identically for softmax / CE.
  - Topology pairing invariant: `loss === "cross_entropy_softmax"` iff `activation_output === "softmax"` — enforced by `assertTopologyValid` at the engine boundary.
- **softmaxVector activation** in `src/activations.ts`. Stable log-sum-exp form. New type `OutputActivationName = ActivationName | "softmax"` for the topology output-layer slot (softmax stays out of `ActivationName` because it's a vector op, not per-scalar — the `activate()` dispatcher remains per-scalar).
- **SHARED_NUMERIC_POLICY_V05_SOFTMAX_CE** in `src/mazur.ts`: hybrid tolerance widened to `{atol: 1e-11, rtol: 1e-7}` (up from v0.3's `{1e-12, 1e-8}`) to accommodate softmax (subtract max, exp, sum, divide), log() in CE, and dual_form term products. ~3x headroom over the theoretical chained-error budget.
- **Canonical softmax+CE topology + input** (`SOFTMAX_CE_TOPOLOGY` + `SOFTMAX_CE_INPUT` in `src/mazur.ts`): 2 inputs → 2 hidden sigmoid → 3 output softmax, one-hot target class o1. Deterministic initial weights. bias_policy.mode = constant (Mazur convention preserved).
- **`fixtures/softmax-ce.golden.jsonl`** — canonical first-run receipt. schema_version `0.3.0`. Byte-equal-reproducible by `runGeneralStep(SOFTMAX_CE_INPUT) + emitGeneralReceipt`.
- **7 bad fixtures** under `fixtures/bad/`:
  - `softmax-ce.bad-prob-bound.jsonl` — forward.o1.out → -0.01 (Rule 0.8 short-circuits).
  - `softmax-ce.bad-softmax-sum.jsonl` — forward.o2.out += 0.1 (Rule 11 fires; no cascade thanks to widened tolerance).
  - `softmax-ce.bad-ce-per-output.jsonl` — loss.per_output.o1 += 0.1 (Rule 12 CE per_output; no cascade).
  - `softmax-ce.bad-ce-total.jsonl` — loss.total += 0.1 (Rule 12 CE total; no cascade).
  - `softmax-ce.bad-dual-term.jsonl` — dual_form jacobian_terms[0].term_value mutated (Rules 13a + 13b).
  - `softmax-ce.bad-dual-sum.jsonl` — dual_form.summed_value mutated (Rules 13b + 13c).
  - `softmax-ce.bad-collapsed-vs-dual.jsonl` — dual_form mutated self-consistently (Rule 13c ALONE — isolates the cross-form check).
  Each ships with a sibling `.meta.json` carrying `reconciliation_check_targeted_first` for the doctrine ratchet.
- **`scripts/generate-softmax-ce-bad-fixtures.ts`** — single-source-of-truth generator for the 7 bad fixtures. Read golden → mutate one field → re-emit via the canonical engine emitter so non-mutated bytes are preserved. Re-runnable if the golden ever needs to be regenerated (e.g., V8 Math.exp drift).
- **Math.exp + Math.log determinism canaries** in `test/determinism.math-exp-canary.test.ts`: `Math.exp(0.5)`, the softmax intermediate `exp(z_o2 - z_max)` from SOFTMAX_CE_INPUT, and `Math.log(p_o1)` at the golden's pinned probability magnitude. CI failure surfaces drift BEFORE any softmax+CE golden regenerates silently.

### Changed

- **`RULE_DESCRIPTIONS`** gains entries 11 + 13; entry 12 updated to note both branches; entry 0 updated to mention Rule 0.8 sub-check.
- **`bp` CLI `RULE_LABELS`** gains entries 11 + 13.
- **`Receipt`** + **`TopologyShape`** in `src/reconcile.ts` widened: TopologyShape gains optional `activation_output`. OutputErrorSignal shape gains optional `dual_form` with JacobianTerm + DualForm sub-types.
- **`OutputErrorSignal`** in `src/engine.ts` widened with optional `dual_form` (additive). Mazur v0.1 receipts that never emit `dual_form` stay byte-identical to the shipped golden.
- **`emit.ts`** emits the optional `dual_form` key only when present (preserves byte-equality for half_squared_error receipts). Two new helpers: `emitDualForm` and `emitJacobianTerm`.
- **`general-engine.ts`** `GeneralReceipt.schema_version` widened from `"0.2.0"` to `"0.2.0" | "0.3.0"`. The engine picks the version based on `topology.loss` so callers don't have to.
- **`assertSupportedPolicy`** in `general-engine.ts` accepts `cross_entropy_softmax` loss now.
- **`assertTopologyValid`** in `topology.ts` accepts `activation_output === "softmax"` and `loss === "cross_entropy_softmax"`. Enforces the softmax+CE pairing invariant (one requires the other).
- **`schema-loader.ts`** `SCHEMA_VERSIONS` tuple extended with `"0.3.0"`. `validate.ts`'s default version remains `"0.2.0"` (receipts declare their own schema_version so the default rarely matters).
- **`package.json`** adds `./schema/0.3.0` subpath export pointing at `schemas/receipt.v0.3.0.json`.
- **Doctrine ratchet test** updated: implemented-rules expectation is now `[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]`. FILENAME_KIND_TO_RULE map adds entries for all 7 v0.5 bad fixtures.

### Tests

- 299 → 322 total (+23). 297 → 320 passing. 0 fail. 2 carry-over skips unchanged.
- New test files:
  - `test/reconcile.bad-prob-bound.test.ts` — Rule 0.8 short-circuits, no numeric cascade.
  - `test/reconcile.bad-softmax-sum.test.ts` — Rule 11 fires on the sum site.
  - `test/reconcile.bad-ce-per-output.test.ts` — Rule 12 CE per_output + total, each in isolation.
  - `test/reconcile.bad-dual-form.test.ts` — Rule 13a/13b/13c, GATED behavior (Mazur + XOR goldens pass cleanly with no dual_form), softmax-ce golden passes all three.
  - `test/softmax-ce.engine.test.ts` — byte-equality vs golden, schema_version 0.3.0, softmax sum-to-1, collapsed-equals-dual property, per-term multiplication property, CE per_output formula.
- All v0.1-v0.4.2 fixtures remain byte-identical (Mazur, XOR, iris, per-neuron-bias). The widened `OutputErrorSignal.dual_form` field is optional and `emit.ts` only emits it when present.

### Migration notes (v0.4.2 → v0.5.0)

- Pure additive on receipts that don't declare softmax+CE. Existing
  half_squared_error receipts validate, reconcile, and emit byte-identically.
- New schema version `0.3.0`. v0.2.0 receipts continue to validate against
  v0.2.0; v0.5 receipts that use softmax / CE declare `schema_version: "0.3.0"`.
- Topology pairing invariant: `topology.loss === "cross_entropy_softmax"`
  REQUIRES `topology.activation_output === "softmax"` (and vice versa).
  `assertTopologyValid` rejects mixed pairings at the engine boundary.
- Rule 13 is GATED: receipts can opt into the extra verification surface
  by emitting `dual_form` alongside the collapsed factors. The engine emits
  dual_form when authoring softmax+CE receipts; receipts authored from
  PyTorch / JAX / etc. may omit it and Rule 13 silently skips.
- Consumers iterating `result.failures[*].rule` should be prepared for
  `rule: 11` and `rule: 13` entries. Rule 0.8 surfaces as `rule: 0` with
  "Rule 0.8" in the message (no new integer rule number to handle).
- The `OutputErrorSignal` TypeScript type widened with optional `dual_form`
  (additive). Consumers that pattern-match on the narrow shape continue
  to work.

### Out of scope (deferred by standing constraint)

- npm publish / git tag / `gh release create` — user-deferred (commit + push only this wave)
- Translations — user-deferred
- Landing page / handbook / SHIP_GATE walkthrough — user-deferred
- Multi-class CE with non-one-hot targets — current implementation accepts arbitrary normalized targets (the math holds), but no fixture exercises non-one-hot yet. Could land in v0.5.x as a fixture-only addition.
- Bias updates on softmax+CE — bias_policy mode "constant" is the only path shipped with the canonical fixture; bias_policy mode "sgd" + softmax+CE would work mathematically but no fixture covers it.
- In-toto v1 attestation + DSSE PAE — still deferred to v0.6+ per the v0.4 study.

---

## [0.4.2] - 2026-05-17

Focused trust patch closing a real v0.4.1 gap surfaced by the v0.5 study-swarm:
`loss.total` was schema-validated but never math-checked by any reconciler rule.
A receipt could mutate `loss.total` arbitrarily and `reconcileReceipt` would
return `ok===true`. v0.4.2 wires Rule 12 (loss formula consistency) as a
polymorphic dispatcher on `topology.loss`; the half_squared_error branch ships
now, cross_entropy_softmax branch is reserved for v0.5 alongside the softmax
+ CE engine path.

### Added

- **Rule 12 — Loss formula consistency** (per-output + total). Polymorphic
  dispatcher on `topology.loss`:
  - `half_squared_error` (v0.4.2): `loss.per_output[u] == 0.5 * (targets[u] - forward[u].out)^2` AND `loss.total == sum(loss.per_output[*])`. Both checks fire independently; either or both can surface a Rule 12 failure.
  - `cross_entropy_softmax` (RESERVED for v0.5): no-op in v0.4.2; will land with the softmax + CE engine path. Receipts with v0.5 cross_entropy_softmax declarations pass v0.4.2's reconciler without firing Rule 12 (it skips silently rather than firing a structural failure — Rule 0 will gate the wider topology declaration when v0.5 ships).
- New paired bad fixture: `fixtures/bad/mazur.bad-loss-total.jsonl` + `.meta.json`. Mutates `loss.total` from 0.298371109 to 0.298372109 (delta +1e-6, ~1000x scalar tolerance) while leaving per-output entries, targets, and forward outputs byte-identical. Rule 12 catches; Rules 1-8 do NOT cascade (loss is independent of backward).
- New test file `test/reconcile.bad-loss-total.test.ts` covers: (1) bad fixture fires Rule 12 on loss.total alone with no cascade to Rules 1-8, (2) Mazur / XOR / iris / per-neuron-bias goldens all pass Rule 12 cleanly under the half_squared_error branch.

### Changed

- `RULE_DESCRIPTIONS[12]` added with explicit reference to topology.loss dispatch + the v0.4.1 trust gap it closes.
- `bp` CLI `RULE_LABELS[12]` added so `bp reconcile receipt` renders "Rule 12: loss formula consistency violation..." instead of the generic "rule mismatch" placeholder.
- `Receipt` type in `src/reconcile.ts` widened with optional `inputs`, `targets`, `forward`, `loss` fields (additive; v0.1 Mazur receipts that don't declare topology.loss fall back to the implicit half_squared_error assumption only when both forward and targets are present).
- `TopologyShape` widened with `loss?: "half_squared_error" | "cross_entropy_softmax"` for v0.5 forward-compat.
- Doctrine ratchet test `test/reconcile.doctrine.test.ts` updated: implemented-rules expectation is now `[1-10, 12]` (Rules 11/13 reserved for v0.5); FILENAME_KIND_TO_RULE map adds `bad-loss-total → 12` plus the v0.4.1 sub-checks that were missing from the static map.

### Tests

- 294 → 299 total; 292 → 297 passing; skips unchanged at 2 (carry-overs from v0.3: cross-version verify-general policy + good multi-step fixture).
- 0 fail. Mazur byte-equal preserved. All v0.4.0/v0.4.1 behavior unchanged.

### Migration notes (v0.4.1 → v0.4.2)

- Pure additive on the reconciler surface. Receipts that pass v0.4.1 continue to pass v0.4.2 IF they were math-consistent on `loss.total` (engine-emitted receipts always are). Receipts that v0.4.1 silently accepted with mutated `loss.total` now surface Rule 12 failures — these were always structurally inconsistent.
- v0.1 Mazur receipts (which use the narrow Mazur Topology without `topology.loss`) gracefully fall back to half_squared_error when `forward` and `targets` are present. No schema bump.
- Consumers iterating `result.failures[*].rule` should be prepared for `rule: 12` entries.

### Out of scope (v0.5 study deferrals, restated)

- Rule 11 (softmax sum-to-unity) — v0.5
- Rule 13 (collapsed↔Jacobian) — v0.5, gated by author intent
- Rule 0.8 (softmax non-negativity sub-check) — v0.5
- `cross_entropy_softmax` engine path + receipt fields — v0.5
- Schema v0.3.0 (additive widening for softmax+CE) — v0.5
- Hybrid tolerance widen to `{1e-11, 1e-7}` — v0.5 (current `{1e-12, 1e-8}` is sufficient for half_squared_error)
- Translations / release pipeline / landing / handbook / npm publish — standing constraint

---

## [0.4.1] - 2026-05-17

Focused trust patch on the v0.4.0 ship: closes the known reconciler gap
flagged independently by 3 agents during the v0.4 swarm — the
`bias_policy.mode` vs `Update.kind` contradiction surfaces only via
`bp verify general`'s engine-reproduce stage, never via `reconcileReceipt`.
v0.4.1 wires a Rule 0 cross-consistency Phase 0 that catches this and 6
other receipt-internal structural contradictions before any numeric rule
runs.

### Added

- `checkRule0Structural` Phase 0 in `reconcileReceipt`. Catches
  receipt-internal contradictions before Rules 1-8. Short-circuits if
  any Rule 0 failure fires (numeric rules on a structurally-broken
  receipt produce confusing quartets — the structural failure alone is
  what the operator needs to fix). Each sub-check gracefully no-ops for
  v0.1 Mazur receipts (which don't carry the v0.2+ topology metadata it
  consults). Sub-checks:
  - **0a**: `bias_policy.mode='constant'` contradicts `updates[*].kind='bias'`
  - **0b**: `bias_policy.mode='constant'` contradicts drifted bias `parameters_after`
  - **0c**: `bias_policy.mode='sgd'` declares biases but no `kind='bias'` updates exist
  - **0d/0e**: `bias_sharing` vs `applies_to_units.length` mismatch
  - **0f**: `Update.kind` vs `topology.parameters[].role` mismatch
  - **0g**: `topology.{input,hidden,output}_size` vs `unit_order.{input,hidden,output}.length` mismatch
- 3 new bad-* fixtures (paired per Csmith doctrine), each isolating one
  Rule 0 sub-check:
  - `fixtures/bad/xor.bad-bias-sharing-mismatch.jsonl` (Rule 0e)
  - `fixtures/bad/xor.bad-kind-vs-role.jsonl` (Rule 0f)
  - `fixtures/bad/xor.bad-topology-size.jsonl` (Rule 0g)
  Sub-checks 0a + 0b are covered by the pre-existing v0.4.0
  `xor.bad-bias-mode-mismatch.jsonl` fixture (which was a skipped test
  in v0.4.0; now passes naturally).
- 3 new tests targeting the new fixtures.

### Changed

- `RULE_DESCRIPTIONS[0]` expanded to mention the v0.4.1+ cross-consistency
  checks alongside the legacy "shape invalid / unsupported product_order /
  non-finite arithmetic" cases.
- `xor.bad-bias-mode-mismatch.test.ts` no longer skips — it fires the
  defensive assertion path and passes (Rule 0a + 0b both surface on this
  fixture per its meta.json mutation).

### Tests

- 291 → 294 total tests; 288 → 292 passing; 3 → 2 skipped.
- 0 fail (Mazur byte-equal preserved; all v0.4.0 behavior unchanged).
- Remaining 2 skips are carry-overs from v0.3: `bp verify general on Mazur (v0.1)`
  cross-version policy + `bp verify multi <good-fixture>` (no good multi-step
  fixture yet).

### Migration notes (v0.4.0 → v0.4.1)

- Pure additive. Existing receipts that pass v0.4.0 reconcile continue to
  pass v0.4.1 reconcile. v0.1/v0.2 Mazur receipts are unaffected (Rule 0
  sub-checks no-op when their input fields are absent).
- Consumers that pattern-match on `result.failures[*].rule` may now see
  `rule: 0` failures where v0.4.0 returned `ok: true` — these are receipts
  that v0.4.0 silently accepted but were always structurally inconsistent.

### Out of scope (deferred)

- Softmax + cross-entropy (v0.5 with factor-decomposition design phase)
- `bp attest` / DSSE / in-toto (premature without consumer)
- Optimizer state (momentum, Adam, weight decay)
- Batched receipts

---

## [0.4.0] - 2026-05-16

### Added

- `bp generate from-config <file>` — read a topology+input JSON, produce a
  canonical receipt. Authoring tools surface (Agent D path from v0.4
  study-swarm).
- `bp scaffold topology --topology mazur|xor|iris [--out <file>]` — write a
  sample input file to bootstrap a new topology.
- `bp validate-input <file>` — schema-validate an input config without
  running the engine.
- Per-neuron bias support: `bias_sharing: "per_neuron"` in Topology,
  `Update.kind: "bias"` populated, `Update.layer_edge: "bias_to_unit"`
  populated. Bias updates are one-factor products of the unit's error
  signal.
- New library exports: `parseTopologyInput`, `validateTopologyInput`,
  `validateTopologyInputOrThrow`, `getInputSchema`,
  `INPUT_SCHEMA_VERSIONS`, `XOR_PER_NEURON_BIAS_INPUT`.
- NEW: `schemas/topology-input.v0.4.0.json` — input schema separate from
  receipt schema. `additionalProperties: false` enforces that receipt-only
  fields (forward, loss, updates, parameters_after, post_update_forward,
  post_update_loss, fixture_status) are PROHIBITED in input files. The
  trust boundary is preserved: authored bytes can never become receipt
  bytes.
- XOR per-neuron-bias golden fixture + 6 bad-bias-* fixtures (one per
  applicable rule, per Csmith doctrine).
- Determinism canary test: `Math.exp(-0.5)` constant pinned across the CI
  matrix (Agent E's early-warning siren for V8 fdlibm drift).
- New CI matrix cell: `node-version: '22.11.0'` alongside the existing
  `22.x` cells.
- NEW: `docs/authoring.md` walkthrough of authoring a custom topology via
  `bp scaffold` → edit → `bp generate from-config` → `bp verify general`.

### Changed

- `schemas/receipt.v0.2.0.json` additive widening: `bias_sharing.enum`
  adds `"per_neuron"`; `OutputErrorSignal.factors.minItems` relaxed from
  2 to 1 (per-neuron bias gradient is a one-factor product).
- README: added "Determinism boundary" section documenting the V8/Node 22
  byte-equal contract scope and the no-go list (Bun/Deno, decimal.js,
  custom Math.exp, Sigstore embedding).

### Determinism scope (unchanged)

- V8/Node 22 scalar IEEE 754 doubles. ECMA-262 §21.3 leaves Math.exp
  precision implementation-defined; backprop-trace's byte-equal contract
  holds on the pinned matrix only.
- Per-neuron bias adds no new transcendentals; the math is `+`, `*` only.

### Doctrine ratchet

- v0.4 study-swarm output (consolidator-decision.md) explicitly REJECTS
  softmax+CE (defer to v0.5; factor-decomposition reshape required),
  `bp attest`/DSSE/in-toto (premature without downstream consumer), tanh
  (surface area without lift), momentum/Adam/weight-decay/batching
  (deferred), custom Math.exp / decimal.js / Bun-Deno matrix
  (thesis-erosion).

### Migration notes (v0.3.0 → v0.4.0)

- v0.1/v0.2 receipts continue to validate against v0.1.0/v0.2.0 schemas.
- v0.2.0 schema's per_layer-only constraint is widened; existing per_layer
  receipts still validate.
- New per-neuron-bias receipts emit `bias_sharing: "per_neuron"` in
  topology and include per-unit bias parameters in `parameter_order` +
  `parameters_before` + `parameters_after`.
- Authoring tooling is opt-in; existing programmatic API (`runGeneralStep`
  with hand-constructed `GeneralInput`) unchanged.

[0.4.0]: https://github.com/mcp-tool-shop-org/backprop-trace/releases/tag/v0.4.0

## [0.3.0] - 2026-05-16

### Added

- Generalized engine (`runGeneralStep`, `src/general-engine.ts`) supporting
  arbitrary N-input N-hidden N-output sigmoid+ReLU+identity topologies via
  explicit `unit_order` + `parameter_order` declarations on a `Topology`
  value. The existing Mazur 2-2-2 path (`runMazurStep`) is unchanged and
  remains the byte-equal golden source; `runGeneralStep` ships alongside it
  and produces v0.2.0-schema receipts.
- Schema v0.2.0 (`schemas/receipt.v0.2.0.json`): additive on top of v0.1.0.
  `unit_order` + `parameter_order` are REQUIRED at the top level for general-
  topology receipts; `trace_id` (128-bit lowercase hex) + `step_index`
  (0-based integer) are OPTIONAL for multi-step receipts;
  `numeric_policy.tolerance` becomes an object `{atol, rtol}` (the scalar
  form is retained as v0.1 compat sugar — read as `{atol: <value>, rtol: 0}`);
  `topology.activation` enum widens to `{sigmoid, identity, relu}`;
  layer-size fields widen from `const 2` to integer 1-64.
- Hybrid tolerance: `|a - b| <= max(atol, rtol * max(|a|, |b|))` — symmetric
  max form per Boost.Test FPC_STRONG, Bruce Dawson (2012), and
  floating-point-gui.de. Defaults `atol = 1e-12`, `rtol = 1e-9`.
- Rule 9 — multi-step parameter chain: for `step_index = N` (N > 0),
  `parameters_before[N]` MUST equal the prior receipt's `parameters_after[N-1]`
  within tolerance. Single-step receipts (`step_index = 0`) skip Rule 9.
- Rule 10 — multi-step trace identity: across a JSONL training run, every
  receipt MUST share `trace_id` and `step_index` MUST be sequential
  (0, 1, 2, ..., N-1, monotonic and dense).
- Activation library (`src/activations.ts`): `sigmoid` (existing),
  `identity` (NEW), `relu` (NEW), each as `activate(x): number` plus
  `*DerivativeFromOut(out): number` siblings. Plus `activate` /
  `activationDerivativeFromOut` dispatch helpers consumed by the general
  engine.
- Topology types and validators (`src/topology.ts`): `Topology`, `Parameter`,
  `ParameterRole`, `UnitOrder`, `UnitId`, `ParameterId`, plus
  `assertTopologyValid`, `findWeight`, `findHiddenBias`, `findOutputBias`
  helpers.
- XOR-sigmoid 2-2-1 fixture (`fixtures/xor.golden.jsonl` +
  `fixtures/xor.published.json`) — operator-chosen seeded init; engine-
  anchored (no published source provides this exact trace).
- Iris 4-3-3 sigmoid fixture (`fixtures/iris.golden.jsonl` +
  `fixtures/iris.published.json`) — first iris flower
  `(5.1, 3.5, 1.4, 0.2)` targeting one-hot setosa `[1, 0, 0]`;
  engine-anchored.
- Bad fixtures for the multi-step rules (`fixtures/bad/multi-step.bad-chain.jsonl`,
  `fixtures/bad/multi-step.bad-trace-id.jsonl`) per the Csmith
  bad-receipts-precede-good doctrine — each ships with a sibling
  `.meta.json` documenting the mutation and the targeted invariant.
- CLI subcommands: `bp verify general <file>` (generalized verify gate for
  v0.2.0-schema receipts), `bp verify multi <file.jsonl>` (multi-record
  verify; Rules 9, 10 + per-record Rules 1-8), `bp generate xor` and
  `bp generate iris` (emit canonical bytes for the new fixtures).
  `bp verify mazur` keeps v0.1.0 semantics unchanged.
- Library exports added to the package barrel: `runGeneralStep`,
  `runMultiStep`, `emitGeneralReceipt`, `XOR_INPUT`, `XOR_TOPOLOGY`,
  `IRIS_INPUT`, `IRIS_TOPOLOGY`, `MAZUR_TOPOLOGY`, `sigmoid` /
  `sigmoidDerivativeFromOut` / `identity` / `identityDerivativeFromOut` /
  `relu` / `reluDerivativeFromOut`, `activate`,
  `activationDerivativeFromOut`, `applyToleranceCheck`,
  `normalizeTolerance`, `checkRule9`, `checkRule10`, `reconcileMultiStep`,
  `verifyGeneralEngineReproduces`, `extractGeneralEngineInput`,
  `assertTopologyValid`, `findWeight`, `findHiddenBias`, `findOutputBias`.
- New subpath exports: `./general-engine`, `./topology`, `./activations`,
  `./schema/0.1.0`, `./schema/0.2.0`. The bare `./schema` alias keeps
  pointing at `receipt.v0.1.0.json` for backward compatibility.
- New docs:
  - `docs/topology.md` — authoring guide for general topologies (the
    `Topology` type, the four `ParameterRole`s, unit-id / parameter-id
    constraints, the `unit_order` + `parameter_order` canonicalization,
    per-layer bias sharing, and a worked example walking through
    `XOR_INPUT`).
  - `docs/multi-step.md` — multi-step training receipts (parameter-chain
    integrity, `trace_id` + `step_index` semantics, multi-record JSONL
    framing, two-phase verification model, `bp verify multi` workflow).

### Changed

- All 8 existing reconciliation rules now route through
  `applyToleranceCheck(a, b, policy)`. v0.1 receipts that supply a scalar
  `numeric_policy.tolerance` continue to reconcile under pure-atol semantics
  (the scalar `X` is normalized to `{atol: X, rtol: 0}`, so the symmetric
  max-form collapses to `|a - b| <= X` — identical to v0.1 behavior).
- `validateReceiptSchema` auto-detects v0.1 vs v0.2 by inspecting
  `schema_version` on the receipt. Both validators are compiled once at
  module load and cached. Callers that need to pin a specific schema can
  pass `opts.version`.
- `emitReceipts` dispatches on receipt schema_version — Mazur receipts emit
  via the v0.1 emitter, generalized receipts via the v0.2 emitter. Multi-
  record framing is unchanged (trailing LF per record; concatenating two
  emitter outputs is itself a valid emitter output).
- `RULE_DESCRIPTIONS` expanded to 10 entries (Rules 9, 10 added).
- `docs/reconciliation.md`: quick-reference table updated to list all 10
  rules; new "Multi-step receipts" section explains the two-phase
  verification model and the 128-bit hex `trace_id` convention.
- `docs/computation-order.md`: new "Hybrid tolerance (v0.3+)" section
  documenting the symmetric max form, defaults (`atol = 1e-12`,
  `rtol = 1e-9`), backward-compat with scalar `tolerance: 1e-9`, and
  rationale (absorbs the v0.1 w6/w8 product drift previously documented
  in `fixtures/bad/mazur.bad-gradient.meta.json`).
- `docs/cli.md`: documents the four new subcommands and the exit-code
  conventions for each.
- `docs/schema.md`: dedicated walk-through of `schemas/receipt.v0.2.0.json`,
  highlighting the v0.1 → v0.2 diffs (required unit_order/parameter_order;
  tolerance becomes object-or-scalar; activation widened; layer sizes
  widened; optional trace_id / step_index for multi-step).
- `docs/quickstart.md`: adds a "Beyond Mazur — XOR and iris" section
  showing programmatic and CLI flows for the new fixtures.
- `README.md`: updated CLI section, new "Quick demos" block with XOR + iris
  one-liners, and the "What this is" section now mentions v0.3 generalized
  engine + hybrid tolerance + multi-step.

### Determinism scope

Unchanged from v0.2 for sigmoid (Math.exp on V8 / Node 22 — see
`docs/canonical-emission.md` for the binary64 pinning policy). ReLU is
exact arithmetic (no transcendental). Identity is trivially exact. The XOR
and iris fixtures inherit the V8/Node 22 ULP envelope from the Mazur
spine — they're pinned against the same runtime, not against an external
published anchor.

### Migration notes (v0.2.0 → v0.3.0)

- Receipts with `schema_version: "0.1.0"` (Mazur) continue to validate
  against the v0.1.0 schema unchanged. `bp reconcile receipt`,
  `bp verify mazur`, `bp generate mazur`, and `bp validate` all keep
  their v0.2 behavior.
- Receipts emitted by `runGeneralStep` declare
  `schema_version: "0.2.0"`. Consumers that read receipts and need to
  route by version should branch on `receipt.schema_version` (the v0.2
  validator surfaces the dispatched version in its result envelope —
  see `ValidationResult.schemaVersion`).
- Consumers that parsed receipts via `JSON.parse` directly and accessed
  `numeric_policy.tolerance` as a number must now handle both shapes —
  use `normalizeTolerance(receipt.numeric_policy.tolerance)` to flatten
  to `{atol, rtol}` and read `atol` (which equals the scalar value for
  v0.1 receipts). `parseReceipt`, `validateReceiptSchema`, and the
  reconciler handle both shapes automatically.
- The Mazur golden fixture (`fixtures/mazur.golden.jsonl`) is byte-equal
  preserved against v0.2. The byte-equal regression test that pinned v0.1
  / v0.2 is unaffected by the v0.3 schema additions.

[0.3.0]: https://github.com/mcp-tool-shop-org/backprop-trace/releases/tag/v0.3.0

## [0.2.0] - 2026-05-16

### Added

- Reconciler now implements all 8 rules from `docs/reconciliation.md`. Rules 1, 2, 3, 5, 6, 7, 8 are wired alongside the v0.1 Rule 4 implementation. The `bp reconcile receipt` command now catches `output_error_signal` product mismatches (Rule 1), per-contribution and backpropagated-sum mismatches (Rule 2), `hidden_error_signal` mismatches (Rule 3), `update == learning_rate * gradient` mismatches (Rule 5), `weight_after == weight_before + update` mismatches (Rule 6), `parameters_after` consistency including the constant-bias exact-zero-delta path (Rule 7), and `factor.from` provenance reference mismatches (Rule 8).
- Eight anti-circularity bad-* fixtures shipping alongside the rule wirings (Csmith doctrine): `fixtures/bad/mazur.bad-output-signal.jsonl` (Rule 1), `mazur.bad-contribution.jsonl` + `mazur.bad-backprop-sum.jsonl` (Rule 2 per-contribution and sum paths), `mazur.bad-hidden-signal.jsonl` (Rule 3), `mazur.bad-update-value.jsonl` (Rule 5), `mazur.bad-weight-after.jsonl` (Rule 6), `mazur.bad-params-after.jsonl` (Rule 7), `mazur.bad-provenance.jsonl` (Rule 8). Each ships with a `.meta.json` sibling documenting the mutation, the targeted invariant, expected cascades, and the `bp reconcile` exit-code contract. All seven new fixtures are byte-precise mutations of `fixtures/mazur.golden.jsonl` (single-field surgery + `fixture_status` block rewrite).
- Cascade detection: when Rule N fails on parameter P and Rule N-1 also failed on the same parameter, the report marks Rule N's failure with `cascade_of_rule: N-1` so renderers can show "Note: cascades from Rule N-1. Fix Rule N-1 first." (FT-E-017).
- Factor decomposition on `ReconciliationFailure`: Rules 1, 3, 4 populate an optional `factors[]` + `product_order` so renderers can show the multiplicand chain matching the example in `docs/reconciliation.md` (FT-E-018; closes D-A-012 docs drift).
- New library exports:
  - `validateReceiptSchema` / `validateReceiptOrThrow` — Ajv-based JSON Schema validation against the bundled schema (FT-F-001).
  - `parseReceipt` / `parseReceiptJsonl` — parse + validate combo with discriminated-union error shape (FT-F-002).
  - `hashReceipt` — canonical-byte sha256 hex; the in-toto v1 attestation seam (FT-F-003).
  - `getReceiptSchema` / `SCHEMA_VERSIONS` — load the bundled schema by version, with the known-version registry (FT-F-005).
  - `verifyEngineReproduces` — re-runs the engine against a parsed receipt and reports byte-equal status (FT-F-009).
  - `extractEngineInput` — recover a `MazurInput` from a `MazurReceipt` for the verify-engine round-trip (FT-F-012).
  - `emitReceipts` — multi-record JSONL framing helper (FT-F-006).
- New `bp` CLI subcommands:
  - `bp verify mazur [<file>]` — full gate: schema validation + reconciliation + engine-reproduction (byte-equal) + `fixture_status` lifecycle + published-anchor drift. Composes the format/engine/reconciler primitives per the sigstore-go fixed-order short-circuit pattern (study-swarm finding 2).
  - `bp generate mazur [--out file] [--check]` — re-runs the engine, emits canonical bytes to stdout or `--out`, and (with `--check`) diffs against an existing file.
  - `bp validate <file>` — schema-only validation, exit 0/1 buckets.
- CLI: `--color=auto|never|always` and `NO_COLOR` environment variable support (FT-C-004).
- CLI: stdin `-` support for `reconcile receipt` and `validate` (FT-C-005).

### Changed

- `ReconciliationFailure` type adds optional `factors`, `product_order`, and `message` fields. Existing consumers that pattern-match on the v0.1 quartet (rule / parameter_id / field_path / stored / recomputed / delta / tolerance / cascade_of_rule) continue to work; the new fields are additive.
- Updated `docs/reconciliation.md` quick-reference table: all 8 rules now show "implemented (v0.2)" or "implemented (v0.1)" status. Removed obsolete "v0.2+" language elsewhere in the doc.
- `fixtures/bad/mazur.bad-gradient.meta.json`: the Rule 5 cascade from Rule 4 is now observed (no longer "expected when Rule 5 lands"). Added a v0.2 observation note about an incidental Rule 3 firing on h2 due to precision drift in the original hand-derivation (the existing T-A-005 test filters specifically on Rule 4 and is unaffected).

### Dependencies

- Added: `ajv ^8.20.0` (runtime; Ajv-based schema validation via the 2020-12 draft entry).

### Infrastructure

- New `docs/cli.md` — reference for all four `bp` subcommands (reconcile / verify / generate / validate), flags, exit-code buckets, and stdin support.
- New `docs/attestation.md` — explains canonical-byte hashing, the in-toto v1 attestation seam via `hashReceipt`, and what's deferred to v0.3+ (DSSE envelope wrapping, Sigstore/Rekor transparency log integration).
- `docs/canonical-emission.md`: documented multi-record JSONL framing (trailing-LF-after-each-record semantics per ndjson convention; `emitReceipts([r1, r2, r3])` produces `{...}\n{...}\n{...}\n`).
- New subpath exports for the v0.2 library modules: `./validate`, `./parse`, `./hash`, `./schema-loader`, `./verify-engine`, `./extract` — consumers can tree-shake to a single helper.

### Determinism scope

Unchanged from v0.1 — Node 22.x on V8. The schema validator (Ajv 2020-12) is pure-JS with no native deps and inherits V8's IEEE-754 determinism. `hashReceipt` uses `node:crypto`'s sha256, which is deterministic across Node versions for identical byte input.

[0.2.0]: https://github.com/mcp-tool-shop-org/backprop-trace/releases/tag/v0.2.0

## [0.1.0] - 2026-05-16

### Added

- Reconciler entry point `reconcileReceipt()` with Rule 4 (update gradient consistency) wired. Rules 1-3 and 5-8 reserved for v0.2+ — each will ship with a deliberately-broken fixture per the Csmith (Yang et al. PLDI 2011) doctrine of bad receipts preceding good receipts.
- Canonical JSONL emission with schema-ordered traversal (`x-order` annotations on every object type in the schema drive byte placement; not alphabetical, not insertion order, not `JSON.stringify`).
- Mazur 2-2-2 hand-derived fixture (`fixtures/mazur.golden.jsonl`) — single training step on the canonical pedagogical 2-input / 2-hidden / 2-output sigmoid+MSE network.
- Engine (`runMazurStep`) reproducing the Mazur fixture at 9-sig-fig trace fidelity within the V8/Node 22 ULP envelope.
- Formatter policy fixture (`fixtures/formatter.policy.golden.json`) with 24 test cases covering round-half-to-even, carry propagation, negative-zero normalization, scope rejection, and tie cases.
- Anti-circularity bad-gradient fixture (`fixtures/bad/mazur.bad-gradient.jsonl`) — deliberately mutates `updates[4].gradient` by 1e-6 (1000x tolerance) so the reconciler must catch the rule violation BEFORE consulting `fixture_status` lifecycle metadata.
- `bp` CLI with `reconcile receipt <file>` subcommand.
- Receipt JSON Schema (`schemas/receipt.v0.1.0.json`) — JSON Schema draft 2020-12, `additionalProperties: false`, `x-order` on every object.
- Doctrine docs: `docs/canonical-emission.md`, `docs/computation-order.md`, `docs/reconciliation.md`.

### Documentation

- Add `docs/schema.md` walking through `schemas/receipt.v0.1.0.json` field-by-field with rationale, cross-referencing canonical-emission (RFC 8785 / RFC 8949 §4.2 alternatives) and the in-toto attestation seam.
- Add `docs/quickstart.md` — five-minute walk-through from install through CLI + library usage.
- Add "Why backprop-trace?" + "30-second quickstart" to `README.md`.
- Add quick-reference table for the eight reconciliation rules in `docs/reconciliation.md` (v0.1 implemented vs v0.2+ deferred).
- Add `human_readable_summary` field to `fixtures/mazur.published.json` so readers understand the drift ledger before parsing the structured claims.
- Cite Csmith (Yang et al. PLDI 2011) and CompCert (Leroy CACM 2009) as the academic lineage for the anti-circularity / "bad receipts precede good receipts" doctrine (in `docs/reconciliation.md`).

### Infrastructure

- Add `.github/workflows/codeql.yml` — weekly CodeQL scans (javascript-typescript) on Mondays 06:00 UTC plus on every push/PR to main.
- Add `.github/dependabot.yml` — weekly npm and github-actions update scans, grouped dev-dependency updates.
- Add `.github/ISSUE_TEMPLATE/bug_report.md` and `.github/ISSUE_TEMPLATE/feature_request.md` so first-time reporters know what context to include (version, Node, OS, receipt file, law-stack alignment for feature requests).
- Add `.github/pull_request_template.md` with an explicit anti-circularity checklist for PRs that wire new reconciler rules.

### Determinism scope

Pinned to Node 22.x on V8. Cross-engine portability (Hermes, JSC, Bun-JSC) is not tested. The widely-cited downstream anchor `0.291027924` differs from the engine value `0.29102777369359933` by ~1.5e-7; see `fixtures/mazur.published.json` for the drift ledger.

[0.1.0]: https://github.com/mcp-tool-shop-org/backprop-trace/releases/tag/v0.1.0
