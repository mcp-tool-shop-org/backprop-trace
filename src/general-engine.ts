/**
 * v0.3 generalized backprop engine — forward / backward / SGD update for
 * any topology declared via src/topology.ts.
 *
 * Coexistence strategy (see design memo §1 + this file's commit notes):
 * runMazurStep in src/engine.ts is UNCHANGED and remains the canonical
 * Mazur 2-2-2 path. This module ships alongside it. The two produce
 * mathematically equivalent receipts for the Mazur topology, but the
 * Mazur byte-equal golden remains pinned to runMazurStep's output so the
 * v0.1 contract is ironclad. runGeneralStep produces v0.2.0-schema
 * receipts (note the bumped schema_version and the generic ForwardUnit /
 * Update keying by unit/parameter id rather than the Mazur-specific
 * h1/h2/o1/o2/w1..w8 shape).
 *
 * Computation order pins (must mirror src/engine.ts's Mazur path so the
 * math is provably identical for the Mazur topology):
 *   - Hidden unit forward: net = sum_i (input_i * weight_i_to_h) + bias_hidden,
 *     STRICT left-to-right in unit_order.input order.
 *   - Output unit forward: net = sum_h (out_h * weight_h_to_o) + bias_output,
 *     STRICT left-to-right in unit_order.hidden order.
 *   - Hidden backward summation: sum_o (signal_o * weight_h_to_o) in
 *     unit_order.output order.
 *   - Update iteration: parameter_order (which biases are skipped per
 *     bias_policy.mode === "constant").
 *
 * Hybrid tolerance (memo §3) is carried THROUGH this engine but not
 * applied here — the engine emits raw bytes; the reconciler is what
 * enforces tolerance. numeric_policy.tolerance accepts either a number
 * (legacy scalar; sugar for {atol: N, rtol: 0}) or the v0.3 object
 * {atol, rtol} form. Both shapes round-trip through the receipt.
 *
 * Multi-step support (memo §4): trace_id + step_index are optional inputs;
 * when present they propagate to the receipt and downstream Rules 9/10
 * use them. Single-step callers leave them undefined.
 */

import {
  activate,
  activationDerivativeFromOut,
  softmaxVector,
  type ActivationName,
  type OutputActivationName,
} from "./activations.js"
import {
  assertTopologyValid,
  findBiasForUnit,
  findHiddenBias,
  findOutputBias,
  findWeight,
  type ParameterId,
  type Topology,
  type UnitId,
} from "./topology.js"

// --- Shared structural types -----------------------------------------------

/**
 * Per-unit forward pass result — pre-activation `net` and post-activation
 * `out`. Keyed by unit id in the receipt's `forward` map.
 */
export type ForwardUnit = { net: number; out: number }

/**
 * A named factor in a multiplicative gradient/signal decomposition.
 * `from` is an optional source-path string for receipt readers.
 */
export type NamedFactor = { name: string; from?: string; value: number }

export type OutputErrorSignal = {
  factors: NamedFactor[]
  product_order: "left_to_right"
  signal_value: number
  /**
   * v0.5 — optional dual-form Jacobian decomposition. Present for softmax+CE
   * receipts the engine emits; absent for half_squared_error receipts
   * (Mazur, XOR, iris, per-neuron-bias). Rule 13 fires only when present.
   */
  dual_form?: DualForm
}

export type DownstreamContribution = {
  from: string
  downstream_signal: number
  via_weight: string
  weight_value: number
  value: number
}

export type HiddenErrorSignal = {
  downstream_contributions: DownstreamContribution[]
  summation_order: string[]
  backpropagated_sum: number
  activation_derivative: number
  product_order: "left_to_right"
  signal_value: number
}

/**
 * v0.9.1 — per-parameter Adam/AdamW state.
 *
 * Canonical names follow Kingma & Ba 2014 Algorithm 1 directly (arXiv:1412.6980):
 *   - m: first moment estimate (signed; same dimension as parameter)
 *   - v: second moment estimate (non-negative; gradient squared accumulator)
 *
 * Framework importers normalize from framework-native names:
 *   - PyTorch torch.optim.Adam state_dict(): exp_avg → m, exp_avg_sq → v
 *   - optax.adam ScaleByAdamState: mu → m, nu → v
 *   - TF Keras Adam: m_<param> → m, v_<param> → v
 *
 * Bias-corrected m̂ and v̂ are DERIVED at verify time from (state_after,
 * beta1, beta2, t) — NEVER stored on the receipt. Storing them risks
 * silent-wrong on disagreement; Rule 23 recomputes from canonical state.
 */
export type AdamState = { m: number; v: number }

/**
 * v0.9.2 — per-parameter classical PyTorch-style SGD momentum state.
 *
 * Single scalar `buffer` tracking the accumulated velocity (PyTorch's
 * `state['momentum_buffer']` one-token form). Distinct from Adam's
 * (m, v) pair. Buffer is signed (tracks gradient sign in descent
 * direction; can be negative when accumulated descent gradient
 * overshoots a basin).
 *
 * Framework importers normalize from framework-native names:
 *   - PyTorch torch.optim.SGD state_dict(): momentum_buffer → buffer
 *   - optax.sgd / optax.trace TraceState: trace → buffer
 *   - TF Keras SGD: momentum/<param> → buffer
 *
 * Recurrence (classical, PyTorch convention with lr OUTSIDE buffer per
 * Sutskever et al. 2013 ICML): buffer_t = mu * buffer_{t-1} + gradient.
 * Update (descent-direction sign convention): update = lr * buffer_t.
 * Initial buffer at t=1: buffer_0 = 0 (PyTorch lazy-initializes on first
 * .step()).
 *
 * v0.9.2 supports CLASSICAL PyTorch-style only. Nesterov accelerated
 * gradient (Sutskever 2013 §2 lookahead form) is reserved for v0.9.3.
 * Dampening (PyTorch's torch.optim.SGD(dampening=tau) recurrence
 * buffer_t = mu * buffer_{t-1} + (1-tau) * gradient) reserved for v0.9.3.
 * SGD coupled L2 weight decay deferred to v0.10.
 */
export type MomentumState = { buffer: number }

/**
 * v0.9.2 — discriminated per-parameter optimizer state.
 *
 * Adam/AdamW updates carry AdamState ({m, v}); sgd_momentum updates
 * carry MomentumState ({buffer}). Receipt schemas validate either
 * shape; reconciler Rule 20 enforces that the actual shape matches
 * optimizer.name. The Optimizer type below uses this union; callers
 * narrow on optimizer.name before accessing shape-specific fields.
 */
export type OptimizerStateAny = AdamState | MomentumState

/**
 * v0.9.1 — per-update optimizer block.
 *
 * Widened over the v0.4 SGD-only shape: `name` is now a union, and
 * state_before / state_after are OPTIONAL at the type level but REQUIRED
 * at the schema + reconciler boundaries when name is "adam" or "adamw".
 *
 * For SGD updates the runtime bytes are byte-equal to v0.1-v0.9.0: the
 * engine never populates state_before/state_after on an SGD update, so
 * the emitter omits them and existing fixtures round-trip unchanged.
 */
export type Optimizer = {
  name: "sgd" | "adam" | "adamw" | "sgd_momentum"
  learning_rate: number
  factors: NamedFactor[]
  product_order: "left_to_right"
  /**
   * v0.9.1 — required when name in {adam, adamw} (AdamState shape).
   * v0.9.2 — required when name === "sgd_momentum" (MomentumState shape).
   * MUST be omitted for plain sgd.
   * Discriminated by optimizer.name; Rule 20 enforces the right shape
   * matches the name at reconcile time.
   */
  state_before?: OptimizerStateAny
  /** v0.9.1+ — see state_before. */
  state_after?: OptimizerStateAny
}

/**
 * v0.9.1 — top-level optimizer configuration block.
 *
 * Carries global hyperparameters (learning rate, betas, epsilon, weight
 * decay) and the step counter t used by Adam bias correction. SGD-only
 * receipts MAY omit this block — when omitted the top-level
 * `learning_rate` field is the sole optimizer descriptor and behavior is
 * byte-equal to v0.4.0. Adam/AdamW receipts MUST include it; the schema
 * enforces beta1/beta2/epsilon/t required for adam, plus weight_decay
 * required for adamw.
 *
 * `t` is per-receipt (per-step in a multi-step bundle). Reconciler
 * Rule 23 asserts `t === step_index + 1` when step_index is present
 * (Kingma & Ba 2014 indexes the timestep starting at 1, matching
 * PyTorch's `state["step"]` after the first `.step()` call).
 *
 * `learning_rate` is excluded from Rule 26's constancy check (LR
 * schedules across steps are legitimate; betas/epsilon/weight_decay/name
 * MUST stay constant).
 */
export type OptimizerConfig = {
  name: "sgd" | "adam" | "adamw" | "sgd_momentum"
  learning_rate: number
  /** Adam/AdamW first-moment decay. */
  beta1?: number
  /** Adam/AdamW second-moment decay. */
  beta2?: number
  /** Adam/AdamW numerical-stability epsilon. */
  epsilon?: number
  /** AdamW decoupled weight decay; v0.9.2 forbids on sgd_momentum (deferred to v0.10). */
  weight_decay?: number
  /** Adam/AdamW timestep (1-indexed per Kingma & Ba 2014 Alg 1). */
  t?: number
  /**
   * v0.9.2 — classical PyTorch-style SGD momentum coefficient (mu).
   * Required when name === "sgd_momentum". In (0, 1). Typically 0.9 in
   * production (Sutskever et al. 2013 / Wilson et al. 2017 / timm).
   */
  momentum?: number
  /**
   * v0.9.2 — RESERVED for v0.9.3 Nesterov accelerated gradient
   * (Sutskever et al. 2013 §2 lookahead form). In v0.9.2, MUST be
   * literally false when present (schema-enforced via const). When
   * absent, treated as false (classical momentum). The engine rejects
   * any sidecar that bypasses schema with nesterov: true via a clear
   * "deferred to v0.9.3" message.
   */
  nesterov?: false
  /**
   * v0.9.2 — RESERVED for v0.9.3 dampening (PyTorch's
   * torch.optim.SGD(dampening=tau) recurrence
   * buffer_t = mu * buffer_{t-1} + (1-tau) * gradient). In v0.9.2,
   * MUST be literally 0 when present (schema-enforced via const).
   * When absent, treated as 0. The engine rejects any sidecar that
   * bypasses schema with dampening !== 0 via a clear
   * "deferred to v0.9.3" message.
   */
  dampening?: 0
}

/**
 * Update entry for a single parameter.
 *
 * v0.4 INVARIANT — TYPE NARROWNESS:
 * The TypeScript `kind` and `layer_edge` unions are deliberately KEPT
 * NARROW (matching v0.3 `kind: "weight"` only) for cross-module type
 * compatibility with src/engine.ts and src/emit.ts (which still consume
 * the v0.1 Update shape). The RUNTIME bytes emitted to receipts are NOT
 * constrained by these narrow types — the v0.4 per_neuron bias update
 * branch in runGeneralStep pushes entries with `kind: "bias"` and
 * `layer_edge: "bias_to_layer"` via a single localized type assertion at
 * the push site (search "PER_NEURON_BIAS_UPDATE_CAST" below).
 *
 * v0.9.1 NOTE — Optimizer widening: general-engine.ts's `Optimizer` now
 * carries optional state_before/state_after (Adam/AdamW). For SGD the
 * emitter omits them; for Adam/AdamW the emitter requires them. This
 * widens general-engine.ts's Update so it is no longer structurally
 * assignable to engine.ts's narrower Update — emit.ts's general path
 * uses dedicated emitUpdateGeneral/emitOptimizerGeneral helpers, while
 * the Mazur path continues to use the existing emitUpdate/emitOptimizer
 * unchanged. This intentional split keeps the Mazur v0.1.0 byte-equal
 * contract isolated from the v0.5.0 Adam additions.
 */
