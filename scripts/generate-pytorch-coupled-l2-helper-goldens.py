#!/usr/bin/env python3
"""Generate the v0.13 SGD coupled-L2 helper-emitted sidecar + observer golden.

These two fixtures close the two SECURITY skips in
test/schema-tolerance-ceiling.test.ts that lacked a v0.8.0 fixture:

  1. fixtures/external/pytorch.helper-emitted.sgd-coupled-l2.sidecar.jsonl
     — a REAL coupled-L2 (weight_decay > 0) SGD step extracted by the live
       helper at scripts/extract/pytorch.py through actual torch. It declares
       `format: "framework-trace.v0.8.0"` (the SGD-family weight_decay schema
       relaxation) and carries `numeric_policy.tolerance` so the
       framework-trace v0.8.0 ceiling test has a tolerance field to widen.

  2. fixtures/external/pytorch.sgd-coupled-l2.golden.jsonl
     — the OBSERVER-mode receipt produced by importing fixture (1) via
       `importPytorchSidecar` (pure TS). It carries
       `attestor.differential_tolerance` so the receipt-schema v0.8.0
       differential_tolerance ceiling test has a tolerance field to widen.
       This is exactly how the v0.4.0-0.7.0 differential_tolerance goldens
       were made (sidecar -> importPytorchSidecar -> canonical bytes).

WHY A TORCH GENERATOR (mirrors scripts/generate-pytorch-helper-goldens.py):
  The coupled-L2 fixture is captured from the live helper run through REAL
  torch — not derived from a hand-authored sidecar — so it exercises the
  genuine extraction path (PyTorch folds wd*param into .grad in-place during
  .step(); the helper records the decay-augmented gradient and the reconciler
  re-derives grad' = grad_base + wd*param).

DETERMINISM:
  Weights are pinned (copy_) and the helper's volatile forensic fields (helper
  block, source_framework.version, wall-clock timestamp, running
  torch.__version__, real source_hash) are OVERWRITTEN with the pinned
  FIXTURE_* constants AFTER emission. The numeric body is a pure function of
  the pinned weights + inputs + optimizer (float64), so re-running on any torch
  build reproduces byte-identical files. The observer golden is then emitted by
  the TS importer (canonical bytes) in a follow-on step driven by
  scripts/emit-coupled-l2-observer-golden.mjs.

USAGE:
  python scripts/generate-pytorch-coupled-l2-helper-goldens.py   # writes sidecar
  node  scripts/emit-coupled-l2-observer-golden.mjs              # writes golden
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

# Pinned forensic block — mirrors scripts/generate-pytorch-helper-goldens.py so
# the helper-emitted golden is byte-stable regardless of the running torch
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

# Same self-describing observer-default numeric_policy the sibling generator
# pins. tolerance {atol:1e-11, rtol:1e-7} is well under the v0.8.0 ceiling
# {atol:1e-5, rtol:1e-3}, so the clean sidecar validates AND the schema-coverage
# suite has a tolerance field to widen for the framework-trace v0.8.0 ceiling.
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


def _pin_forensics(sidecar: dict) -> dict:
    sidecar["helper"] = json.loads(json.dumps(FIXTURE_HELPER_BLOCK))
    sidecar["source_framework"] = {
        "name": "pytorch",
        "version": PINNED_SOURCE_VERSION,
        "information_uri": "https://pytorch.org",
        "extractor": {"name": "backprop-trace-pytorch-helper", "version": "0.12.0"},
    }
    if "numeric_policy" not in sidecar:
        sidecar["numeric_policy"] = json.loads(json.dumps(DEFAULT_OBSERVER_NUMERIC_POLICY))
    sidecar.pop("trace_id", None)
    sidecar.pop("step_index", None)
    return sidecar


class _Capture:
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


def _build_222(bias: bool) -> nn.Module:
    return nn.Sequential(
        nn.Linear(2, 2, bias=bias),
        nn.Sigmoid(),
        nn.Linear(2, 2, bias=bias),
        nn.Sigmoid(),
    )


def _pin_222_weights(model: nn.Module) -> None:
    with torch.no_grad():
        model[0].weight.copy_(torch.tensor([[0.15, 0.20], [0.25, 0.30]], dtype=torch.float64))
        model[2].weight.copy_(torch.tensor([[0.40, 0.45], [0.50, 0.55]], dtype=torch.float64))
        model[0].bias.copy_(torch.tensor([0.35, 0.45], dtype=torch.float64))
        model[2].bias.copy_(torch.tensor([0.60, 0.55], dtype=torch.float64))


INPUTS = {"i1": 0.05, "i2": 0.10}
TARGETS = {"o1": 0.01, "o2": 0.99}
X = torch.tensor([[INPUTS["i1"], INPUTS["i2"]]], dtype=torch.float64)
Y = torch.tensor([[TARGETS["o1"], TARGETS["o2"]]], dtype=torch.float64)


def main() -> int:
    torch.set_default_dtype(torch.float64)

    # SGD COUPLED L2 (the documented Rule 7 third branch): weight_decay > 0
    # folds wd*param into the gradient before the update. Single bias=True step.
    m = _build_222(bias=True)
    _pin_222_weights(m)
    opt = torch.optim.SGD(m.parameters(), lr=0.5, weight_decay=0.01)
    mse = lambda out, t: 0.5 * ((out - t) ** 2).sum()  # noqa: E731

    cap = _Capture()
    dumper = H.TraceDumper(
        m, opt, mse, out=cap, trace_id=None, topology_loss="half_squared_error"
    )
    with dumper.step(inputs=INPUTS, targets=TARGETS):
        opt.zero_grad()
        loss = mse(m(X), Y)
        loss.backward()
        opt.step()

    sidecar = json.loads(cap.lines[0])
    assert sidecar["format"] == "framework-trace.v0.8.0", sidecar["format"]
    assert sidecar["optimizer"]["weight_decay"] > 0, "coupled-L2 needs weight_decay > 0"

    out_path = FIXTURES_EXT / "pytorch.helper-emitted.sgd-coupled-l2.sidecar.jsonl"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(_pin_forensics(sidecar)) + "\n", encoding="utf-8")
    print(f"wrote {out_path.relative_to(REPO_ROOT)} (format={sidecar['format']}, "
          f"weight_decay={sidecar['optimizer']['weight_decay']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
