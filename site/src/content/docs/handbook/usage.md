---
title: Usage
description: Verify your own PyTorch / JAX / TensorFlow training trace — live helper, sidecar import, multi-step.
sidebar:
  order: 2
---

Once you have backprop-trace installed and the Mazur fixture verifies (see [Getting Started](../getting-started/)), the next move is verifying **your own training trace**.

There are two paths: the **live PyTorch helper** (v0.10+, recommended) and the **hand-authored sidecar** path (works for any framework).

## Path A — Live PyTorch helper (recommended)

backprop-trace v0.10+ ships a single auditable Python file that extracts a `framework-trace.v0.7.0` sidecar from a real PyTorch training step. No pip package by design — copy the file into your repo, read it, run it.

### Step 1: Copy the helper

```bash
npx bp examples pytorch --print > pytorch_trace_helper.py
```

That's the entire installation. The helper is ~700 lines of Python. Read it before running it — that's a security feature, not a limitation. The first 100 lines are the **trust-boundary statement**: the helper is an observer, never a verifier; Rule 14 (engine-recompute differential) is the authority on every helper-emitted sidecar regardless of what the helper claims.

### Step 2: Wrap your training loop

```python
from pytorch_trace_helper import TraceDumper
import torch
import torch.nn as nn

model = nn.Sequential(
    nn.Linear(2, 2),
    nn.Sigmoid(),
    nn.Linear(2, 2),
    nn.Sigmoid(),
)
optimizer = torch.optim.SGD(model.parameters(), lr=0.5)
loss_fn = lambda out, target: 0.5 * ((out - target) ** 2).sum()

dumper = TraceDumper(
    model,
    optimizer,
    loss_fn,
    out="trace.jsonl",
    trace_id="run-001",                          # required for multi-step
    topology_loss="half_squared_error",          # or "cross_entropy_softmax"
)

for batch_idx, (x, y) in enumerate(loader):
    inputs = {"i1": float(x[0, 0]), "i2": float(x[0, 1])}
    targets = {"o1": float(y[0, 0]), "o2": float(y[0, 1])}
    with dumper.step(inputs=inputs, targets=targets):
        optimizer.zero_grad()
        loss = loss_fn(model(x), y)
        loss.backward()
        optimizer.step()

dumper.close()
```

The `with dumper.step(...):` block defines exactly one training step. The helper snapshots pre-state before yielding, lets your code run, snapshots post-state after, emits one JSONL record per step.

### Step 3: Verify

```bash
npx bp import pytorch trace.jsonl | npx bp verify multi -
# exit 0 — clean
# exit 1 — Rule violation (named in stderr)
# exit 2 — I/O / extraction error
```

Or one-shot pipe-everything:

```bash
python my_train.py | npx bp import pytorch - | npx bp verify multi -
```

### Helper scope

