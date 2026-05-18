# Live framework helpers (v0.10+)

`backprop-trace` v0.10 ships the first **live framework helper**: a
single auditable Python file at `scripts/extract/pytorch.py` that
extracts a `framework-trace.v0.7.0` sidecar from a real PyTorch
training step. The helper is **observer-only**. Rule 14
(engine-recompute differential) in `bp import pytorch` is the
authority on every helper-emitted sidecar.

## Trust boundary (load-bearing)

The helper is an observer that extracts named factors from a live
framework run into the `framework-trace` sidecar schema. **It is never
a verifier and never an authority.** Every helper-emitted sidecar is
structurally indistinguishable from a hand-authored or adversarial
sidecar at Rule 14's input. Rule 14 (engine-recompute differential
against the sidecar's named factors) MUST fire unconditionally on
`authoring_state === "external_imported"` regardless of how trusted
the helper appears, what framework version it ran against, or whether
the helper reports success. The helper's source-hash and version
metadata are **forensic**, enabling post-hoc attribution when Rule 14
disagrees — they are not bypass credentials.

This mirrors the doctrine in:

- **Csmith** (Yang/Chen/Eide/Regehr PLDI 2011) and **CompCert** (Leroy
  CACM 2009): the oracle must not consult the artifact it judges.
  The producer **states**; the verifier **checks**; the same code
  path never plays both roles.