export type Update = {
  parameter_id: string
  kind: "weight"
  layer_edge: "input_to_hidden" | "hidden_to_output"
  parameter_role: string
  from_unit: string
  to_unit: string
  weight_before: number
  optimizer: Optimizer
  gradient: number
  update: number
  weight_after: number
}

// --- Policy types (carried from input through receipt) ---------------------

/**
 * v0.3 hybrid tolerance object: |a - b| <= max(atol, rtol * max(|a|, |b|))
 * (memo §3). The legacy scalar form `tolerance: number` is accepted as
 * sugar for {atol: number, rtol: 0} — see ToleranceSpec union.
 */
export type ToleranceObject = { atol: number; rtol: number }

/**
 * Tolerance as accepted at the engine boundary: either the legacy scalar
 * (treated as {atol: scalar, rtol: 0}) or the v0.3 object. The engine
 * stores whatever the caller supplied — it does NOT normalize. The
 * reconciler is responsible for normalizing at consumption time.
 */
export type ToleranceSpec = number | ToleranceObject

export type NumericPolicy = {
  number_encoding: "decimal"
  precision_significant_digits: number
  rounding: "round_half_to_even"
  tolerance: ToleranceSpec
  computation_order: "schema_defined"
  byte_output: {
    format: "jsonl"
    json_key_order: "schema_defined"
    trailing_zero_policy: "pad_to_significant_digits"
    indent: "none"
  }
}

export type BiasPolicy = {
  mode: "constant" | "sgd"
  reason: string
  updated_in_step: boolean
  reconciliation: string
}

// --- GeneralInput + GeneralReceipt ----------------------------------------

/**
 * Input to runGeneralStep. Mirrors MazurInput's shape but is generic over
 * topology, units, and parameters.
 *
 * The `inputs` map is keyed by input unit ids (whatever the topology
 * declares — e.g. "i1", "x1", "f1"). `targets` is keyed by output unit
 * ids. `parameters_before` is keyed by parameter ids (e.g. "w1", "w_x1_h1",
 * "b_hidden"). The engine asserts every required key is present and
 * finite at the boundary.
 *
 * `trace_id` + `step_index` are optional multi-step overlay (memo §4).
 * Leave undefined for single-step receipts; Rules 9 and 10 skip when
 * either is absent on a single-record verify.
 */
export type GeneralInput = {
  readonly topology: Topology
  readonly learning_rate: number
  readonly inputs: Readonly<Record<string, number>>
  readonly targets: Readonly<Record<string, number>>
  readonly parameters_before: Readonly<Record<string, number>>
  readonly numeric_policy: NumericPolicy
  readonly bias_policy: BiasPolicy
  readonly trace_id?: string
  readonly step_index?: number
  readonly fixture?: string
  readonly metadata?: GeneralMetadata
  /**
   * v0.9.1 — OPTIONAL optimizer config. When absent or `name === "sgd"`,
   * the engine takes the SGD path (byte-equal to v0.1-v0.9.0). When
   * `name in {adam, adamw}`, the engine takes the Adam path and REQUIRES
   * `optimizer_state_before` to be present with an entry for every
   * weight parameter (biases are handled per `bias_policy`). beta1,
   * beta2, epsilon, and t MUST be set; for adamw, weight_decay MUST also
   * be set. Validation happens at runtime in assertOptimizerConfig.
   */
  readonly optimizer_config?: OptimizerConfig
  /**
   * v0.9.1+ — OPTIONAL per-parameter optimizer state at step entry.
   * REQUIRED when optimizer_config.name in {adam, adamw, sgd_momentum}.
   * Shape discriminated by optimizer_config.name:
   *   - adam/adamw: AdamState ({m, v}) per parameter
   *   - sgd_momentum: MomentumState ({buffer}) per parameter
   * Keyed by parameter_id; MUST cover every parameter that will get an
   * Update entry emitted (weights always; biases only when
   * bias_policy.mode === "sgd"). Engine derives state_after
   * deterministically from (state_before, gradient, hyperparameters).
   */
  readonly optimizer_state_before?: Readonly<Record<string, OptimizerStateAny>>
}

export type GeneralMetadata = {
  source: string
  url_reference?: string
  gradient_convention: "descent_direction"
}

/**
 * Serialized form of a Topology for emission inside a receipt. Identical
 * to Topology except the readonly hints are dropped so it deserializes
 * round-trip as plain JSON. Equivalent at runtime.
 */
export type SerializedTopology = {
  layers: ["input", "hidden", "output"]
  unit_order: { input: UnitId[]; hidden: UnitId[]; output: UnitId[] }
  parameter_order: ParameterId[]
  parameters: Array<{
    id: ParameterId
    role:
      | "input_to_hidden_weight"
      | "hidden_to_output_weight"
      | "hidden_bias"
      | "output_bias"
    from_unit?: UnitId
    to_unit?: UnitId
    applies_to_units?: UnitId[]
  }>
  activation_hidden: ActivationName
  // v0.5: widened to OutputActivationName to admit "softmax". For non-softmax
  // outputs the bytes are unchanged; softmax is a v0.3.0-schema-only addition.
  activation_output: OutputActivationName
  // v0.5: widened to admit "cross_entropy_softmax". Pairs with
  // activation_output === "softmax" — topology.ts asserts the co-requirement.
  loss: "half_squared_error" | "cross_entropy_softmax"
  bias_sharing: "per_layer" | "per_neuron"
  input_size: number
  hidden_size: number
  output_size: number
}

// v0.5 — re-export DualForm + JacobianTerm from engine.ts so consumers can
// import them from either engine module. The canonical declaration lives in
// engine.ts (alongside OutputErrorSignal) so the emit-side narrow type
// shares the same shape.
export type { JacobianTerm, DualForm } from "./engine.js"
import type { DualForm, JacobianTerm } from "./engine.js"

export type FixtureStatus = {
  authoring_state: "engine_generated"
  verification_state: "engine_reproduced_byte_equal"
  canonical: true
}

/**
 * v0.2.0-schema receipt emitted by runGeneralStep.
 *
 * Differences vs MazurReceipt (v0.1.0):
 *   - schema_version: "0.2.0"
 *   - topology: full SerializedTopology (not just sizes + activation)
 *   - forward / loss.per_output / parameters_before / parameters_after /
 *     targets / inputs: all keyed by unit/parameter id (open-ended record),
 *     not the fixed Mazur key set.
 *   - Optional trace_id / step_index for multi-step overlay.
 */
/**
 * v0.6 — source-framework identity for observer-mode receipts.
 *
 * Closed enum on `name` for the trust vocabulary (mirrors SARIF
 * tool.driver.name discipline). `extractor` separately identifies the
 * adapter (e.g. bp-import-pytorch) that produced the sidecar — distinct
 * from the framework that produced the math.
 *
 * Engine-authored receipts never carry source_framework. Observer-mode
 * receipts (output of `bp import pytorch` etc.) REQUIRE it.
 */
export type SourceFramework = {
  name: "pytorch" | "jax" | "tensorflow" | "hand_derived" | "backprop_trace_engine"
  version: string
  information_uri?: string
  extractor?: { name: string; version: string }
}

/**
 * v0.6 — attestor identity for in-toto-style trust accounting.
 *
 * `kind` is the closed trust class; `identity` is the free-form
 * identifier (URN, framework@version, etc.).
 */
export type AttestorIdentity = {
  kind: "framework" | "engine" | "hand_derivation"
  identity: string
}

/**
 * v0.6 — closed enum of skip-basis values for Rule 15.
 *
 * When `fixture_status.verification_state === "engine_recompute_skipped_with_basis"`,
 * `attestor.skip_basis` MUST be one of these four values. Empty / missing
 * / out-of-enum → Rule 15 failure. The closed enum makes "the operator
 * named the reason on the record" a structural requirement (Leroy's
 * verified-vs-trusted discipline).
 */
export const EXTERNAL_TRUST_BASIS = [
  "hardware_nondeterminism",
  "framework_op_unsupported",
  "distributed_only_field",
  "attested_third_party",
] as const
export type ExternalTrustBasis = (typeof EXTERNAL_TRUST_BASIS)[number]

/**
 * v0.6 — attestor block for observer-mode receipts.
 *
 * `computed_by`: who produced the math (the foreign framework).
 * `verified_by`: who re-ran it as differential witness (the backprop-trace engine).
 * `differential_tolerance`: hybrid tolerance applied to Rule 14.
 * `import_provenance`: optional bookkeeping for the import event.
 * `skip_basis`: optional; required by Rule 15 only when verification_state demands it.
 * `signed_subject_digest`: optional; Rule 16 fires only when present.
 * `bundle_root_digest`: optional (v0.8+); Rule 17 fires only when present.
 *   Binds all receipts in a multi-step observer-mode bundle to a
 *   recomputed canonical-byte digest. INTEGRITY layer (catches accidental
 *   splice + post-binding mutation when the digest is not recomputed),
 *   NOT a producer-authenticity layer — an attacker who controls all
 *   receipt bytes and recomputes the bundle digest passes Rule 17
 *   trivially. Combine with `signed_subject_digest` (Rule 16) or an
 *   external signature for producer-identity binding.
 *
 * computed_by !== verified_by is the load-bearing invariant. Engine-
 * authored receipts have neither (they ARE the producer); observer-mode
 * receipts have both.
 */
export type Attestor = {
  computed_by: AttestorIdentity
  verified_by: AttestorIdentity
  differential_tolerance: { atol: number; rtol: number }
  import_provenance?: {
    source_format: string
    source_hash: string
    import_timestamp?: string
  }
  skip_basis?: ExternalTrustBasis
  signed_subject_digest?: string
  bundle_root_digest?: string
}