| Feature | v0.10.x status |
|---|---|
| PyTorch SGD | ✅ |
| PyTorch SGD with momentum (classical + Nesterov + dampening, with sign-flip) | ✅ |
| PyTorch Adam | ✅ |
| PyTorch AdamW (decoupled weight decay) | ✅ |
| Single-step + multi-step | ✅ |
| CPU device | ✅ |
| 2-layer Mazur-shaped topologies | ✅ |
| half_squared_error + cross_entropy_softmax loss | ✅ |
| SGD with weight_decay > 0 (coupled L2) | ❌ rejected (v0.11) |
| AMSGrad / NAdam / RAdam / Lion / LBFGS | ❌ rejected |
| AMP / `torch.cuda.amp.autocast` | ❌ rejected (PyTorch issue #75224) |
| CUDA / MPS / XLA | ❌ rejected (CPU-first; v0.11+ for device tolerance) |
| Multi-hidden-layer / CNN / transformer topologies | ❌ rejected (v0.11) |
| Batched live extraction | ❌ helper extracts single samples (hand-authored batched sidecars work) |
| JAX live helper | ⏸ deferred to v0.11 (adopter-pull triggered) |
| TensorFlow live helper | ⏸ deferred to v0.12+ |

When a feature is rejected at the boundary, the helper raises `HelperUnsupportedError` with a clear message pointing at the deferral. The hand-authored sidecar path (Path B below) handles many of these cases.

## Path B — Hand-authored sidecar (any framework)

For JAX, TensorFlow, sgd_momentum with coupled-L2, batched extraction, or anything outside the live helper's scope, author a sidecar by hand. The schema is [`schemas/framework-trace.v0.7.0.json`](https://github.com/mcp-tool-shop-org/backprop-trace/blob/main/schemas/framework-trace.v0.7.0.json) (or v0.6.0 for sidecars without a `helper` block).

1. Extract per-tensor numerics from your training step (frameworks expose these via `autograd`, `grad`/`value_and_grad`, `tf.GradientTape`)
2. Emit canonical JSONL (decimal strings, schema-defined key order — see [canonical-emission.md](https://github.com/mcp-tool-shop-org/backprop-trace/blob/main/docs/canonical-emission.md))
3. Run `bp import {pytorch,jax,tensorflow} sidecar.jsonl`
4. The importer runs Rule 14 (engine-recompute differential) and produces an observer-mode receipt

This is friction-heavy compared to Path A but it works for any framework + optimizer combination the verifier supports.

## Multi-step verification

A multi-step bundle is a JSONL stream — one record per training step in one file. The importer hashes the stream once, emits one receipt per step (with shared `trace_id` + dense `step_index`), and runs Rule 14 per step at import time.

```bash
bp import pytorch train.multi-step.sidecar.jsonl | bp verify multi -
```

Cross-step rules then fire:

- **Rule 9** — parameter chain: `parameters_before[N]` = prior `parameters_after[N-1]`
- **Rule 10** — trace identity: shared `trace_id` + sequential `step_index`
- **Rule 17** — bundle-integrity binding (GATED): when any receipt declares `attestor.bundle_root_digest`, all receipts must carry the same value, and that value must equal the recomputed canonical-byte digest of the receipt stream (with `bundle_root_digest` stripped). Catches accidental splice, post-binding mutation, inconsistent bundle roots. **NOT a producer-authenticity check** — for that, combine with Rule 16 + an external signature.
- **Rule 25** — multi-step optimizer-state chain: `state_before[step+1] == state_after[step]` for `m, v` / `buffer`; `t` monotonic +1
- **Rule 26** — multi-step optimizer-config constancy: `{name, beta1, beta2, epsilon, weight_decay, momentum, nesterov, dampening}` identical across bundle; `learning_rate` EXCLUDED (LR schedules legitimate); `t` EXCLUDED (Rule 25 handles it)

## Batched verification

When a sidecar declares a top-level `batch` block (size + sample_order + reduction), additional rules fire:

- **Rule 18** — batch reduction consistency: `loss.total == reduction(loss.per_sample.values(), batch.reduction)`. Catches the mean-vs-sum confusion attack.
- **Rule 19** — sample-set coherence: every per-sample map's key set equals `batch.sample_order` set. Missing/duplicate/out-of-order sample IDs fail.

## What to do when Rule 14 fails

Rule 14 is the engine-recompute differential. If it fails on a helper-emitted sidecar, three possibilities:

1. **Your training step actually disagrees with the engine** — could be a framework bug, an unexpected non-determinism source, or a topology mismatch. Investigate.
2. **The helper extracted the wrong factors** — most common cause. Read the helper's source, check the snapshot ordering (`zero_grad → forward → backward → step → snapshot`), check for AMP / mixed-precision drift.
3. **The receipt was mutated after extraction** — check `attestor.import_provenance.source_hash` against the file you imported.

The Rule 14 failure message names the specific field path that disagreed (`updates[3].gradient`, `parameters_after.w_h1_o1`, etc.). Start there.

## Next steps

- **Browse every `bp` verb + flag** → [Reference](../reference/)
- **Understand the engine and trust boundary** → [Architecture](../architecture/)
- **What this proves vs. what it doesn't** → [Security](../security/)
