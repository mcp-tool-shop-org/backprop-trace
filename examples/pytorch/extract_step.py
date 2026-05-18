"""
backprop-trace PyTorch live helper — minimal example (v0.10.0).

To run this example, first copy the helper into your repo:

    bp examples pytorch --print > pytorch_trace_helper.py

Then run:

    python extract_step.py | bp import pytorch - | bp verify multi -

The exit code is 0 if the helper's emitted sidecar passes Rule 14
(engine-recompute differential). Non-zero means either the helper
extracted the wrong factors OR the framework's training step disagrees
with the engine — Rule 14 is the authority either way.

WHAT THIS EXAMPLE DOES
----------------------
- Builds a Mazur 2-2-2 PyTorch model (2 inputs, 2 hidden sigmoid, 2 output
  sigmoid, half-squared-error loss).
- Runs ONE training step with vanilla SGD (no momentum).
- Uses the TraceDumper context manager to emit a single
  `framework-trace.v0.7.0` sidecar to stdout.
- The sidecar's `helper` block is forensic only — Rule 14 is the
  authority. See scripts/extract/pytorch.py docstring + docs/live-helpers.md.

NO TRUST IS GRANTED TO THIS EXAMPLE
-----------------------------------
This is documentation. The helper itself is observer-only. If you copy
this code into a production training loop and the sidecar passes
Rule 14, that means your training step is mathematically consistent
with the helper's named factors — NOT that the training is "correct"
in any deeper sense. backprop-trace is a per-step structural verifier,
not a training oracle.
"""

# ===== Step 1: copy the helper, then import from your local copy =====
# In your real workflow you'd run:
#     bp examples pytorch --print > pytorch_trace_helper.py
# and then:
#     from pytorch_trace_helper import TraceDumper
#
# For the in-repo example we point at scripts/extract/pytorch.py via sys.path
# so the example can be smoke-run from the repo root without requiring the
# user to copy anything. PRODUCTION USERS: follow the copy-then-import flow
# shown in the docstring above — that is the locked v0.10 workflow.
import sys
from pathlib import Path
_HELPER_DIR = Path(__file__).resolve().parent.parent.parent / "scripts" / "extract"
sys.path.insert(0, str(_HELPER_DIR))
from pytorch import TraceDumper  # noqa: E402  — module name is the file name


def main() -> int:
    try:
        import torch
        import torch.nn as nn
    except ImportError:
        print(
            "Install PyTorch first: pip install torch  "
            "(see https://pytorch.org for CUDA-vs-CPU wheels).",
            file=sys.stderr,
        )
        return 2

    torch.manual_seed(42)
    torch.set_default_dtype(torch.float64)

    # Mazur 2-2-2 topology — sigmoid hidden + sigmoid output + MSE loss.
    model = nn.Sequential(
        nn.Linear(2, 2, bias=True),
        nn.Sigmoid(),
        nn.Linear(2, 2, bias=True),
        nn.Sigmoid(),
    )
    # Pin to canonical Mazur initial weights for reproducible sidecars.
    # In a real loop these come from your training state, not pinned constants.
    with torch.no_grad():
        # input→hidden weights (per-row layout: row 0 is h1, row 1 is h2)
        model[0].weight.copy_(torch.tensor([[0.15, 0.20], [0.25, 0.30]], dtype=torch.float64))
        model[0].bias.fill_(0.35)  # per-layer bias convention
        # hidden→output weights
        model[2].weight.copy_(torch.tensor([[0.40, 0.45], [0.50, 0.55]], dtype=torch.float64))
        model[2].bias.fill_(0.60)

    optimizer = torch.optim.SGD(model.parameters(), lr=0.5, momentum=0.0)
    loss_fn = lambda out, target: 0.5 * ((out - target) ** 2).sum()

    inputs = {"i1": 0.05, "i2": 0.10}
    targets = {"o1": 0.01, "o2": 0.99}
    x = torch.tensor([[inputs["i1"], inputs["i2"]]], dtype=torch.float64)
    y = torch.tensor([[targets["o1"], targets["o2"]]], dtype=torch.float64)

    # Single-step example. For multi-step, loop and call dumper.step()
    # per training step with a stable trace_id passed at TraceDumper
    # construction time.
    dumper = TraceDumper(
        model,
        optimizer,
        loss_fn,
        out=None,  # stdout
        trace_id=None,  # single-step
        topology_loss="half_squared_error",
    )

    with dumper.step(inputs=inputs, targets=targets):
        optimizer.zero_grad()
        loss = loss_fn(model(x), y)
        loss.backward()
        optimizer.step()

    dumper.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
