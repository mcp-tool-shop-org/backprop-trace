---
title: Usage
description: Verify your own PyTorch / JAX / TensorFlow training trace — live helper, sidecar import, multi-step.
sidebar:
  order: 2
---

Once you have backprop-trace installed and the Mazur fixture verifies (see [Getting Started](../getting-started/)), the next move is verifying **your own training trace**.

There are three paths: the **live PyTorch helper** (recommended for PyTorch), the **live JAX helper** (v1.0.0, stronger trust boundary for JAX), and the **hand-authored sidecar** path (works for any framework).

## Path A — Live PyTorch helper (recommended)

backprop-trace ships a single auditable Python file that extracts a `framework-trace` sidecar from a real PyTorch training step. No pip package by design — copy the file into your repo, read it, run it.

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

| Feature | v1.0.0 status |
|---|---|
| PyTorch SGD | ✅ |
| PyTorch SGD with momentum (classical + Nesterov + dampening, with sign-flip) | ✅ |
| PyTorch Adam | ✅ |
| PyTorch AdamW (decoupled weight decay) | ✅ |
| PyTorch SGD with weight_decay > 0 (coupled L2) | ✅ (v1.0.0 — Rule 7 third branch; decay folds into the gradient + momentum buffer) |
| Per-neuron biases (torch-validated end-to-end) | ✅ |
| Single-step + multi-step | ✅ |
| CPU device | ✅ |
| 2-layer Mazur-shaped topologies + the 9-pixel→16-ReLU→4-class hero classifier | ✅ |
| half_squared_error + cross_entropy_softmax loss | ✅ |
| NAdam / RAdam | ❌ rejected (roadmap: next) |
| AMSGrad / Lion / LBFGS / per-group LRs / gradient clipping | ❌ rejected (later, each gated on a receipt/reconciler extension) |
| LR schedules | ❌ rejected (roadmap: next, composes with all optimizers) |
| AMP / `torch.cuda.amp.autocast` | ❌ rejected (PyTorch issue #75224) |
| CUDA / MPS / XLA | ❌ rejected — GPU/fused-kernel bit-determinism is permanently out of scope (FP non-associativity, [arXiv:2408.05148](https://arxiv.org/abs/2408.05148)) |
| Multi-hidden-layer / CNN / transformer topologies | ❌ rejected (the dense ReLU→softmax hero classifier is the shipped v1.0 fixture; conv stays out of the deterministic corner) |
| Batched live extraction | ❌ helper extracts single samples (hand-authored batched sidecars work) |
| JAX live helper (SGD + Adam) | ✅ (v1.0.0 — `scripts/extract/jax.py`; see Path A-JAX below) |
| TensorFlow live helper | ⏸ deferred (later) |

When a feature is rejected at the boundary, the helper raises `HelperUnsupportedError` with a clear message pointing at the deferral. The hand-authored sidecar path (Path B below) handles many of these cases.

## Path A-JAX — Live JAX helper (v1.0.0)

For JAX, v1.0.0 ships a parallel single auditable file at `scripts/extract/jax.py` with a **stronger trust boundary** than PyTorch eager. Copy it into your repo, read it, run it:

```bash
cp node_modules/@mcptoolshop/backprop-trace/scripts/extract/jax.py jax_trace_helper.py
```

The JAX-specific contribution: the helper folds a `jax.make_jaxpr(jax.grad(loss))` digest into the forensic `helper` block — the gradient computation graph (the jaxpr) as an inspectable, auditable artifact that PyTorch eager has no first-class equivalent for. Like the `source_hash`, the jaxpr is **forensic, not a credential** — it does not bypass Rule 14; it makes post-hoc attribution richer.

Two determinism requirements are enforced at the boundary (the helper refuses to run otherwise):

- **CPU only.** GPU/TPU FP reductions are non-associative across kernels ([arXiv:2408.05148](https://arxiv.org/abs/2408.05148)) and would diverge from the engine's pinned scalar recompute.
- **`jax.config.update("jax_enable_x64", True)`.** JAX defaults to float32; the engine runs binary64. Without x64 the extracted scalars are float32 and Rule 14 would surface tolerance disagreements — so the helper fails loudly at the boundary rather than silently emitting a float32 sidecar.

```python
from jax_trace_helper import TraceDumper

dumper = TraceDumper(
    params, optimizer="sgd", learning_rate=0.5,
    topology_loss="half_squared_error", out="trace.jsonl",
)
for x, y in loader:
    with dumper.step(inputs=x, targets=y) as ctx:
        params = ctx.run(params)   # runs forward+grad+update internally
```

Verify the same way as PyTorch — the importer + Rule 14 are framework-agnostic:

```bash
npx bp import jax trace.jsonl | npx bp verify multi -
```

The JAX helper covers SGD and Adam. It is observer-only; Rule 14 is the authority on every helper-emitted sidecar, exactly as with PyTorch. A dedicated CI `jax-e2e` job validates it against real JAX on every relevant push.

## Path B — Hand-authored sidecar (any framework)

For TensorFlow, batched extraction, or anything outside the live helpers' scope, author a sidecar by hand. The schema is [`schemas/framework-trace.v0.8.0.json`](https://github.com/mcp-tool-shop-org/backprop-trace/blob/main/schemas/framework-trace.v0.8.0.json) (v0.8.0 adds the SGD coupled-L2 weight-decay surface; earlier versions back to v0.6.0 remain valid for sidecars that don't use it, or that omit the `helper` block).

1. Extract per-tensor numerics from your training step (frameworks expose these via `autograd`, `grad`/`value_and_grad`, `tf.GradientTape`)
2. Emit canonical JSONL (decimal strings, schema-defined key order — see [canonical-emission.md](https://github.com/mcp-tool-shop-org/backprop-trace/blob/main/docs/canonical-emission.md))
3. Run `bp import {pytorch,jax,tensorflow} sidecar.jsonl`
4. The importer runs Rule 14 (engine-recompute differential) and produces an observer-mode receipt

This is friction-heavy compared to Path A but it works for any framework + optimizer combination the verifier supports.

### Observer-mode verify behavior (what `bp verify` does with an imported receipt)

When you run `bp verify` (or `bp verify multi`) on a receipt that came from `bp import`, the verifier treats it as an **observer-mode** receipt and re-runs Rule 14 independently — the import-time differential is not trusted as the verdict (Reproducible Builds discipline: the producer's claim is not the verifier's truth). Four behaviors matter here:

- **Rule 14 fires on observer markers, not labels.** The verifier decides to re-derive based on the presence of `source_framework` / `attestor.import_provenance`, so an imported receipt cannot turn off the math gate by editing its `authoring_state` field.
- **The differential tolerance is verifier-owned.** The receipt's `attestor.differential_tolerance` is clamped to `{atol: 1e-5, rtol: 1e-3}` before the comparison — an imported receipt cannot request a pass band wide enough to hide its own divergence. (This looser-than-engine band is what lets honest float32 sidecars pass; v0.12.0 stopped false-FAILing them.)
- **Completeness is checked.** Rule 14 asserts the update set covers every engine-updated parameter and `parameters_after == topology.parameter_order` — a sidecar cannot pass by reporting only the parameters it got right.
- **Self-declared skips fail.** A multi-step bundle that announces its own math gate was skipped is a NON-PASS, not a pass.

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
