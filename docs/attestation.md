# Attestation seam

Receipts have a canonical byte representation (see [`docs/canonical-emission.md`](./canonical-emission.md)).
The sha256 of those canonical bytes is the receipt's identity: two receipts
with the same field values produce identical canonical bytes, identical
digests, and therefore are the same receipt for purposes of attestation
and supply-chain provenance.

This document describes the attestation seam (`hashReceipt`) and the
path forward to a full DSSE-wrapped, Rekor-logged provenance integration.
The seam is schema-version-agnostic: `hashReceipt` re-emits any receipt
through the canonical emitter, so it produces a stable digest for every
receipt the engine writes today (`schema_version` `0.1.0` through `0.7.0`).

## Why canonical-byte hashing matters

If two parties produce a receipt with identical field values but different
in-memory key orders (e.g., one party round-trips through `JSON.parse` +
`JSON.stringify`), naive `sha256(JSON.stringify(receipt))` produces
different digests. That breaks any downstream identity claim — the digest
is no longer a function of the receipt's *meaning*, only of one party's
serializer.

backprop-trace's canonical-emission contract removes that ambiguity. Per
[`docs/canonical-emission.md`](./canonical-emission.md):

- Keys appear in schema-declared `x-order`, not insertion order.
- No whitespace inside the JSON.
- Numeric leaves go through `formatNumberForEngine` (9-sig-fig, round-half-to-even).
- Each record terminates with a single LF.

Two receipts that pass the engine-reproduction byte-equal check
(`bp verify mazur` step 3) produce byte-identical canonical streams and
therefore identical `hashReceipt` digests.

## API

```ts
import { hashReceipt } from "@mcptoolshop/backprop-trace";

const digest = hashReceipt(receipt);            // sha256 hex
const sha512 = hashReceipt(receipt, "sha512");  // opt-in stronger digest
```

Source: [`src/hash.ts`](../src/hash.ts).

Overloads:

| Input | Behavior |
|---|---|
| `MazurReceipt` | Re-emits via `emitMazurReceipt`, hashes the canonical bytes. Safe path. |
| `string` | Hashes the bytes as-is. Caller is responsible for canonical-byte equivalence. |
| `Buffer` | Hashes the bytes as-is. Caller is responsible. |

Algorithm choice is deliberate: **sha256** is the in-toto v1 default and
the de-facto baseline for supply-chain attestations (Sigstore, SLSA).
**sha512** is offered as an opt-in for callers that need it but is NOT
used by the default attestation seam.

## Mapping to in-toto v1

