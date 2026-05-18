---
title: Getting Started
description: Install backprop-trace, verify a good receipt, reject a bad one — in three commands.
sidebar:
  order: 1
---

backprop-trace is a CLI + library. You can do everything from the `bp` command, or pull the public API in TypeScript. This page covers the three commands that prove the system works.

## Prerequisites

- **Node.js 22.x** (pinned — V8 fdlibm `Math.exp` determinism is load-bearing; see [Architecture](./architecture/) for why)
- A package manager: `pnpm` (preferred), `npm`, or `yarn`

## Install

```bash
pnpm add @mcptoolshop/backprop-trace
# or:
npm install @mcptoolshop/backprop-trace
```

Or globally (for `bp` in any shell):

```bash
npm install -g @mcptoolshop/backprop-trace
```

## The three commands

These are the same three blocks from the README's 30-second quickstart, expanded.

### 1. Accept a good receipt

```bash
npx bp verify mazur
# exit 0 — schema + reconcile + engine-reproduce + byte-equal-vs-golden
```

This runs the full Mazur gate on the bundled fixture (`fixtures/mazur.golden.jsonl`):

1. **Schema validate** the receipt (Ajv against `schemas/receipt.v0.1.0.json`)
2. **Reconcile** — all 26 rules pass within hybrid tolerance (`atol=1e-12`, `rtol=1e-9`)
3. **Engine-reproduce** — re-run `runMazurStep(MAZUR_INPUT)` and compare bytewise
4. **Byte-equal vs golden** — the canonical bytes match the committed fixture
5. **Fixture status** enum sanity
6. **Published-anchor drift** — `post_update_loss.total = 0.29102777369359933` matches the [Mazur 2015 walkthrough](https://mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example/)

The Mazur 2-2-2 is the most-cited single-step backprop example on the open web. Every number in it is derivable by hand.

### 2. Reject a deliberately-broken receipt

```bash
npx bp reconcile receipt \
  node_modules/@mcptoolshop/backprop-trace/fixtures/bad/mazur.bad-gradient.jsonl
# exit 1 — Rule 4: update.gradient mismatch on w5
```

The bad fixture has the gradient field of one update mutated. Rule 4 (update gradient consistency) recomputes the gradient from named factors (output error signal × upstream activation), compares to the stored value, finds disagreement within none-of-tolerance, exits 1.

**The load-bearing detail**: the verifier rejects BEFORE consulting `fixture_status.authoring_state = "deliberately_broken"`. If the reconciler used metadata to decide whether to fail, the oracle would be consulting the artifact it judges — that's the Csmith/CompCert anti-circularity violation. Every bad fixture must be reject-by-math, not reject-by-label.

The test plate at `test/reconcile.bad-*.test.ts` formalizes this — it loads the bad fixture as raw JSONL, runs `reconcileReceipt()` first, captures the failure, THEN reads `meta.json` to assert the right rule fired. Reading meta.json before reconcile would invalidate the test.

### 3. Emit canonical bytes (the attestation seam)

```bash
npx bp generate mazur | sha256sum
# 9-sig-fig canonical bytes (V8/Node 22.x) — in-toto v1 attestation seam
```

`bp generate mazur` re-runs the engine and emits the canonical JSONL receipt to stdout. The bytes are deterministic on Node 22.x (see [Architecture](./architecture/) for the determinism scope). Pipe them to `sha256sum` (or `shasum -a 256`) to get the bytes hash — that's what an in-toto v1 attestation envelope would wrap as its subject digest.

This is the seam where backprop-trace plugs into supply-chain attestation: an [in-toto](https://github.com/in-toto/attestation) `subject.digest.sha256` equals the receipt-bytes hash; the `predicate` is the receipt itself plus a producer signature. backprop-trace doesn't ship the signing layer; it produces deterministic bytes that the signing layer can wrap.

## Next steps

- **Verify your own training trace** → [Usage](./usage/)
- **Browse the full CLI surface** → [Reference](./reference/)
- **Understand how it works** → [Architecture](./architecture/)
- **Trust boundary questions** → [Security](./security/)