export type GeneralReceipt = {
  // v0.6: schema_version is "0.2.0" for half_squared_error receipts (byte-
  // identical to v0.3/v0.4 fixtures), "0.3.0" for cross_entropy_softmax
  // receipts (v0.5 additive-schema path), and "0.4.0" for observer-mode
  // receipts that carry source_framework + attestor (v0.6 external
  // ingestion). v0.9.1: "0.5.0" for Adam/AdamW receipts (FORCED bump:
  // optimizer.name was closed enum ["sgd"]; widening to ["sgd","adam","adamw"]
  // plus per-update state_before/after plus top-level optimizer_config
  // could not happen in-place on v0.4.0). The engine picks the version
  // based on optimizer_config.name (adam/adamw → 0.5.0) + topology.loss
  // + (source_framework presence) inside runGeneralStep so legacy
  // callers don't need to pass it explicitly.
  schema_version: "0.2.0" | "0.3.0" | "0.4.0" | "0.5.0" | "0.6.0"
  fixture: string
  // step is integer ≥1 per receipt.v0.4.0 schema. Engine-authored single-step
  // receipts hardcode step:1. v0.8 multi-step observer-mode receipts set
  // step = step_index + 1 per record (step_index is 0-indexed).
  step: number
  fixture_status: FixtureStatus
  /**
   * v0.6: identifies the framework that produced the math. REQUIRED
   * (semantically) when fixture_status.authoring_state === "external_imported";
   * the schema makes it optional so engine-authored receipts can omit it
   * cleanly. The reconciler's Rule 0 sub-check enforces the pairing.
   */
  source_framework?: SourceFramework
  /**
   * v0.6: attestor block (computed_by + verified_by + differential_tolerance).
   * REQUIRED for observer-mode receipts. Engine-authored receipts omit it.
   */
  attestor?: Attestor
  metadata: GeneralMetadata
  numeric_policy: NumericPolicy
  bias_policy: BiasPolicy
  topology: SerializedTopology
  learning_rate: number
  /**
   * v0.9.1 — OPTIONAL top-level optimizer config (Adam/AdamW). Engine
   * populates this when input.optimizer_config.name in {adam, adamw};
   * SGD-only receipts MUST omit it for byte-equal preservation with
   * v0.1-v0.9.0. Schema position is between `learning_rate` and
   * `trace_id` per receipt.v0.5.0 x-order.
   */
  optimizer_config?: OptimizerConfig
  trace_id?: string
  step_index?: number
  /**
   * v0.9+ — OPTIONAL batch block. When present, declares this receipt
   * represents a BATCHED training step. Single-sample (unbatched)
   * receipts MUST omit this block (preserves v0.1-v0.8 byte-equality).
   * `sample_order` is the canonical iteration order; `reduction`
   * declares how per-sample losses + gradients were reduced.
   */
  batch?: {
    size: number
    sample_order: string[]
    reduction: "mean" | "sum" | "none"
  }
  inputs: Record<string, number>
  targets: Record<string, number>
  parameters_before: Record<string, number>
  /**
   * v0.9+ — OPTIONAL per-sample block. REQUIRED at the reconciler
   * boundary when `batch.size > 1`. Sample-keyed map of full per-sample
   * state (inputs, targets, forward, loss). Top-level inputs/targets/
   * forward carry the FIRST sample's values by canonical convention.
   * v0.9.0 does NOT include per-sample gradients (reduced gradients
   * only at updates[].gradient).
   */
  per_sample?: Record<
    string,
    {
      inputs: Record<string, number>
      targets: Record<string, number>
      forward: Record<string, ForwardUnit>
      loss: {
        per_output: Record<string, number>
        per_sample?: Record<string, number>
        reduction?: "mean" | "sum" | "none"
        total: number
      }
    }
  >
  forward: Record<string, ForwardUnit>
  loss: {
    per_output: Record<string, number>
    /** v0.9+: optional sample-keyed map of per-sample total loss. Used by Rule 18. */
    per_sample?: Record<string, number>
    /** v0.9+: optional echo of batch.reduction. */
    reduction?: "mean" | "sum" | "none"
    total: number
  }
  backward: {
    output_error_signals: Record<string, OutputErrorSignal>
    hidden_error_signals: Record<string, HiddenErrorSignal>
  }
  updates: Update[]
  parameters_after: Record<string, number>
  post_update_forward: {
    status: "filled"
    units: Record<string, ForwardUnit>
  }
  post_update_loss: {
    status: "filled"
    per_output: Record<string, number>
    total: number
  }
}

// --- Boundary validation ---------------------------------------------------

function assertFiniteGeneralInput(input: GeneralInput): void {
  // learning_rate
  if (!Number.isFinite(input.learning_rate)) {
    throw new Error(
      `runGeneralStep: input.learning_rate is not finite (got ${String(input.learning_rate)}). ` +
        `Hint: learning_rate must be a finite positive number.`,
    )
  }
  if (!(input.learning_rate > 0)) {
    throw new Error(
      `runGeneralStep: input.learning_rate must be > 0 (got ${String(input.learning_rate)}).`,
    )
  }
  // inputs
  for (const uid of input.topology.unit_order.input) {
    const v = input.inputs[uid]
    if (v === undefined) {
      throw new Error(
        `runGeneralStep: input.inputs is missing required input unit '${uid}'. ` +
          `Hint: provide a numeric value for every id in topology.unit_order.input.`,
      )
    }
    if (!Number.isFinite(v)) {
      throw new Error(
        `runGeneralStep: input.inputs['${uid}'] is not finite (got ${String(v)}).`,
      )
    }
  }
  // targets
  for (const uid of input.topology.unit_order.output) {
    const v = input.targets[uid]
    if (v === undefined) {
      throw new Error(
        `runGeneralStep: input.targets is missing required output unit '${uid}'. ` +
          `Hint: provide a numeric value for every id in topology.unit_order.output.`,
      )
    }
    if (!Number.isFinite(v)) {
      throw new Error(
        `runGeneralStep: input.targets['${uid}'] is not finite (got ${String(v)}).`,
      )
    }
  }
  // parameters_before
  for (const pid of input.topology.parameter_order) {
    const v = input.parameters_before[pid]
    if (v === undefined) {
      throw new Error(
        `runGeneralStep: input.parameters_before is missing required parameter '${pid}'. ` +
          `Hint: provide a numeric value for every id in topology.parameter_order.`,
      )
    }
    if (!Number.isFinite(v)) {
      throw new Error(
        `runGeneralStep: input.parameters_before['${pid}'] is not finite (got ${String(v)}).`,
      )
    }
  }
}

/**
 * v0.9.1 — boundary validation for Adam/AdamW optimizer config + state.
 *
 * Fail-loud at the engine boundary so misconfigured callers get a clear
 * error message naming the missing field. The schema (v0.5.0) enforces
 * the same conditional requirements but the schema dispatcher runs only
 * at the importer boundary; engine-direct callers (tests, scripts) get
 * caught here. Symmetric with assertSupportedPolicy + assertFiniteGeneralInput.
 */
function assertOptimizerConfig(input: GeneralInput): void {
  const oc = input.optimizer_config
  if (oc === undefined) {
    // SGD is the implicit default. If optimizer_state_before is set without
    // an optimizer_config, that's a misconfiguration — fail loudly.
    if (input.optimizer_state_before !== undefined) {
      throw new Error(
        `runGeneralStep: optimizer_state_before is set but optimizer_config is undefined. ` +
          `Hint: set optimizer_config.name to "adam", "adamw", or "sgd_momentum" to use the ` +
          `per-parameter state, or unset optimizer_state_before to use the SGD path.`,
      )
    }
    return
  }
  if (oc.name === "sgd") {
    // SGD with optimizer_config explicitly set — allowed; engine still takes
    // the SGD path and emits no optimizer_config block in the receipt to
    // preserve v0.1-v0.9.0 byte-equality.
    if (input.optimizer_state_before !== undefined) {
      throw new Error(
        `runGeneralStep: optimizer_state_before is set but optimizer_config.name === "sgd". ` +
          `SGD has no per-parameter state; unset optimizer_state_before or switch to adam/adamw/sgd_momentum.`,
      )
    }
    if (oc.learning_rate !== input.learning_rate) {
      throw new Error(
        `runGeneralStep: optimizer_config.learning_rate (${oc.learning_rate}) ` +
          `!= input.learning_rate (${input.learning_rate}). Both must agree.`,
      )
    }
    return
  }
  if (oc.name !== "adam" && oc.name !== "adamw" && oc.name !== "sgd_momentum") {
    throw new Error(
      `runGeneralStep: optimizer_config.name must be 'sgd', 'adam', 'adamw', or 'sgd_momentum' ` +
        `(got '${String(oc.name)}'). Hint: v0.9.2 supports SGD, Adam, AdamW, and classical ` +
        `PyTorch-style SGD momentum. Nesterov accelerated gradient is v0.9.3; AMSGrad / NAdam / ` +
        `RAdam / Lion / per-parameter-groups / LR schedules / gradient clipping / mixed precision ` +
        `are deferred to v0.10+.`,
    )
  }
  if (oc.learning_rate !== input.learning_rate) {
    throw new Error(
      `runGeneralStep: optimizer_config.learning_rate (${oc.learning_rate}) ` +
        `!= input.learning_rate (${input.learning_rate}). Both must agree.`,
    )
  }
  // -----------------------------------------------------------------------
  // v0.9.2 — classical PyTorch-style SGD momentum branch
  // -----------------------------------------------------------------------
  if (oc.name === "sgd_momentum") {
    // Required hyperparameter: momentum coefficient mu in (0, 1).
    if (oc.momentum === undefined) {
      throw new Error(
        `runGeneralStep: optimizer_config.momentum is required when name === 'sgd_momentum' (got undefined). ` +
          `Hint: classical PyTorch-style SGD momentum recurrence is ` +
          `buffer_t = mu * buffer_{t-1} + gradient; mu is the momentum coefficient ` +
          `(typically 0.9; Sutskever et al. 2013 ICML / Wilson et al. 2017 arXiv:1705.08292).`,
      )
    }
    if (!Number.isFinite(oc.momentum) || !(oc.momentum > 0) || !(oc.momentum < 1)) {
      throw new Error(
        `runGeneralStep: optimizer_config.momentum must be a finite number in (0, 1) (got ${oc.momentum}).`,
      )
    }
    // Reserved-for-v0.9.3 fields: nesterov MUST be absent or literally false;
    // dampening MUST be absent or literally 0. Loud rejection — avoids silent
    // misverification of Nesterov/dampened PyTorch traces against the
    // classical-only v0.9.2 verifier.
    if (oc.nesterov !== undefined && oc.nesterov !== false) {
      throw new Error(
        `runGeneralStep: optimizer_config.nesterov === true is NOT supported in v0.9.2 (got ${String(oc.nesterov)}). ` +
          `Nesterov accelerated gradient (Sutskever et al. 2013 ICML lookahead form) is RESERVED for v0.9.3. ` +
          `v0.9.2 ships classical PyTorch-style SGD momentum ONLY; the schema enforces nesterov: const false. ` +
          `Hint: defer to v0.9.3 for Nesterov support, OR set nesterov: false (or omit) for classical momentum.`,
      )
    }
    if (oc.dampening !== undefined && oc.dampening !== 0) {
      throw new Error(
        `runGeneralStep: optimizer_config.dampening !== 0 is NOT supported in v0.9.2 (got ${String(oc.dampening)}). ` +
          `PyTorch's torch.optim.SGD(dampening=tau) recurrence buffer_t = mu * buffer_{t-1} + (1-tau) * gradient ` +
          `is RESERVED for v0.9.3. v0.9.2 ships dampening=0 ONLY (recurrence buffer_t = mu * buffer_{t-1} + gradient); ` +
          `the schema enforces dampening: const 0. Hint: defer to v0.9.3 for dampening support, OR set ` +
          `dampening: 0 (or omit) for classical momentum.`,
      )
    }
    // SGD coupled L2 weight decay deferred to v0.10 — needs Rules 6/7 third
    // branch distinct from AdamW's decoupled. Loud rejection at the engine
    // boundary; schema also rejects at the if/then level.
    if (oc.weight_decay !== undefined) {
      throw new Error(
        `runGeneralStep: optimizer_config.weight_decay is NOT supported with name === 'sgd_momentum' in v0.9.2 ` +
          `(got ${String(oc.weight_decay)}). PyTorch's torch.optim.SGD(weight_decay=lambda) applies COUPLED L2 ` +
          `(g_t ← g_t + lambda * theta_t before the buffer update) — distinct from AdamW's DECOUPLED weight decay ` +
          `(Rules 6/7 AdamW branch). v0.9.2 defers SGD coupled L2 to v0.10 because it requires a third Rules 6/7 ` +
          `branch + touches Rule 4's factor narrative. Hint: defer to v0.10 for SGD coupled L2 support, OR ` +
          `omit weight_decay for plain sgd_momentum.`,
      )
    }
    // Adam fields MUST be absent on sgd_momentum (cross-validation).
    for (const k of ["beta1", "beta2", "epsilon", "t"] as const) {
      if (oc[k] !== undefined) {
        throw new Error(
          `runGeneralStep: optimizer_config.${k} is an Adam-family field and MUST be absent when ` +
            `name === 'sgd_momentum' (got ${String(oc[k])}).`,
        )
      }
    }
    // state_before required; MomentumState shape ({buffer}) per param.
    if (input.optimizer_state_before === undefined) {
      throw new Error(
        `runGeneralStep: optimizer_state_before is required when optimizer_config.name === 'sgd_momentum' ` +
          `(got undefined). Hint: provide { buffer } per parameter id that will get an Update entry. ` +
          `At step 1 (t=1 equivalent), classical PyTorch initializes buffer_0 = 0 on the first .step() call.`,
      )
    }
    for (const pid of input.topology.parameter_order) {
      const param = input.topology.parameters.find((p) => p.id === pid)!
      const isBias = param.role === "hidden_bias" || param.role === "output_bias"
      if (isBias && input.bias_policy.mode === "constant") continue
      const st = input.optimizer_state_before[pid]
      if (st === undefined) {
        throw new Error(
          `runGeneralStep: optimizer_state_before missing entry for parameter '${pid}' ` +
            `(name === 'sgd_momentum'; MomentumState shape required).`,
        )
      }
      const stAny = st as Partial<MomentumState> & Partial<AdamState>
      if (typeof stAny.buffer !== "number" || !Number.isFinite(stAny.buffer)) {
        throw new Error(
          `runGeneralStep: optimizer_state_before['${pid}'].buffer must be a finite number (got ${String(stAny.buffer)}). ` +
            `sgd_momentum state shape is MomentumState ({buffer}); Adam-shape ({m, v}) is rejected here.`,
        )
      }
    }
    return
  }
  // -----------------------------------------------------------------------
  // adam / adamw (v0.9.1, unchanged)
  // -----------------------------------------------------------------------
  for (const k of ["beta1", "beta2", "epsilon", "t"] as const) {
    const v = oc[k]
    if (v === undefined) {
      throw new Error(
        `runGeneralStep: optimizer_config.${k} is required when name === '${oc.name}' (got undefined).`,
      )
    }
    if (!Number.isFinite(v)) {
      throw new Error(
        `runGeneralStep: optimizer_config.${k} is not finite (got ${String(v)}).`,
      )
    }
  }
  if (!(oc.beta1! > 0 && oc.beta1! < 1)) {
    throw new Error(
      `runGeneralStep: optimizer_config.beta1 must be in (0, 1) (got ${oc.beta1}).`,
    )
  }
  if (!(oc.beta2! > 0 && oc.beta2! < 1)) {
    throw new Error(
      `runGeneralStep: optimizer_config.beta2 must be in (0, 1) (got ${oc.beta2}).`,
    )
  }
  if (!(oc.epsilon! > 0)) {
    throw new Error(
      `runGeneralStep: optimizer_config.epsilon must be > 0 (got ${oc.epsilon}).`,
    )
  }
  if (!Number.isInteger(oc.t!) || oc.t! < 1) {
    throw new Error(
      `runGeneralStep: optimizer_config.t must be a positive integer (got ${oc.t}). ` +
        `Hint: Kingma & Ba 2014 Algorithm 1 indexes the timestep starting at 1; ` +
        `Rule 23 asserts t === step_index + 1 when step_index is present.`,
    )
  }
  if (oc.name === "adamw") {
    if (oc.weight_decay === undefined) {
      throw new Error(
        `runGeneralStep: optimizer_config.weight_decay is required when name === 'adamw' (got undefined). ` +
          `Hint: AdamW adds decoupled weight decay (Loshchilov & Hutter 2017 Algorithm 2 line 12) — ` +
          `applied directly to the parameter at the parameter-update step, NOT folded into the gradient ` +
          `(that would be coupled L2; explicitly contrasted with decoupled in Rule 24's AdamW branch).`,
      )
    }
    if (!Number.isFinite(oc.weight_decay) || oc.weight_decay < 0) {
      throw new Error(
        `runGeneralStep: optimizer_config.weight_decay must be a non-negative finite number (got ${oc.weight_decay}).`,
      )
    }
  }
  // state_before required + must cover every parameter that will be updated
  // (i.e., weights always; biases only when bias_policy.mode === "sgd").
  if (input.optimizer_state_before === undefined) {
    throw new Error(
      `runGeneralStep: optimizer_state_before is required when optimizer_config.name === '${oc.name}' (got undefined). ` +
        `Hint: provide { m, v } per parameter id that will get an Update entry.`,
    )
  }
  for (const pid of input.topology.parameter_order) {
    const param = input.topology.parameters.find((p) => p.id === pid)!
    const isBias = param.role === "hidden_bias" || param.role === "output_bias"
    if (isBias && input.bias_policy.mode === "constant") {
      // Constant biases skip update emission; state not needed.
      continue
    }
    const st = input.optimizer_state_before[pid]
    if (st === undefined) {
      throw new Error(
        `runGeneralStep: optimizer_state_before missing entry for parameter '${pid}'. ` +
          `Hint: every parameter that will receive an Update entry must have { m, v } in optimizer_state_before.`,
      )
    }
    const stAny = st as Partial<AdamState>
    if (typeof stAny.m !== "number" || !Number.isFinite(stAny.m)) {
      throw new Error(
        `runGeneralStep: optimizer_state_before['${pid}'].m is not finite (got ${String(stAny.m)}).`,
      )
    }
    if (typeof stAny.v !== "number" || !Number.isFinite(stAny.v) || stAny.v < 0) {
      throw new Error(
        `runGeneralStep: optimizer_state_before['${pid}'].v must be a non-negative finite number (got ${String(stAny.v)}).`,
      )
    }
  }
}

