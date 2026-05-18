/**
 * v0.9.2 — Generate canonical PyTorch classical SGD momentum fixture pairs:
 *
 *   - fixtures/external/pytorch.sgd-momentum.{sidecar,golden}.jsonl
 *       (single-step classical PyTorch-style SGD momentum;
 *        framework-trace.v0.5.0 sidecar + observer-mode receipt.v0.6.0)
 *   - fixtures/external/pytorch.sgd-momentum.multi-step.{sidecar,golden}.jsonl
 *       (3-step momentum JSONL stream exercising Rules 25 buffer chain + 26
 *        config constancy)
 *
 * Topology: same Mazur 2-2-2 used by the v0.9.1 Adam fixtures. Bias policy:
 * constant (momentum updates apply to weights only; per-neuron biases under
 * momentum is a small follow-on but adds noise here).
 *
 * Recurrence (classical PyTorch-style, Sutskever et al. 2013 ICML):
 *   buffer_t = mu * buffer_{t-1} + gradient
 *   update   = lr * buffer_t                 (descent direction; sign in gradient)
 *   weight_after = weight_before + update
 *
 * v0.9.2 ships classical PyTorch-style ONLY — Nesterov + dampening
 * RESERVED for v0.9.3; SGD coupled L2 weight decay deferred to v0.10.
 *
 * Reproducibility: reads no files. Re-runs produce byte-identical output
 * provided runGeneralStep + emitGeneralReceipt are unchanged.
 */

import { writeFileSync } from "node:fs"
import { runGeneralStep } from "../src/general-engine.js"
import { importPytorchSidecar, importPytorchSidecarStream } from "../src/import-pytorch.js"
import type {
  GeneralInput,
  GeneralReceipt,
  OptimizerConfig,
  MomentumState,
} from "../src/general-engine.js"
import type { Topology } from "../src/topology.js"

const PINNED_TIMESTAMP = "2026-05-19T01:00:00Z"
const PINNED_PYTORCH_VERSION = "2.4.0"
const PINNED_TRACE_ID = "c1d2e3f405061728394a5b6c7d8e9f01"

const MOMENTUM_TOPOLOGY: Topology = {
  layers: ["input", "hidden", "output"],
  unit_order: {
    input: ["x1", "x2"],
    hidden: ["h1", "h2"],
    output: ["o1", "o2"],
  },
  parameter_order: [
    "w_x1_h1", "w_x2_h1", "w_x1_h2", "w_x2_h2",
    "w_h1_o1", "w_h2_o1", "w_h1_o2", "w_h2_o2",
    "b_hidden", "b_output",
  ],
  parameters: [
    { id: "w_x1_h1", role: "input_to_hidden_weight", from_unit: "x1", to_unit: "h1" },
    { id: "w_x2_h1", role: "input_to_hidden_weight", from_unit: "x2", to_unit: "h1" },
    { id: "w_x1_h2", role: "input_to_hidden_weight", from_unit: "x1", to_unit: "h2" },
    { id: "w_x2_h2", role: "input_to_hidden_weight", from_unit: "x2", to_unit: "h2" },
    { id: "w_h1_o1", role: "hidden_to_output_weight", from_unit: "h1", to_unit: "o1" },
    { id: "w_h2_o1", role: "hidden_to_output_weight", from_unit: "h2", to_unit: "o1" },
    { id: "w_h1_o2", role: "hidden_to_output_weight", from_unit: "h1", to_unit: "o2" },
    { id: "w_h2_o2", role: "hidden_to_output_weight", from_unit: "h2", to_unit: "o2" },
    { id: "b_hidden", role: "hidden_bias", applies_to_units: ["h1", "h2"] },
    { id: "b_output", role: "output_bias", applies_to_units: ["o1", "o2"] },
  ],
  activation_hidden: "sigmoid",
  activation_output: "sigmoid",
  loss: "half_squared_error",
  bias_sharing: "per_layer",
  input_size: 2,
  hidden_size: 2,
  output_size: 2,
}

