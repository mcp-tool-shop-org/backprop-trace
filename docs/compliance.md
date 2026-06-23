# Compliance audit bundle

This page shows how a backprop-trace **receipt** functions as one evidence
artifact inside a machine-learning compliance bundle — and, just as important,
what it does **not** attest. backprop-trace is a numerical-correctness verifier
for one training step; it is a *predicate*, not a compliance solution. Used
honestly it is a small, verifiable, dated, signable record that the math of a
recorded training step is internally consistent and that the step chain is
intact.

> **Read the ceiling first.** A receipt attests that the recorded
> `(inputs, params, gradients, optimizer state, updates, loss)` tuple is
> *internally consistent* with the published optimizer math, re-derived by an
> independent engine that never consults the receipt's own metadata
> ([anti-circularity](./reconciliation.md#failure-priority-rule)). It does **not**
> prove the gradient was computed on real data by a real trainer, it does **not**
> attest data quality or provenance, and it is **not** a cryptographic identity
> proof. It is **tamper-evident**, not tamper-proof: an adversary who controls
> every byte *and* recomputes a consistent tuple passes the math rules — that is
> the documented [Fang et al. 2023](https://arxiv.org/abs/2208.03567)
> Proof-of-Learning spoofing class. For producer identity, compose the receipt
> with an external signature (Rule 16 `signed_subject_digest`, Sigstore/cosign,
> or an out-of-band attestation). See [SECURITY.md](../SECURITY.md).

## What a receipt is, in compliance terms

A receipt is a **per-step technical-documentation record** plus an
**integrity control**:

- It documents the *general logic of the algorithm* for one step — the exact
  optimizer rule, gradient decomposition, and parameter update, with every
  factor named and re-derivable.
- It is a *test log* of that step that a third party can re-run in seconds and
  that fails closed on disagreement — a verifiable, dated, signable artifact.

## Honest mapping to the standards

| Standard / clause | What it asks for | How a receipt contributes | Fit |
|---|---|---|---|
| **EU AI Act Annex IV §2(g)** — validation & testing procedures; *"test logs and all test reports, dated and signed by the responsible persons"* | Evidence that the system was validated; reproducible test records | A receipt **is** a machine-checkable test log of one training step's math; `bp verify` is the re-run; the canonical bytes are signable/datable | **Primary** |
| **EU AI Act Annex IV §2(b)** — *"the general logic of the AI system and of the algorithms"* | Documented algorithmic logic | The receipt records the exact optimizer recurrence + gradient derivation per step (the 26 rules name each) | **Strong** |
| **EU AI Act Article 15** — accuracy & robustness; systems *"resilient to attacks and circumstances that could cause errors"* | Integrity controls against error/tamper | The adversarial verifier **rejects** tampered or mathematically-wrong receipts before reading any status metadata; every rule ships a paired bad fixture it must reject | **Strong** |
| **EU AI Act Article 12** — record-keeping; automatic logging of events over the lifetime | Per-event records | A receipt per step is a re-derivable record; multi-step bundles chain via Rules 9/10 | **Moderate** |
| **EU AI Act Article 10** — data & data governance | Training-data quality/governance | **Out of scope.** A receipt attests *math*, not data quality or provenance. Do not claim Article 10 coverage. | **None** |
| **SLSA-for-ML / Sigstore model-signing** | Pipeline & artifact provenance | The receipt is an **internal-consistency predicate** that composes *below* model-signing; an [ML-BOM](https://cyclonedx.org/capabilities/mlbom/) or in-toto statement can reference it | **Composes** |

> The repo's earlier one-line "EU AI Act Article 10" framing was imprecise:
> backprop-trace's honest anchors are **Annex IV §2(g)/§2(b)** and **Article 15**,
> not Article 10 (data governance). This page is the authoritative mapping.

## A worked bundle

The bundle below uses the shipped hero fixture
[`fixtures/hero-classifier.golden.jsonl`](../fixtures/hero-classifier.golden.jsonl)
— a 9-pixel → 16-ReLU → 4-class softmax glyph classifier step — as the example
receipt. Substitute your own engine-emitted or imported receipt.

**1. Verify the step (the re-runnable test log).**

```bash
npx bp verify general fixtures/hero-classifier.golden.jsonl --json
# exit 0 — schema + reconcile (26 rules) + engine-reproduce byte-equal.
# --json carries `rules_evaluated` / `gated_off` so the bundle records WHICH
# rules the PASS actually exercised (an auditable PASS, not a silent one).
```

**2. Pin the canonical bytes (the subject digest).**

```bash
npx bp generate from-config <your-step>.input.json | sha256sum
# 9-significant-figure canonical bytes (V8 / Node 22.x). This sha256 is the
# in-toto subject digest — see docs/attestation.md.
```

**3. Wrap it in an in-toto v1 statement** (the bundle artifact). The predicate
records the verifier's verdict + the exact rule coverage; the subject binds the
canonical receipt bytes:

```json
{
  "_type": "https://in-toto.io/Statement/v1",
  "subject": [
    { "name": "hero-classifier.step0",
      "digest": { "sha256": "<canonical-bytes-sha256>" } }
  ],
  "predicateType": "https://mcp-tool-shop-org.github.io/backprop-trace/predicate/v1",
  "predicate": {
    "verifier": "@mcptoolshop/backprop-trace",
    "verifierVersion": "<version>",
    "result": "pass",
    "rulesEvaluated": [1,2,3,4,5,6,7,8,11,12,13],
    "node": "22.x",
    "determinismBoundary": "node-22 / backprop-trace 1.x / canonical-emission v1"
  }
}
```

**4. Compose, don't conflate.** Sign the statement with Sigstore/cosign for
producer identity, reference it from your model card / ML-BOM, and pair it with
the data-governance and post-market-monitoring evidence the receipt does **not**
provide. The receipt is the *numerical-consistency* leaf of that tree.

## What to write in your technical documentation

> *"Per-step training-trace records were captured as backprop-trace receipts
> (`@mcptoolshop/backprop-trace`, vX.Y.Z, Node 22.x). Each receipt re-derives the
> optimizer math from named factors via an independent engine that does not
> consult the receipt's status metadata, and is rejected on any disagreement
> within `atol+rtol`. Verification (`bp verify`) is reproducible by a third
> party; canonical bytes are pinned by sha256 and bound into an in-toto v1
> statement. These records evidence Annex IV §2(g) validation/testing logs and
> Article 15 robustness controls for the training step; they do not attest data
> governance (Article 10) or model-level performance, which are documented
> separately."*

## Related

- [`docs/attestation.md`](./attestation.md) — the in-toto v1 attestation seam.
- [`SECURITY.md`](../SECURITY.md) — what counts as a vulnerability; the trust ceiling.
- [`docs/reconciliation.md`](./reconciliation.md) — the 26 rules + anti-circularity doctrine.