function assertSupportedPolicy(input: GeneralInput): void {
  if (
    input.topology.loss !== "half_squared_error" &&
    input.topology.loss !== "cross_entropy_softmax"
  ) {
    throw new Error(
      `runGeneralStep: topology.loss must be 'half_squared_error' or 'cross_entropy_softmax' (got '${input.topology.loss}'). ` +
        `Hint: v0.5 ships these two losses. The softmax+CE pairing invariant ` +
        `(loss='cross_entropy_softmax' iff activation_output='softmax') is ` +
        `enforced by assertTopologyValid before this check.`,
    )
  }
  if (input.bias_policy.mode !== "constant" && input.bias_policy.mode !== "sgd") {
    throw new Error(
      `runGeneralStep: bias_policy.mode must be 'constant' or 'sgd' (got '${String(input.bias_policy.mode)}'). ` +
        `Hint: 'constant' keeps biases fixed on the step (Mazur convention, all v0.1-v0.3 fixtures). ` +
        `'sgd' applies the same SGD update as weights to bias parameters (v0.4+ per_neuron path).`,
    )
  }
  if (
    input.topology.bias_sharing !== "per_layer" &&
    input.topology.bias_sharing !== "per_neuron"
  ) {
    throw new Error(
      `runGeneralStep: topology.bias_sharing must be 'per_layer' or 'per_neuron' (got '${String(input.topology.bias_sharing)}').`,
    )
  }
  // v0.4 wires bias updates only for per_neuron topologies. per_layer + sgd
  // is a combination v0.4 does NOT wire: the per_layer bias gradient would
  // be the SUM of per-unit signals, not a per-unit value, which is a
  // distinct mathematical case (the Mazur convention for per_layer is
  // "constant on this step" and we preserve that).
  if (
    input.topology.bias_sharing === "per_layer" &&
    input.bias_policy.mode === "sgd"
  ) {
    throw new Error(
      `runGeneralStep: bias_policy.mode 'sgd' is not supported with bias_sharing 'per_layer' in v0.4. ` +
        `Hint: per_layer bias updates would sum per-unit signals across the layer (a distinct case ` +
        `deferred beyond v0.4). Use bias_sharing 'per_neuron' to update biases per-unit, ` +
        `or keep bias_policy.mode 'constant' for per_layer topologies.`,
    )
  }
  if (input.trace_id !== undefined) {
    if (typeof input.trace_id !== "string" || input.trace_id.length === 0) {
      throw new Error(
        `runGeneralStep: input.trace_id must be a non-empty string when present (got ${String(input.trace_id)}).`,
      )
    }
  }
  if (input.step_index !== undefined) {
    if (!Number.isInteger(input.step_index) || input.step_index < 0) {
      throw new Error(
        `runGeneralStep: input.step_index must be a non-negative integer when present (got ${String(input.step_index)}).`,
      )
    }
  }
}

// --- Topology serialization -----------------------------------------------

function serializeTopology(t: Topology): SerializedTopology {
  return {
    layers: ["input", "hidden", "output"],
    unit_order: {
      input: [...t.unit_order.input],
      hidden: [...t.unit_order.hidden],
      output: [...t.unit_order.output],
    },
    parameter_order: [...t.parameter_order],
    parameters: t.parameters.map((p) => {
      const out: SerializedTopology["parameters"][number] = {
        id: p.id,
        role: p.role,
      }
      if (p.from_unit !== undefined) out.from_unit = p.from_unit
      if (p.to_unit !== undefined) out.to_unit = p.to_unit
      if (p.applies_to_units !== undefined)
        out.applies_to_units = [...p.applies_to_units]
      return out
    }),
    activation_hidden: t.activation_hidden,
    activation_output: t.activation_output,
    loss: t.loss,
    bias_sharing: t.bias_sharing,
    input_size: t.input_size,
    hidden_size: t.hidden_size,
    output_size: t.output_size,
  }
}

// --- The engine -----------------------------------------------------------

/**
 * Run one generalized backprop step end-to-end.
 *
 * Mirrors src/engine.ts's runMazurStep math exactly for the Mazur 2-2-2
 * topology (same left-to-right factor multiplication, same hidden-signal
 * summation order, same SGD update sign convention). For other topologies,
 * the same rules generalize: weight from_unit/to_unit iteration follows
 * unit_order.input / unit_order.hidden / unit_order.output, and the
 * parameter update phase iterates topology.parameter_order in declared
 * order.
 *
 * SGD update sign convention: `weight_after = weight_before + lr * gradient`
 * where gradient absorbs the descent-direction sign (memo §1 + engine.ts
 * gradient_convention: "descent_direction"). i.e. gradient = signal *
 * upstream, with signal = (target - out) * activation_derivative on the
 * output side; for hidden units, signal = (sum downstream contributions)
 * * activation_derivative.
 *
 * Bias behavior is policy-driven:
 *   - bias_policy.mode === "constant" (Mazur convention; all v0.1-v0.3
 *     fixtures + v0.4 per_layer fixtures): biases are unchanged on the
 *     step — `parameters_after[bias_id] === parameters_before[bias_id]`
 *     exactly, no Update entry emitted for biases.
 *   - bias_policy.mode === "sgd" (v0.4+ per_neuron path; per_layer + sgd
 *     is rejected at the boundary): per-neuron biases are updated by SGD
 *     using the unit's error signal as the single-factor gradient
 *     (∂E/∂b_u = signal_u — see the BIAS UPDATE CONVENTION block in the
 *     update loop). Each per-neuron bias produces ONE Update entry with
 *     kind: "bias", layer_edge: "bias_to_layer", optimizer.factors.length
 *     === 1.
 *
 * @param input  A GeneralInput literal. Asserted finite + topology-supported
 *               + policy-supported at the boundary.
 * @returns      A v0.2.0-schema GeneralReceipt with forward / loss /
 *               backward / per-parameter updates / parameters_after /
 *               post_update_forward / post_update_loss.
 * @throws       Error if any input scalar is non-finite, learning_rate
 *               <= 0, topology declares an unsupported variant, or a
 *               required input/target/parameter is missing.
 */