const INITIAL_PARAMETERS = {
  w_x1_h1: 0.15, w_x2_h1: 0.20, w_x1_h2: 0.25, w_x2_h2: 0.30,
  w_h1_o1: 0.40, w_h2_o1: 0.45, w_h1_o2: 0.50, w_h2_o2: 0.55,
  b_hidden: 0.35, b_output: 0.60,
}

const LEARNING_RATE = 0.01
const MOMENTUM = 0.9 // Sutskever 2013 / PyTorch default for production momentum SGD
const INPUTS = { x1: 0.05, x2: 0.10 }
const TARGETS = { o1: 0.01, o2: 0.99 }

const NUMERIC_POLICY: NonNullable<GeneralInput["numeric_policy"]> = {
  number_encoding: "decimal",
  precision_significant_digits: 9,
  rounding: "round_half_to_even",
  tolerance: { atol: 1e-11, rtol: 1e-7 },
  computation_order: "schema_defined",
  byte_output: {
    format: "jsonl",
    json_key_order: "schema_defined",
    trailing_zero_policy: "pad_to_significant_digits",
    indent: "none",
  },
}

const BIAS_POLICY: NonNullable<GeneralInput["bias_policy"]> = {
  mode: "constant",
  reason:
    "v0.9.2 momentum fixture pins biases as constant — momentum updates apply to " +
    "weights only in this canonical fixture; per-neuron biases under momentum are a " +
    "small follow-on slice.",
  updated_in_step: false,
  reconciliation:
    "parameters_after[bias_id] === parameters_before[bias_id] for every bias parameter",
}

// Zero-init MomentumState for every WEIGHT parameter (biases are constant —
// no optimizer state). PyTorch torch.optim.SGD lazy-initializes
// momentum_buffer = 0 on the first .step() call; we explicitly populate
// buffer_0 = 0 at t=1 (Rule 20 cross-checks the shape).
function zeroMomentumState(params: Record<string, number>): Record<string, MomentumState> {
  const state: Record<string, MomentumState> = {}
  for (const pid of Object.keys(params)) {
    if (pid.startsWith("b_")) continue // skip constant biases
    state[pid] = { buffer: 0 }
  }
  return state
}

// ===========================================================================
// Single-step classical PyTorch-style SGD momentum
// ===========================================================================
{
  const optimizer_config: OptimizerConfig = {
    name: "sgd_momentum",
    learning_rate: LEARNING_RATE,
    momentum: MOMENTUM,
  }
  const engineInput: GeneralInput = {
    topology: MOMENTUM_TOPOLOGY,
    learning_rate: LEARNING_RATE,
    inputs: INPUTS,
    targets: TARGETS,
    parameters_before: INITIAL_PARAMETERS,
    numeric_policy: NUMERIC_POLICY,
    bias_policy: BIAS_POLICY,
    optimizer_config,
    optimizer_state_before: zeroMomentumState(INITIAL_PARAMETERS),
    fixture: "pytorch-sgd-momentum-engine-step",
    metadata: {
      source:
        "src/import-pytorch.ts (PyTorch classical SGD momentum single-step observer-mode; " +
        "Sutskever et al. 2013 ICML 'On the importance of initialization and momentum in deep learning')",
      gradient_convention: "descent_direction",
    },
  }
  const er = runGeneralStep(engineInput)

  // Build framework-trace.v0.5.0 sidecar mirroring the engine output.
  const sidecar = {
    format: "framework-trace.v0.5.0",
    source_framework: {
      name: "pytorch",
      version: PINNED_PYTORCH_VERSION,
      information_uri: "https://pytorch.org/docs/stable/generated/torch.optim.SGD.html",
      extractor: {
        name: "bp-import-pytorch-sgd-momentum-helper",
        version: "0.9.2",
      },
    },
    topology: MOMENTUM_TOPOLOGY,
    learning_rate: LEARNING_RATE,
    optimizer: {
      name: "sgd_momentum" as const,
      learning_rate: LEARNING_RATE,
      momentum: MOMENTUM,
    },
    numeric_policy: NUMERIC_POLICY,
    bias_policy: BIAS_POLICY,
    inputs: INPUTS,
    targets: TARGETS,
    parameters_before: er.parameters_before,
    forward: er.forward,
    loss: er.loss,
    backward: er.backward,
    updates: er.updates,
    parameters_after: er.parameters_after,
    post_update_forward: {
      status: er.post_update_forward.status,
      ...er.post_update_forward.units,
    },
    post_update_loss: er.post_update_loss,
  }
  const sidecarBytes = JSON.stringify(sidecar) + "\n"
  writeFileSync("fixtures/external/pytorch.sgd-momentum.sidecar.jsonl", sidecarBytes)
  console.log(`wrote fixtures/external/pytorch.sgd-momentum.sidecar.jsonl`)

  const imported = importPytorchSidecar(sidecarBytes, {
    importTimestamp: PINNED_TIMESTAMP,
    fixtureLabel: "pytorch-sgd-momentum-imported",
  })
  writeFileSync("fixtures/external/pytorch.sgd-momentum.golden.jsonl", imported.emittedBytes)
  console.log(`wrote fixtures/external/pytorch.sgd-momentum.golden.jsonl`)
  console.log(`  differentialPassed: ${imported.differentialPassed}`)
}

