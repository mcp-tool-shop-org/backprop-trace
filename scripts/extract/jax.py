"""
backprop-trace JAX live helper
==============================
(version tracked by the HELPER_VERSION constant below, in lockstep with the
@mcptoolshop/backprop-trace package version — not hardcoded in this docstring.)

MIT License — Copyright (c) 2026 mcp-tool-shop. See LICENSE in the
@mcptoolshop/backprop-trace package.

Single-file observer that extracts a `framework-trace.v0.7.0` sidecar from a
real JAX training step. Emits JSONL to stdout (default) or to `--out <file>`.
Pipe into `bp import jax -` and then `bp verify multi -` to verify the receipt.

This is the JAX sibling of `scripts/extract/pytorch.py`. It is a SINGLE
auditable file with NO pip package — copy it into your training repo, read it
(you can in 10 minutes), and run it. Same trust boundary, same forensic helper
block, same observer-not-verifier discipline. The JAX-specific contribution is
a STRONGER trust boundary: `jax.make_jaxpr(jax.grad(...))` captures the
gradient computation graph (the jaxpr) as an inspectable, auditable artifact
recorded in the forensic `helper` block. PyTorch eager has no equivalent — its
autograd graph is reconstructed implicitly at `.backward()` time and is not a
first-class inspectable object. (The jaxpr is FORENSIC, like the source_hash —
it does NOT bypass Rule 14; it makes post-hoc attribution richer.)

USAGE
-----
1. Copy this file into your training repo:

       bp examples jax --print > jax_trace_helper.py

   (Or `bp examples jax` to print the absolute path of the bundled file, then
   copy by hand.)

2. Build a small feed-forward net as flat parameter pytrees and wrap your
   training step:

       from jax_trace_helper import TraceDumper, sgd_step, adam_step

       dumper = TraceDumper(
           params, optimizer="sgd", learning_rate=0.5,
           topology_loss="half_squared_error", out="trace.jsonl",
       )
       for x, y in loader:
           with dumper.step(inputs=x, targets=y) as ctx:
               params = ctx.run(params)   # runs forward+grad+update internally

3. Verify:

       bp import jax trace.jsonl | bp verify multi -

DETERMINISM (LOAD-BEARING)
--------------------------
This helper requires:
  - CPU only (no GPU/TPU). GPU/TPU FP reductions are non-associative across
    kernels (arXiv:2408.05148) and would diverge from the engine's pinned
    scalar recompute. The helper rejects non-CPU devices at the extraction
    boundary (HelperUnsupportedError).
  - `jax.config.update("jax_enable_x64", True)` — JAX defaults to float32;
    the engine runs binary64. Without x64 the extracted scalars are float32
    and Rule 14 would surface tolerance disagreements. The helper REFUSES to
    run unless x64 is enabled (so a forgotten config flip fails loudly at the
    boundary rather than silently producing a float32 sidecar).
  - A pinned jax / jaxlib (see scripts/extract/requirements-jax-cpu.txt) so
    XLA's CPU codegen is byte-stable across re-runs (PIN_PER_STEP).

TRUST BOUNDARY (LOAD-BEARING)
-----------------------------
This helper is an OBSERVER. It is NEVER a verifier. It emits the
`framework-trace.v0.7.0` sidecar with extracted numerics and a FORENSIC
`helper` block (helper name, version, source_hash, framework=jax, jax version,
runtime, AND the gradient jaxpr digest — the stronger JAX-only trust signal).
The `source_hash` is computed by this file ON ITSELF — acceptable because the
hash is FORENSIC, not a credential. Rule 14 (engine-recompute differential) in
`bp import jax` is the authority on every helper-emitted sidecar regardless of
what this block claims. A spoofed / wrong / missing `source_hash` or jaxpr does
NOT bypass Rule 14; Rule 14 fires unconditionally on every receipt with
`authoring_state === "external_imported"`.

This helper:
- DOES NOT verify anything.
- DOES NOT claim Rule 14 will pass.
- DOES NOT sign anything.
- DOES NOT recompute the engine.
- DOES NOT emit receipts (only sidecars).
- DOES NOT touch fixture_status / authoring_state / verification_state.

Csmith/CompCert lineage: the oracle must not consult the artifact it judges.
Fang et al. 2023 PoL spoofing class: a producer with byte-control defeats
structural-only checks; the defense is independent recomputation.
backprop-trace's Rule 14 IS that independent recomputation.

SCOPE
-----
SUPPORTED:
- JAX SGD (vanilla, hand-rolled `p - lr*g` step).
- JAX Adam (optax-style m/v moments; descent-signed m at the boundary).
- nn topology: single-hidden-layer feed-forward (Linear → activation → Linear
  → output_activation), Mazur-shaped (i1/i2, h1/h2, o1/o2). PER-NEURON biases
  (b_h<k> / b_o<k>) — one bias scalar per output neuron, updated every step.
- CPU device, x64 (float64) only.
- half_squared_error loss; cross_entropy_softmax loss.
- Single-step and multi-step (call `with dumper.step():` per training step).
- 2-2-2 / 2-2-3 / 2-3-2 topologies.

NOT SUPPORTED (REJECTED at the extraction boundary — HelperUnsupportedError):
- GPU / TPU devices (CPU-first; FP non-associativity, arXiv:2408.05148).
- float32 (x64 disabled) — refuses to run without jax_enable_x64.
- vmap / pmap / scan batched extraction — the helper extracts SINGLE samples.
- AdamW / amsgrad / Nesterov / weight_decay — deferred (each gated on a
  receipt/reconciler extension; the hand-authored sidecar path supports many).
- Multi-hidden-layer / CNN / transformer topologies.

PARAMETER LAYOUT (the helper's pytree contract)
-----------------------------------------------
The helper takes params as a flat dict pytree with keys:
    {"W_ih": (hidden, input) array,
     "b_h":  (hidden,) array,
     "W_ho": (output, hidden) array,
     "b_o":  (output,) array}
This is the JAX-idiomatic flat-dict pytree — the user's own model state. The
helper flattens it to backprop-trace's per-edge / per-bias scalar parameter_ids
by the topology manifest, exactly mirroring pytorch.py's mapping of
nn.Linear.weight (out, in) tensors. W_ih[h_out, i_in] = w_i<in+1>_h<out+1>;
W_ho[o_out, h_in] = w_h<in+1>_o<out+1>; b_h[h_out] = b_h<out+1>;
b_o[o_out] = b_o<out+1>.

ADAM m SIGN FLIP (LOAD-BEARING)
-------------------------------
This helper's optax-style Adam accumulates the DESCENT gradient directly
(m = beta1*m + (1-beta1)*grad_descent), because the hand-rolled update subtracts
`lr*m_hat`. backprop-trace's AdamState.m is ALSO descent-signed (Rule 22a), so
the helper's internal m is already in the engine's convention and needs NO
flip. (Contrast pytorch.py, whose exp_avg accumulates the ASCENT gradient and
must be flipped.) The helper computes its OWN m/v from the descent gradient it
already extracted, so the sign is correct by construction; the documented
non-flip is the JAX-specific trust note.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import sys
import platform
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional, TextIO, Union

# Defer import so this file is import-checkable without jax installed
# (e.g. for `bp examples jax --print` on a Node-only CI machine).
try:
    import jax  # type: ignore
    import jax.numpy as jnp  # type: ignore

    _JAX_AVAILABLE = True
except ImportError:  # pragma: no cover
    _JAX_AVAILABLE = False
    jax = None  # type: ignore
    jnp = None  # type: ignore


HELPER_VERSION = "0.12.0"
HELPER_NAME = "backprop-trace-jax-helper"
SCHEMA_FORMAT = "framework-trace.v0.7.0"
DEFAULT_TOLERANCE_ATOL = 1e-6
DEFAULT_TOLERANCE_RTOL = 1e-4


# ---------------------------------------------------------------------------
# Helper trust-boundary errors
# ---------------------------------------------------------------------------


class HelperError(Exception):
    """Base for helper-detected extraction errors. Raised before sidecar
    emission so a partial / wrong sidecar never reaches Rule 14."""


class HelperUnsupportedError(HelperError):
    """User asked for a feature outside the current helper scope (GPU/TPU,
    float32, vmap/pmap, AdamW / amsgrad / Nesterov, multi-hidden-layer
    topologies). The hand-authored sidecar path remains available for many of
    these; only the LIVE HELPER refuses them."""


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
# Determinism / device guards
# ---------------------------------------------------------------------------


def _assert_x64_enabled() -> None:
    """The helper REQUIRES jax_enable_x64 — JAX defaults to float32, the engine
    runs binary64. A float32 sidecar would surface tolerance disagreements at
    Rule 14 for no reason other than a forgotten config flip. Fail loudly at the
    boundary instead of silently emitting float32 numerics."""
    if not _JAX_AVAILABLE:  # pragma: no cover
        return
    if not jax.config.read("jax_enable_x64"):
        raise HelperUnsupportedError(
            "helper: jax_enable_x64 is False. The JAX live helper requires "
            "float64 (binary64) so the extracted scalars are byte-stable against "
            "the engine's binary64 recompute. Enable it BEFORE building params:\n"
            "    import jax\n"
            "    jax.config.update('jax_enable_x64', True)\n"
            "(JAX defaults to float32; a float32 sidecar fails Rule 14 on FP drift "
            "alone. This is the determinism contract, not a soft preference.)"
        )


def _assert_cpu_only(arr: "jnp.ndarray") -> None:
    """The helper is CPU-first. GPU/TPU rejected — FP reductions are
    non-associative across kernels (arXiv:2408.05148) and would diverge from the
    engine's pinned scalar recompute."""
    # jax arrays expose .devices() (a set) in modern JAX; fall back to the
    # default backend platform if a bare ndarray slips through.
    try:
        devices = arr.devices()
        platforms = {d.platform for d in devices}
    except (AttributeError, TypeError):  # pragma: no cover
        platforms = {jax.default_backend()}
    non_cpu = platforms - {"cpu"}
    if non_cpu:
        raise HelperUnsupportedError(
            f"helper: parameter is on device platform(s) {sorted(non_cpu)}; the JAX "
            f"helper is CPU-first. GPU/TPU bit-determinism is permanently out of scope "
            f"(FP non-associativity across kernels, arXiv:2408.05148). Move params to "
            f"CPU for extraction:\n"
            f"    params = jax.device_put(params, jax.devices('cpu')[0])\n"
            f"Training can resume on accelerator after the snapshot."
        )


