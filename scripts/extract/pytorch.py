"""
backprop-trace PyTorch live helper
==================================
(version tracked by the HELPER_VERSION constant below, in lockstep with the
@mcptoolshop/backprop-trace package version — not hardcoded in this docstring.)

MIT License — Copyright (c) 2026 mcp-tool-shop. See LICENSE in the
@mcptoolshop/backprop-trace package.

Single-file observer that extracts a `framework-trace.v0.7.0` sidecar
from a real PyTorch training step. Emits JSONL to stdout (default) or
to `--out <file>`. Pipe into `bp import pytorch -` and then
`bp verify multi -` to verify the receipt.

USAGE
-----
1. Copy this file into your training repo:

       bp examples pytorch --print > pytorch_trace_helper.py

   (Or `bp examples pytorch` to print the absolute path of the
   bundled file, then copy by hand.)

2. Wrap your training loop:

       from pytorch_trace_helper import TraceDumper

       dumper = TraceDumper(model, optimizer, loss_fn, out="trace.jsonl")
       for batch_idx, (x, y) in enumerate(loader):
           with dumper.step(trace_id="run-001"):
               optimizer.zero_grad()
               loss = loss_fn(model(x), y)
               loss.backward()
               optimizer.step()

3. Verify:

       bp import pytorch trace.jsonl | bp verify multi -

TRUST BOUNDARY (LOAD-BEARING)
-----------------------------
This helper is an OBSERVER. It is NEVER a verifier. It emits the
`framework-trace.v0.7.0` sidecar with extracted numerics and a
FORENSIC `helper` block (helper name, version, source_hash, framework
version, python version, extraction timestamp). The `source_hash`
is computed by this file ON ITSELF — that is acceptable because the
hash is FORENSIC, not a credential. Rule 14 (engine-recompute
differential) in `bp import pytorch` is the authority on every
helper-emitted sidecar regardless of what this block claims. A
spoofed / wrong / missing `source_hash` does NOT bypass Rule 14;
Rule 14 fires unconditionally on every receipt with
`authoring_state === "external_imported"`.

This helper:
- DOES NOT verify anything.
- DOES NOT claim Rule 14 will pass.
- DOES NOT sign anything.
- DOES NOT recompute the engine.
- DOES NOT emit receipts (only sidecars).
- DOES NOT touch fixture_status / authoring_state / verification_state.

Csmith/CompCert lineage: the oracle must not consult the artifact it
judges. Fang et al. 2023 PoL spoofing class: producer with byte-control
defeats structural-only checks; defense is independent recomputation.
backprop-trace's Rule 14 IS that independent recomputation.

SCOPE
-----
SUPPORTED:
- PyTorch SGD (vanilla, no momentum).
- PyTorch SGD with momentum (`torch.optim.SGD(momentum=...)`), classical
  + Nesterov (dampening=0) — momentum_buffer sign-flipped at extraction
  boundary (see MOMENTUM_BUFFER SIGN FLIP below).
- PyTorch Adam.
- PyTorch AdamW (decoupled weight decay).
- nn.Linear(..., bias=True): PER-NEURON biases (one bias parameter per
  output neuron, b_h<k>/b_o<k>), updated every step like any real model.
  bias=False is also supported (synthetic constant 0 biases).
- Single-step and multi-step (call `with dumper.step():` per training step).
- CPU device.
- 2-2-2 / 2-2-3 / 2-3-2 topologies (Mazur-shaped feed-forward nets).
- half_squared_error loss; cross_entropy_softmax loss.

SUPPORTED (v0.13):
- SGD with weight_decay > 0 (COUPLED L2 — the documented Rule 7 third
  branch). The decay folds into the gradient before the buffer/update:
  d_p = grad + weight_decay*param. The helper derives the BASE loss
  gradient analytically; the reconciler recovers the coupled-L2 term
  (Rule 5 / Rule 21) from update = wa - wb + optimizer_config.weight_decay.
  Emits a `framework-trace.v0.8.0` sidecar. DISTINCT from AdamW's DECOUPLED
  weight decay (which was always supported on v0.7.0 / earlier).

NOT SUPPORTED (REJECTED at the extraction boundary — HelperUnsupportedError):
- SGD dampening != 0 — PyTorch SKIPS dampening on the first (buffer-init)
  step (buf = grad, no (1 - dampening) factor) while the engine's Rule 21a
  applies it uniformly; the first-step buffer diverges, so a valid step
  would be rejected. Classical momentum + Nesterov (dampening=0) are fine.
- amsgrad=True (Adam/AdamW) — the engine models plain Adam, not the
  AMSGrad max-of-v_hat track.
- maximize=True (any) — ascent step; the engine is descent-only.
- fused / capturable / differentiable = True — alternate kernels / graph
  modes that can reorder FP ops and diverge from the engine recompute.
- Multiple param_groups — the sidecar reads only param_groups[0]; per-
  parameter / per-layer groups are deferred.
- NAdam / RAdam / Lion / LBFGS / closure-style optimizers.
- Batched live extraction — the batched sidecar path exists for
  hand-authored sidecars, but the helper extracts SINGLE samples one at a
  time.
- AMP / GradScaler — PyTorch issue #75224 fp16/fp32 master-confusion.
- CUDA / MPS / XLA devices — CPU-first; device-tolerance is future work.

NOTE: the hand-authored sidecar path (bp import pytorch on a manually
written framework-trace sidecar) continues to support many of these — only
the LIVE HELPER refuses them.

MOMENTUM_BUFFER SIGN FLIP (LOAD-BEARING)
-----------------------------------------
PyTorch's `optimizer.state[p]["momentum_buffer"]` accumulates the
*unsigned* gradient (ascent direction) because PyTorch applies the
parameter update as `param.add_(d_p, alpha=-lr)` — the descent sign
lives in the update step, not in the buffer.

backprop-trace's `MomentumState.buffer` lives in DESCENT space — the
schema's Rule 21a is `buffer_after = mu * buffer_before + (1 - dampening) * gradient`
where `gradient` is already signed for descent.

This helper sign-flips at the extraction boundary:

    snap_buffer = (-state["momentum_buffer"]).detach().clone().cpu()

The flip happens once, in `_snapshot_per_parameter_state` under the
sgd_momentum branch. Documented in schemas/framework-trace.v0.7.0.json
MomentumState docstring + docs/schema.md. Confirmed against PyTorch
source (`torch/optim/sgd.py:445-461`) and PyTorch issue #1099.

The sign flip is INVERTIBLE — `bp import pytorch` will reject a
sgd_momentum sidecar whose buffer is NOT flipped via Rule 21a (the
recurrence will predict the wrong sign of `buffer_after`). The
adversarial fixture `fixtures/bad/pytorch-helper.bad-momentum-buffer-
not-sign-flipped.jsonl` exercises this rejection.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import sys
import time
import platform
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional, TextIO, Union

# Defer import so this file is import-checkable without torch installed
# (e.g. for `bp examples pytorch --print` on a Node-only CI machine).
try:
    import torch  # type: ignore
    import torch.nn as nn  # type: ignore

    _TORCH_AVAILABLE = True
except ImportError:  # pragma: no cover
    _TORCH_AVAILABLE = False
    torch = None  # type: ignore
    nn = None  # type: ignore


HELPER_VERSION = "1.0.0"
HELPER_NAME = "backprop-trace-pytorch-helper"
SCHEMA_FORMAT = "framework-trace.v0.7.0"
# v0.13 — SGD coupled L2 (the documented Rule 7 third branch) FORCES a schema
# bump: the v0.7.0 sidecar schema rejects weight_decay for the SGD family. A
# sidecar carrying coupled-L2 weight_decay on sgd / sgd_momentum declares this
# format instead. (Adam/AdamW weight_decay is DECOUPLED and stays on v0.7.0.)
SCHEMA_FORMAT_COUPLED_L2 = "framework-trace.v0.8.0"
DEFAULT_TOLERANCE_ATOL = 1e-6
DEFAULT_TOLERANCE_RTOL = 1e-4
DEFAULT_PRECISION = 17


# ---------------------------------------------------------------------------
# Helper trust-boundary errors
# ---------------------------------------------------------------------------


class HelperError(Exception):
    """Base for helper-detected extraction errors. Raised before sidecar
    emission so a partial / wrong sidecar never reaches Rule 14."""


class HelperUnsupportedError(HelperError):
    """User asked for a feature outside the current helper
    scope (AMSGrad / NAdam / RAdam / Lion / LBFGS / SGD-coupled-L2-
    weight-decay / AMP / GPU / multi-hidden-layer topologies). The
    hand-authored sidecar path remains available for many of these;
    only the LIVE HELPER refuses them."""


# ---------------------------------------------------------------------------
# Source-hash (forensic only — documented as not-a-credential in the docstring)
# ---------------------------------------------------------------------------


def _compute_self_source_hash() -> str:
    """Hash this file's bytes. FORENSIC, not a credential. Rule 14 in the
    verifier is the authority regardless of what this returns."""
    try:
        own_path = Path(__file__).resolve()
        return "sha256:" + hashlib.sha256(own_path.read_bytes()).hexdigest()
    except (OSError, NameError):  # pragma: no cover - fallback for exec()-loaded
        return "sha256:" + ("0" * 64)


# ---------------------------------------------------------------------------
# Topology inference from a torch.nn module
# ---------------------------------------------------------------------------


def _infer_topology(model: "nn.Module", *, loss: str) -> dict[str, Any]:
    """Infer a backprop-trace topology from a torch.nn.Module.

    The helper supports the same single-hidden-layer feed-forward shape the
    engine's general-engine.ts handles: Linear(input → hidden) →
    activation → Linear(hidden → output) → output_activation. Topology
    keys are pinned to the Mazur canonical form (i1/i2, h1/h2, o1/o2).
    """
    linears = [m for m in model.modules() if isinstance(m, nn.Linear)]
    if len(linears) != 2:
        raise HelperUnsupportedError(
            f"helper: expected exactly 2 nn.Linear layers (input→hidden, hidden→output); "
            f"got {len(linears)}. The helper supports single-hidden-layer feed-forward nets only. "
            f"CNN / transformer / multi-hidden-layer topologies are not supported."
        )
    input_size = linears[0].in_features
    hidden_size = linears[0].out_features
    output_size = linears[1].out_features
    if linears[1].in_features != hidden_size:
        raise HelperUnsupportedError(
            f"helper: hidden→output linear's in_features ({linears[1].in_features}) "
            f"!= input→hidden's out_features ({hidden_size}). Topology mismatch."
        )

    def _act_kind(model: "nn.Module", after_linear: "nn.Linear") -> str:
        # Walk modules to find what immediately follows the given Linear.
        modules = list(model.modules())
        try:
            idx = modules.index(after_linear)
        except ValueError:  # pragma: no cover
            return "identity"
        for m in modules[idx + 1 :]:
            if isinstance(m, nn.Sigmoid):
                return "sigmoid"
            if isinstance(m, nn.ReLU):
                return "relu"
            if isinstance(m, nn.Softmax):
                return "softmax"
            if isinstance(m, nn.Linear):
                return "identity"
        return "identity"

    activation_hidden = _act_kind(model, linears[0])
    activation_output = _act_kind(model, linears[1])

    # Cross-check loss vs output activation
    if loss == "cross_entropy_softmax" and activation_output != "softmax":
        raise HelperUnsupportedError(
            f"helper: loss='cross_entropy_softmax' requires output activation "
            f"to be Softmax; observed '{activation_output}'."
        )
    if loss == "half_squared_error" and activation_output not in ("sigmoid", "identity", "relu"):
        raise HelperUnsupportedError(
            f"helper: loss='half_squared_error' requires output activation "
            f"in (sigmoid, identity, relu); observed '{activation_output}'."
        )

    # Build unit_order with canonical i*/h*/o* naming
    input_units = [f"i{i + 1}" for i in range(input_size)]
    hidden_units = [f"h{i + 1}" for i in range(hidden_size)]
    output_units = [f"o{i + 1}" for i in range(output_size)]

    # Parameter manifest
    parameters: list[dict[str, Any]] = []
    parameter_order: list[str] = []
    # input→hidden weights: w_<i_in>_<h_out>
    for i_in in range(input_size):
        for h_out in range(hidden_size):
            pid = f"w_i{i_in + 1}_h{h_out + 1}"
            parameters.append(
                {
                    "id": pid,
                    "role": "input_to_hidden_weight",
                    "from_unit": input_units[i_in],
                    "to_unit": hidden_units[h_out],
                }
            )
            parameter_order.append(pid)
    # hidden biases (PER-NEURON convention; bias_sharing="per_neuron").
    #
    # A real nn.Linear(in, hidden, bias=True) has ONE bias scalar per OUTPUT
    # neuron (Linear.bias is a 1-D tensor of length out_features), and any
    # optimizer updates each of those scalars independently. There is no
    # "shared layer bias" in PyTorch. Emitting a single per_layer b_h was
    # structurally wrong (G-015): after one real SGD/Adam step the two hidden
    # biases diverge, so a per_layer sidecar either crashed at extraction (the
    # "all equal" guard) or — worse — was silently treated as constant by the
    # importer and rejected by Rule 14. We emit one bias parameter per hidden
    # unit (b_h1, b_h2, …) so the engine's per_neuron + sgd path updates them.
    for h_out in range(hidden_size):
        bid = f"b_h{h_out + 1}"
        parameters.append(
            {
                "id": bid,
                "role": "hidden_bias",
                "applies_to_units": [hidden_units[h_out]],
            }
        )
        parameter_order.append(bid)
    # hidden→output weights: w_<h_in>_<o_out>
    for h_in in range(hidden_size):
        for o_out in range(output_size):
            pid = f"w_h{h_in + 1}_o{o_out + 1}"
            parameters.append(
                {
                    "id": pid,
                    "role": "hidden_to_output_weight",
                    "from_unit": hidden_units[h_in],
                    "to_unit": output_units[o_out],
                }
            )
            parameter_order.append(pid)
    # output biases (PER-NEURON — one per output unit: b_o1, b_o2, …).
    for o_out in range(output_size):
        bid = f"b_o{o_out + 1}"
        parameters.append(
            {
                "id": bid,
                "role": "output_bias",
                "applies_to_units": [output_units[o_out]],
            }
        )
        parameter_order.append(bid)

    return {
        "layers": ["input", "hidden", "output"],
        "input_size": input_size,
        "hidden_size": hidden_size,
        "output_size": output_size,
        "unit_order": {
            "input": input_units,
            "hidden": hidden_units,
            "output": output_units,
        },
        "parameter_order": parameter_order,
        "parameters": parameters,
        "activation_hidden": activation_hidden,
        "activation_output": activation_output,
        "loss": loss,
        "bias_sharing": "per_neuron",
    }


# ---------------------------------------------------------------------------
# Tensor snapshot helpers
# ---------------------------------------------------------------------------


def _snap_tensor(t: "torch.Tensor") -> list[float]:
    """Detach + clone + cpu + float64-coerce + tolist. The detach().clone()
    discipline is load-bearing (per PyTorch forum / Elana Simon 2025):
    .detach() alone returns a storage-sharing view; subsequent
    optimizer.step() mutates the snapshot in place. .detach().clone()
    severs both autograd and storage."""
    if not torch.is_tensor(t):  # pragma: no cover
        return [float(t)]
    return t.detach().clone().to(dtype=torch.float64, device="cpu").flatten().tolist()


def _scalar(t: "torch.Tensor") -> float:
    """Detach + clone + float64-coerce a 0-dim tensor to a Python float."""
    if not torch.is_tensor(t):
        return float(t)
    return float(t.detach().clone().to(dtype=torch.float64, device="cpu").item())


def _snapshot_parameters(model: "nn.Module", topology: dict[str, Any]) -> dict[str, float]:
    """Walk named_parameters in canonical parameter_order. Maps PyTorch's
    (Linear.weight, Linear.bias) flat tensors to backprop-trace's
    per-edge / per-bias scalars by the topology's parameter manifest.

    Linear.weight shape is (out_features, in_features) — out is the
    leading axis. For input→hidden:
        weight[h_out_idx, i_in_idx] = w_i<in+1>_h<out+1>
    For hidden→output:
        weight[o_out_idx, h_in_idx] = w_h<in+1>_o<out+1>
    Bias is a 1-D tensor of length out_features; under the PER-NEURON
    convention (G-015) each bias scalar maps to its own parameter:
        bias[h_out_idx] = b_h<out+1>
        bias[o_out_idx] = b_o<out+1>
    PyTorch has no shared per-layer bias, so there is no all-equal guard.
    A bias-less Linear (bias=False) is reported as 0.0 per neuron — the
    importer keeps these constant (bias_policy stays 'constant' when no
    bias parameter changes across the step; see import-observer.ts).
    """
    linears = [m for m in model.modules() if isinstance(m, nn.Linear)]
    L_in_h = linears[0]
    L_h_o = linears[1]
    hidden_size = topology["hidden_size"]
    input_size = topology["input_size"]
    output_size = topology["output_size"]
    snap: dict[str, float] = {}
    W_ih = _snap_tensor(L_in_h.weight)  # length hidden_size * input_size
    for h_out in range(hidden_size):
        for i_in in range(input_size):
            snap[f"w_i{i_in + 1}_h{h_out + 1}"] = W_ih[h_out * input_size + i_in]
    if L_in_h.bias is not None:
        b_h = _snap_tensor(L_in_h.bias)  # length hidden_size, per-neuron
        for h_out in range(hidden_size):
            snap[f"b_h{h_out + 1}"] = b_h[h_out]
    else:
        for h_out in range(hidden_size):
            snap[f"b_h{h_out + 1}"] = 0.0
    W_ho = _snap_tensor(L_h_o.weight)  # length output_size * hidden_size
    for o_out in range(output_size):
        for h_in in range(hidden_size):
            snap[f"w_h{h_in + 1}_o{o_out + 1}"] = W_ho[o_out * hidden_size + h_in]
    if L_h_o.bias is not None:
        b_o = _snap_tensor(L_h_o.bias)  # length output_size, per-neuron
        for o_out in range(output_size):
            snap[f"b_o{o_out + 1}"] = b_o[o_out]
    else:
        for o_out in range(output_size):
            snap[f"b_o{o_out + 1}"] = 0.0
    return snap


def _snapshot_per_parameter_state(
    model: "nn.Module",
    optimizer: "torch.optim.Optimizer",
    topology: dict[str, Any],
    family: str,
    step_index: int,
) -> dict[str, dict[str, Any]]:
    """Snapshot per-backprop-trace-parameter optimizer state.

    Returns dict[parameter_id, state-dict] where state-dict shape is:
      - {m, v, step} for adam / adamw
      - {buffer}     for sgd_momentum (SIGN-FLIPPED to descent direction)
      - {} for vanilla SGD (no state)

    Walks `topology.parameter_order` (the canonical backprop-trace
    order) and for each parameter_id finds the corresponding scalar
    in PyTorch's per-layer state tensor by element index. This mirrors
    `_snapshot_parameters` — both extract scalar-per-parameter values
    from PyTorch's flat per-layer tensors.

    PyTorch state lookup discipline (per PyTorch issue #1489):
      - Walk model's Linear layers in module-registration order
      - For each Linear, look up state via `optimizer.state.get(L.weight)`
        and `optimizer.state.get(L.bias)` directly — NEVER iterate
        `optimizer.state` (id()-keyed; iteration order is non-stable).
      - Pre-first-step states are EMPTY (PyTorch lazy-init); we emit
        zero-init scalars matching the receipt schema's required shape.
    """
    if family == "sgd":
        return {}

    linears = [m for m in model.modules() if isinstance(m, nn.Linear)]
    L_in_h, L_h_o = linears[0], linears[1]
    hidden_size = topology["hidden_size"]
    input_size = topology["input_size"]
    output_size = topology["output_size"]

    s_w_ih = optimizer.state.get(L_in_h.weight, {}) or {}
    s_b_h = optimizer.state.get(L_in_h.bias, {}) if L_in_h.bias is not None else {}
    s_w_ho = optimizer.state.get(L_h_o.weight, {}) or {}
    s_b_o = optimizer.state.get(L_h_o.bias, {}) if L_h_o.bias is not None else {}

    snap: dict[str, dict[str, Any]] = {}

    if family in ("adam", "adamw"):
        def _adam_element(state: dict[str, Any], *idx: int) -> dict[str, Any]:
            # Pre-first-step zero-init (Adam lazy-init). The schema's AdamState
            # is EXACTLY {m, v} (additionalProperties:false) — emitting a `step`
            # field fails schema validation (a latent bug torch end-to-end
            # exposed; the fixtures derive from hand-authored {m,v}-only
            # sidecars). The Adam timestep `t` lives on the top-level optimizer
            # block (step_index + 1, Rule 23), NOT in per-parameter state, so
            # `step` is not needed here.
            if not state or "exp_avg" not in state:
                return {"m": 0.0, "v": 0.0}
            m_t = state["exp_avg"]
            v_t = state["exp_avg_sq"]
            # === ADAM m SIGN FLIP (LOAD-BEARING) ===
            # PyTorch's exp_avg accumulates the ASCENT gradient:
            #   exp_avg = beta1 * exp_avg + (1 - beta1) * grad_ascent.
            # backprop-trace's AdamState.m lives in DESCENT space, consistent
            # with the descent-signed `gradient` the receipt carries (Rule 22a:
            # m_after = beta1*m_before + (1-beta1)*gradient_descent). Since m is
            # LINEAR in the gradient, m_descent = -m_ascent — flip once here.
            # exp_avg_sq (v) is QUADRATIC in the gradient (grad^2), so it is
            # sign-invariant and is NOT flipped (Rule 22b uses gradient^2).
            # Same doctrine as the momentum_buffer sign flip above; the
            # hand-authored Adam fixtures were already descent-signed, so this
            # live-extraction flip was untested until torch end-to-end.
            m_val = -float(m_t[idx].detach().to(torch.float64).item())
            v_val = float(v_t[idx].detach().to(torch.float64).item())
            return {"m": m_val, "v": v_val}

        # input→hidden weights (Linear.weight shape: [hidden_size, input_size])
        for h_out in range(hidden_size):
            for i_in in range(input_size):
                snap[f"w_i{i_in + 1}_h{h_out + 1}"] = _adam_element(s_w_ih, h_out, i_in)
        # hidden biases (PER-NEURON: bias state element h_out → b_h<h_out+1>)
        for h_out in range(hidden_size):
            snap[f"b_h{h_out + 1}"] = _adam_element(s_b_h, h_out)
        # hidden→output weights (Linear.weight shape: [output_size, hidden_size])
        for o_out in range(output_size):
            for h_in in range(hidden_size):
                snap[f"w_h{h_in + 1}_o{o_out + 1}"] = _adam_element(s_w_ho, o_out, h_in)
        # output biases (PER-NEURON: bias state element o_out → b_o<o_out+1>)
        for o_out in range(output_size):
            snap[f"b_o{o_out + 1}"] = _adam_element(s_b_o, o_out)
        return snap

    if family == "sgd_momentum":
        def _momentum_element(state: dict[str, Any], *idx: int) -> dict[str, Any]:
            # Pre-first-step zero-init (PyTorch issue #99079: momentum_buffer
            # is literally None on step 0; backprop-trace MomentumState
            # requires `buffer: number`, so we emit zero — descent and ascent
            # are equal at zero so no sign flip needed for the zero case).
            if not state or "momentum_buffer" not in state or state["momentum_buffer"] is None:
                return {"buffer": 0.0}
            buf = state["momentum_buffer"]
            # === THE SIGN FLIP (LOAD-BEARING) ===
            # PyTorch buf accumulates +grad (ascent direction) because
            # `param.add_(d_p, alpha=-lr)` puts the descent sign at the
            # parameter update, NOT in the buffer.
            # backprop-trace MomentumState.buffer is DESCENT direction —
            # Rule 21a: buffer_after = mu * buffer_before + (1-dampening)*gradient
            # where `gradient` is already signed for descent.
            # Per docs/schema.md (v0.9.3 MomentumState section) +
            # docs/live-helpers.md (sign-flip pin) + PyTorch issue #1099.
            # Flip ONCE at extraction; do NOT flip gradient.
            buf_descent = -buf
            return {"buffer": float(buf_descent[idx].detach().to(torch.float64).item())}

        for h_out in range(hidden_size):
            for i_in in range(input_size):
                snap[f"w_i{i_in + 1}_h{h_out + 1}"] = _momentum_element(s_w_ih, h_out, i_in)
        # hidden biases (PER-NEURON: momentum buffer element h_out → b_h<h_out+1>)
        for h_out in range(hidden_size):
            snap[f"b_h{h_out + 1}"] = _momentum_element(s_b_h, h_out)
        for o_out in range(output_size):
            for h_in in range(hidden_size):
                snap[f"w_h{h_in + 1}_o{o_out + 1}"] = _momentum_element(s_w_ho, o_out, h_in)
        # output biases (PER-NEURON: momentum buffer element o_out → b_o<o_out+1>)
        for o_out in range(output_size):
            snap[f"b_o{o_out + 1}"] = _momentum_element(s_b_o, o_out)
        return snap

    raise HelperUnsupportedError(  # pragma: no cover
        f"helper: unknown optimizer family {family!r} in _snapshot_per_parameter_state"
    )


# ---------------------------------------------------------------------------
# Optimizer family detection + config emission
# ---------------------------------------------------------------------------


def _flag_is_set(optimizer: "torch.optim.Optimizer", group: dict[str, Any], key: str) -> bool:
    """Read a boolean optimizer flag, checking the param_group first then the
    optimizer.defaults. Some flags (e.g. fused, capturable) live in defaults
    but not always in every param_group dict; checking both is robust."""
    if key in group:
        return bool(group.get(key))
    defaults = getattr(optimizer, "defaults", {}) or {}
    return bool(defaults.get(key, False))


def _assert_supported_optimizer_flags(optimizer: "torch.optim.Optimizer") -> None:
    """G-016 / G-034 — reject optimizer flags whose numerics the engine does
    NOT model, BEFORE any sidecar is emitted.

    _detect_optimizer_family used to key SOLELY on type(optimizer).__name__, so
    Adam(amsgrad=True) / AdamW(amsgrad=True) and any optimizer with
    maximize=True were silently accepted and MISLABELED as plain
    adam/adamw/descent — a wrong-but-schema-valid sidecar (the README claimed
    'AMSGrad ... REJECTED at boundary'; that was false for the flag form). We
    inspect the actual flags via optimizer.defaults / param_group and refuse:

      - maximize=True   (all): ascent step (θ += lr·g); the engine is descent-
                               only. Numerically inverted.
      - amsgrad=True (Adam/AdamW): uses max(v_hat) — the engine's Rule 22/24
                               model plain Adam, not the AMSGrad max-track.
      - fused / capturable / differentiable = True: alternate kernels / graph
                               modes that can reorder FP ops and diverge from
                               the engine's pinned scalar recurrences.

    (foreach is intentionally NOT rejected: on CPU it is a vectorized but
    bit-identical path. G-034 multi-param-group rejection lives in the caller.)
    """
    BANNED_ALL = ("maximize", "fused", "capturable", "differentiable")
    BANNED_ADAM = ("amsgrad",)
    cls = type(optimizer).__name__
    for group in optimizer.param_groups:
        for flag in BANNED_ALL:
            if _flag_is_set(optimizer, group, flag):
                raise HelperUnsupportedError(
                    f"helper: torch.optim.{cls} with {flag}=True is rejected at the "
                    f"extraction boundary — its numerics can diverge from backprop-trace's "
                    f"engine recompute (maximize is an ascent step; fused/capturable/"
                    f"differentiable use alternate kernels/graph modes that reorder FP ops). "
                    f"The engine models descent-only, scalar, pinned recurrences. Disable the "
                    f"flag for sidecar extraction, or use the hand-authored sidecar path."
                )
        if cls in ("Adam", "AdamW"):
            for flag in BANNED_ADAM:
                if _flag_is_set(optimizer, group, flag):
                    raise HelperUnsupportedError(
                        f"helper: torch.optim.{cls} with {flag}=True (AMSGrad) is rejected at the "
                        f"extraction boundary. The engine's Adam recurrences (Rule 22/24, Kingma & Ba "
                        f"2014) model plain Adam, NOT the AMSGrad max-of-v_hat track (Reddi et al. 2018 "
                        f"arXiv:1904.09237). An AMSGrad step would be silently mislabeled as plain adam. "
                        f"Use plain Adam/AdamW, or the hand-authored sidecar path."
                    )


def _detect_optimizer_family(optimizer: "torch.optim.Optimizer") -> str:
    """Return one of "sgd" | "sgd_momentum" | "adam" | "adamw" for the
    supported families, AFTER asserting flags + param-group constraints.

    - "sgd" — torch.optim.SGD with momentum=0 AND weight_decay=0
    - "sgd_momentum" — torch.optim.SGD with momentum > 0 (classical or
      Nesterov; dampening != 0 is REJECTED — see below)
    - "adam" — torch.optim.Adam
    - "adamw" — torch.optim.AdamW (decoupled weight decay)

    G-016: flags whose numerics diverge (maximize / amsgrad / fused /
    capturable / differentiable) are rejected via
    _assert_supported_optimizer_flags. G-034: multi-param-group optimizers are
    rejected here (the family scan inspects all groups but the hyperparameter
    block reads only param_groups[0], so >1 group would be silently
    mishandled). SGD with weight_decay > 0 (coupled L2) and AMSGrad / NAdam /
    RAdam / Lion / LBFGS remain REJECTED."""
    # G-016 — reject divergent flags first (applies to every family).
    _assert_supported_optimizer_flags(optimizer)
    # G-034 — multi-param-group optimizers: the family scan below looks at all
    # groups, but _build_optimizer_block + the learning_rate resolution read
    # ONLY param_groups[0]. A 2-group optimizer (e.g. different lr per layer)
    # would be silently mishandled (group-1 hyperparameters dropped). Reject —
    # per-parameter groups are deferred (documented scope).
    if len(optimizer.param_groups) > 1:
        raise HelperUnsupportedError(
            f"helper: optimizer has {len(optimizer.param_groups)} param_groups; the helper supports "
            f"exactly 1. Per-parameter / per-layer groups (distinct lr, momentum, weight_decay, etc.) "
            f"are deferred — the sidecar's top-level optimizer block reads only param_groups[0], so "
            f"additional groups would be silently dropped. Use a single param_group, or the "
            f"hand-authored sidecar path."
        )
    cls = type(optimizer).__name__
    if cls == "Adam":
        return "adam"
    if cls == "AdamW":
        return "adamw"
    if cls == "SGD":
        # Inspect the (single) param_group for momentum + weight_decay + dampening.
        any_momentum = False
        for group in optimizer.param_groups:
            # v0.13 — SGD coupled L2 (the documented Rule 7 third branch) is now
            # SUPPORTED. PyTorch's torch.optim.SGD(weight_decay=lambda) folds the
            # decay into the gradient before the buffer/update: d_p = grad +
            # lambda*param. The helper derives the BASE loss gradient analytically
            # from the loss (signal*upstream) — the coupled-L2 term is recovered
            # by the reconciler (Rule 5 / Rule 21) from update = wa - wb and
            # optimizer_config.weight_decay, so the receipt stays self-consistent.
            # weight_decay >= 0 is accepted; only a negative value (which PyTorch
            # itself rejects) is refused here.
            wd = group.get("weight_decay", 0.0)
            if wd < 0:
                raise HelperUnsupportedError(
                    "helper: torch.optim.SGD with weight_decay < 0 is invalid "
                    "(PyTorch requires weight_decay >= 0). Coupled L2 needs a "
                    "non-negative lambda."
                )
            momentum = group.get("momentum", 0.0)
            dampening = group.get("dampening", 0.0)
            # DAMPENING REJECTION (numerics diverge on the FIRST step):
            # PyTorch's SGD skips dampening on the step where the momentum
            # buffer is initialized — `buf = grad.clone()` (NO (1 - dampening)
            # factor) — and applies `buf = mu*buf + (1 - dampening)*grad` only
            # from the SECOND step on (torch/optim/sgd.py _single_tensor_sgd).
            # The engine's Rule 21a applies (1 - dampening) UNIFORMLY on every
            # step, so a step-0 dampening sidecar fails Rule 14 on
            # state_after.buffer. A per-step observer cannot guarantee it is
            # never invoked on a buffer-init step, so dampening != 0 is rejected
            # outright. Classical momentum (dampening=0) and Nesterov are
            # supported and round-trip exactly. (Hand-authored dampening
            # sidecars remain valid via bp import pytorch.)
            if momentum > 0 and dampening != 0:
                raise HelperUnsupportedError(
                    "helper: torch.optim.SGD with dampening != 0 is rejected at the extraction "
                    "boundary. PyTorch SKIPS dampening on the first (buffer-init) step "
                    "(buf = grad, no (1 - dampening) factor) but the engine's Rule 21a applies "
                    "(1 - dampening) on every step, so the first-step buffer diverges and Rule 14 "
                    "rejects a valid step. Classical momentum (dampening=0) and Nesterov are fully "
                    "supported. Use dampening=0, or the hand-authored sidecar path for dampening."
                )
            if momentum > 0:
                any_momentum = True
        if any_momentum:
            return "sgd_momentum"
        return "sgd"
    raise HelperUnsupportedError(
        f"helper: optimizer class '{cls}' is not supported. "
        f"The helper supports torch.optim.{{SGD, Adam, AdamW}}. "
        f"SGD with momentum > 0 is supported as 'sgd_momentum' (with the "
        f"documented momentum_buffer sign-flip). "
        f"AMSGrad / NAdam / RAdam / Lion / LBFGS are not supported."
    )


def _build_optimizer_block(
    optimizer: "torch.optim.Optimizer", family: str, step_index: int
) -> Optional[dict[str, Any]]:
    """Build the top-level `optimizer` block of the sidecar.

    Returns None for plain SGD with NO weight decay (the optimizer block is
    optional in the schema; absence ⇒ SGD by default for byte-equality with
    v0.6/v0.7 SGD sidecars). v0.13: plain SGD WITH weight_decay > 0 (coupled
    L2) returns {name, learning_rate, weight_decay}.

    For adam / adamw / sgd_momentum, returns the full hyperparameter
    block:
      - adam:         {name, learning_rate, beta1, beta2, epsilon, t}
      - adamw:        same as adam + weight_decay (DECOUPLED weight decay)
      - sgd_momentum: {name, learning_rate, momentum, nesterov?, weight_decay?}
        - nesterov is emitted only when True (preserves v0.6.0 byte-equal
          for classical sgd_momentum)
        - weight_decay (v0.13) is emitted only when > 0 — COUPLED L2 (folded
          into the gradient before the buffer). Absence ⇒ 0 (no decay),
          preserving v0.6/v0.7 byte-equality.
        - dampening is NOT emitted: SGD with dampening != 0 is rejected
          upstream by _detect_optimizer_family (it cannot round-trip the
          engine's uniform Rule 21a on the buffer-init step), so the live
          helper only ever observes dampening == 0 here.
    """
    g = optimizer.param_groups[0]
    if family == "sgd":
        # v0.13 — plain SGD coupled L2: emit a block ONLY when weight_decay > 0.
        wd = float(g.get("weight_decay", 0.0))
        if wd > 0:
            return {
                "name": "sgd",
                "learning_rate": float(g["lr"]),
                "weight_decay": wd,
            }
        return None
    if family == "adam":
        beta1, beta2 = g["betas"]
        return {
            "name": "adam",
            "learning_rate": float(g["lr"]),
            "beta1": float(beta1),
            "beta2": float(beta2),
            "epsilon": float(g["eps"]),
            "t": step_index + 1,
        }
    if family == "adamw":
        beta1, beta2 = g["betas"]
        return {
            "name": "adamw",
            "learning_rate": float(g["lr"]),
            "beta1": float(beta1),
            "beta2": float(beta2),
            "epsilon": float(g["eps"]),
            "weight_decay": float(g.get("weight_decay", 0.0)),
            "t": step_index + 1,
        }
    if family == "sgd_momentum":
        block: dict[str, Any] = {
            "name": "sgd_momentum",
            "learning_rate": float(g["lr"]),
            "momentum": float(g["momentum"]),
        }
        # v0.13 — emit weight_decay only when > 0 (COUPLED L2; folded into the
        # gradient before the momentum buffer). Absence ⇒ 0 (no decay),
        # preserving v0.6/v0.7 classical-sgd_momentum byte-equality.
        wd = float(g.get("weight_decay", 0.0))
        if wd > 0:
            block["weight_decay"] = wd
        nesterov = bool(g.get("nesterov", False))
        if nesterov:
            block["nesterov"] = True
        # dampening is NOT emitted. _detect_optimizer_family rejects SGD with
        # dampening != 0 at the extraction boundary (it cannot round-trip the
        # engine's uniform Rule 21a on the buffer-init step — see the DAMPENING
        # REJECTION block there), so by construction dampening == 0 here. Do NOT
        # re-add a dampening field: a dampened step genuinely fails Rule 14.
        return block
    raise HelperUnsupportedError(f"helper: optimizer family {family!r} unsupported")  # pragma: no cover


# ---------------------------------------------------------------------------
# AMP / device guards
# ---------------------------------------------------------------------------


def _assert_no_amp() -> None:
    """The helper rejects AMP / autocast — fp16 master vs fp32 master confusion
    is the canonical AMP extraction bug (PyTorch issue #75224)."""
    if not _TORCH_AVAILABLE:  # pragma: no cover
        return
    if torch.is_autocast_enabled():
        raise HelperUnsupportedError(
            "helper: torch.cuda.amp.autocast is active. The helper requires "
            "fp32 training without autocast (fp16 master vs fp32 master confusion is "
            "the canonical AMP extraction bug per PyTorch issue #75224). Disable "
            "autocast for the snapshot or upcast tensors to fp32 before dumper.step()."
        )


def _assert_cpu_only(p: "torch.Tensor") -> None:
    """The helper is CPU-first. CUDA/MPS/XLA reported but rejected
    (separate device-tolerance work is future)."""
    device_type = p.device.type
    if device_type != "cpu":
        raise HelperUnsupportedError(
            f"helper: parameter device '{device_type}' is not supported. "
            f"The helper is CPU-first; CUDA/MPS/XLA device-tolerance is future work. "
            f"Move the model to CPU for sidecar extraction "
            f"(model.cpu(); inputs.cpu(); targets.cpu()) and try again. "
            f"Training can resume on GPU after the snapshot."
        )


# ---------------------------------------------------------------------------
# Number formatting (canonical-emission helper)
# ---------------------------------------------------------------------------


def _normalize_for_json(value: Any) -> Any:
    """JSON-safe normalize: rejects NaN / Infinity (the schema's `type: number`
    would reject these, but a clean Python-side error is friendlier)."""
    if isinstance(value, float):
        if value != value:  # NaN
            raise HelperError("helper: extracted NaN — backprop-trace receipts forbid NaN.")
        if value in (float("inf"), float("-inf")):
            raise HelperError("helper: extracted Infinity — backprop-trace receipts forbid Infinity.")
        return value
    if isinstance(value, dict):
        return {k: _normalize_for_json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_normalize_for_json(v) for v in value]
    return value


# ---------------------------------------------------------------------------
# Helper block (forensic, not credential)
# ---------------------------------------------------------------------------


def _build_helper_block(
    optimizer: "torch.optim.Optimizer", device: str
) -> dict[str, Any]:
    """Build the forensic `helper` block. NEVER a credential — Rule 14 is
    the authority. Helper computes its own source_hash; docs state this
    is observer-claimed-not-verifier-checked."""
    torch_version = torch.__version__ if _TORCH_AVAILABLE else "unknown"
    return {
        "name": HELPER_NAME,
        "version": HELPER_VERSION,
        "distribution": "repo-script",
        "source_hash": _compute_self_source_hash(),
        "framework": {
            "name": "pytorch",
            "version": torch_version,
        },
        "runtime": {
            "python_version": platform.python_version(),
            "torch_version": torch_version,
            "deterministic_mode": {
                "torch_use_deterministic_algorithms": bool(
                    torch.are_deterministic_algorithms_enabled()
                ),
                "cudnn_deterministic": bool(torch.backends.cudnn.deterministic),
                "cudnn_benchmark": bool(torch.backends.cudnn.benchmark),
            },
        },
        "extraction": {
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "device": device,
        },
    }


# ---------------------------------------------------------------------------
# Public API — TraceDumper context manager
# ---------------------------------------------------------------------------


class TraceDumper:
    """Per-training-loop helper. Construct once; use `with dumper.step():`
    around the per-step body to emit one sidecar per training step.

    See module docstring for the trust-boundary statement, scope, and
    momentum_buffer sign-flip pin.
    """

    def __init__(
        self,
        model: "nn.Module",
        optimizer: "torch.optim.Optimizer",
        loss_fn: Any,
        *,
        out: Union[str, Path, TextIO, None] = None,
        trace_id: Optional[str] = None,
        topology_loss: str = "half_squared_error",
        learning_rate: Optional[float] = None,
        append: bool = False,
    ) -> None:
        if not _TORCH_AVAILABLE:  # pragma: no cover
            raise HelperError(
                "helper: torch is not installed. Install PyTorch (https://pytorch.org) "
                "or use the hand-authored sidecar path via the framework-trace.v0.6.0 schema."
            )
        _assert_no_amp()
        self._model = model
        self._optimizer = optimizer
        self._loss_fn = loss_fn
        self._family = _detect_optimizer_family(optimizer)
        self._topology = _infer_topology(model, loss=topology_loss)
        for p in model.parameters():
            _assert_cpu_only(p)
        # Resolve learning rate: explicit > optimizer.param_groups[0]["lr"]
        if learning_rate is not None:
            self._learning_rate = float(learning_rate)
        else:
            self._learning_rate = float(optimizer.param_groups[0]["lr"])
        self._trace_id_default = trace_id
        self._step_counter = 0
        # Resolve out destination.
        #
        # G-058 — DEFAULT to write-truncate ('w'). The old default was append
        # ('a'), so re-running a training script silently CONCATENATED a new
        # trace onto the previous file's bytes — a stale multi-trace JSONL that
        # then fails import (mixed trace_ids / step_index sequencing) or, worse,
        # imports as a corrupt longer trace. Truncating on open is the
        # least-surprise default; pass append=True to deliberately accumulate
        # across runs, and we warn loudly if that targets a non-empty file.
        self._out_owns_handle = False
        if out is None:
            self._out: TextIO = sys.stdout
        elif isinstance(out, (str, Path)):
            mode = "a" if append else "w"
            if append:
                try:
                    if Path(str(out)).exists() and Path(str(out)).stat().st_size > 0:
                        print(
                            f"helper: WARNING — appending (append=True) to non-empty file "
                            f"{out!r}; existing bytes are preserved and the new trace is "
                            f"concatenated. If you meant to overwrite, drop append=True.",
                            file=sys.stderr,
                        )
                except OSError:  # pragma: no cover
                    pass
            self._out = open(str(out), mode, encoding="utf-8")
            self._out_owns_handle = True
        else:
            self._out = out  # caller-provided stream

    def close(self) -> None:
        if self._out_owns_handle:
            try:
                self._out.close()
            except OSError:  # pragma: no cover
                pass

    def __enter__(self) -> "TraceDumper":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    @contextlib.contextmanager
    def step(
        self,
        *,
        trace_id: Optional[str] = None,
        inputs: Optional[dict[str, float]] = None,
        targets: Optional[dict[str, float]] = None,
    ) -> Any:
        """Context manager wrapping ONE training step. Captures pre-state
        before yielding control; captures post-state after the user's step
        body returns; emits one sidecar JSONL line.

        `inputs` / `targets` keys MUST match topology.unit_order.input /
        .output naming (i1, i2, ... / o1, o2, ...). If omitted, the helper
        attempts to discover them from the most recent model forward
        invocation but this is fragile; explicit pass is recommended.
        """
        # === BEFORE training step (capture pre-state) ===
        _assert_no_amp()
        if not torch.is_grad_enabled():
            raise HelperError(
                "helper: torch.is_grad_enabled() is False on entry to dumper.step(). "
                "backprop-trace requires gradients to verify Rule 4. Did you nest dumper.step() "
                "inside a torch.no_grad() block?"
            )
        params_before = _snapshot_parameters(self._model, self._topology)
        state_before = _snapshot_per_parameter_state(
            self._model, self._optimizer, self._topology, self._family, self._step_counter,
        )
        # Cache pre-state for inputs/targets defaulting fallback
        self._pending = {
            "params_before": params_before,
            "state_before": state_before,
            "inputs_override": inputs,
            "targets_override": targets,
        }
        try:
            yield self
        finally:
            self._after_step()

    def _after_step(self) -> None:
        # === AFTER training step (capture post-state) ===
        params_before = self._pending["params_before"]
        state_before = self._pending["state_before"]
        inputs_override = self._pending["inputs_override"]
        targets_override = self._pending["targets_override"]
        params_after = _snapshot_parameters(self._model, self._topology)
        state_after = _snapshot_per_parameter_state(
            self._model, self._optimizer, self._topology, self._family, self._step_counter,
        )

        # Resolve inputs/targets — required from the caller
        if inputs_override is None or targets_override is None:
            raise HelperError(
                "helper: dumper.step(inputs={...}, targets={...}) requires "
                "both inputs and targets to be passed explicitly. Inference from "
                "torch.autograd graph is fragile; the explicit-pass convention "
                "makes the receipt's named-factors provenance unambiguous."
            )

        # Build optimizer block (None for vanilla SGD)
        optimizer_block = _build_optimizer_block(self._optimizer, self._family, self._step_counter)

        # Compute gradient + forward from cached run by re-doing the math
        # the user just ran. The helper does NOT capture mid-step; it captures
        # pre-state and post-state and asks the verifier (Rule 14) to fill
        # forward/backward by recomputation. The sidecar emits a MINIMAL
        # shape: parameters_before, parameters_after, inputs, targets, plus
        # the helper block. The importer's runGeneralStep fills the rest.
        # However the v0.6.0 schema REQUIRES forward / loss / backward /
        # updates in the sidecar — so we run the framework forward once
        # more in inference mode to capture forward/loss, and store the
        # gradients we computed during the user's loss.backward() pass.

        forward_dict, loss_dict, backward_dict, updates_dict = self._compute_observables(
            params_before, params_after, inputs_override, targets_override, state_before, state_after
        )

        # v0.13 — SGD coupled L2 (the documented Rule 7 third branch) forces a
        # FORCED schema bump: the v0.7.0 sidecar schema REJECTS weight_decay for
        # the SGD family. A sidecar carrying coupled-L2 weight_decay on sgd /
        # sgd_momentum declares format "framework-trace.v0.8.0". Without it the
        # sidecar stays at SCHEMA_FORMAT (v0.7.0) for byte-equality. Adam/AdamW
        # weight_decay is DECOUPLED and was always permitted, so it does NOT
        # trigger the v0.8.0 bump.
        sidecar_format = SCHEMA_FORMAT
        if (
            optimizer_block is not None
            and optimizer_block.get("name") in ("sgd", "sgd_momentum")
            and float(optimizer_block.get("weight_decay", 0.0)) > 0
        ):
            sidecar_format = SCHEMA_FORMAT_COUPLED_L2

        sidecar = {
            "format": sidecar_format,
            "source_framework": {
                "name": "pytorch",
                "version": torch.__version__,
                "extractor": {
                    "name": HELPER_NAME,
                    "version": HELPER_VERSION,
                },
            },
            "helper": _build_helper_block(self._optimizer, device="cpu"),
            "topology": self._topology,
            "learning_rate": self._learning_rate,
            "inputs": inputs_override,
            "targets": targets_override,
            "parameters_before": params_before,
            "forward": forward_dict,
            "loss": loss_dict,
            "backward": backward_dict,
            "updates": updates_dict,
            "parameters_after": params_after,
        }
        if optimizer_block is not None:
            sidecar["optimizer"] = optimizer_block

        # Multi-step fields
        trace_id = self._pending.get("trace_id_override") or self._trace_id_default
        if trace_id is not None:
            sidecar["trace_id"] = trace_id
            sidecar["step_index"] = self._step_counter

        line = json.dumps(_normalize_for_json(sidecar), separators=(",", ":"), allow_nan=False)
        self._out.write(line + "\n")
        self._out.flush()

        self._step_counter += 1
        self._pending = {}

    def _compute_observables(
        self,
        params_before: dict[str, float],
        params_after: dict[str, float],
        inputs: dict[str, float],
        targets: dict[str, float],
        state_before: dict[tuple[int, int], dict[str, Any]],
        state_after: dict[tuple[int, int], dict[str, Any]],
    ) -> tuple[dict, dict, dict, list]:
        """Re-run forward + loss to capture observables for the sidecar.

        The user has already run loss.backward() + optimizer.step() inside
        the `with dumper.step():` body — params_after reflects the post-
        step state. We re-run the forward pass on params_before (which we
        cached, not re-loaded into the model — that would be invasive) by
        a clean inference computation using the topology metadata.

        For the gradient field of each update, we use (weight_before -
        weight_after) / lr for plain SGD; for Adam we cannot derive it from
        before/after alone (the moment update is path-dependent), so we
        flag this as a limitation that requires the user to capture
        gradients explicitly. The simpler solution is: re-run
        loss.backward() once more on a snapshot of pre-state. We do that
        below.
        """
        # Re-run forward pass on params_before via a clean tensor build
        # We rebuild the model's forward computation directly using the
        # extracted weights rather than mutating the live model.
        topo = self._topology
        i_units = topo["unit_order"]["input"]
        h_units = topo["unit_order"]["hidden"]
        o_units = topo["unit_order"]["output"]

        # Inputs as a tensor in canonical order
        x = torch.tensor(
            [[inputs[u] for u in i_units]],
            dtype=torch.float64,
            requires_grad=False,
        )
        y = torch.tensor(
            [[targets[u] for u in o_units]],
            dtype=torch.float64,
            requires_grad=False,
        )

        # Reconstruct weights + PER-NEURON biases (G-015): b_h<k> / b_o<k>.
        W_ih = torch.zeros(len(h_units), len(i_units), dtype=torch.float64, requires_grad=True)
        b_h = torch.zeros(len(h_units), dtype=torch.float64, requires_grad=True)
        W_ho = torch.zeros(len(o_units), len(h_units), dtype=torch.float64, requires_grad=True)
        b_o = torch.zeros(len(o_units), dtype=torch.float64, requires_grad=True)

        with torch.no_grad():
            for h_out in range(len(h_units)):
                for i_in in range(len(i_units)):
                    W_ih[h_out, i_in] = params_before[f"w_i{i_in + 1}_h{h_out + 1}"]
                b_h[h_out] = params_before[f"b_h{h_out + 1}"]
            for o_out in range(len(o_units)):
                for h_in in range(len(h_units)):
                    W_ho[o_out, h_in] = params_before[f"w_h{h_in + 1}_o{o_out + 1}"]
                b_o[o_out] = params_before[f"b_o{o_out + 1}"]

        W_ih.requires_grad_(True)
        b_h.requires_grad_(True)
        W_ho.requires_grad_(True)
        b_o.requires_grad_(True)

        # Forward
        net_h = x @ W_ih.t() + b_h.unsqueeze(0)
        if topo["activation_hidden"] == "sigmoid":
            out_h = torch.sigmoid(net_h)
        elif topo["activation_hidden"] == "relu":
            out_h = torch.relu(net_h)
        else:
            out_h = net_h
        net_o = out_h @ W_ho.t() + b_o.unsqueeze(0)
        if topo["activation_output"] == "sigmoid":
            out_o = torch.sigmoid(net_o)
        elif topo["activation_output"] == "softmax":
            out_o = torch.softmax(net_o, dim=-1)
        elif topo["activation_output"] == "relu":
            out_o = torch.relu(net_o)
        else:
            out_o = net_o

        # Loss
        if topo["loss"] == "half_squared_error":
            per_output_loss = 0.5 * (out_o - y) ** 2
            total_loss = per_output_loss.sum()
        elif topo["loss"] == "cross_entropy_softmax":
            eps = 1e-30  # log-stability epsilon; tolerance-bounded
            per_output_loss = -y * torch.log(out_o + eps)
            total_loss = per_output_loss.sum()
        else:
            raise HelperUnsupportedError(f"helper: loss {topo['loss']!r} unsupported")

        # Backward
        total_loss.backward()

        # Build forward + loss + backward dicts
        net_h_vals = net_h.detach().to(torch.float64).flatten().tolist()
        out_h_vals = out_h.detach().to(torch.float64).flatten().tolist()
        net_o_vals = net_o.detach().to(torch.float64).flatten().tolist()
        out_o_vals = out_o.detach().to(torch.float64).flatten().tolist()
        forward_dict: dict[str, dict[str, float]] = {}
        for idx, u in enumerate(h_units):
            forward_dict[u] = {"net": net_h_vals[idx], "out": out_h_vals[idx]}
        for idx, u in enumerate(o_units):
            forward_dict[u] = {"net": net_o_vals[idx], "out": out_o_vals[idx]}

        per_output_loss_vals = per_output_loss.detach().to(torch.float64).flatten().tolist()
        loss_dict = {
            "per_output": {o_units[idx]: per_output_loss_vals[idx] for idx in range(len(o_units))},
            "total": _scalar(total_loss),
        }

        # Backward: output_error_signals + hidden_error_signals.
        #
        # SIGN CONVENTION (LOAD-BEARING — descent_direction). The engine
        # (general-engine.ts) emits the output error signal in DESCENT
        # direction so that `update = lr * gradient` and `weight_after =
        # weight_before + update` (Rules 5/6). That means:
        #   - half_squared_error: signal_o = (target - out) * act'(net_o)
        #       factors = [target_minus_output, activation_derivative]
        #   - cross_entropy_softmax (collapsed): signal_o = (target - p_o)
        #       factors = [target_minus_probability]
        # An earlier helper used (out - target) (ASCENT, the raw dL/dnet sign).
        # That flipped the stored gradient's sign so Rule 5 (update == lr *
        # gradient) FAILED against the real torch update (which is descent).
        # The mismatch was invisible because the fixtures derived from
        # hand-authored (correctly-signed) sidecars; torch end-to-end exposes
        # it. The factor NAMES also match the engine so the receipt is
        # shape-identical to an engine-authored one.
        output_error_signals = {}
        for o_idx, u in enumerate(o_units):
            t_val = targets[u]
            o_val = out_o_vals[o_idx]
            if topo["loss"] == "cross_entropy_softmax":
                # Collapsed softmax+CE signal: (target - probability).
                signal_val = t_val - o_val
                factors = [
                    {"name": "target_minus_probability", "value": signal_val},
                ]
            elif topo["activation_output"] == "sigmoid":
                tmo = t_val - o_val
                deriv = o_val * (1.0 - o_val)  # sigmoid'(net) = out*(1-out)
                signal_val = tmo * deriv
                factors = [
                    {"name": "target_minus_output", "value": tmo},
                    {"name": "activation_derivative", "value": deriv},
                ]
            elif topo["activation_output"] == "relu":
                tmo = t_val - o_val
                # Engine uses reluDerivativeFromOut(out): out > 0 ? 1 : 0.
                deriv = 1.0 if o_val > 0 else 0.0
                signal_val = tmo * deriv
                factors = [
                    {"name": "target_minus_output", "value": tmo},
                    {"name": "activation_derivative", "value": deriv},
                ]
            else:  # identity
                tmo = t_val - o_val
                signal_val = tmo * 1.0
                factors = [
                    {"name": "target_minus_output", "value": tmo},
                    {"name": "activation_derivative", "value": 1.0},
                ]
            output_error_signals[u] = {
                "factors": factors,
                "product_order": "left_to_right",
                "signal_value": signal_val,
            }

        # Hidden error signals
        hidden_error_signals = {}
        for h_idx, hu in enumerate(h_units):
            contributions = []
            backprop_sum = 0.0
            for o_idx, ou in enumerate(o_units):
                downstream = output_error_signals[ou]["signal_value"]
                w_val = params_before[f"w_h{h_idx + 1}_o{o_idx + 1}"]
                contrib = downstream * w_val
                contributions.append({
                    "from": ou,
                    "downstream_signal": downstream,
                    "via_weight": f"w_h{h_idx + 1}_o{o_idx + 1}",
                    "weight_value": w_val,
                    "value": contrib,
                })
                backprop_sum += contrib
            out_h_val = out_h_vals[h_idx]
            if topo["activation_hidden"] == "sigmoid":
                act_deriv = out_h_val * (1.0 - out_h_val)
            elif topo["activation_hidden"] == "relu":
                # Engine uses reluDerivativeFromOut(out): out > 0 ? 1 : 0.
                act_deriv = 1.0 if out_h_val > 0 else 0.0
            else:
                act_deriv = 1.0
            hidden_error_signals[hu] = {
                "downstream_contributions": contributions,
                "summation_order": list(o_units),
                "backpropagated_sum": backprop_sum,
                "activation_derivative": act_deriv,
                "product_order": "left_to_right",
                "signal_value": backprop_sum * act_deriv,
            }

        backward_dict = {
            "output_error_signals": output_error_signals,
            "hidden_error_signals": hidden_error_signals,
        }

        # Updates: walk parameter_order
        lr = self._learning_rate
        h_cache = self._cache_forward(topo, params_before, inputs)
        # BIAS-UPDATE EMISSION POLICY (mirrors import-observer.ts
        # resolveBiasPolicyForSidecar). A real nn.Linear(bias=True) updates its
        # per-neuron biases every step → the importer routes to
        # bias_policy.mode='sgd' and the engine EMITS a bias update per neuron;
        # the helper must emit them too. A bias=False model has synthetic 0
        # biases that never change → the importer keeps mode='constant' and the
        # engine emits NO bias updates (it `continue`s past them); emitting bias
        # updates anyway trips Rule 0's bias_policy-vs-Update.kind cross-check.
        # Decide once: emit bias updates IFF at least one bias actually moved.
        bias_ids = [
            p["id"] for p in topo["parameters"]
            if p["role"] in ("hidden_bias", "output_bias")
        ]
        any_bias_changed = any(
            params_after[bid] != params_before[bid] for bid in bias_ids
        )
        updates_dict = []
        for pid in topo["parameter_order"]:
            wb = params_before[pid]
            wa = params_after[pid]
            meta_param_pre = next(p for p in topo["parameters"] if p["id"] == pid)
            # Skip constant biases (bias=False / unchanged) — matches the
            # engine's bias_policy.mode='constant' path which omits the entry.
            if (
                meta_param_pre["role"] in ("hidden_bias", "output_bias")
                and not any_bias_changed
            ):
                continue
            grad = self._derive_gradient_for_param(
                pid, topo, params_before, inputs, output_error_signals, hidden_error_signals
            )
            # `update` SEMANTICS (LOAD-BEARING for AdamW — Rule 6/7).
            # The engine defines `weight_after = weight_before + update` for
            # SGD / sgd_momentum / Adam, so update = wa - wb. But AdamW applies
            # DECOUPLED weight decay (Loshchilov & Hutter 2017 arXiv:1711.05101
            # Alg 2): weight_after = (1 - lr*wd)*weight_before + update, where
            # `update` is the PLAIN Adam step (lr*m_hat/(sqrt(v_hat)+eps)) and
            # does NOT include the decay shrinkage. Using wa - wb here would
            # fold the -lr*wd*weight_before shrinkage INTO update — exactly the
            # coupled-L2 confusion the bad-adamw-as-coupled-l2 fixture rejects.
            # Recover the plain Adam update: update = wa - (1 - lr*wd)*wb.
            if self._family == "adamw":
                g0 = self._optimizer.param_groups[0]
                wd = float(g0.get("weight_decay", 0.0))
                update_val = wa - (1.0 - self._learning_rate * wd) * wb
            else:
                update_val = wa - wb
            meta_param = next(p for p in topo["parameters"] if p["id"] == pid)
            role = meta_param["role"]
            # === NAMED-FACTOR DECOMPOSITION (LOAD-BEARING — Rule 4) ===
            # Rule 4 requires `gradient == product(optimizer.factors)` left-to-
            # right. The engine (general-engine.ts computeUpdateAndOptimizer +
            # the weight/bias branches) emits factors as the GRADIENT operands
            # — [error_signal, upstream_activation] for weights, [error_signal]
            # for per-neuron biases — NOT [learning_rate, gradient] (whose
            # product would be lr*gradient and fail Rule 4). The helper MUST
            # mirror that decomposition exactly, including the `from` provenance
            # paths, or its own honest receipt is rejected at Rule 4 (the latent
            # bug G-017's torch end-to-end test now guards against). The
            # learning_rate enters via update = lr * gradient (Rules 5/6/21/24),
            # not as a factor of the gradient.
            factors: list[dict[str, Any]] = self._build_optimizer_factors(
                pid, role, inputs, output_error_signals, hidden_error_signals, h_cache
            )
            update_entry: dict[str, Any] = {
                "parameter_id": pid,
                "kind": "bias" if pid.startswith("b_") else "weight",
                "weight_before": wb,
                "optimizer": {
                    "name": self._family,
                    "learning_rate": lr,
                    "factors": factors,
                    "product_order": "left_to_right",
                },
                "gradient": grad,
                "update": update_val,
                "weight_after": wa,
            }
            # Add layer_edge / from_unit / to_unit / parameter_role from topology
            update_entry["parameter_role"] = (
                # Weights carry the engine's "<from>_to_<to>" role string;
                # biases carry the role name (hidden_bias / output_bias) since
                # a bias does not connect two units (matches general-engine.ts).
                f'{meta_param["from_unit"]}_to_{meta_param["to_unit"]}'
                if role in ("input_to_hidden_weight", "hidden_to_output_weight")
                else role
            )
            if role in ("hidden_bias", "output_bias"):
                # Bias: from_unit === to_unit === served unit (engine convention).
                served = meta_param["applies_to_units"][0]
                update_entry["from_unit"] = served
                update_entry["to_unit"] = served
            else:
                if "from_unit" in meta_param:
                    update_entry["from_unit"] = meta_param["from_unit"]
                if "to_unit" in meta_param:
                    update_entry["to_unit"] = meta_param["to_unit"]
            if role == "input_to_hidden_weight":
                update_entry["layer_edge"] = "input_to_hidden"
            elif role == "hidden_to_output_weight":
                update_entry["layer_edge"] = "hidden_to_output"
            elif role in ("hidden_bias", "output_bias"):
                update_entry["layer_edge"] = "bias_to_layer"
            # Optimizer-state pass-through.
            #
            # state_before / state_after are now keyed by backprop-trace
            # parameter_id directly (refactored from the earlier tuple key
            # via _snapshot_per_parameter_state). For adam/adamw the
            # state shape is {m, v, step}; for sgd_momentum it's
            # {buffer} (already sign-flipped from PyTorch's ascent-
            # direction momentum_buffer per the load-bearing pin at
            # the top of this file).
            #
            # Plain SGD has no state — both maps are empty {}.
            if self._family in ("adam", "adamw", "sgd_momentum"):
                if pid in state_before:
                    update_entry["optimizer"]["state_before"] = state_before[pid]
                if pid in state_after:
                    update_entry["optimizer"]["state_after"] = state_after[pid]
            updates_dict.append(update_entry)

        return forward_dict, loss_dict, backward_dict, updates_dict

    def _derive_gradient_for_param(
        self,
        pid: str,
        topo: dict[str, Any],
        params_before: dict[str, float],
        inputs: dict[str, float],
        output_signals: dict[str, dict[str, Any]],
        hidden_signals: dict[str, dict[str, Any]],
    ) -> float:
        """Derive the gradient for parameter `pid` from the cached forward
        + error signals. This mirrors the engine's named-factors form:
        - input→hidden weight w_i<a>_h<b>: signal_h<b> * input_i<a>
        - hidden→output weight w_h<a>_o<b>: signal_o<b> * out_h<a>
        - PER-NEURON hidden bias b_h<b>: signal_h<b> (single factor; ∂E/∂b_u = signal_u)
        - PER-NEURON output bias b_o<b>: signal_o<b>
        """
        if pid.startswith("w_i"):
            # w_i<a>_h<b>
            parts = pid[2:].split("_")  # ["i<a>", "h<b>"]
            i_part = parts[0]  # "i<a>"
            h_part = parts[1]  # "h<b>"
            input_val = inputs[i_part]
            hidden_signal = hidden_signals[h_part]["signal_value"]
            return hidden_signal * input_val
        if pid.startswith("w_h"):
            parts = pid[2:].split("_")
            h_part = parts[0]
            o_part = parts[1]
            out_h_val = next(
                fwd["out"] for k, fwd in self._cache_forward(topo, params_before, inputs).items() if k == h_part
            )
            output_signal = output_signals[o_part]["signal_value"]
            return output_signal * out_h_val
        if pid.startswith("b_h"):
            # PER-NEURON hidden bias for unit h<k>: the unit's own error signal.
            h_part = pid[2:]  # "h<k>"
            return hidden_signals[h_part]["signal_value"]
        if pid.startswith("b_o"):
            # PER-NEURON output bias for unit o<k>: the unit's own error signal.
            o_part = pid[2:]  # "o<k>"
            return output_signals[o_part]["signal_value"]
        raise HelperError(f"helper: unknown parameter id {pid!r}")

    def _build_optimizer_factors(
        self,
        pid: str,
        role: str,
        inputs: dict[str, float],
        output_signals: dict[str, dict[str, Any]],
        hidden_signals: dict[str, dict[str, Any]],
        h_cache: dict[str, dict[str, float]],
    ) -> list[dict[str, Any]]:
        """Build the named-factor decomposition for `pid`'s optimizer block.

        Mirrors general-engine.ts EXACTLY so Rule 4 (gradient ==
        product(factors), left-to-right) holds on the helper's own honest
        receipt:

          - input→hidden weight w_i<a>_h<b>:
              [hidden_error_signal (from backward.hidden_error_signals.h<b>.signal_value),
               upstream_activation (from inputs.i<a>)]
          - hidden→output weight w_h<a>_o<b>:
              [output_error_signal (from backward.output_error_signals.o<b>.signal_value),
               upstream_activation (from forward.h<a>.out)]
          - per-neuron hidden bias b_h<b>:
              [hidden_error_signal (from backward.hidden_error_signals.h<b>.signal_value)]
          - per-neuron output bias b_o<b>:
              [output_error_signal (from backward.output_error_signals.o<b>.signal_value)]

        The `from` provenance strings match the engine's NamedFactor.from
        paths so the emitted receipt is byte-shape-identical to an engine-
        authored one for the same step.
        """
        if role == "input_to_hidden_weight":
            parts = pid[2:].split("_")  # ["i<a>", "h<b>"]
            i_part, h_part = parts[0], parts[1]
            return [
                {
                    "name": "hidden_error_signal",
                    "from": f"backward.hidden_error_signals.{h_part}.signal_value",
                    "value": hidden_signals[h_part]["signal_value"],
                },
                {
                    "name": "upstream_activation",
                    "from": f"inputs.{i_part}",
                    "value": inputs[i_part],
                },
            ]
        if role == "hidden_to_output_weight":
            parts = pid[2:].split("_")  # ["h<a>", "o<b>"]
            h_part, o_part = parts[0], parts[1]
            return [
                {
                    "name": "output_error_signal",
                    "from": f"backward.output_error_signals.{o_part}.signal_value",
                    "value": output_signals[o_part]["signal_value"],
                },
                {
                    "name": "upstream_activation",
                    "from": f"forward.{h_part}.out",
                    "value": h_cache[h_part]["out"],
                },
            ]
        if role == "hidden_bias":
            h_part = pid[2:]  # "h<b>"
            return [
                {
                    "name": "hidden_error_signal",
                    "from": f"backward.hidden_error_signals.{h_part}.signal_value",
                    "value": hidden_signals[h_part]["signal_value"],
                },
            ]
        if role == "output_bias":
            o_part = pid[2:]  # "o<b>"
            return [
                {
                    "name": "output_error_signal",
                    "from": f"backward.output_error_signals.{o_part}.signal_value",
                    "value": output_signals[o_part]["signal_value"],
                },
            ]
        raise HelperError(f"helper: unknown parameter role {role!r} for {pid!r}")

    def _cache_forward(
        self, topo: dict[str, Any], params_before: dict[str, float], inputs: dict[str, float]
    ) -> dict[str, dict[str, float]]:
        """Compute h-layer forward values (cached per-call usage). Repeats
        the math from _compute_observables for the bridge path of
        _derive_gradient_for_param — small enough to recompute."""
        h_units = topo["unit_order"]["hidden"]
        i_units = topo["unit_order"]["input"]
        out: dict[str, dict[str, float]] = {}
        for h_idx, hu in enumerate(h_units):
            net = params_before[f"b_h{h_idx + 1}"]  # PER-NEURON hidden bias
            for i_idx, iu in enumerate(i_units):
                net += params_before[f"w_i{i_idx + 1}_h{h_idx + 1}"] * inputs[iu]
            if topo["activation_hidden"] == "sigmoid":
                from math import exp

                act = 1.0 / (1.0 + exp(-net))
            elif topo["activation_hidden"] == "relu":
                act = max(0.0, net)
            else:
                act = net
            out[hu] = {"net": net, "out": act}
        return out


# ---------------------------------------------------------------------------
# CLI entrypoint (defensive — primary surface is the library API)
# ---------------------------------------------------------------------------


def _cli() -> int:  # pragma: no cover - tested via bp examples pytorch
    """Minimal CLI for `python pytorch_trace_helper.py --print-hash` etc.

    The primary surface is the library API (TraceDumper). The CLI is a
    convenience for the user wanting to introspect the helper without
    importing it (e.g. to print the source_hash that this version will
    embed in sidecars)."""
    import argparse

    parser = argparse.ArgumentParser(
        description=f"{HELPER_NAME} v{HELPER_VERSION} — forensic-only helper for backprop-trace.",
    )
    parser.add_argument("--print-hash", action="store_true", help="Print this file's sha256 hash (forensic only).")
    parser.add_argument("--version", action="store_true", help="Print helper version.")
    args = parser.parse_args()
    if args.version:
        print(f"{HELPER_NAME} v{HELPER_VERSION}")
        return 0
    if args.print_hash:
        print(_compute_self_source_hash())
        return 0
    parser.print_help()
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(_cli())