// ===========================================================================
// Multi-step classical PyTorch-style SGD momentum (3 steps)
//   exercises Rules 25 (buffer chain) + 26 (config constancy)
// ===========================================================================
{
  const STEP_COUNT = 3
  const engineReceipts: GeneralReceipt[] = []
  let parameters_before: Record<string, number> = { ...INITIAL_PARAMETERS }
  let state_before: Record<string, MomentumState> = zeroMomentumState(INITIAL_PARAMETERS)
  for (let i = 0; i < STEP_COUNT; i += 1) {
    const optimizer_config: OptimizerConfig = {
      name: "sgd_momentum",
      learning_rate: LEARNING_RATE,
      momentum: MOMENTUM,
    }
    const input: GeneralInput = {
      topology: MOMENTUM_TOPOLOGY,
      learning_rate: LEARNING_RATE,
      inputs: INPUTS,
      targets: TARGETS,
      parameters_before,
      numeric_policy: NUMERIC_POLICY,
      bias_policy: BIAS_POLICY,
      optimizer_config,
      optimizer_state_before: state_before,
      trace_id: PINNED_TRACE_ID,
      step_index: i,
      fixture: `pytorch-sgd-momentum-multi-step-engine-step-${i}`,
      metadata: {
        source:
          "src/import-pytorch.ts (PyTorch classical SGD momentum multi-step observer-mode)",
        gradient_convention: "descent_direction",
      },
    }
    const r = runGeneralStep(input)
    engineReceipts.push(r)
    parameters_before = { ...r.parameters_after }
    // Build state_before for next step from state_after of current step
    const nextState: Record<string, MomentumState> = {}
    for (const u of r.updates) {
      const sa = u.optimizer.state_after
      if (sa && typeof (sa as MomentumState).buffer === "number") {
        nextState[u.parameter_id] = { buffer: (sa as MomentumState).buffer }
      }
    }
    state_before = nextState
  }

  // Build framework-trace.v0.5.0 sidecars (3 records).
  const sidecarRecords = engineReceipts.map((er, i) => ({
    format: "framework-trace.v0.5.0",
    source_framework: {
      name: "pytorch",
      version: PINNED_PYTORCH_VERSION,
      information_uri: "https://pytorch.org/",
      extractor: {
        name: "bp-import-pytorch-sgd-momentum-multi-step-helper",
        version: "0.9.2",
      },
    },
    trace_id: PINNED_TRACE_ID,
    step_index: i,
    topology: MOMENTUM_TOPOLOGY,
    learning_rate: LEARNING_RATE,
    optimizer: {
      name: "sgd_momentum" as const,
      learning_rate: LEARNING_RATE,
      momentum: MOMENTUM,
    },
    numeric_policy: NUMERIC_POLICY,
    bias_policy: BIAS_POLICY,
    inputs: INPUTS,
    targets: TARGETS,
    parameters_before: er.parameters_before,
    forward: er.forward,
    loss: er.loss,
    backward: er.backward,
    updates: er.updates,
    parameters_after: er.parameters_after,
    post_update_forward: {
      status: er.post_update_forward.status,
      ...er.post_update_forward.units,
    },
    post_update_loss: er.post_update_loss,
  }))

  const sidecarBytes = sidecarRecords.map((r) => JSON.stringify(r)).join("\n") + "\n"
  writeFileSync(
    "fixtures/external/pytorch.sgd-momentum.multi-step.sidecar.jsonl",
    sidecarBytes,
  )
  console.log(
    `wrote fixtures/external/pytorch.sgd-momentum.multi-step.sidecar.jsonl (${STEP_COUNT} steps, trace_id=${PINNED_TRACE_ID})`,
  )

  const result = importPytorchSidecarStream(sidecarBytes, {
    importTimestamp: PINNED_TIMESTAMP,
    fixtureLabel: "pytorch-sgd-momentum-multi-step-imported",
  })
  writeFileSync(
    "fixtures/external/pytorch.sgd-momentum.multi-step.golden.jsonl",
    result.emittedBytes,
  )
  console.log(
    `wrote fixtures/external/pytorch.sgd-momentum.multi-step.golden.jsonl (${result.steps.length} receipts)`,
  )
  console.log(`  allDifferentialsPassed: ${result.allDifferentialsPassed}`)
  console.log(`  bundleRootDigest: ${result.bundleRootDigest}`)
}

