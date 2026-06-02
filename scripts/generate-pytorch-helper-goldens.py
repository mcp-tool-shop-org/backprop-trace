#!/usr/bin/env python3
"""Generate the GOOD helper-emitted golden sidecars from REAL PyTorch.

These goldens are the canonical "what the live helper at scripts/extract/
pytorch.py actually emits" for a bias=True model under each supported
optimizer. They are the INPUT that scripts/build-pytorch-helper-fixtures.mjs
mutates to derive the adversarial bad-helper fixtures, and they are read by
test/import-pytorch-helper.test.ts.

WHY A TORCH GENERATOR (G-035 / G-017):
  Earlier the goldens were DERIVED in Node from hand-authored per_layer
  sidecars (w_x*/b_hidden/b_output, constant biases). That made the helper's
  REAL emission contract — per-neuron biases (b_h<k>/b_o<k>), the descent-sign
  output signal, the [error_signal, upstream] factor decomposition, the Adam m
  sign flip, the AdamW decoupled-update semantics — completely untested. These
  goldens come straight from the live helper run through real torch, so the
  fixtures now exercise the genuine path.

DETERMINISM:
  Weights are pinned (copy_/fill_) and the helper's volatile forensic fields
  (helper block, source_framework.version, wall-clock timestamp, running
  torch.__version__, real source_hash) are OVERWRITTEN with the pinned
  FIXTURE_* constants AFTER emission. The numeric body is a pure function of
  the pinned weights + inputs + optimizer, so re-running on any torch build
  reproduces byte-identical files (the formatter coerces to float64). CI runs
  this only in the torch-gated job; the Node fixture build consumes the
  checked-in output and never needs torch.

USAGE:
  python scripts/generate-pytorch-helper-goldens.py
  (writes fixtures/external/pytorch.helper-emitted.{sgd.softmax-ce,adamw,
   sgd-momentum}.sidecar.jsonl, then run
   `node scripts/build-pytorch-helper-fixtures.mjs` to refresh the bad plate.)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
FIXTURES_EXT = REPO_ROOT / "fixtures" / "external"
sys.path.insert(0, str(HERE / "extract"))

import torch  # noqa: E402
import torch.nn as nn  # noqa: E402
import pytorch as H  # the live helper  # noqa: E402

# Pinned forensic block — mirrors scripts/build-pytorch-helper-fixtures.mjs so
# the helper-emitted goldens are byte-stable regardless of the running torch
# build / wall clock / on-disk helper hash.
FIXTURE_HELPER_BLOCK = {
    "name": "backprop-trace-pytorch-helper",
    "version": "0.12.0",
    "distribution": "repo-script",
    "source_hash": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "framework": {"name": "pytorch", "version": "2.5.0"},
    "runtime": {
        "python_version": "3.12.0",
        "torch_version": "2.5.0",
        "deterministic_mode": {
            "torch_use_deterministic_algorithms": True,
            "cudnn_deterministic": True,
            "cudnn_benchmark": False,
        },
    },
    "extraction": {"timestamp": "2026-05-18T12:00:00Z", "device": "cpu"},
}

PINNED_SOURCE_VERSION = "2.5.0"

# The importer's observer-mode default numeric_policy (import-observer.ts
# DEFAULT_NUMERIC_POLICY_FOR_OBSERVER). The LIVE helper omits numeric_policy
# and the importer supplies exactly this default — so pinning it onto the
# golden fixtures is behavior-neutral (identical bytes downstream) while making
# the fixtures self-describing. It also gives the schema-coverage suite a
# v0.7.0 sidecar that carries numeric_policy.tolerance for its ceiling check.
DEFAULT_OBSERVER_NUMERIC_POLICY = {
    "number_encoding": "decimal",
    "precision_significant_digits": 9,
    "rounding": "round_half_to_even",
    "tolerance": {"atol": 1e-11, "rtol": 1e-7},
    "computation_order": "schema_defined",
    "byte_output": {
        "format": "jsonl",
        "json_key_order": "schema_defined",
        "trailing_zero_policy": "pad_to_significant_digits",
        "indent": "none",
    },
}


def _pin_forensics(sidecar: dict, *, single_step: bool) -> dict:
    """Overwrite volatile forensic fields with pinned fixture constants and
    normalize source_framework. Leaves the numeric body untouched. Also pins
    the observer-default numeric_policy (behavior-neutral; see the constant)."""
    sidecar["helper"] = json.loads(json.dumps(FIXTURE_HELPER_BLOCK))
    sidecar["source_framework"] = {
        "name": "pytorch",
        "version": PINNED_SOURCE_VERSION,
        "information_uri": "https://pytorch.org",
        "extractor": {"name": "backprop-trace-pytorch-helper", "version": "0.12.0"},
    }
    if "numeric_policy" not in sidecar:
        sidecar["numeric_policy"] = json.loads(json.dumps(DEFAULT_OBSERVER_NUMERIC_POLICY))
    if single_step:
        sidecar.pop("trace_id", None)
        sidecar.pop("step_index", None)
    return sidecar


class _Capture:
    """A writable sink that captures emitted JSONL lines."""

    def __init__(self) -> None:
        self.lines: list[str] = []
        self._buf = ""

    def write(self, s: str) -> int:
        self._buf += s
        while "\n" in self._buf:
            line, self._buf = self._buf.split("\n", 1)
            if line:
                self.lines.append(line)
        return len(s)

    def flush(self) -> None:  # pragma: no cover
        pass


def _build_222(bias: bool, output_softmax: bool) -> nn.Module:
    out_act = nn.Softmax(dim=-1) if output_softmax else nn.Sigmoid()
    return nn.Sequential(
        nn.Linear(2, 2, bias=bias),
        nn.Sigmoid(),
        nn.Linear(2, 2, bias=bias),
        out_act,
    )


def _pin_222_weights(model: nn.Module) -> None:
    """Pin the Mazur-ish 2-2-2 weights + per-neuron biases for determinism.
    Biases are pinned UNEQUAL so the per-neuron structure is exercised (equal
    biases would not distinguish per_neuron from per_layer)."""
    with torch.no_grad():
        model[0].weight.copy_(torch.tensor([[0.15, 0.20], [0.25, 0.30]], dtype=torch.float64))
        model[2].weight.copy_(torch.tensor([[0.40, 0.45], [0.50, 0.55]], dtype=torch.float64))
        if model[0].bias is not None:
            model[0].bias.copy_(torch.tensor([0.35, 0.45], dtype=torch.float64))
        if model[2].bias is not None:
            model[2].bias.copy_(torch.tensor([0.60, 0.55], dtype=torch.float64))


INPUTS = {"i1": 0.05, "i2": 0.10}
X = torch.tensor([[INPUTS["i1"], INPUTS["i2"]]], dtype=torch.float64)


def _emit(model, optimizer, loss_fn, targets, topology_loss, trace_id) -> list[dict]:
    y = torch.tensor([[targets[u] for u in sorted(targets)]], dtype=torch.float64)
    cap = _Capture()
    dumper = H.TraceDumper(
        model, optimizer, loss_fn, out=cap, trace_id=trace_id, topology_loss=topology_loss
    )
    n = 2 if trace_id is not None else 1
    for _ in range(n):
        with dumper.step(inputs=INPUTS, targets=targets):
            optimizer.zero_grad()
            loss = loss_fn(model(X), y)
            loss.backward()
            optimizer.step()
    return [json.loads(l) for l in cap.lines]


def _write(path: Path, sidecar: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(sidecar) + "\n", encoding="utf-8")
    print(f"wrote {path.relative_to(REPO_ROOT)}")


def main() -> int:
    torch.set_default_dtype(torch.float64)

    # --- SGD + softmax/CE (single-step good; base for the 7 byte-mutation bad fixtures) ---
    m = _build_222(bias=True, output_softmax=True)
    _pin_222_weights(m)
    opt = torch.optim.SGD(m.parameters(), lr=0.5)
    targets = {"o1": 1.0, "o2": 0.0}

    def ce(out, t):
        eps = 1e-30
        return -(t * torch.log(out + eps)).sum()

    sgd_lines = _emit(m, opt, ce, targets, "cross_entropy_softmax", trace_id=None)
    _write(
        FIXTURES_EXT / "pytorch.helper-emitted.sgd.softmax-ce.sidecar.jsonl",
        _pin_forensics(sgd_lines[0], single_step=True),
    )

    # --- AdamW + sigmoid/MSE (single-step good) ---
    m = _build_222(bias=True, output_softmax=False)
    _pin_222_weights(m)
    opt = torch.optim.AdamW(m.parameters(), lr=0.1, weight_decay=0.05)
    targets = {"o1": 0.01, "o2": 0.99}
    mse = lambda out, t: 0.5 * ((out - t) ** 2).sum()  # noqa: E731
    adamw_lines = _emit(m, opt, mse, targets, "half_squared_error", trace_id=None)
    _write(
        FIXTURES_EXT / "pytorch.helper-emitted.adamw.sidecar.jsonl",
        _pin_forensics(adamw_lines[0], single_step=True),
    )

    # --- sgd_momentum (classical) + sigmoid/MSE (single-step good) ---
    # 2 steps so the SECOND step carries a NON-ZERO momentum buffer
    # (state_before != 0), exercising the sign-flip + Rule 21 recurrence; we
    # keep the SECOND step's sidecar as the single-step golden.
    m = _build_222(bias=True, output_softmax=False)
    _pin_222_weights(m)
    opt = torch.optim.SGD(m.parameters(), lr=0.5, momentum=0.9)
    targets = {"o1": 0.01, "o2": 0.99}
    mom_lines = _emit(m, opt, mse, targets, "half_squared_error", trace_id="a" * 32)
    second = mom_lines[1]
    _write(
        FIXTURES_EXT / "pytorch.helper-emitted.sgd-momentum.sidecar.jsonl",
        _pin_forensics(second, single_step=True),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