- **Fang et al. EuroS&P 2023** ("Adversarial Examples for Proof-of-
  Learning"): a producer with byte-control over the training trace
  defeats every structural-only check; the defense is independent
  recomputation, not richer self-attestation.
- **SLSA Provenance v1.0** / **in-toto attestation v1**: predicate
  states inputs; verifier checks subject; the attestor has no
  vocabulary for predicting verification outcome.
- **Sigstore model-transparency**: helper and verifier share only
  the hash function; verification logic is independent.

## v0.10 scope

| Feature | v0.10 status |
|---|---|
| PyTorch SGD (`torch.optim.SGD`, momentum=0) | ✅ supported |
| PyTorch Adam (`torch.optim.Adam`) | ✅ supported |
| Single-step extraction | ✅ supported |
| Multi-step extraction (loop with shared `trace_id`) | ✅ supported |
| CPU device | ✅ supported |
| Mazur-shaped feed-forward nets (single hidden layer, sigmoid/relu/identity hidden, sigmoid/softmax/identity/relu output) | ✅ supported |
| `half_squared_error` loss | ✅ supported |
| `cross_entropy_softmax` loss | ✅ supported |
| PyTorch AdamW (`torch.optim.AdamW`) | ⏸ deferred to v0.10.1 (decoupled-decay extraction) |
| PyTorch sgd_momentum (`torch.optim.SGD` with momentum > 0) | ⏸ deferred to v0.10.1 (momentum_buffer sign-flip pin) |
| Nesterov / dampening | ⏸ deferred to v0.10.1 (via sgd_momentum) |
| AMP / `torch.cuda.amp.autocast` | ❌ rejected at boundary (fp16/fp32 master confusion — PyTorch issue #75224) |
| CUDA / MPS / XLA devices | ❌ rejected at boundary (CPU-first v0.10; v0.11+ for device-tolerance) |
| Batched live extraction | ❌ not supported in helper (hand-authored batched sidecars continue working) |
| AMSGrad / NAdam / RAdam / Lion | ❌ deferred to v0.10+ |
| LBFGS / closure-style optimizers | ❌ deferred |
| Multi-hidden-layer / CNN / transformer topologies | ❌ deferred to v0.11 |
| JAX live helper | ⏸ deferred to v0.11 (adopter-pull triggered) |
| TensorFlow live helper | ⏸ deferred to v0.12+ (gated on JAX clean shipment) |

Hand-authored JAX / TensorFlow sidecars **continue to work unchanged**
in v0.10 via the existing `bp import jax` / `bp import tensorflow`
paths. The deferral is **helper-only**, not **verifier**.

## Workflow

### 1. Copy the helper into your repo

```bash
# Prints the absolute path of the bundled helper
bp examples pytorch
# /path/to/node_modules/@mcptoolshop/backprop-trace/scripts/extract/pytorch.py

# Cat the helper to stdout — pipe into a local file
bp examples pytorch --print > pytorch_trace_helper.py
```

The helper is a single ~600-line Python file. Read it before running
it — that's a security feature, not a limitation (`tools you can read
in 10 minutes` beats `pip install black box`).

### 2. Wrap your training loop

```python
from pytorch_trace_helper import TraceDumper

dumper = TraceDumper(
    model,
    optimizer,
    loss_fn,
    out="trace.jsonl",          # or omit for stdout (pipe-friendly)
    trace_id="run-001",          # required for multi-step
    topology_loss="half_squared_error",  # or "cross_entropy_softmax"
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

`inputs` and `targets` must be passed explicitly (v0.10) so the
sidecar's named-factors provenance is unambiguous. The helper does
NOT infer them from the autograd graph (that path is fragile).

### 3. Verify

```bash
bp import pytorch trace.jsonl | bp verify multi -
echo $?    # 0 = clean · 1 = Rule violation · 2 = extraction/I/O error
```

The pipeline is composable: `python my_train.py | bp import pytorch - | bp verify multi -`
becomes the killer one-liner once the helper writes to stdout.

## Forensic metadata: the `helper` block

Every helper-emitted sidecar carries a `helper` object documenting:

```json
"helper": {
  "name": "backprop-trace-pytorch-helper",
  "version": "0.10.0",
  "distribution": "repo-script",
  "source_hash": "sha256:<64 hex chars>",
  "framework": { "name": "pytorch", "version": "2.5.0" },
  "runtime": {
    "python_version": "3.12.5",
    "torch_version": "2.5.0",
    "deterministic_mode": {
      "torch_use_deterministic_algorithms": true,
      "cudnn_deterministic": true,
      "cudnn_benchmark": false
    }
  },
  "extraction": {
    "timestamp": "2026-05-18T12:00:00Z",
    "device": "cpu"
  }
}
```

**The `source_hash` is computed by the helper, on itself, at extraction
time.** This is acceptable because the hash is **forensic, not a
credential**. A spoofed / wrong / missing hash does NOT bypass Rule
14; Rule 14 fires unconditionally on every receipt with
`authoring_state === "external_imported"`. The hash exists so that
when Rule 14 disagrees, operators can pin which helper version
produced the disagreement.

**The schema does NOT validate the hash against actual file contents.**
That would re-introduce the trust-boundary violation we're avoiding
(the schema would need to invoke a re-hash routine, which is itself
producer-controlled in any real deployment). Rule 14 is the authority
because Rule 14 is independent recomputation against the sidecar's
named factors — it doesn't care what the helper claimed about itself.

## Forbidden in the helper

- **Claiming verification outcome.** No `rule14_passed`,
  `verification_passed`, `expected_outcome`, `differential_passed`,
  or any synonym. The schema's `additionalProperties: false`
  enforces this; the helper would fail validation if it tried.
- **Computing values rather than extracting them.** Every numeric
  scalar in `forward / loss / backward / updates / parameters_after`
  must be the value returned by the framework's own tensor read
  (`.item()`, `.detach().clone().cpu().tolist()`, equivalent). The
  helper may NOT recompute `signal_value = factor1 * factor2`; if
  the framework didn't expose it, the field is absent and Rule 14
  falls back to engine recompute.
- **Emitting anything outside `framework-trace.v0.7.0`.** No
  companion files. No optional richness packs. No
  `metadata.helper_notes`. The schema's `additionalProperties:
  false` is the contract.
- **Touching the receipt schema family.** The helper writes
  `framework-trace.v0.7.0` sidecars only. Receipts are produced by
  `runGeneralStep` from sidecars after Rule 14 passes — the helper
  never produces receipts and never sees receipts.
- **Signing the sidecar.** If signing is desired (Sigstore
  model-transparency style), an **independent** signer runs over
  the helper's output bytes — never the helper signing itself.

## Adversarial fixture catalog (`fixtures/bad/pytorch-helper.bad-*`)

Per Csmith/CompCert discipline, the v0.10 plate ships 7 deliberately-
broken simulated-helper sidecars under `fixtures/bad/`. Each is
generated by a deterministic JS mutation script
(`scripts/build-pytorch-helper-fixtures.mjs`) applied to the good
helper-emitted golden — bad fixtures are NEVER captured from a live
broken helper (that would make them byte-unstable).

| Fixture | Simulated helper bug | Rejected by |
|---|---|---|
| `pytorch-helper.bad-grad-captured-after-zero-grad` | Helper read `param.grad` AFTER `optimizer.zero_grad()` | Rule 4 (update gradient consistency) |
| `pytorch-helper.bad-detach-not-applied` | Helper captured `param.data` as a view; `optimizer.step()` mutated the snapshot | Rule 6 (weight progression) |
| `pytorch-helper.bad-param-ordering-swapped` | Helper iterated `state_dict()` insertion order vs `param_groups` order (PyTorch issue #1489) | Rule 4 (factor cross-reference) |
| `pytorch-helper.bad-loss-stale` | Helper captured loss tensor before `loss.backward()` | Rule 12 (loss formula consistency) |
| `pytorch-helper.bad-forward-out-mismatch` | Helper cached wrong layer's output (mid-layer vs final) | Rule 11 (softmax normalization) |
| `pytorch-helper.bad-weight-after-divergence` | Helper captured `parameters_after` before `optimizer.step()` returned | Rule 6 (weight progression) |
| `pytorch-helper.bad-hidden-signal-misrouted` | Helper used `out` (sigmoid value) instead of `out*(1-out)` (sigmoid derivative) for `activation_derivative` | Rule 8 (provenance reference consistency) |

The test plate at `test/reconcile.bad-pytorch-helper.test.ts` runs
each fixture through `importPytorchSidecar()` + `reconcileReceipt()`
**before** reading the `.meta.json` — the anti-circularity invariant
the doctrine pins.

## Why no pip package in v0.10

The user-facing UX in v0.10 is "copy one auditable file". Going
straight to `pip install backprop-trace-pytorch` would:

1. **Hide the helper from the user.** They install a black box that
   produces sidecars. Auditability is the load-bearing trust signal;
   we should not erode it.
2. **Create a distribution surface we can't take back.** pip names
   are squatable; pip release notes outlive the project; downgrading
   a pip package after a bug is painful.
3. **Lock in API decisions before they're proven.** The
   `TraceDumper` context-manager shape, the `inputs`/`targets`
   explicit-pass requirement, the topology-loss declaration —
   these are v0.10 hypotheses, not v1.0 commitments. Proving them
   in a single-file workflow before committing to pip is honest.

**The flip signal** — when we will reconsider pip distribution:

- **≥3 independent non-team users** open issues asking "how do I `pip
  install` this?" within a single release cycle. (MLflow's per-
  framework autolog packaging followed this exact signal.)
- **The helper needs a dependency the user can't reasonably copy-
  paste** — anything beyond `torch` + Python stdlib (e.g. a hashing
  utility version-locked with the npm verifier).

Until both fire, repo-script is the right answer. Documented in
`SHIP_GATE.md` and reaffirmed in v0.10's commit message.

## v0.10.1 outlook

The next slice extends the helper's optimizer matrix:

- **PyTorch AdamW** — same shape as Adam but the `optimizer_config`
  block carries `weight_decay`; engine's Rule 6/7 AdamW branches
  fire on `(1 - lr*wd)` decoupled-decay. No schema bump.
- **PyTorch sgd_momentum** — adds the `momentum_buffer` sign-flip at
  the extraction boundary. The pin is documented in
  `scripts/extract/pytorch.py` and in `schemas/framework-trace.v0.7.0.json`
  `MomentumState` description. The helper currently REJECTS
  sgd_momentum at the boundary with a clear "deferred to v0.10.1"
  message; v0.10.1 turns the rejection into an extraction branch
  (one new function `_sign_flip_momentum_buffer`, ~10 lines).

v0.11 and beyond — JAX helper (adopter-pull triggered), TF helper
(gated on JAX clean shipment), Lightning / Accelerate integration,
multi-hidden-layer topologies — are out of v0.10 / v0.10.x scope.

## Sources

- **Csmith** — Yang, Chen, Eide, Regehr (PLDI 2011). https://doi.org/10.1145/1993498.1993532
- **CompCert** — Leroy (CACM 2009). https://doi.org/10.1145/1538788.1538814
- **PoL spoofing** — Fang et al. (EuroS&P 2023). https://arxiv.org/abs/2208.03567
- **PoL original** — Jia et al. (IEEE S&P 2021). https://arxiv.org/abs/2103.05633
- **SLSA Provenance v1.0** — https://slsa.dev/spec/v1.0/provenance
- **in-toto attestation v1** — https://github.com/in-toto/attestation
- **Sigstore model-transparency** — https://github.com/sigstore/model-transparency
- **PyTorch SGD source** — https://github.com/pytorch/pytorch/blob/main/torch/optim/sgd.py (issue #1099 documents the ascent-buffer convention)
- **PyTorch state_dict by id() not name** — https://github.com/pytorch/pytorch/issues/1489
- **Extractor mutates state** — https://github.com/pytorch/pytorch/issues/164929
- **detach view storage** — https://discuss.pytorch.org/t/clone-and-detach-in-v0-4-0/16861 + https://elanapearl.github.io/blog/2025/the-bug-that-taught-me-pytorch/
- **AMP cast hazard** — https://github.com/pytorch/pytorch/issues/75224
- **Captum design (PyTorch-only intentional)** — Kokhlikyan et al. 2020, https://arxiv.org/abs/2009.07896