// ===========================================================================
// v0.9.3 — single-step Nesterov sgd_momentum
// ===========================================================================
{
  const optimizer_config: OptimizerConfig = {
    name: "sgd_momentum",
    learning_rate: LEARNING_RATE,
    momentum: MOMENTUM,
    nesterov: true,
  }
  const engineInput: GeneralInput = {
    topology: MOMENTUM_TOPOLOGY,
    learning_rate: LEARNING_RATE,
    inputs: INPUTS,
    targets: TARGETS,
    parameters_before: INITIAL_PARAMETERS,
    numeric_policy: NUMERIC_POLICY,
    bias_policy: BIAS_POLICY,
    optimizer_config,
    optimizer_state_before: zeroMomentumState(INITIAL_PARAMETERS),
    fixture: "pytorch-sgd-momentum-nesterov-engine-step",
    metadata: {
      source:
        "src/import-pytorch.ts (PyTorch Nesterov SGD momentum single-step observer-mode; " +
        "Sutskever et al. 2013 ICML §2 lookahead form; PyTorch torch.optim.SGD nesterov=True default for vision/timm)",
      gradient_convention: "descent_direction",
    },
  }
  const er = runGeneralStep(engineInput)

  const sidecar = {
    format: "framework-trace.v0.6.0",
    source_framework: {
      name: "pytorch",
      version: PINNED_PYTORCH_VERSION,
      information_uri: "https://pytorch.org/docs/stable/generated/torch.optim.SGD.html",
      extractor: {
        name: "bp-import-pytorch-sgd-momentum-nesterov-helper",
        version: "0.9.3",
      },
    },
    topology: MOMENTUM_TOPOLOGY,
    learning_rate: LEARNING_RATE,
    optimizer: {
      name: "sgd_momentum" as const,
      learning_rate: LEARNING_RATE,
      momentum: MOMENTUM,
      nesterov: true,
    },
    numeric_policy: NUMERIC_POLICY,
    bias_policy: BIAS_POLICY,
    inputs: INPUTS,
    targets: TARGETS,
    parameters_before: er.parameters_before,
    forward: er.forward,
    loss: er.loss,
    backward: er.backward,
    updates: er.updates,
    parameters_after: er.parameters_after,
    post_update_forward: {
      status: er.post_update_forward.status,
      ...er.post_update_forward.units,
    },
    post_update_loss: er.post_update_loss,
  }
  const sidecarBytes = JSON.stringify(sidecar) + "\n"
  writeFileSync("fixtures/external/pytorch.sgd-momentum.nesterov.sidecar.jsonl", sidecarBytes)
  console.log(`wrote fixtures/external/pytorch.sgd-momentum.nesterov.sidecar.jsonl`)

  const imported = importPytorchSidecar(sidecarBytes, {
    importTimestamp: PINNED_TIMESTAMP,
    fixtureLabel: "pytorch-sgd-momentum-nesterov-imported",
  })
  writeFileSync("fixtures/external/pytorch.sgd-momentum.nesterov.golden.jsonl", imported.emittedBytes)
  console.log(`wrote fixtures/external/pytorch.sgd-momentum.nesterov.golden.jsonl`)
  console.log(`  differentialPassed: ${imported.differentialPassed}`)
  console.log(`  schema_version: ${imported.receipt.schema_version} (expected 0.7.0)`)
}