export function runGeneralStep(input: GeneralInput): GeneralReceipt {
  assertTopologyValid(input.topology)
  assertSupportedPolicy(input)
  assertFiniteGeneralInput(input)
  assertOptimizerConfig(input)

  const t = input.topology
  const lr = input.learning_rate
  const before = input.parameters_before
  // v0.9.1 — Adam family dispatch. When optimizer_config.name in {adam, adamw},
  // takes the Adam path: weight_after derives from m_hat / sqrt(v_hat) instead
  // of lr * gradient; per-update emit carries state_before / state_after;
  // top-level receipt carries optimizer_config block; schema_version is "0.5.0".
  // v0.9.2 — sgd_momentum dispatch. When optimizer_config.name === "sgd_momentum",
  // takes the classical PyTorch-style momentum path: buffer_t = mu * buffer_{t-1}
  // + gradient (Sutskever et al. 2013 / PyTorch torch.optim.SGD); update = lr *
  // buffer_t (descent direction); per-update emit carries state_before/after as
  // MomentumState ({buffer}); top-level receipt carries optimizer_config; schema_
  // version is "0.6.0". NO Nesterov (reserved v0.9.3); NO dampening (reserved
  // v0.9.3); NO SGD coupled L2 weight decay (deferred v0.10).
  // SGD path (default / explicit name === "sgd") stays byte-equal to v0.1-v0.9.0.
  const oc = input.optimizer_config
  const isAdam = oc?.name === "adam"
  const isAdamW = oc?.name === "adamw"
  const isAdamFamily = isAdam || isAdamW
  const isSgdMomentum = oc?.name === "sgd_momentum"
  const isOptimizerWithState = isAdamFamily || isSgdMomentum
  /**
   * Compute (update, weight_after, optimizer) for one parameter. Dispatches
   * on optimizer_config.name. Shared by weight-update branches and the
   * per-neuron-bias-sgd branch so all updates pick up Adam state uniformly.
   *
   * SGD path: update = lr * gradient ; weight_after = weight_before + update.
   * Adam path: m_after = beta1*m_before + (1-beta1)*g ; v_after = beta2*v_before + (1-beta2)*g²
   *   m_hat = m_after / (1 - beta1^t) ; v_hat = v_after / (1 - beta2^t)
   *   update = lr * m_hat / (sqrt(v_hat) + epsilon)  // descent direction
   *   weight_after = weight_before + update
   * AdamW path: same as Adam plus the decoupled-decay step:
   *   weight_after = (1 - lr*wd) * weight_before + update  // Loshchilov & Hutter 2017 Alg 2 line 12
   * Factors stay SGD-shape ([signal, upstream] for weights; [signal] for biases)
   * so Rule 4 (gradient == product(factors)) holds on both paths. Rule 5 is
   * gated OFF for non-SGD (update != lr*gradient on Adam). Rule 24 is the
   * Adam-specific update check.
   */
  const computeUpdateAndOptimizer = (
    pid: string,
    wBefore: number,
    gradient: number,
    factors: NamedFactor[],
  ): { update: number; wAfter: number; optimizer: Optimizer } => {
    if (!isOptimizerWithState) {
      const update = lr * gradient
      return {
        update,
        wAfter: wBefore + update,
        optimizer: {
          name: "sgd",
          learning_rate: lr,
          factors,
          product_order: "left_to_right",
        },
      }
    }
    // ---------------------------------------------------------------------
    // v0.9.2 — classical PyTorch-style SGD momentum branch.
    // Recurrence (Sutskever et al. 2013 ICML / PyTorch torch.optim.SGD):
    //   buffer_t = mu * buffer_{t-1} + gradient  (dampening hardcoded 0)
    //   update   = lr * buffer_t                 (descent direction; sign
    //                                             already in `gradient`)
    //   weight_after = weight_before + update    (no AdamW-style decoupled
    //                                             decay branch — sgd_momentum
    //                                             with weight_decay is deferred
    //                                             to v0.10; rejected at boundary)
    // Rule 21 verifies both 21a (buffer recurrence) and 21b (update formula).
    // ---------------------------------------------------------------------
    if (isSgdMomentum) {
      const cfg = oc!
      const stateBefore = input.optimizer_state_before![pid]
      if (stateBefore === undefined) {
        throw new Error(
          `runGeneralStep: optimizer_state_before missing entry for parameter '${pid}'.`,
        )
      }
      const mu = cfg.momentum!
      // MomentumState shape ({buffer}); narrow via property check.
      const stMom = stateBefore as Partial<MomentumState> & Partial<AdamState>
      const bufferBefore = stMom.buffer
      if (typeof bufferBefore !== "number") {
        throw new Error(
          `runGeneralStep: optimizer_state_before['${pid}'].buffer must be a number for sgd_momentum ` +
            `(got ${String(bufferBefore)}). Hint: sgd_momentum state is MomentumState ({buffer}), ` +
            `not AdamState ({m, v}).`,
        )
      }
      // Rule 21a: classical PyTorch-style recurrence.
      const bufferAfter = mu * bufferBefore + gradient
      // Rule 21b: classical update formula (lr OUTSIDE buffer; sign in gradient).
      const update = lr * bufferAfter
      const wAfter = wBefore + update
      return {
        update,
        wAfter,
        optimizer: {
          name: "sgd_momentum",
          learning_rate: lr,
          // Factors stay SGD-shape [signal, upstream] (or [signal] for bias).
          // Rule 4 (gradient == product(factors)) continues to hold —
          // gradient is still the descent-direction gradient at this step;
          // momentum dynamics live in buffer_before/buffer_after, NOT in
          // the factor decomposition. Keeps factor reading consistent
          // across SGD / Adam / AdamW / sgd_momentum.
          factors,
          product_order: "left_to_right",
          state_before: { buffer: bufferBefore },
          state_after: { buffer: bufferAfter },
        },
      }
    }
    // Adam / AdamW
    const cfg = oc!
    const stateBefore = input.optimizer_state_before![pid]
    if (stateBefore === undefined) {
      // Defensive: assertOptimizerConfig already checked this, but keep
      // the inline guard for non-direct callers / future bias-skip changes.
      throw new Error(
        `runGeneralStep: optimizer_state_before missing entry for parameter '${pid}'.`,
      )
    }
    const beta1 = cfg.beta1!
    const beta2 = cfg.beta2!
    const epsilon = cfg.epsilon!
    const t_step = cfg.t!
    const stAdam = stateBefore as Partial<AdamState> & Partial<MomentumState>
    if (typeof stAdam.m !== "number" || typeof stAdam.v !== "number") {
      throw new Error(
        `runGeneralStep: optimizer_state_before['${pid}'] must be AdamState ({m, v}) for ${cfg.name} ` +
          `(got ${JSON.stringify(stateBefore)}).`,
      )
    }
    const mBefore = stAdam.m
    const vBefore = stAdam.v
    // Adam moment recurrences (Kingma & Ba 2014 arXiv:1412.6980 Alg 1
    // lines 9-10). Pinned product order: (1 - beta1) * gradient is the
    // RHS factor multiplied second (left-to-right scan); engine convention.
    const mAfter = beta1 * mBefore + (1 - beta1) * gradient
    const vAfter = beta2 * vBefore + (1 - beta2) * (gradient * gradient)
    // Bias correction (Kingma & Ba 2014 Alg 1 lines 11-12). Derived;
    // never stored on the receipt (single source of truth = state_after + t).
    const mHat = mAfter / (1 - Math.pow(beta1, t_step))
    const vHat = vAfter / (1 - Math.pow(beta2, t_step))
    // Adam parameter update (Kingma & Ba 2014 Alg 1 line 13). Pinned
    // epsilon placement: OUTSIDE the sqrt (PyTorch convention) —
    // sqrt(v_hat) + epsilon, NOT sqrt(v_hat + epsilon). Bad fixture
    // adam.bad-epsilon-inside-sqrt covers the silent-porting-bug case.
    const update = (lr * mHat) / (Math.sqrt(vHat) + epsilon)
    let wAfter: number
    if (isAdamW) {
      // AdamW decoupled weight decay (Loshchilov & Hutter 2017
      // arXiv:1711.05101 Alg 2 line 12). Applied at the parameter step,
      // NOT folded into the gradient (that would be coupled L2 — a
      // famous porting bug, captured by adamw.bad-as-coupled-l2 fixture).
      const wd = cfg.weight_decay!
      wAfter = (1 - lr * wd) * wBefore + update
    } else {
      wAfter = wBefore + update
    }
    return {
      update,
      wAfter,
      optimizer: {
        name: cfg.name as "adam" | "adamw",
        learning_rate: lr,
        // Factors stay SGD-shape [signal, upstream] (or [signal] for bias).
        // Rule 4 (gradient == product(factors)) continues to hold on
        // Adam/AdamW updates. The m_hat / sqrt(v_hat) / epsilon
        // decomposition lives implicitly in Rule 24's recomputation
        // chain rather than being named in factors — keeps the factors
        // array reading consistently across SGD and Adam.
        factors,
        product_order: "left_to_right",
        state_before: { m: mBefore, v: vBefore },
        state_after: { m: mAfter, v: vAfter },
      },
    }
  }

  // --- Bias resolution helpers (per_layer vs per_neuron) -------------------
  //
  // The engine resolves a unit's hidden/output bias parameter via these two
  // helpers so the rest of the math stays oblivious to bias_sharing:
  //
  //   - per_layer:  every hidden unit shares ONE hidden_bias parameter
  //                 (returned by findHiddenBias) and every output unit
  //                 shares ONE output_bias parameter (findOutputBias).
  //                 The helper closure resolves the parameter ONCE and
  //                 returns the same parameter for every unit.
  //   - per_neuron: each unit has its OWN bias parameter. The helper
  //                 closure calls findBiasForUnit(role, unit) for each
  //                 unit. assertTopologyValid has already guaranteed
  //                 exactly one bias parameter per unit on per_neuron.
  //
  // BACKWARD-COMPATIBILITY GUARANTEE: on per_layer topologies the forward
  // pass executes the SAME findHiddenBias / findOutputBias calls in the
  // SAME order as the v0.3 code path. The byte-equal Mazur golden and
  // engine-reproduce check are preserved exactly.
  const resolveHiddenBiasParam = (() => {
    if (t.bias_sharing === "per_layer") {
      const cached = findHiddenBias(t.parameters)
      return (_unit: UnitId): typeof cached => cached
    } else {
      return (unit: UnitId) => findBiasForUnit(t.parameters, "hidden_bias", unit)
    }
  })()
  const resolveOutputBiasParam = (() => {
    if (t.bias_sharing === "per_layer") {
      const cached = findOutputBias(t.parameters)
      return (_unit: UnitId): typeof cached => cached
    } else {
      return (unit: UnitId) => findBiasForUnit(t.parameters, "output_bias", unit)
    }
  })()

  // --- Forward pass ---
  const forward: Record<string, ForwardUnit> = {}
  for (const hUnit of t.unit_order.hidden) {
    let net = 0
    for (const iUnit of t.unit_order.input) {
      const w = findWeight(t.parameters, iUnit, hUnit)
      const wVal = before[w.id]!
      const xVal = input.inputs[iUnit]!
      net = net + xVal * wVal
    }
    const biasParam = resolveHiddenBiasParam(hUnit)
    net = net + before[biasParam.id]!
    const out = activate(t.activation_hidden, net)
    forward[hUnit] = { net, out }
  }
  // --- Output forward pass ---
  //
  // For non-softmax outputs (the v0.1-v0.4 path), each output unit is computed
  // independently in unit_order order and activated per-scalar. BYTE-EQUAL
  // PRESERVATION: this loop is identical to the v0.4 code for non-softmax
  // outputs — `activate(t.activation_output, net)` is the same dispatcher.
  //
  // For softmax outputs (v0.5), each unit's net (the logit z_u) is computed
  // first (same per-unit loop as before, without activation), then
  // softmaxVector is called ONCE over the assembled logit vector. The result
  // p_u is written to forward[oUnit].out.
  //
  // Determinism contract: net is computed left-to-right in unit_order.hidden
  // for each output unit, identically for both branches. softmaxVector uses
  // the stable LSE trick (subtract max, then exp, then divide by sum) which
  // is deterministic across V8/Node 22.x runs given the determinism canary.
  if (t.activation_output === "softmax") {
    // Phase 1: compute logits z_u per output unit (left-to-right in unit_order).
    const logits: number[] = []
    for (const oUnit of t.unit_order.output) {
      let net = 0
      for (const hUnit of t.unit_order.hidden) {
        const w = findWeight(t.parameters, hUnit, oUnit)
        const wVal = before[w.id]!
        const hOut = forward[hUnit]!.out
        net = net + hOut * wVal
      }
      const biasParam = resolveOutputBiasParam(oUnit)
      net = net + before[biasParam.id]!
      logits.push(net)
      // Seed forward[oUnit] with net only — out is filled in phase 2.
      forward[oUnit] = { net, out: 0 }
    }
    // Phase 2: vectorized softmax over the logit vector.
    const probabilities = softmaxVector(logits)
    for (let i = 0; i < t.unit_order.output.length; i++) {
      const oUnit = t.unit_order.output[i]!
      forward[oUnit] = { net: logits[i]!, out: probabilities[i]! }
    }
  } else {
    // Non-softmax outputs (v0.1-v0.4 byte-equal path).
    for (const oUnit of t.unit_order.output) {
      let net = 0
      for (const hUnit of t.unit_order.hidden) {
        const w = findWeight(t.parameters, hUnit, oUnit)
        const wVal = before[w.id]!
        const hOut = forward[hUnit]!.out
        net = net + hOut * wVal
      }
      const biasParam = resolveOutputBiasParam(oUnit)
      net = net + before[biasParam.id]!
      // For non-softmax outputs, activate() dispatches per-scalar.
      const out = activate(t.activation_output as ActivationName, net)
      forward[oUnit] = { net, out }
    }
  }

  // --- Loss (polymorphic on topology.loss) ---
  //
  // half_squared_error (v0.1-v0.4 byte-equal path): per_output[u] = 0.5 * (y_u - p_u)^2
  // cross_entropy_softmax (v0.5): per_output[u] = -y_u * log(p_u); the term
  // is forced to 0 when y_u === 0 to avoid -0 * log(0) = NaN propagation
  // (the limit y*log(p) → 0 as y → 0 holds even at p = 0, so the forced 0
  // is mathematically faithful). For non-zero y_u with p_u > 0, log() is
  // well-defined; for y_u > 0 with p_u === 0 the formula yields +Infinity,
  // which is the right diagnostic surface — a NaN/Infinity per_output value
  // would surface as a Rule 12 NaN-poisoning failure downstream.
  const perOutputLoss: Record<string, number> = {}
  let totalLoss = 0
  if (t.loss === "cross_entropy_softmax") {
    for (const oUnit of t.unit_order.output) {
      const target = input.targets[oUnit]!
      const out = forward[oUnit]!.out
      const e = target === 0 ? 0 : -target * Math.log(out)
      perOutputLoss[oUnit] = e
      totalLoss = totalLoss + e
    }
  } else {
    // half_squared_error
    for (const oUnit of t.unit_order.output) {
      const target = input.targets[oUnit]!
      const out = forward[oUnit]!.out
      const diff = target - out
      const e = 0.5 * diff * diff
      perOutputLoss[oUnit] = e
      totalLoss = totalLoss + e
    }
  }

  // --- Backward: output error signals (polymorphic on loss) ---
  //
  // half_squared_error + per-scalar activation (v0.1-v0.4 byte-equal path):
  //   signal_u = (target - out) * act'(out)     [descent direction]
  //   factors = [{target_minus_output}, {activation_derivative}]
  //
  // cross_entropy_softmax + softmax activation (v0.5 collapsed path):
  //   signal_u = y_u - p_u                       [descent direction;
  //                                                negation of textbook
  //                                                dL/dz_u = p_u - y_u]
  //   factors = [{target_minus_probability}]
  //   dual_form = expanded Jacobian:
  //     sum_j y_j * (delta_ju - p_u)             where delta_ju is 1 iff j=u
  //   The collapsed signal equals the dual sum: y_u - p_u * sum_j(y_j)
  //   = y_u - p_u (when targets sum to 1). The engine emits BOTH so Rule 13
  //   can independently verify the dual decomposition matches the collapsed
  //   shape (Rule 13c) plus the per-term math (Rule 13a) and summation (Rule
  //   13b). Receipts authored outside the engine may omit dual_form; Rule 13
  //   silently skips when absent.
  const outputErrorSignals: Record<string, OutputErrorSignal> = {}
  if (t.loss === "cross_entropy_softmax") {
    // Pre-load p_u + y_u maps so each unit's dual_form can reference them.
    const probAtUnit: Record<string, number> = {}
    const targetAtUnit: Record<string, number> = {}
    for (const u of t.unit_order.output) {
      probAtUnit[u] = forward[u]!.out
      targetAtUnit[u] = input.targets[u]!
    }
    for (const oUnit of t.unit_order.output) {
      const y_u = targetAtUnit[oUnit]!
      const p_u = probAtUnit[oUnit]!
      // Collapsed descent-direction signal: signal_u = y_u - p_u.
      const collapsedSignal = y_u - p_u
      // Build dual_form Jacobian terms in unit_order.output order.
      const jacobianTerms: JacobianTerm[] = []
      let dualSum = 0
      const summationOrder: string[] = []
      let dualFirst = true
      for (const jUnit of t.unit_order.output) {
        const y_j = targetAtUnit[jUnit]!
        const delta_ju = jUnit === oUnit ? 1 : 0
        const delta_ju_minus_p_u = delta_ju - p_u
        const termValue = y_j * delta_ju_minus_p_u
        jacobianTerms.push({
          target_unit: jUnit,
          factors: [
            { name: "y_j", from: `targets.${jUnit}`, value: y_j },
            { name: "delta_ju_minus_p_u", value: delta_ju_minus_p_u },
          ],
          term_value: termValue,
        })
        if (dualFirst) {
          dualSum = termValue
          dualFirst = false
        } else {
          dualSum = dualSum + termValue
        }
        summationOrder.push(jUnit)
      }
      outputErrorSignals[oUnit] = {
        factors: [
          {
            name: "target_minus_probability",
            value: collapsedSignal,
          },
        ],
        product_order: "left_to_right",
        signal_value: collapsedSignal,
        dual_form: {
          jacobian_terms: jacobianTerms,
          product_order: "left_to_right",
          summation_order: summationOrder,
          summed_value: dualSum,
        },
      }
    }
  } else {
    // half_squared_error path (v0.1-v0.4 byte-equal).
    for (const oUnit of t.unit_order.output) {
      const target = input.targets[oUnit]!
      const out = forward[oUnit]!.out
      const tmo = target - out
      const ad = activationDerivativeFromOut(t.activation_output as ActivationName, out)
      const signal = tmo * ad
      outputErrorSignals[oUnit] = {
        factors: [
          { name: "target_minus_output", value: tmo },
          { name: "activation_derivative", value: ad },
        ],
        product_order: "left_to_right",
        signal_value: signal,
      }
    }
  }

  // --- Backward: hidden error signals (summation in unit_order.output order) ---
  const hiddenErrorSignals: Record<string, HiddenErrorSignal> = {}
  for (const hUnit of t.unit_order.hidden) {
    const contributions: DownstreamContribution[] = []
    let sum = 0
    for (const oUnit of t.unit_order.output) {
      const w = findWeight(t.parameters, hUnit, oUnit)
      const wVal = before[w.id]!
      const downstreamSignal = outputErrorSignals[oUnit]!.signal_value
      const value = downstreamSignal * wVal
      contributions.push({
        from: oUnit,
        downstream_signal: downstreamSignal,
        via_weight: w.id,
        weight_value: wVal,
        value,
      })
      sum = sum + value
    }
    const hOut = forward[hUnit]!.out
    const ad = activationDerivativeFromOut(t.activation_hidden, hOut)
    const signal = sum * ad
    hiddenErrorSignals[hUnit] = {
      downstream_contributions: contributions,
      summation_order: [...t.unit_order.output],
      backpropagated_sum: sum,
      activation_derivative: ad,
      product_order: "left_to_right",
      signal_value: signal,
    }
  }

  // --- Updates (iterate topology.parameter_order) ---
  //
  // BIAS UPDATE CONVENTION (v0.4 — per_neuron + sgd):
  //
  // For a per-neuron bias parameter `b_u` serving unit `u`, the gradient
  // of the half-squared-error loss with respect to `b_u` is exactly the
  // unit's error signal:
  //
  //     ∂E/∂b_u = signal_u                                         (i)
  //
  // because in the forward pass `net_u = (sum_v w_vu * out_v) + b_u`, so
  // `∂net_u/∂b_u = 1` and the chain rule gives `∂E/∂b_u = signal_u * 1`.
  //
  // The optimizer emits ONE factor (the error signal itself) for the bias
  // gradient — there is no upstream activation to multiply by. The schema's
  // factors.minItems was widened from 2 to 1 in v0.4 to admit this case;
  // weight updates continue to emit 2 factors (signal × upstream) as
  // before, byte-equal on per_layer topologies.
  //
  // SIGN CONVENTION: identical to weight updates and consistent with
  // metadata.gradient_convention === "descent_direction" — the gradient
  // VALUE stored in the receipt is `signal_u` (which already carries the
  // descent-direction sign because `signal_u = (target - out_u) * act'(u)`
  // on outputs and `signal_u = sum_o(signal_o * w_uo) * act'(u)` on
  // hidden units). The update is `lr * gradient` and `weight_after =
  // weight_before + update` — matches the weight branch's Rules 5/6.
  //
  // RECEIPT SHAPE: layer_edge is "bias_to_layer" (the only bias-related
  // enum value in schemas/receipt.v0.2.0.json's Update.layer_edge enum).
  // from_unit is set to the same value as to_unit (the bias is its own
  // upstream — there is no source unit). parameter_role is the role name
  // ("hidden_bias" or "output_bias") rather than a from->to string, since
  // a bias does not connect two units.
  const updates: Update[] = []
  const parametersAfter: Record<string, number> = {}
  // Pre-seed parameters_after with bias VALUES at their before-step value.
  // This is correct for bias_policy.mode === "constant" (biases stay fixed)
  // and serves as a safe default for bias_policy.mode === "sgd" (the per-
  // neuron bias branch below overwrites with the updated value).
  for (const pid of t.parameter_order) {
    parametersAfter[pid] = before[pid]!
  }
  for (const pid of t.parameter_order) {
    const param = t.parameters.find((p) => p.id === pid)!
    if (param.role === "hidden_bias" || param.role === "output_bias") {
      if (input.bias_policy.mode === "constant") {
        // Biases are constant — nothing to update; already seeded above.
        continue
      }
      // bias_policy.mode === "sgd" — per_neuron bias update.
      // assertSupportedPolicy has already rejected the per_layer + sgd
      // combination, so on this branch bias_sharing === "per_neuron" and
      // applies_to_units lists exactly one unit (validated earlier).
      const unit = param.applies_to_units![0]!
      const signal =
        param.role === "hidden_bias"
          ? hiddenErrorSignals[unit]!.signal_value
          : outputErrorSignals[unit]!.signal_value
      const signalPath =
        param.role === "hidden_bias"
          ? `backward.hidden_error_signals.${unit}.signal_value`
          : `backward.output_error_signals.${unit}.signal_value`
      const factorName =
        param.role === "hidden_bias"
          ? "hidden_error_signal"
          : "output_error_signal"
      const wBefore = before[pid]!
      // Bias gradient is the unit's error signal alone (no upstream
      // activation factor — see ∂E/∂b_u derivation above).
      const gradient = signal
      const biasFactors: NamedFactor[] = [
        { name: factorName, from: signalPath, value: signal },
      ]
      // v0.9.1 — dispatch to SGD or Adam/AdamW. For SGD this is byte-equal
      // to v0.1-v0.9.0 (no state_before/state_after emitted). For
      // Adam/AdamW, state_before is REQUIRED for biases too (when
      // bias_policy.mode === "sgd") and assertOptimizerConfig has
      // verified its presence.
      const computed = computeUpdateAndOptimizer(pid, wBefore, gradient, biasFactors)
      parametersAfter[pid] = computed.wAfter
      // PER_NEURON_BIAS_UPDATE_CAST — see TYPE NARROWNESS comment on the
      // `Update` type declaration above. At runtime the receipt bytes
      // carry kind: "bias" and layer_edge: "bias_to_layer" (both schema-
      // permitted enum values).
      const biasUpdate = {
        parameter_id: pid,
        kind: "bias" as const,
        layer_edge: "bias_to_layer" as const,
        parameter_role: param.role,
        // No source unit for a bias — set from_unit === to_unit === served
        // unit so receipt readers can find the served unit either way.
        from_unit: unit,
        to_unit: unit,
        weight_before: wBefore,
        optimizer: computed.optimizer,
        gradient,
        update: computed.update,
        weight_after: computed.wAfter,
      }
      updates.push(biasUpdate as unknown as Update)
      continue
    }
    if (param.role === "input_to_hidden_weight") {
      const fromUnit = param.from_unit!
      const toUnit = param.to_unit!
      const signal = hiddenErrorSignals[toUnit]!.signal_value
      const upstream = input.inputs[fromUnit]!
      const wBefore = before[pid]!
      const gradient = signal * upstream
      const weightFactors: NamedFactor[] = [
        {
          name: "hidden_error_signal",
          from: `backward.hidden_error_signals.${toUnit}.signal_value`,
          value: signal,
        },
        {
          name: "upstream_activation",
          from: `inputs.${fromUnit}`,
          value: upstream,
        },
      ]
      const computed = computeUpdateAndOptimizer(pid, wBefore, gradient, weightFactors)
      parametersAfter[pid] = computed.wAfter
      updates.push({
        parameter_id: pid,
        kind: "weight",
        layer_edge: "input_to_hidden",
        parameter_role: `${fromUnit}_to_${toUnit}`,
        from_unit: fromUnit,
        to_unit: toUnit,
        weight_before: wBefore,
        optimizer: computed.optimizer,
        gradient,
        update: computed.update,
        weight_after: computed.wAfter,
      })
    } else if (param.role === "hidden_to_output_weight") {
      const fromUnit = param.from_unit!
      const toUnit = param.to_unit!
      const signal = outputErrorSignals[toUnit]!.signal_value
      const upstream = forward[fromUnit]!.out
      const wBefore = before[pid]!
      const gradient = signal * upstream
      const weightFactors: NamedFactor[] = [
        {
          name: "output_error_signal",
          from: `backward.output_error_signals.${toUnit}.signal_value`,
          value: signal,
        },
        {
          name: "upstream_activation",
          from: `forward.${fromUnit}.out`,
          value: upstream,
        },
      ]
      const computed = computeUpdateAndOptimizer(pid, wBefore, gradient, weightFactors)
      parametersAfter[pid] = computed.wAfter
      updates.push({
        parameter_id: pid,
        kind: "weight",
        layer_edge: "hidden_to_output",
        parameter_role: `${fromUnit}_to_${toUnit}`,
        from_unit: fromUnit,
        to_unit: toUnit,
        weight_before: wBefore,
        optimizer: computed.optimizer,
        gradient,
        update: computed.update,
        weight_after: computed.wAfter,
      })
    }
  }

  // --- Post-update forward pass ---
  // Mirrors the pre-update forward pass: hidden layer per-scalar; output
  // layer branches on activation_output. Byte-equal for non-softmax outputs
  // (v0.1-v0.4 fixtures preserved); softmax outputs use softmaxVector once
  // over the logit vector.
  const postUpdateForward: Record<string, ForwardUnit> = {}
  for (const hUnit of t.unit_order.hidden) {
    let net = 0
    for (const iUnit of t.unit_order.input) {
      const w = findWeight(t.parameters, iUnit, hUnit)
      const wVal = parametersAfter[w.id]!
      const xVal = input.inputs[iUnit]!
      net = net + xVal * wVal
    }
    const biasParam = resolveHiddenBiasParam(hUnit)
    net = net + parametersAfter[biasParam.id]!
    const out = activate(t.activation_hidden, net)
    postUpdateForward[hUnit] = { net, out }
  }
  if (t.activation_output === "softmax") {
    const logits: number[] = []
    for (const oUnit of t.unit_order.output) {
      let net = 0
      for (const hUnit of t.unit_order.hidden) {
        const w = findWeight(t.parameters, hUnit, oUnit)
        const wVal = parametersAfter[w.id]!
        const hOut = postUpdateForward[hUnit]!.out
        net = net + hOut * wVal
      }
      const biasParam = resolveOutputBiasParam(oUnit)
      net = net + parametersAfter[biasParam.id]!
      logits.push(net)
      postUpdateForward[oUnit] = { net, out: 0 }
    }
    const probabilities = softmaxVector(logits)
    for (let i = 0; i < t.unit_order.output.length; i++) {
      const oUnit = t.unit_order.output[i]!
      postUpdateForward[oUnit] = { net: logits[i]!, out: probabilities[i]! }
    }
  } else {
    for (const oUnit of t.unit_order.output) {
      let net = 0
      for (const hUnit of t.unit_order.hidden) {
        const w = findWeight(t.parameters, hUnit, oUnit)
        const wVal = parametersAfter[w.id]!
        const hOut = postUpdateForward[hUnit]!.out
        net = net + hOut * wVal
      }
      const biasParam = resolveOutputBiasParam(oUnit)
      net = net + parametersAfter[biasParam.id]!
      const out = activate(t.activation_output as ActivationName, net)
      postUpdateForward[oUnit] = { net, out }
    }
  }

  // --- Post-update loss (polymorphic on loss) ---
  const postUpdatePerOutput: Record<string, number> = {}
  let postUpdateTotal = 0
  if (t.loss === "cross_entropy_softmax") {
    for (const oUnit of t.unit_order.output) {
      const target = input.targets[oUnit]!
      const out = postUpdateForward[oUnit]!.out
      const e = target === 0 ? 0 : -target * Math.log(out)
      postUpdatePerOutput[oUnit] = e
      postUpdateTotal = postUpdateTotal + e
    }
  } else {
    for (const oUnit of t.unit_order.output) {
      const target = input.targets[oUnit]!
      const out = postUpdateForward[oUnit]!.out
      const diff = target - out
      const e = 0.5 * diff * diff
      postUpdatePerOutput[oUnit] = e
      postUpdateTotal = postUpdateTotal + e
    }
  }

  // --- Build inputs / targets / parameters_before records (plain copies) ---
  const inputsOut: Record<string, number> = {}
  for (const uid of t.unit_order.input) inputsOut[uid] = input.inputs[uid]!
  const targetsOut: Record<string, number> = {}
  for (const uid of t.unit_order.output) targetsOut[uid] = input.targets[uid]!
  const parametersBeforeOut: Record<string, number> = {}
  for (const pid of t.parameter_order)
    parametersBeforeOut[pid] = input.parameters_before[pid]!

  // --- Observability hook (mirrors src/engine.ts BPT_DEBUG behavior) ---
  if (process.env["BPT_DEBUG"] === "1") {
    process.stderr.write(
      `[bpt:general-engine] step=1 post_update_loss.total=${postUpdateTotal}\n`,
    )
  }

  // v0.5: schema_version is "0.3.0" for softmax+CE receipts (the additive-
  // schema path with dual_form, softmax activation_output, cross_entropy_softmax
  // loss). All other receipts (Mazur, XOR, iris, per-neuron-bias, and any
  // future half_squared_error receipts) continue to emit "0.2.0" so the
  // shipped fixtures stay byte-identical.
  // v0.9.1: "0.5.0" for Adam/AdamW receipts (FORCED bump — see receipt.v0.5.0
  // docstring). v0.9.2: "0.6.0" for sgd_momentum receipts (FORCED bump — see
  // receipt.v0.6.0 docstring). Adam/AdamW + softmax+CE + sgd_momentum all
  // compose additively at the schema layer; the version reflects the
  // optimizer-with-state shape that's present on the receipt, with v0.6.0
  // > v0.5.0 > v0.3.0 > v0.2.0 in fields-carried order.
  const schemaVersionForReceipt: "0.2.0" | "0.3.0" | "0.5.0" | "0.6.0" = isSgdMomentum
    ? "0.6.0"
    : isAdamFamily
      ? "0.5.0"
      : t.loss === "cross_entropy_softmax" || t.activation_output === "softmax"
        ? "0.3.0"
        : "0.2.0"
  const receipt: GeneralReceipt = {
    schema_version: schemaVersionForReceipt,
    fixture: input.fixture ?? "general-engine-first-run",
    step: 1,
    fixture_status: {
      authoring_state: "engine_generated",
      verification_state: "engine_reproduced_byte_equal",
      canonical: true,
    },
    metadata: input.metadata ?? {
      source: "src/general-engine.ts (generalized backprop engine first-run)",
      gradient_convention: "descent_direction",
    },
    numeric_policy: input.numeric_policy,
    bias_policy: input.bias_policy,
    topology: serializeTopology(t),
    learning_rate: lr,
    inputs: inputsOut,
    targets: targetsOut,
    parameters_before: parametersBeforeOut,
    forward,
    loss: { per_output: perOutputLoss, total: totalLoss },
    backward: {
      output_error_signals: outputErrorSignals,
      hidden_error_signals: hiddenErrorSignals,
    },
    updates,
    parameters_after: parametersAfter,
    post_update_forward: { status: "filled", units: postUpdateForward },
    post_update_loss: {
      status: "filled",
      per_output: postUpdatePerOutput,
      total: postUpdateTotal,
    },
  }
  // v0.9.1 — emit top-level optimizer_config ONLY for Adam/AdamW (preserves
  // SGD byte-equality with v0.1-v0.9.0; engine SGD receipts continue to omit
  // this block even when an explicit optimizer_config.name === "sgd" was
  // passed in via the input).
  // v0.9.2 — same emission for sgd_momentum (momentum hyperparameter; no
  // nesterov/dampening/weight_decay in v0.9.2 — reserved fields not emitted).
  if (isAdamFamily) {
    const cfg = oc!
    const ocOut: OptimizerConfig = {
      name: cfg.name,
      learning_rate: cfg.learning_rate,
      beta1: cfg.beta1,
      beta2: cfg.beta2,
      epsilon: cfg.epsilon,
      t: cfg.t,
    }
    if (cfg.name === "adamw") ocOut.weight_decay = cfg.weight_decay
    receipt.optimizer_config = ocOut
  } else if (isSgdMomentum) {
    const cfg = oc!
    const ocOut: OptimizerConfig = {
      name: "sgd_momentum",
      learning_rate: cfg.learning_rate,
      momentum: cfg.momentum,
    }
    // v0.9.2 — reserved fields (nesterov, dampening) are NOT emitted to keep
    // receipt bytes minimal and forward-compatible with v0.9.3 (when the
    // const-false / const-0 restrictions widen, the emitter can opt into
    // these fields without changing existing v0.9.2 receipts).
    receipt.optimizer_config = ocOut
  }
  if (input.trace_id !== undefined) receipt.trace_id = input.trace_id
  if (input.step_index !== undefined) receipt.step_index = input.step_index
  return receipt
}