# ---------------------------------------------------------------------------
# Topology inference from a flat-dict pytree
# ---------------------------------------------------------------------------


def _infer_topology(params: dict[str, Any], *, loss: str) -> dict[str, Any]:
    """Infer a backprop-trace topology from the flat-dict pytree.

    Mirrors pytorch.py's _infer_topology: single-hidden-layer feed-forward,
    Mazur canonical naming (i1/i2, h1/h2, o1/o2), PER-NEURON biases. Shapes are
    read from the W_ih / W_ho arrays:
        W_ih shape (hidden, input);  W_ho shape (output, hidden).
    """
    required = ("W_ih", "b_h", "W_ho", "b_o")
    missing = [k for k in required if k not in params]
    if missing:
        raise HelperUnsupportedError(
            f"helper: params pytree is missing key(s) {missing}. The JAX helper expects a "
            f"flat dict with W_ih (hidden,input), b_h (hidden,), W_ho (output,hidden), "
            f"b_o (output,). Multi-hidden-layer / CNN / transformer topologies are not supported."
        )
    W_ih = params["W_ih"]
    W_ho = params["W_ho"]
    if W_ih.ndim != 2 or W_ho.ndim != 2:
        raise HelperUnsupportedError(
            "helper: W_ih and W_ho must be 2-D arrays (hidden,input) and (output,hidden)."
        )
    hidden_size, input_size = int(W_ih.shape[0]), int(W_ih.shape[1])
    output_size, ho_hidden = int(W_ho.shape[0]), int(W_ho.shape[1])
    if ho_hidden != hidden_size:
        raise HelperUnsupportedError(
            f"helper: W_ho in-features ({ho_hidden}) != W_ih out-features ({hidden_size}). "
            f"Topology mismatch."
        )
    b_h, b_o = params["b_h"], params["b_o"]
    if int(b_h.shape[0]) != hidden_size or int(b_o.shape[0]) != output_size:
        raise HelperUnsupportedError(
            "helper: bias shapes must match (b_h length == hidden_size, b_o length == output_size)."
        )

    # Determine activations from the loss declaration (the helper's forward is
    # the fixed Mazur shape: sigmoid hidden; sigmoid or softmax output). The
    # user declares the loss; we cross-check it against the implied output act.
    activation_hidden = "sigmoid"
    if loss == "cross_entropy_softmax":
        activation_output = "softmax"
    elif loss == "half_squared_error":
        activation_output = "sigmoid"
    else:
        raise HelperUnsupportedError(
            f"helper: loss {loss!r} unsupported. Use 'half_squared_error' (sigmoid output) "
            f"or 'cross_entropy_softmax' (softmax output)."
        )

    input_units = [f"i{i + 1}" for i in range(input_size)]
    hidden_units = [f"h{i + 1}" for i in range(hidden_size)]
    output_units = [f"o{i + 1}" for i in range(output_size)]

    parameters: list[dict[str, Any]] = []
    parameter_order: list[str] = []
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
    # PER-NEURON hidden biases (b_h1, b_h2, …) — mirrors pytorch.py G-015.
    for h_out in range(hidden_size):
        bid = f"b_h{h_out + 1}"
        parameters.append(
            {"id": bid, "role": "hidden_bias", "applies_to_units": [hidden_units[h_out]]}
        )
        parameter_order.append(bid)
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
    for o_out in range(output_size):
        bid = f"b_o{o_out + 1}"
        parameters.append(
            {"id": bid, "role": "output_bias", "applies_to_units": [output_units[o_out]]}
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
# Parameter snapshot (pytree → backprop-trace scalar map)
# ---------------------------------------------------------------------------


def _snapshot_parameters(params: dict[str, Any], topology: dict[str, Any]) -> dict[str, float]:
    """Flatten the pytree to backprop-trace's per-edge / per-bias scalars.

    W_ih shape (hidden, input):  W_ih[h_out, i_in] = w_i<in+1>_h<out+1>
    W_ho shape (output, hidden): W_ho[o_out, h_in] = w_h<in+1>_o<out+1>
    b_h[h_out] = b_h<out+1> ; b_o[o_out] = b_o<out+1> (PER-NEURON).

    All values float64-coerced (x64 already enforced upstream).
    """
    hidden_size = topology["hidden_size"]
    input_size = topology["input_size"]
    output_size = topology["output_size"]
    W_ih = [float(v) for v in __import__("numpy").asarray(params["W_ih"], dtype="float64").flatten()]
    W_ho = [float(v) for v in __import__("numpy").asarray(params["W_ho"], dtype="float64").flatten()]
    b_h = [float(v) for v in __import__("numpy").asarray(params["b_h"], dtype="float64").flatten()]
    b_o = [float(v) for v in __import__("numpy").asarray(params["b_o"], dtype="float64").flatten()]
    snap: dict[str, float] = {}
    for h_out in range(hidden_size):
        for i_in in range(input_size):
            snap[f"w_i{i_in + 1}_h{h_out + 1}"] = W_ih[h_out * input_size + i_in]
    for h_out in range(hidden_size):
        snap[f"b_h{h_out + 1}"] = b_h[h_out]
    for o_out in range(output_size):
        for h_in in range(hidden_size):
            snap[f"w_h{h_in + 1}_o{o_out + 1}"] = W_ho[o_out * hidden_size + h_in]
    for o_out in range(output_size):
        snap[f"b_o{o_out + 1}"] = b_o[o_out]
    return snap


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
# Forward / loss as a pure JAX function (so jax.grad + jax.make_jaxpr apply)
# ---------------------------------------------------------------------------


def _forward_full(params: dict[str, Any], x: "jnp.ndarray", topo: dict[str, Any]) -> dict[str, Any]:
    """Pure forward pass returning intermediates (net_h, out_h, net_o, out_o).
    Used both for observable extraction and as the body grad differentiates."""
    net_h = params["W_ih"] @ x + params["b_h"]
    if topo["activation_hidden"] == "sigmoid":
        out_h = jax.nn.sigmoid(net_h)
    elif topo["activation_hidden"] == "relu":
        out_h = jax.nn.relu(net_h)
    else:
        out_h = net_h
    net_o = params["W_ho"] @ out_h + params["b_o"]
    if topo["activation_output"] == "sigmoid":
        out_o = jax.nn.sigmoid(net_o)
    elif topo["activation_output"] == "softmax":
        out_o = jax.nn.softmax(net_o)
    elif topo["activation_output"] == "relu":
        out_o = jax.nn.relu(net_o)
    else:
        out_o = net_o
    return {"net_h": net_h, "out_h": out_h, "net_o": net_o, "out_o": out_o}


def _loss_value(params: dict[str, Any], x: "jnp.ndarray", y: "jnp.ndarray", topo: dict[str, Any]) -> "jnp.ndarray":
    """Pure scalar loss — the function jax.grad differentiates."""
    fwd = _forward_full(params, x, topo)
    out_o = fwd["out_o"]
    if topo["loss"] == "half_squared_error":
        return jnp.sum(0.5 * (out_o - y) ** 2)
    if topo["loss"] == "cross_entropy_softmax":
        eps = 1e-30  # log-stability epsilon; tolerance-bounded
        return jnp.sum(-y * jnp.log(out_o + eps))
    raise HelperUnsupportedError(f"helper: loss {topo['loss']!r} unsupported")  # pragma: no cover


# ---------------------------------------------------------------------------
# Helper block (forensic, not credential) — carries the gradient jaxpr digest
# ---------------------------------------------------------------------------


def _build_helper_block(jaxpr_digest: Optional[str]) -> dict[str, Any]:
    """Build the forensic `helper` block. NEVER a credential — Rule 14 is the
    authority. The JAX-specific richness is `jaxpr_sha256` embedded in
    source_uri-adjacent forensic note: we record it in the deterministic_mode
    seed-free runtime block via the documented schema fields only (no
    additionalProperties), so it rides as a forensic comment in source_uri.

    The schema's `helper` block is additionalProperties:false, so we CANNOT add a
    free `jaxpr` field. Instead the jaxpr digest is folded into `source_uri` as a
    `#jaxpr=<sha256>` fragment — informational, forensic, and schema-legal. This
    keeps the stronger-trust-boundary signal auditable from the sidecar bytes
    without a schema change (the schema family is coordinator-owned; the helper
    stays within v0.7.0)."""
    jax_version = jax.__version__ if _JAX_AVAILABLE else "unknown"
    source_uri = "file://scripts/extract/jax.py"
    if jaxpr_digest is not None:
        # Forensic: the gradient-jaxpr digest. Auditable from sidecar bytes;
        # NOT consulted by Rule 14. Documents the exact gradient graph XLA
        # lowered for this step.
        source_uri = f"{source_uri}#jaxpr_sha256={jaxpr_digest}"
    return {
        "name": HELPER_NAME,
        "version": HELPER_VERSION,
        "distribution": "repo-script",
        "source_hash": _compute_self_source_hash(),
        "source_uri": source_uri,
        "framework": {
            "name": "jax",
            "version": jax_version,
        },
        "runtime": {
            "python_version": platform.python_version(),
        },
        "extraction": {
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "device": "cpu",
        },
    }


# ---------------------------------------------------------------------------
# Public API — TraceDumper context manager
# ---------------------------------------------------------------------------


class _StepContext:
    """Yielded by TraceDumper.step(). Call ctx.run(params) inside the with-block
    to run forward+grad+update; returns the new params. The dumper captures
    pre/post state around it and emits one sidecar line on context exit."""

    def __init__(self, dumper: "TraceDumper", inputs: dict[str, float], targets: dict[str, float]) -> None:
        self._dumper = dumper
        self._inputs = inputs
        self._targets = targets
        self._params_after: Optional[dict[str, Any]] = None

    def run(self, params: dict[str, Any]) -> dict[str, Any]:
        new_params = self._dumper._apply_step(params, self._inputs, self._targets)
        self._params_after = new_params
        return new_params


class TraceDumper:
    """Per-training-loop helper. Construct once; use `with dumper.step():`
    around the per-step body to emit one sidecar per training step.

    Unlike pytorch.py (which wraps the user's own optimizer.step()), this helper
    OWNS the step math (sgd/adam) so it can compute the descent gradient via
    jax.grad and capture the jaxpr. The user supplies params + inputs + targets;
    ctx.run(params) does forward+grad+update and returns the new params.

    See module docstring for the trust-boundary statement, scope, determinism
    contract, and the Adam-m non-flip note.
    """

    def __init__(
        self,
        params: dict[str, Any],
        *,
        optimizer: str = "sgd",
        learning_rate: float,
        out: Union[str, Path, TextIO, None] = None,
        trace_id: Optional[str] = None,
        topology_loss: str = "half_squared_error",
        beta1: float = 0.9,
        beta2: float = 0.999,
        epsilon: float = 1e-8,
        append: bool = False,
    ) -> None:
        if not _JAX_AVAILABLE:  # pragma: no cover
            raise HelperError(
                "helper: jax is not installed. Install CPU jax + jaxlib "
                "(scripts/extract/requirements-jax-cpu.txt) or use the hand-authored "
                "sidecar path via the framework-trace schema."
            )
        _assert_x64_enabled()
        if optimizer not in ("sgd", "adam"):
            raise HelperUnsupportedError(
                f"helper: optimizer {optimizer!r} not supported. The JAX live helper "
                f"supports 'sgd' and 'adam'. AdamW / sgd_momentum / Nesterov / amsgrad / "
                f"weight_decay are deferred (hand-authored sidecar path remains available)."
            )
        for v in params.values():
            _assert_cpu_only(v)
        self._family = optimizer
        self._learning_rate = float(learning_rate)
        self._topology = _infer_topology(params, loss=topology_loss)
        self._beta1, self._beta2, self._epsilon = float(beta1), float(beta2), float(epsilon)
        self._trace_id_default = trace_id
        self._step_counter = 0
        # Adam moment state per backprop-trace parameter_id (descent-signed m).
        self._adam_m: dict[str, float] = {}
        self._adam_v: dict[str, float] = {}
        # Capture the gradient jaxpr ONCE (graph shape is step-invariant) for the
        # forensic helper block — the JAX-only stronger trust boundary.
        self._jaxpr_digest = self._capture_jaxpr_digest(params)
        # Resolve out destination (truncate by default; see pytorch.py G-058).
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
                            f"{out!r}; existing bytes preserved, new trace concatenated.",
                            file=sys.stderr,
                        )
                except OSError:  # pragma: no cover
                    pass
            self._out = open(str(out), mode, encoding="utf-8")
            self._out_owns_handle = True
        else:
            self._out = out

    def _capture_jaxpr_digest(self, params: dict[str, Any]) -> Optional[str]:
        """Capture jax.make_jaxpr(jax.grad(loss))(...) as a SHA-256 digest of the
        jaxpr's string form. This is the JAX-only stronger trust boundary: the
        gradient computation graph is a first-class inspectable artifact (PyTorch
        eager has no equivalent). FORENSIC — recorded in the helper block; Rule 14
        does NOT consult it. Best-effort: if jaxpr capture fails for any reason,
        the digest is None and the sidecar still emits (the digest is a richness
        signal, not a gate)."""
        try:
            topo = self._topology
            x = jnp.zeros((topo["input_size"],), dtype=jnp.float64)
            y = jnp.zeros((topo["output_size"],), dtype=jnp.float64)
            grad_fn = jax.grad(lambda p: _loss_value(p, x, y, topo))
            jaxpr = jax.make_jaxpr(grad_fn)(params)
            text = str(jaxpr)
            return hashlib.sha256(text.encode("utf-8")).hexdigest()
        except Exception:  # pragma: no cover - forensic best-effort
            return None

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
        inputs: dict[str, float],
        targets: dict[str, float],
        trace_id: Optional[str] = None,
    ) -> Any:
        """Context manager wrapping ONE training step. Yields a _StepContext;
        call ctx.run(params) inside to do forward+grad+update. Captures pre-state
        before yielding, post-state after, emits one sidecar JSONL line.

        `inputs` / `targets` keys MUST match topology.unit_order.input /
        .output naming (i1, i2, … / o1, o2, …)."""
        i_units = self._topology["unit_order"]["input"]
        o_units = self._topology["unit_order"]["output"]
        missing_in = [u for u in i_units if u not in inputs]
        missing_out = [u for u in o_units if u not in targets]
        if missing_in or missing_out:
            raise HelperError(
                f"helper: dumper.step(inputs, targets) missing keys "
                f"(inputs missing {missing_in}, targets missing {missing_out}). "
                f"Keys must match topology.unit_order (inputs: {i_units}, targets: {o_units})."
            )
        ctx = _StepContext(self, inputs, targets)
        self._pending_ctx = ctx
        self._pending_trace_id = trace_id
        try:
            yield ctx
        finally:
            if ctx._params_after is None:
                raise HelperError(
                    "helper: dumper.step() block must call ctx.run(params). "
                    "The helper owns the step math (forward+grad+update) so it can "
                    "compute the descent gradient via jax.grad. Call new_params = ctx.run(params)."
                )

    def _apply_step(
        self, params: dict[str, Any], inputs: dict[str, float], targets: dict[str, float]
    ) -> dict[str, Any]:
        """Run forward + jax.grad + optimizer update; emit the sidecar; return
        new params. The descent gradient comes from jax.grad of the BASE loss —
        the engine's named-factor decomposition is mirrored from the same
        forward intermediates so Rule 4 holds on the helper's honest receipt."""
        topo = self._topology
        i_units = topo["unit_order"]["input"]
        h_units = topo["unit_order"]["hidden"]
        o_units = topo["unit_order"]["output"]

        x = jnp.array([inputs[u] for u in i_units], dtype=jnp.float64)
        y = jnp.array([targets[u] for u in o_units], dtype=jnp.float64)

        params_before = _snapshot_parameters(params, topo)

        # Forward intermediates (for observables).
        fwd = _forward_full(params, x, topo)
        import numpy as _np

        net_h_vals = [float(v) for v in _np.asarray(fwd["net_h"], dtype="float64")]
        out_h_vals = [float(v) for v in _np.asarray(fwd["out_h"], dtype="float64")]
        net_o_vals = [float(v) for v in _np.asarray(fwd["net_o"], dtype="float64")]
        out_o_vals = [float(v) for v in _np.asarray(fwd["out_o"], dtype="float64")]

        # === jax.grad of the BASE loss (DESCENT gradient is -dL/dp). ===
        # jax.grad returns dL/dp (ascent). The engine's gradient is DESCENT-signed
        # (update = lr*gradient, weight_after = weight_before + update). We negate
        # to descent at the boundary. This is the JAX analogue of pytorch.py's
        # output-signal sign convention.
        raw_grad = jax.grad(lambda p: _loss_value(p, x, y, topo))(params)
        grad_W_ih = -_np.asarray(raw_grad["W_ih"], dtype="float64")
        grad_b_h = -_np.asarray(raw_grad["b_h"], dtype="float64")
        grad_W_ho = -_np.asarray(raw_grad["W_ho"], dtype="float64")
        grad_b_o = -_np.asarray(raw_grad["b_o"], dtype="float64")

        # Map descent gradients to backprop-trace parameter_ids.
        grad_by_pid: dict[str, float] = {}
        hidden_size, input_size, output_size = topo["hidden_size"], topo["input_size"], topo["output_size"]
        for h_out in range(hidden_size):
            for i_in in range(input_size):
                grad_by_pid[f"w_i{i_in + 1}_h{h_out + 1}"] = float(grad_W_ih[h_out, i_in])
        for h_out in range(hidden_size):
            grad_by_pid[f"b_h{h_out + 1}"] = float(grad_b_h[h_out])
        for o_out in range(output_size):
            for h_in in range(hidden_size):
                grad_by_pid[f"w_h{h_in + 1}_o{o_out + 1}"] = float(grad_W_ho[o_out, h_in])
        for o_out in range(output_size):
            grad_by_pid[f"b_o{o_out + 1}"] = float(grad_b_o[o_out])

        # === Optimizer update + per-parameter state (descent-signed). ===
        lr = self._learning_rate
        state_before: dict[str, dict[str, Any]] = {}
        state_after: dict[str, dict[str, Any]] = {}
        update_by_pid: dict[str, float] = {}
        if self._family == "sgd":
            for pid, g in grad_by_pid.items():
                update_by_pid[pid] = lr * g
        elif self._family == "adam":
            t = self._step_counter + 1
            for pid, g in grad_by_pid.items():
                m_prev = self._adam_m.get(pid, 0.0)
                v_prev = self._adam_v.get(pid, 0.0)
                state_before[pid] = {"m": m_prev, "v": v_prev}
                # optax-style: m/v accumulate the DESCENT gradient directly, so m
                # is already descent-signed (Rule 22a) — NO flip (see docstring).
                m_t = self._beta1 * m_prev + (1.0 - self._beta1) * g
                v_t = self._beta2 * v_prev + (1.0 - self._beta2) * (g * g)
                m_hat = m_t / (1.0 - self._beta1 ** t)
                v_hat = v_t / (1.0 - self._beta2 ** t)
                update_by_pid[pid] = lr * m_hat / (v_hat ** 0.5 + self._epsilon)
                state_after[pid] = {"m": m_t, "v": v_t}
                self._adam_m[pid] = m_t
                self._adam_v[pid] = v_t

        # Apply the update to the pytree (weight_after = weight_before + update).
        new_W_ih = _np.array(_np.asarray(params["W_ih"], dtype="float64"))
        new_b_h = _np.array(_np.asarray(params["b_h"], dtype="float64"))
        new_W_ho = _np.array(_np.asarray(params["W_ho"], dtype="float64"))
        new_b_o = _np.array(_np.asarray(params["b_o"], dtype="float64"))
        for h_out in range(hidden_size):
            for i_in in range(input_size):
                new_W_ih[h_out, i_in] += update_by_pid[f"w_i{i_in + 1}_h{h_out + 1}"]
            new_b_h[h_out] += update_by_pid[f"b_h{h_out + 1}"]
        for o_out in range(output_size):
            for h_in in range(hidden_size):
                new_W_ho[o_out, h_in] += update_by_pid[f"w_h{h_in + 1}_o{o_out + 1}"]
            new_b_o[o_out] += update_by_pid[f"b_o{o_out + 1}"]
        new_params = {
            "W_ih": jnp.array(new_W_ih, dtype=jnp.float64),
            "b_h": jnp.array(new_b_h, dtype=jnp.float64),
            "W_ho": jnp.array(new_W_ho, dtype=jnp.float64),
            "b_o": jnp.array(new_b_o, dtype=jnp.float64),
        }
        params_after = _snapshot_parameters(new_params, topo)

        # === Build the sidecar observables (forward / loss / backward / updates). ===
        forward_dict, loss_dict, backward_dict = self._build_forward_loss_backward(
            topo, params_before, inputs, targets,
            net_h_vals, out_h_vals, net_o_vals, out_o_vals,
        )
        updates_dict = self._build_updates(
            topo, params_before, params_after, inputs,
            backward_dict, grad_by_pid, update_by_pid, state_before, state_after,
        )

        optimizer_block = self._build_optimizer_block()

        sidecar: dict[str, Any] = {
            "format": SCHEMA_FORMAT,
            "source_framework": {
                "name": "jax",
                "version": jax.__version__,
                "extractor": {"name": HELPER_NAME, "version": HELPER_VERSION},
            },
            "helper": _build_helper_block(self._jaxpr_digest),
            "topology": topo,
            "learning_rate": self._learning_rate,
            "inputs": dict(inputs),
            "targets": dict(targets),
            "parameters_before": params_before,
            "forward": forward_dict,
            "loss": loss_dict,
            "backward": backward_dict,
            "updates": updates_dict,
            "parameters_after": params_after,
        }
        if optimizer_block is not None:
            sidecar["optimizer"] = optimizer_block

        trace_id = self._pending_trace_id or self._trace_id_default
        if trace_id is not None:
            sidecar["trace_id"] = trace_id
            sidecar["step_index"] = self._step_counter

        line = json.dumps(_normalize_for_json(sidecar), separators=(",", ":"), allow_nan=False)
        self._out.write(line + "\n")
        self._out.flush()
        self._step_counter += 1
        return new_params

    def _build_optimizer_block(self) -> Optional[dict[str, Any]]:
        """Top-level optimizer block. None for plain SGD (byte-equal with v0.7.0
        SGD sidecars). Full hyperparameter block for adam."""
        if self._family == "sgd":
            return None
        if self._family == "adam":
            return {
                "name": "adam",
                "learning_rate": self._learning_rate,
                "beta1": self._beta1,
                "beta2": self._beta2,
                "epsilon": self._epsilon,
                "t": self._step_counter + 1,
            }
        raise HelperUnsupportedError(f"helper: optimizer family {self._family!r} unsupported")  # pragma: no cover

    def _build_forward_loss_backward(
        self,
        topo: dict[str, Any],
        params_before: dict[str, float],
        inputs: dict[str, float],
        targets: dict[str, float],
        net_h_vals: list[float],
        out_h_vals: list[float],
        net_o_vals: list[float],
        out_o_vals: list[float],
    ) -> tuple[dict, dict, dict]:
        """Build forward + loss + backward dicts, mirroring general-engine.ts /
        pytorch.py named-factor decomposition + descent sign convention exactly so
        Rule 4 / Rule 8 hold on the helper's honest receipt."""
        h_units = topo["unit_order"]["hidden"]
        o_units = topo["unit_order"]["output"]

        forward_dict: dict[str, dict[str, float]] = {}
        for idx, u in enumerate(h_units):
            forward_dict[u] = {"net": net_h_vals[idx], "out": out_h_vals[idx]}
        for idx, u in enumerate(o_units):
            forward_dict[u] = {"net": net_o_vals[idx], "out": out_o_vals[idx]}

        # Loss per output.
        if topo["loss"] == "half_squared_error":
            per_output = {o_units[i]: 0.5 * (out_o_vals[i] - targets[o_units[i]]) ** 2 for i in range(len(o_units))}
        else:  # cross_entropy_softmax
            from math import log

            eps = 1e-30
            per_output = {
                o_units[i]: -targets[o_units[i]] * log(out_o_vals[i] + eps) for i in range(len(o_units))
            }
        loss_dict = {"per_output": per_output, "total": sum(per_output.values())}

        # Output error signals (DESCENT — mirrors pytorch.py exactly).
        output_error_signals: dict[str, Any] = {}
        for o_idx, u in enumerate(o_units):
            t_val = targets[u]
            o_val = out_o_vals[o_idx]
            if topo["loss"] == "cross_entropy_softmax":
                signal_val = t_val - o_val
                factors = [{"name": "target_minus_probability", "value": signal_val}]
            elif topo["activation_output"] == "sigmoid":
                tmo = t_val - o_val
                deriv = o_val * (1.0 - o_val)
                signal_val = tmo * deriv
                factors = [
                    {"name": "target_minus_output", "value": tmo},
                    {"name": "activation_derivative", "value": deriv},
                ]
            elif topo["activation_output"] == "relu":
                tmo = t_val - o_val
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

        # Hidden error signals.
        hidden_error_signals: dict[str, Any] = {}
        for h_idx, hu in enumerate(h_units):
            contributions = []
            backprop_sum = 0.0
            for o_idx, ou in enumerate(o_units):
                downstream = output_error_signals[ou]["signal_value"]
                w_val = params_before[f"w_h{h_idx + 1}_o{o_idx + 1}"]
                contrib = downstream * w_val
                contributions.append(
                    {
                        "from": ou,
                        "downstream_signal": downstream,
                        "via_weight": f"w_h{h_idx + 1}_o{o_idx + 1}",
                        "weight_value": w_val,
                        "value": contrib,
                    }
                )
                backprop_sum += contrib
            out_h_val = out_h_vals[h_idx]
            if topo["activation_hidden"] == "sigmoid":
                act_deriv = out_h_val * (1.0 - out_h_val)
            elif topo["activation_hidden"] == "relu":
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
        return forward_dict, loss_dict, backward_dict

    def _build_updates(
        self,
        topo: dict[str, Any],
        params_before: dict[str, float],
        params_after: dict[str, float],
        inputs: dict[str, float],
        backward_dict: dict[str, Any],
        grad_by_pid: dict[str, float],
        update_by_pid: dict[str, float],
        state_before: dict[str, dict[str, Any]],
        state_after: dict[str, dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Build the updates[] array, mirroring general-engine.ts / pytorch.py
        named-factor decomposition + bias-update emission policy exactly."""
        output_signals = backward_dict["output_error_signals"]
        hidden_signals = backward_dict["hidden_error_signals"]
        h_cache = self._cache_forward(topo, params_before, inputs)
        lr = self._learning_rate

        bias_ids = [
            p["id"] for p in topo["parameters"] if p["role"] in ("hidden_bias", "output_bias")
        ]
        any_bias_changed = any(params_after[bid] != params_before[bid] for bid in bias_ids)

        updates_dict: list[dict[str, Any]] = []
        for pid in topo["parameter_order"]:
            wb = params_before[pid]
            wa = params_after[pid]
            meta_param = next(p for p in topo["parameters"] if p["id"] == pid)
            role = meta_param["role"]
            if role in ("hidden_bias", "output_bias") and not any_bias_changed:
                continue
            grad = grad_by_pid[pid]
            update_val = update_by_pid[pid]
            factors = self._build_optimizer_factors(pid, role, inputs, output_signals, hidden_signals, h_cache)
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
            update_entry["parameter_role"] = (
                f'{meta_param["from_unit"]}_to_{meta_param["to_unit"]}'
                if role in ("input_to_hidden_weight", "hidden_to_output_weight")
                else role
            )
            if role in ("hidden_bias", "output_bias"):
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
            if self._family == "adam":
                if pid in state_before:
                    update_entry["optimizer"]["state_before"] = state_before[pid]
                if pid in state_after:
                    update_entry["optimizer"]["state_after"] = state_after[pid]
            updates_dict.append(update_entry)
        return updates_dict

    def _build_optimizer_factors(
        self,
        pid: str,
        role: str,
        inputs: dict[str, float],
        output_signals: dict[str, dict[str, Any]],
        hidden_signals: dict[str, dict[str, Any]],
        h_cache: dict[str, dict[str, float]],
    ) -> list[dict[str, Any]]:
        """Named-factor decomposition mirroring general-engine.ts / pytorch.py
        EXACTLY so Rule 4 (gradient == product(factors)) holds."""
        if role == "input_to_hidden_weight":
            parts = pid[2:].split("_")
            i_part, h_part = parts[0], parts[1]
            return [
                {
                    "name": "hidden_error_signal",
                    "from": f"backward.hidden_error_signals.{h_part}.signal_value",
                    "value": hidden_signals[h_part]["signal_value"],
                },
                {"name": "upstream_activation", "from": f"inputs.{i_part}", "value": inputs[i_part]},
            ]
        if role == "hidden_to_output_weight":
            parts = pid[2:].split("_")
            h_part, o_part = parts[0], parts[1]
            return [
                {
                    "name": "output_error_signal",
                    "from": f"backward.output_error_signals.{o_part}.signal_value",
                    "value": output_signals[o_part]["signal_value"],
                },
                {"name": "upstream_activation", "from": f"forward.{h_part}.out", "value": h_cache[h_part]["out"]},
            ]
        if role == "hidden_bias":
            h_part = pid[2:]
            return [
                {
                    "name": "hidden_error_signal",
                    "from": f"backward.hidden_error_signals.{h_part}.signal_value",
                    "value": hidden_signals[h_part]["signal_value"],
                }
            ]
        if role == "output_bias":
            o_part = pid[2:]
            return [
                {
                    "name": "output_error_signal",
                    "from": f"backward.output_error_signals.{o_part}.signal_value",
                    "value": output_signals[o_part]["signal_value"],
                }
            ]
        raise HelperError(f"helper: unknown parameter role {role!r} for {pid!r}")  # pragma: no cover

    def _cache_forward(
        self, topo: dict[str, Any], params_before: dict[str, float], inputs: dict[str, float]
    ) -> dict[str, dict[str, float]]:
        """Compute h-layer forward values (for the upstream_activation factor).
        Small enough to recompute scalar-side; mirrors pytorch.py."""
        from math import exp

        h_units = topo["unit_order"]["hidden"]
        i_units = topo["unit_order"]["input"]
        out: dict[str, dict[str, float]] = {}
        for h_idx, hu in enumerate(h_units):
            net = params_before[f"b_h{h_idx + 1}"]
            for i_idx, iu in enumerate(i_units):
                net += params_before[f"w_i{i_idx + 1}_h{h_idx + 1}"] * inputs[iu]
            if topo["activation_hidden"] == "sigmoid":
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


def _cli() -> int:  # pragma: no cover - tested via bp examples jax
    """Minimal CLI for `python jax_trace_helper.py --print-hash` etc. Primary
    surface is the library API (TraceDumper)."""
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