// ===========================================================================
// v0.9.3 — single-step sgd_momentum with dampening
// ===========================================================================
{
  const DAMPENING = 0.1
  const optimizer_config: OptimizerConfig = {
    name: "sgd_momentum",
    learning_rate: LEARNING_RATE,
    momentum: MOMENTUM,
    dampening: DAMPENING,
  }
  const engineInput: GeneralInput = {
    topology: MOMENTUM_TOPOLOGY,
    learning_rate: LEARNING_RATE,
    inputs: INPUTS,
    targets: TARGETS,
    parameters_before: INITIAL_PARAMETERS,
    numeric_policy: NUMERIC_POLICY,
    bias_policy: BIAS_POLICY,
    optimizer_config,
    optimizer_state_before: zeroMomentumState(INITIAL_PARAMETERS),
    fixture: "pytorch-sgd-momentum-dampening-engine-step",
    metadata: {
      source:
        "src/import-pytorch.ts (PyTorch SGD momentum with dampening single-step observer-mode; " +
        "recurrence buffer_t = mu * buffer_{t-1} + (1 - tau) * gradient; PyTorch torch.optim.SGD dampening parameter)",
      gradient_convention: "descent_direction",
    },
  }
  const er = runGeneralStep(engineInput)

  const sidecar = {
    format: "framework-trace.v0.6.0",
    source_framework: {
      name: "pytorch",
      version: PINNED_PYTORCH_VERSION,
      information_uri: "https://pytorch.org/docs/stable/generated/torch.optim.SGD.html",
      extractor: {
        name: "bp-import-pytorch-sgd-momentum-dampening-helper",
        version: "0.9.3",
      },
    },
    topology: MOMENTUM_TOPOLOGY,
    learning_rate: LEARNING_RATE,
    optimizer: {
      name: "sgd_momentum" as const,
      learning_rate: LEARNING_RATE,
      momentum: MOMENTUM,
      dampening: DAMPENING,
    },
    numeric_policy: NUMERIC_POLICY,
    bias_policy: BIAS_POLICY,
    inputs: INPUTS,
    targets: TARGETS,
    parameters_before: er.parameters_before,
    forward: er.forward,
    loss: er.loss,
    backward: er.backward,
    updates: er.updates,
    parameters_after: er.parameters_after,
    post_update_forward: {
      status: er.post_update_forward.status,
      ...er.post_update_forward.units,
    },
    post_update_loss: er.post_update_loss,
  }
  const sidecarBytes = JSON.stringify(sidecar) + "\n"
  writeFileSync("fixtures/external/pytorch.sgd-momentum.dampening.sidecar.jsonl", sidecarBytes)
  console.log(`wrote fixtures/external/pytorch.sgd-momentum.dampening.sidecar.jsonl`)

  const imported = importPytorchSidecar(sidecarBytes, {
    importTimestamp: PINNED_TIMESTAMP,
    fixtureLabel: "pytorch-sgd-momentum-dampening-imported",
  })
  writeFileSync("fixtures/external/pytorch.sgd-momentum.dampening.golden.jsonl", imported.emittedBytes)
  console.log(`wrote fixtures/external/pytorch.sgd-momentum.dampening.golden.jsonl`)
  console.log(`  differentialPassed: ${imported.differentialPassed}`)
  console.log(`  schema_version: ${imported.receipt.schema_version} (expected 0.7.0)`)
}

