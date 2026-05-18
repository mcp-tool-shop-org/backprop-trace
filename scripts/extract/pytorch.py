"""
backprop-trace PyTorch live helper (v0.10.3)
=============================================

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

SCOPE (v0.10.x)
---------------
SUPPORTED:
- PyTorch SGD (vanilla, no momentum).
- PyTorch SGD with momentum (`torch.optim.SGD(momentum=...)`), classical
  + Nesterov + dampening — momentum_buffer sign-flipped at extraction
  boundary (see MOMENTUM_BUFFER SIGN FLIP below).
- PyTorch Adam.
- PyTorch AdamW (decoupled weight decay).
- Single-step and multi-step (call `with dumper.step():` per training step).
- CPU device.
- 2-2-2 / 2-2-3 / 2-3-2 topologies (Mazur-shaped feed-forward nets).
- half_squared_error loss; cross_entropy_softmax loss.

NOT SUPPORTED YET (v0.10.x / v0.11):
- SGD with weight_decay (coupled L2 form) — REJECTED at boundary;
  Rule 7 third branch deferred to v0.11.
- AMSGrad / NAdam / RAdam / Lion — REJECTED at boundary.
- LBFGS / closure-style optimizers — REJECTED at boundary.
- Batched live extraction — the batched sidecar path exists for
  hand-authored sidecars, but the v0.10.x helper extracts SINGLE
  samples one at a time.
- AMP / GradScaler — REJECTED at boundary (PyTorch issue #75224
  fp16/fp32 master-confusion).
- CUDA / MPS / XLA devices — REJECTED at boundary (CPU-first v0.10.x;
  device-tolerance work is v0.11+).

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


HELPER_VERSION = "0.10.3"
HELPER_NAME = "backprop-trace-pytorch-helper"
SCHEMA_FORMAT = "framework-trace.v0.7.0"
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
    """User asked for a feature outside the current v0.10.x helper
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

    v0.10 supports the same single-hidden-layer feed-forward shape the
    engine's general-engine.ts handles: Linear(input → hidden) →
    activation → Linear(hidden → output) → output_activation. Topology
    keys are pinned to the Mazur canonical form (i1/i2, h1/h2, o1/o2).
    """
    linears = [m for m in model.modules() if isinstance(m, nn.Linear)]
    if len(linears) != 2:
        raise HelperUnsupportedError(
            f"helper v0.10.x: expected exactly 2 nn.Linear layers (input→hidden, hidden→output); "
            f"got {len(linears)}. v0.10 supports single-hidden-layer feed-forward nets only. "
            f"CNN / transformer / multi-hidden-layer topologies deferred to v0.11."
        )
    input_size = linears[0].in_features
    hidden_size = linears[0].out_features
    output_size = linears[1].out_features
    if linears[1].in_features != hidden_size:
        raise HelperUnsupportedError(
            f"helper v0.10.x: hidden→output linear's in_features ({linears[1].in_features}) "
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
            f"helper v0.10.x: loss='cross_entropy_softmax' requires output activation "
            f"to be Softmax; observed '{activation_output}'."
        )
    if loss == "half_squared_error" and activation_output not in ("sigmoid", "identity", "relu"):
        raise HelperUnsupportedError(
            f"helper v0.10.x: loss='half_squared_error' requires output activation "
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
    # hidden biases (per-layer convention in v0.10; bias_sharing="per_layer")
    parameters.append(
        {
            "id": "b_h",
            "role": "hidden_bias",
            "applies_to_units": list(hidden_units),
        }
    )
    parameter_order.append("b_h")
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
    # output biases (per-layer)
    parameters.append(
        {
            "id": "b_o",
            "role": "output_bias",
            "applies_to_units": list(output_units),
        }
    )
    parameter_order.append("b_o")

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
        "bias_sharing": "per_layer",
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
    Bias is a 1-D tensor of length out_features; we apply per-layer
    averaging when bias_sharing == "per_layer" (the canonical case in
    v0.10) — PyTorch's per-unit biases must all be equal for that
    sharing convention to hold.
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
        b_h = _snap_tensor(L_in_h.bias)
        if not all(abs(b - b_h[0]) < 1e-12 for b in b_h):
            raise HelperUnsupportedError(
                f"helper v0.10.x: hidden-layer per-unit biases must all be equal "
                f"for bias_sharing='per_layer' convention; observed {b_h}. "
                f"Per-neuron-bias topologies are receipt-schema-supported but "
                f"v0.10 helper authors per-layer only."
            )
        snap["b_h"] = b_h[0]
    else:
        snap["b_h"] = 0.0
    W_ho = _snap_tensor(L_h_o.weight)  # length output_size * hidden_size
    for o_out in range(output_size):
        for h_in in range(hidden_size):
            snap[f"w_h{h_in + 1}_o{o_out + 1}"] = W_ho[o_out * hidden_size + h_in]
    if L_h_o.bias is not None:
        b_o = _snap_tensor(L_h_o.bias)
        if not all(abs(b - b_o[0]) < 1e-12 for b in b_o):
            raise HelperUnsupportedError(
                f"helper v0.10.x: output-layer per-unit biases must all be equal "
                f"for bias_sharing='per_layer' convention; observed {b_o}."
            )
        snap["b_o"] = b_o[0]
    else:
        snap["b_o"] = 0.0
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
            # Pre-first-step zero-init (Adam lazy-init; matches v0.6.0
            # AdamState required shape {m, v}).
            if not state or "exp_avg" not in state:
                return {"m": 0.0, "v": 0.0, "step": step_index}
            step_val = state["step"]
            step_int = int(step_val.item()) if torch.is_tensor(step_val) else int(step_val)
            m_t = state["exp_avg"]
            v_t = state["exp_avg_sq"]
            m_val = float(m_t[idx].detach().to(torch.float64).item())
            v_val = float(v_t[idx].detach().to(torch.float64).item())
            return {"m": m_val, "v": v_val, "step": step_int}

        # input→hidden weights (Linear.weight shape: [hidden_size, input_size])
        for h_out in range(hidden_size):
            for i_in in range(input_size):
                snap[f"w_i{i_in + 1}_h{h_out + 1}"] = _adam_element(s_w_ih, h_out, i_in)
        # hidden bias (per-layer convention: all bias entries equal; element 0)
        snap["b_h"] = _adam_element(s_b_h, 0)
        # hidden→output weights (Linear.weight shape: [output_size, hidden_size])
        for o_out in range(output_size):
            for h_in in range(hidden_size):
                snap[f"w_h{h_in + 1}_o{o_out + 1}"] = _adam_element(s_w_ho, o_out, h_in)
        snap["b_o"] = _adam_element(s_b_o, 0)
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
        snap["b_h"] = _momentum_element(s_b_h, 0)
        for o_out in range(output_size):
            for h_in in range(hidden_size):
                snap[f"w_h{h_in + 1}_o{o_out + 1}"] = _momentum_element(s_w_ho, o_out, h_in)
        snap["b_o"] = _momentum_element(s_b_o, 0)
        return snap

    raise HelperUnsupportedError(  # pragma: no cover
        f"helper v0.10.x: unknown optimizer family {family!r} in _snapshot_per_parameter_state"
    )


# ---------------------------------------------------------------------------
# Optimizer family detection + config emission
# ---------------------------------------------------------------------------


def _detect_optimizer_family(optimizer: "torch.optim.Optimizer") -> str:
    """Return one of "sgd" | "sgd_momentum" | "adam" | "adamw" for v0.10.1
    supported families.

    v0.10.1 closes the helper-side optimizer matrix gap from v0.10.0:
    - "sgd" — torch.optim.SGD with momentum=0 AND weight_decay=0
    - "sgd_momentum" — torch.optim.SGD with momentum > 0 (any combo of
      Nesterov / dampening; PyTorch rejects nesterov=True with
      dampening != 0 at constructor time so we never observe the combo)
    - "adam" — torch.optim.Adam
    - "adamw" — torch.optim.AdamW (decoupled weight decay)

    SGD with weight_decay > 0 (coupled L2) remains REJECTED — Rule 7's
    third branch is deferred to v0.11. AMSGrad / NAdam / RAdam / Lion /
    LBFGS remain REJECTED."""
    cls = type(optimizer).__name__
    if cls == "Adam":
        return "adam"
    if cls == "AdamW":
        return "adamw"
    if cls == "SGD":
        # Inspect param_groups for momentum + weight_decay
        any_momentum = False
        for group in optimizer.param_groups:
            wd = group.get("weight_decay", 0.0)
            if wd > 0:
                raise HelperUnsupportedError(
                    "helper v0.10.x: torch.optim.SGD with weight_decay > 0 "
                    "(coupled L2 form) is deferred to v0.11 (Rule 7 third branch). "
                    "v0.10.x supports SGD (no weight_decay), sgd_momentum (no "
                    "weight_decay), Adam, and AdamW (decoupled weight_decay). "
                    "Hand-authored sidecars continue to work via the existing "
                    "bp import pytorch path."
                )
            if group.get("momentum", 0.0) > 0:
                any_momentum = True
        if any_momentum:
            return "sgd_momentum"
        return "sgd"
    raise HelperUnsupportedError(
        f"helper v0.10.x: optimizer class '{cls}' is not supported. "
        f"v0.10.x supports torch.optim.{{SGD, Adam, AdamW}}. "
        f"SGD with momentum > 0 is supported as 'sgd_momentum' (with the "
        f"documented momentum_buffer sign-flip). "
        f"AMSGrad / NAdam / RAdam / Lion / LBFGS deferred to v0.10+."
    )


def _build_optimizer_block(
    optimizer: "torch.optim.Optimizer", family: str, step_index: int
) -> Optional[dict[str, Any]]:
    """Build the top-level `optimizer` block of the sidecar.

    Returns None for plain SGD (the optimizer block is optional in the
    schema; absence ⇒ SGD by default for byte-equality with v0.6/v0.7
    SGD sidecars).

    For adam / adamw / sgd_momentum, returns the full hyperparameter
    block:
      - adam:         {name, learning_rate, beta1, beta2, epsilon, t}
      - adamw:        same as adam + weight_decay
      - sgd_momentum: {name, learning_rate, momentum, nesterov?, dampening?}
        - nesterov is emitted only when True (preserves v0.6.0 byte-equal
          for classical sgd_momentum)
        - dampening is emitted only when > 0
        - PyTorch rejects nesterov=True with dampening != 0 at the
          constructor, so we never observe the combo
    """
    if family == "sgd":
        return None
    g = optimizer.param_groups[0]
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
        nesterov = bool(g.get("nesterov", False))
        dampening = float(g.get("dampening", 0.0))
        if nesterov:
            block["nesterov"] = True
        if dampening > 0:
            block["dampening"] = dampening
        return block
    raise HelperUnsupportedError(f"helper v0.10.x: optimizer family {family!r} unsupported")  # pragma: no cover


# ---------------------------------------------------------------------------
# AMP / device guards
# ---------------------------------------------------------------------------


def _assert_no_amp() -> None:
    """v0.10 rejects AMP / autocast — fp16 master vs fp32 master confusion
    is the canonical AMP extraction bug (PyTorch issue #75224)."""
    if not _TORCH_AVAILABLE:  # pragma: no cover
        return
    if torch.is_autocast_enabled():
        raise HelperUnsupportedError(
            "helper v0.10.x: torch.cuda.amp.autocast is active. v0.10.x helper requires "
            "fp32 training without autocast (fp16 master vs fp32 master confusion is "
            "the canonical AMP extraction bug per PyTorch issue #75224). Disable "
            "autocast for the snapshot or upcast tensors to fp32 before dumper.step()."
        )


def _assert_cpu_only(p: "torch.Tensor") -> None:
    """v0.10 ships CPU-first. CUDA/MPS/XLA reported but rejected for v0.10
    (separate device-tolerance work is v0.11+)."""
    device_type = p.device.type
    if device_type != "cpu":
        raise HelperUnsupportedError(
            f"helper v0.10.x: parameter device '{device_type}' is not supported. "
            f"v0.10 ships CPU-first; CUDA/MPS/XLA device-tolerance is v0.11+. "
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
            raise HelperError("helper v0.10.x: extracted NaN — backprop-trace receipts forbid NaN.")
        if value in (float("inf"), float("-inf")):
            raise HelperError("helper v0.10.x: extracted Infinity — backprop-trace receipts forbid Infinity.")
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
    momentum_buffer sign-flip pin for v0.10.1.
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
    ) -> None:
        if not _TORCH_AVAILABLE:  # pragma: no cover
            raise HelperError(
                "helper v0.10.x: torch is not installed. Install PyTorch (https://pytorch.org) "
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
        # Resolve out destination
        self._out_owns_handle = False
        if out is None:
            self._out: TextIO = sys.stdout
        elif isinstance(out, (str, Path)):
            self._out = open(str(out), "a", encoding="utf-8")
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
                "helper v0.10.x: torch.is_grad_enabled() is False on entry to dumper.step(). "
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

        # Resolve inputs/targets — required from the caller in v0.10
        if inputs_override is None or targets_override is None:
            raise HelperError(
                "helper v0.10.x: dumper.step(inputs={...}, targets={...}) requires "
                "both inputs and targets to be passed explicitly. Inference from "
                "torch.autograd graph is fragile; the explicit-pass convention "
                "makes the receipt's named-factors provenance unambiguous."
            )

        # Build optimizer block (None for vanilla SGD)
        optimizer_block = _build_optimizer_block(self._optimizer, self._family, self._step_counter)

        # Compute gradient + forward from cached run by re-doing the math
        # the user just ran. v0.10 does NOT capture mid-step; it captures
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

        sidecar = {
            "format": SCHEMA_FORMAT,
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
        flag this as a v0.10 limitation that requires the user to capture
        gradients explicitly. The simpler solution for v0.10 is: re-run
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

        # Reconstruct weights
        W_ih = torch.zeros(len(h_units), len(i_units), dtype=torch.float64, requires_grad=True)
        b_h = torch.full((len(h_units),), params_before["b_h"], dtype=torch.float64, requires_grad=True)
        W_ho = torch.zeros(len(o_units), len(h_units), dtype=torch.float64, requires_grad=True)
        b_o = torch.full((len(o_units),), params_before["b_o"], dtype=torch.float64, requires_grad=True)

        with torch.no_grad():
            for h_out in range(len(h_units)):
                for i_in in range(len(i_units)):
                    W_ih[h_out, i_in] = params_before[f"w_i{i_in + 1}_h{h_out + 1}"]
            for o_out in range(len(o_units)):
                for h_in in range(len(h_units)):
                    W_ho[o_out, h_in] = params_before[f"w_h{h_in + 1}_o{o_out + 1}"]

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
            raise HelperUnsupportedError(f"helper v0.10.x: loss {topo['loss']!r} unsupported")

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

        # Backward: output_error_signals (dL/dnet_o) + hidden_error_signals (dL/dnet_h)
        # PyTorch doesn't expose dL/dnet_o directly; we compute from the closed forms:
        # For half_squared_error + sigmoid: signal_o = (out_o - y) * sigmoid'(net_o) = (out_o - y) * out_o * (1 - out_o)
        # For half_squared_error + identity/relu: signal_o = (out_o - y) [* derivative]
        # For cross_entropy_softmax: signal_o = (out_o - y) directly
        output_error_signals = {}
        for o_idx, u in enumerate(o_units):
            t_val = targets[u]
            o_val = out_o_vals[o_idx]
            if topo["loss"] == "cross_entropy_softmax":
                signal_val = o_val - t_val
                factors = [
                    {"name": "out_minus_target", "value": signal_val},
                ]
            elif topo["activation_output"] == "sigmoid":
                deriv = o_val * (1.0 - o_val)
                signal_val = (o_val - t_val) * deriv
                factors = [
                    {"name": "out_minus_target", "value": o_val - t_val},
                    {"name": "sigmoid_derivative", "value": deriv},
                ]
            else:
                signal_val = o_val - t_val
                factors = [{"name": "out_minus_target", "value": signal_val}]
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
                act_deriv = 1.0 if net_h_vals[h_idx] > 0 else 0.0
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
        updates_dict = []
        for pid in topo["parameter_order"]:
            wb = params_before[pid]
            wa = params_after[pid]
            grad = self._derive_gradient_for_param(
                pid, topo, params_before, inputs, output_error_signals, hidden_error_signals
            )
            update_val = wa - wb
            update_entry: dict[str, Any] = {
                "parameter_id": pid,
                "kind": "bias" if pid.startswith("b_") else "weight",
                "weight_before": wb,
                "optimizer": {
                    "name": self._family,
                    "learning_rate": lr,
                    "factors": [
                        {"name": "learning_rate", "value": lr},
                        {"name": "gradient", "value": grad},
                    ],
                    "product_order": "left_to_right",
                },
                "gradient": grad,
                "update": update_val,
                "weight_after": wa,
            }
            # Add layer_edge / from_unit / to_unit / parameter_role from topology
            meta_param = next(p for p in topo["parameters"] if p["id"] == pid)
            update_entry["parameter_role"] = meta_param["role"]
            if "from_unit" in meta_param:
                update_entry["from_unit"] = meta_param["from_unit"]
            if "to_unit" in meta_param:
                update_entry["to_unit"] = meta_param["to_unit"]
            if meta_param["role"] == "input_to_hidden_weight":
                update_entry["layer_edge"] = "input_to_hidden"
            elif meta_param["role"] == "hidden_to_output_weight":
                update_entry["layer_edge"] = "hidden_to_output"
            elif meta_param["role"] in ("hidden_bias", "output_bias"):
                update_entry["layer_edge"] = "bias_to_layer"
            # Optimizer-state pass-through (v0.10.1).
            #
            # state_before / state_after are now keyed by backprop-trace
            # parameter_id directly (refactored from the v0.10 tuple key
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
        - hidden bias: sum_h signal_h * 1.0
        - output bias: sum_o signal_o * 1.0
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
        if pid == "b_h":
            # Sum of hidden signals (bias contributes 1.0 to each net_h)
            return sum(sig["signal_value"] for sig in hidden_signals.values())
        if pid == "b_o":
            return sum(sig["signal_value"] for sig in output_signals.values())
        raise HelperError(f"helper v0.10.x: unknown parameter id {pid!r}")

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
            net = params_before["b_h"]
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