// =============================================================================
// v0.9 — Batched general-engine entry point
// =============================================================================

/**
 * v0.9 — Input shape for runBatchedGeneralStep.
 *
 * Omits top-level `inputs` + `targets` (which are per-sample for batched
 * training) and replaces with `batch` + `per_sample`. Everything else
 * (topology, learning_rate, parameters_before, numeric_policy, bias_policy)
 * is shared across all samples in the batch.
 *
 * v0.9.0 ships SGD only — `Update.optimizer.name` stays at `"sgd"`. Adam /
 * AdamW / momentum are deferred to v0.9.1+.
 */
export type BatchedGeneralInput = Omit<GeneralInput, "inputs" | "targets"> & {
  batch: {
    size: number
    sample_order: string[]
    reduction: "mean" | "sum" | "none"
  }
  per_sample: Record<
    string,
    { inputs: Record<string, number>; targets: Record<string, number> }
  >
}

/**
 * v0.9 — Batched general-engine entry point.
 *
 * Orchestrates N runs of runGeneralStep (one per sample in batch.sample_order)
 * against shared parameters_before, then reduces per-sample losses and
 * gradients per batch.reduction and produces a single batched receipt with
 * canonical observer-mode + per-sample structure.
 *
 * Receipt shape:
 *   - top-level `inputs` / `targets` / `forward` / `backward` = FIRST sample's
 *     state (canonical convention; load-bearing for v0.1-v0.8 byte-equal
 *     backward compat — top-level fields stay populated)
 *   - top-level `loss.per_output` / `loss.total` = REDUCED (per batch.reduction)
 *   - top-level `loss.per_sample` = sample-keyed map of per-sample total loss
 *     (used by Rule 18)
 *   - top-level `loss.reduction` = echo of batch.reduction
 *   - top-level `updates[].gradient` = REDUCED gradient per parameter
 *   - top-level `updates[].optimizer.factors` = [{batch_reduced_gradient, value}]
 *     (single-factor decomposition; per-sample gradient breakdown deferred to v0.9.x)
 *   - top-level `parameters_after` = parameters_before + (-lr * reduced_gradient) per param
 *   - top-level `per_sample` block = per-sample inputs/targets/forward/loss
 *
 * Rule 18 verifies loss.total == reduction(loss.per_sample.values()).
 * Rule 19 verifies sample-set coherence.
 * Rule 14 (engine recompute) verifies per-sample forward + per-sample loss +
 * reduced gradient + parameters_after via this same function.
 *
 * v0.9.0 explicitly does NOT include per-sample gradients (per_sample[s] has
 * inputs/targets/forward/loss only — no per-sample backward, no per-sample
 * updates). Reduced gradients only.
 */
