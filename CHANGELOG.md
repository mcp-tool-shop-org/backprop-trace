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