// ===========================================================================
// v0.9.3 — multi-step Nesterov sgd_momentum (3 steps)
//   exercises Rule 25 buffer chain + Rule 26 constancy (nesterov flag stays true across steps)
// ===========================================================================
{
  const STEP_COUNT = 3
  const PINNED_TRACE_ID_NEST = "d1e2f30405061728394a5b6c7d8e9f02"
  const engineReceipts: GeneralReceipt[] = []
  let parameters_before: Record<string, number> = { ...INITIAL_PARAMETERS }
  let state_before: Record<string, MomentumState> = zeroMomentumState(INITIAL_PARAMETERS)
  for (let i = 0; i < STEP_COUNT; i += 1) {
    const optimizer_config: OptimizerConfig = {
      name: "sgd_momentum",
      learning_rate: LEARNING_RATE,
      momentum: MOMENTUM,
      nesterov: true,
    }
    const input: GeneralInput = {
      topology: MOMENTUM_TOPOLOGY,
      learning_rate: LEARNING_RATE,
      inputs: INPUTS,
      targets: TARGETS,
      parameters_before,
      numeric_policy: NUMERIC_POLICY,
      bias_policy: BIAS_POLICY,
      optimizer_config,
      optimizer_state_before: state_before,
      trace_id: PINNED_TRACE_ID_NEST,
      step_index: i,
      fixture: `pytorch-sgd-momentum-nesterov-multi-step-engine-step-${i}`,
      metadata: {
        source:
          "src/import-pytorch.ts (PyTorch Nesterov SGD momentum multi-step observer-mode; " +
          "Sutskever et al. 2013 ICML §2 lookahead form)",
        gradient_convention: "descent_direction",
      },
    }
    const r = runGeneralStep(input)
    engineReceipts.push(r)
    parameters_before = { ...r.parameters_after }
    const nextState: Record<string, MomentumState> = {}
    for (const u of r.updates) {
      const sa = u.optimizer.state_after
      if (sa && typeof (sa as MomentumState).buffer === "number") {
        nextState[u.parameter_id] = { buffer: (sa as MomentumState).buffer }
      }
    }
    state_before = nextState
  }

  const sidecarRecords = engineReceipts.map((er, i) => ({
    format: "framework-trace.v0.6.0",
    source_framework: {
      name: "pytorch",
      version: PINNED_PYTORCH_VERSION,
      information_uri: "https://pytorch.org/",
      extractor: {
        name: "bp-import-pytorch-sgd-momentum-nesterov-multi-step-helper",
        version: "0.9.3",
      },
    },
    trace_id: PINNED_TRACE_ID_NEST,
    step_index: i,
    topology: MOMENTUM_TOPOLOGY,
    learning_rate: LEARNING_RATE,
    optimizer: {
      name: "sgd_momentum" as const,
      learning_rate: LEARNING_RATE,
      momentum: MOMENTUM,
      nesterov: true,
    },
    numeric_policy: NUMERIC_POLICY,
    bias_policy: BIAS_POLICY,
    inputs: INPUTS,
    targets: TARGETS,
    parameters_before: er.parameters_before,
    forward: er.forward,
    loss: er.loss,
    backward: er.backward,
    updates: er.updates,
    parameters_after: er.parameters_after,
    post_update_forward: {
      status: er.post_update_forward.status,
      ...er.post_update_forward.units,
    },
    post_update_loss: er.post_update_loss,
  }))

  const sidecarBytes = sidecarRecords.map((r) => JSON.stringify(r)).join("\n") + "\n"
  writeFileSync(
    "fixtures/external/pytorch.sgd-momentum.nesterov.multi-step.sidecar.jsonl",
    sidecarBytes,
  )
  console.log(
    `wrote fixtures/external/pytorch.sgd-momentum.nesterov.multi-step.sidecar.jsonl (${STEP_COUNT} steps, trace_id=${PINNED_TRACE_ID_NEST})`,
  )

  const result = importPytorchSidecarStream(sidecarBytes, {
    importTimestamp: PINNED_TIMESTAMP,
    fixtureLabel: "pytorch-sgd-momentum-nesterov-multi-step-imported",
  })
  writeFileSync(
    "fixtures/external/pytorch.sgd-momentum.nesterov.multi-step.golden.jsonl",
    result.emittedBytes,
  )
  console.log(
    `wrote fixtures/external/pytorch.sgd-momentum.nesterov.multi-step.golden.jsonl (${result.steps.length} receipts)`,
  )
  console.log(`  allDifferentialsPassed: ${result.allDifferentialsPassed}`)
  console.log(`  bundleRootDigest: ${result.bundleRootDigest}`)
}