export function runBatchedGeneralStep(input: BatchedGeneralInput): GeneralReceipt {
  // v0.9.1 — batched Adam/AdamW NOT supported in v0.9.1. The per-sample-runs-
  // then-reduce pattern works for SGD (reduced gradient → single-step SGD
  // update) but Adam needs a SINGLE optimizer step against the reduced
  // gradient with state evolution; the per-sample subreceipts that
  // runBatchedGeneralStep currently produces don't have that information.
  // Deferred to v0.9.x / v0.10. The schema CAN express batched + Adam
  // (batch + optimizer_config blocks coexist on receipt.v0.5.0); the
  // engine just doesn't implement it yet — fail loudly so callers know.
  if (
    input.optimizer_config !== undefined &&
    input.optimizer_config.name !== "sgd"
  ) {
    throw new Error(
      `runBatchedGeneralStep: batched Adam/AdamW/sgd_momentum is NOT supported in v0.9.2 ` +
        `(got optimizer_config.name='${input.optimizer_config.name}'). ` +
        `Hint: v0.9.2 supports single-step + multi-step Adam/AdamW/sgd_momentum only. ` +
        `Batched non-SGD is deferred (needs reduced-gradient → single-optimizer-step ` +
        `dispatch, distinct from runBatchedGeneralStep's per-sample subreceipt ` +
        `pattern). Use a batch size of 1 + Adam/momentum, or use plain SGD for batched runs.`,
    )
  }
  // 1. Validate batch invariants (will be re-checked by Rule 19 at reconcile time,
  //    but fail early at the engine boundary for clear diagnostics).
  if (input.batch.size !== input.batch.sample_order.length) {
    throw new Error(
      `runBatchedGeneralStep: batch.size (${input.batch.size}) != ` +
        `batch.sample_order.length (${input.batch.sample_order.length})`,
    )
  }
  const seenIds = new Set<string>()
  for (const sid of input.batch.sample_order) {
    if (seenIds.has(sid)) {
      throw new Error(
        `runBatchedGeneralStep: duplicate sample_id ${JSON.stringify(sid)} in batch.sample_order`,
      )
    }
    seenIds.add(sid)
  }
  for (const sid of input.batch.sample_order) {
    if (!(sid in input.per_sample)) {
      throw new Error(
        `runBatchedGeneralStep: per_sample missing entry for sample_id ${JSON.stringify(sid)} ` +
          `declared in batch.sample_order`,
      )
    }
  }
  for (const sid of Object.keys(input.per_sample)) {
    if (!input.batch.sample_order.includes(sid)) {
      throw new Error(
        `runBatchedGeneralStep: per_sample has extra entry ${JSON.stringify(sid)} ` +
          `not declared in batch.sample_order`,
      )
    }
  }

  // 2. Run engine per sample with shared parameters_before.
  const perSampleReceipts = input.batch.sample_order.map((sid) => {
    const sample = input.per_sample[sid]!
    const sampleInput: GeneralInput = {
      topology: input.topology,
      learning_rate: input.learning_rate,
      inputs: sample.inputs,
      targets: sample.targets,
      parameters_before: input.parameters_before,
      numeric_policy: input.numeric_policy,
      bias_policy: input.bias_policy,
      ...(input.fixture !== undefined ? { fixture: input.fixture } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    }
    return runGeneralStep(sampleInput)
  })

  // 3. Reduction helper.
  const reduce = (vals: number[]): number => {
    if (input.batch.reduction === "mean") {
      return vals.reduce((a, b) => a + b, 0) / vals.length
    }
    if (input.batch.reduction === "sum") {
      return vals.reduce((a, b) => a + b, 0)
    }
    // "none" — degenerate; return first sample's value (not used in v0.9.0
    // workflows but kept for schema completeness).
    return vals[0]!
  }

  const firstReceipt = perSampleReceipts[0]!
  const firstSampleId = input.batch.sample_order[0]!
  const firstSample = input.per_sample[firstSampleId]!

  // 4. Reduce per-parameter gradients (mean/sum across samples).
  const reducedGradients: Record<string, number> = {}
  for (const upd of firstReceipt.updates) {
    const perSampleGrads = perSampleReceipts.map((r) => {
      const sampleUpd = r.updates.find((u) => u.parameter_id === upd.parameter_id)
      if (!sampleUpd) {
        throw new Error(
          `runBatchedGeneralStep: parameter_id ${JSON.stringify(upd.parameter_id)} missing in per-sample updates`,
        )
      }
      return sampleUpd.gradient
    })
    reducedGradients[upd.parameter_id] = reduce(perSampleGrads)
  }

  // 5. Build reduced updates (single-factor decomposition).
  const lr = input.learning_rate
  const reducedUpdates: Update[] = firstReceipt.updates.map((upd) => {
    const reducedGrad = reducedGradients[upd.parameter_id]!
    // Sign convention: gradient is already in descent_direction (per
    // GeneralReceipt metadata.gradient_convention = "descent_direction"),
    // so update = lr * gradient (positive); weight_after = weight_before
    // + update moves in descent direction. Matches runGeneralStep
    // (lines ~1039, ~1078). Rule 5 checks update == lr * gradient.
    const reducedUpdateValue = lr * reducedGrad
    const reducedWeightAfter = upd.weight_before + reducedUpdateValue
    return {
      ...upd,
      optimizer: {
        ...upd.optimizer,
        // v0.9.0 single-factor decomposition for batched receipts. Per-sample
        // gradient breakdown is deferred to v0.9.x; for now the reduced gradient
        // IS the named factor. Rule 4 checks product([reduced_gradient]) ==
        // update.gradient, which passes trivially. Rule 14 (engine recompute)
        // is the load-bearing math check for batched receipts.
        factors: [
          { name: "batch_reduced_gradient", value: reducedGrad },
        ],
      },
      gradient: reducedGrad,
      update: reducedUpdateValue,
      weight_after: reducedWeightAfter,
    }
  })

  // 6. parameters_after from reduced updates.
  const reducedParametersAfter: Record<string, number> = { ...input.parameters_before }
  for (const upd of reducedUpdates) {
    reducedParametersAfter[upd.parameter_id] = upd.weight_after
  }
  // For per_neuron bias policy etc, parameters_before fields not in updates stay constant.

  // 7. Reduce loss (per_output + total + per_sample map).
  const perSampleLossTotal: Record<string, number> = {}
  for (let i = 0; i < input.batch.sample_order.length; i++) {
    perSampleLossTotal[input.batch.sample_order[i]!] = perSampleReceipts[i]!.loss.total
  }
  const reducedLossPerOutput: Record<string, number> = {}
  for (const u of input.topology.unit_order.output) {
    reducedLossPerOutput[u] = reduce(
      perSampleReceipts.map((r) => r.loss.per_output[u]!),
    )
  }
  const reducedLossTotal = reduce(perSampleReceipts.map((r) => r.loss.total))

  // 8. Recompute post-update forward + loss using reduced parameters_after on
  // the first sample (canonical convention; matches the top-level forward
  // representing the first sample).
  const postUpdateInput: GeneralInput = {
    topology: input.topology,
    learning_rate: input.learning_rate,
    inputs: firstSample.inputs,
    targets: firstSample.targets,
    parameters_before: reducedParametersAfter,
    numeric_policy: input.numeric_policy,
    bias_policy: input.bias_policy,
  }
  const postUpdateReceipt = runGeneralStep(postUpdateInput)

  // 9. Build batched receipt.
  const receipt: GeneralReceipt = {
    schema_version: firstReceipt.schema_version,
    fixture: input.fixture ?? `batched-${input.batch.size}-sample-step`,
    step: 1,
    fixture_status: firstReceipt.fixture_status,
    metadata: firstReceipt.metadata,
    numeric_policy: firstReceipt.numeric_policy,
    bias_policy: firstReceipt.bias_policy,
    topology: firstReceipt.topology,
    learning_rate: lr,
    batch: input.batch,
    inputs: firstSample.inputs,
    targets: firstSample.targets,
    parameters_before: input.parameters_before,
    per_sample: Object.fromEntries(
      input.batch.sample_order.map((sid, i) => [
        sid,
        {
          inputs: input.per_sample[sid]!.inputs,
          targets: input.per_sample[sid]!.targets,
          forward: perSampleReceipts[i]!.forward,
          loss: perSampleReceipts[i]!.loss,
        },
      ]),
    ),
    forward: firstReceipt.forward,
    loss: {
      per_output: reducedLossPerOutput,
      per_sample: perSampleLossTotal,
      reduction: input.batch.reduction,
      total: reducedLossTotal,
    },
    backward: firstReceipt.backward,
    updates: reducedUpdates,
    parameters_after: reducedParametersAfter,
    post_update_forward: {
      status: "filled",
      units: postUpdateReceipt.forward,
    },
    post_update_loss: {
      status: "filled",
      per_output: postUpdateReceipt.loss.per_output,
      total: postUpdateReceipt.loss.total,
    },
  }
  if (input.trace_id !== undefined) receipt.trace_id = input.trace_id
  if (input.step_index !== undefined) receipt.step_index = input.step_index
  return receipt
}