[in-toto Attestation Framework v1](https://github.com/in-toto/attestation/blob/main/spec/v1/README.md)
defines a *statement* shape:

```json
{
  "_type": "https://in-toto.io/Statement/v1",
  "subject": [
    {
      "name": "<receipt fixture id>",
      "digest": { "sha256": "<hashReceipt(receipt)>" }
    }
  ],
  "predicateType": "https://mcptoolshop.org/backprop-trace/receipt/v1",
  "predicate": <the receipt itself, or a structured subset>
}
```

The two load-bearing fields are:

- **`subject[0].digest.sha256`** = `hashReceipt(receipt)`. This is the
  canonical identity of the artifact being attested.
- **`predicateType`** identifies the schema *family* of `predicate`. For
  backprop-trace, the URL `https://mcptoolshop.org/backprop-trace/receipt/v1`
  signals that `predicate` is a backprop-trace receipt; the receipt's own
  `schema_version` field (its first key) selects which concrete schema
  validates it (`receipt.v0.1.0.json` for Mazur, `receipt.v0.2.0.json`
  and its additively-widened successors up through `0.7.0` for the
  generalized / multi-step / optimizer paths).

A consumer that receives such a statement can:

1. Look up `predicateType` to learn that `predicate` is a backprop-trace
   receipt.
2. Validate `predicate` via `validateReceiptSchema` from this library,
   which reads the receipt's `schema_version` and dispatches to the
   matching schema file automatically.
3. Compute `hashReceipt(predicate)` and confirm it matches
   `subject[0].digest.sha256`.
4. Hand the validated receipt to `reconcileReceipt` and confirm the
   math.

Steps 2-4 are the same composition the `bp verify mazur` CLI runs
locally — the difference is that an attestation lets a verifier confirm
without re-running the engine, provided the digest is signed and the
signing key is trusted.

## Sigstore / DSSE integration

backprop-trace ships the *seam* — `hashReceipt` produces the digest that
goes into `subject[0].digest.sha256`. Wrapping the in-toto statement in a
[DSSE envelope](https://github.com/secure-systems-lab/dsse/blob/master/envelope.md)
and submitting to a [Rekor transparency log](https://docs.sigstore.dev/logging/overview/)
is intentionally out of the library's current scope (the architectural
seam is stable; the wrapper is left to the user's existing supply-chain
tooling — see "Position in the law stack" below).

The unbuilt work breaks into three pieces:

1. **DSSE envelope wrapper.** Compute `PAE("application/vnd.in-toto+json", statement_bytes)`
   per the Pre-Authenticated Encoding spec, sign that PAE blob with a
   chosen key, package payload + signatures into the envelope shape.
2. **Sigstore identity binding.** Wire the cosign key-issuance flow (or
   accept a passed-in signer) so the signature carries an identity claim
   anchored in Fulcio.
3. **Rekor transparency log submission.** POST the DSSE envelope to
   Rekor, store the log index, and surface it from `bp verify`.

The architectural seam is the in-toto statement shape. That shape is
stable, so the DSSE wrapper + Rekor submission is mechanical and does not
require any change to the receipt format itself.

## What the attestation seam does NOT do

- **Does not sign anything.** `hashReceipt` is a digest function, not a
  signature. Identity binding (who attests this receipt?) is left to the
  user's signing tooling.
- **Does not emit a DSSE envelope.** The in-toto statement is described
  in this document but not produced by the library. Callers wrap manually.
- **Does not submit to Rekor.** Transparency-log integration is out of
  scope for the library.

These deferrals are deliberate: signing key management and log
submission are operationally heavy and best handled by the user's
existing supply-chain tooling (cosign, rekor-cli, GitHub Actions
attestations). `hashReceipt` gives those tools a stable input.

## Worked example

```ts
import { runMazurStep, hashReceipt, MAZUR_INPUT } from "@mcptoolshop/backprop-trace";
import { writeFileSync } from "node:fs";

const receipt = runMazurStep(MAZUR_INPUT);
const digest = hashReceipt(receipt);

const statement = {
  _type: "https://in-toto.io/Statement/v1",
  subject: [
    { name: receipt.fixture, digest: { sha256: digest } },
  ],
  predicateType: "https://mcptoolshop.org/backprop-trace/receipt/v1",
  predicate: receipt,
};

writeFileSync(`${receipt.fixture}.intoto.json`, JSON.stringify(statement, null, 2));
// Then hand the file to cosign / rekor-cli for signing + logging.
```

## References

- in-toto Attestation Framework v1 specification:
  https://github.com/in-toto/attestation/blob/main/spec/v1/README.md
- in-toto Statement v1 schema:
  https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md
- DSSE envelope specification:
  https://github.com/secure-systems-lab/dsse/blob/master/envelope.md
- Sigstore documentation:
  https://docs.sigstore.dev/
- Rekor transparency log:
  https://docs.sigstore.dev/logging/overview/
- SLSA (provenance levels):
  https://slsa.dev/

## Position in the law stack

Attestation is downstream of the canonical-emission and reconciliation
contracts:

> Contract precedes engine. Formatter policy precedes runtime formatting.
> Bad receipts precede good receipts. Runtime formatting precedes Mazur.
> Mazur precedes diagnostics.

A signed attestation of an *unverified* receipt is a strictly weaker
claim than the receipt itself: the signature attests only that the
signer endorses the bytes, not that the math is correct. backprop-trace's
position is that signing should happen after `bp verify mazur` passes,
not before — the receipt earns its signature by passing the math gate
first.
