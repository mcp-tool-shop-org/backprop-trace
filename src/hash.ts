/**
 * hashReceipt — canonical-bytes digest for receipts (FT-F-003).
 *
 * The receipt's identity is its canonical-emission digest. Two receipts
 * with the same field values but different in-memory key order produce
 * the same canonical bytes (per docs/canonical-emission.md schema-ordered
 * traversal) and therefore the same digest. This is the seam for in-toto
 * v1 attestations: `subject.digest.sha256 = hashReceipt(receipt)`. See
 * docs/attestation.md for the predicate-shape walkthrough.
 *
 * Algorithm choice is deliberate: sha256 is the in-toto default and the
 * de-facto baseline for supply-chain attestations (sigstore, SLSA). sha512
 * is offered as an opt-in for callers that need it but is NOT used by the
 * default attestation seam.
 *
 * String / Buffer inputs bypass re-emission and hash the caller-supplied
 * bytes directly. Callers using this overload are responsible for ensuring
 * those bytes are canonical-emission-equivalent — otherwise the digest is
 * meaningless for cross-machine comparison. The MazurReceipt overload is
 * the safe path for any caller that has the receipt object in hand.
 */

import { createHash } from "node:crypto";
import type { MazurReceipt } from "./engine.js";
import { emitMazurReceipt } from "./emit.js";

/**
 * Supported digest algorithms. sha256 is the in-toto / sigstore baseline
 * (and the value used in the attestation walkthrough); sha512 is offered
 * as an opt-in for callers that already operate on the longer digest.
 */
export type HashAlgorithm = "sha256" | "sha512";

/**
 * Compute the canonical-bytes digest of a Mazur receipt.
 *
 * If passed a MazurReceipt, re-emits it via emitMazurReceipt and hashes
 * the resulting canonical bytes. If passed a string or Buffer, hashes
 * those bytes directly — caller is responsible for canonical-byte
 * equivalence.
 *
 * The receipt's identity is its canonical-emission digest. This is the
 * seam for in-toto v1 attestations:
 *
 *   {
 *     "subject": [{
 *       "name":   receipt.fixture,
 *       "digest": { "sha256": hashReceipt(receipt) },
 *     }],
 *     "predicateType": "https://backprop-trace.dev/predicate/v1",
 *     "predicate":     { /* engine metadata, reconciler-rule version, ... *\/ }
 *   }
 *
 * @param input      Either a MazurReceipt (recommended — guarantees
 *                   canonical bytes), or a raw string/Buffer of bytes
 *                   the caller has already canonicalized.
 * @param algorithm  "sha256" (default, in-toto baseline) or "sha512".
 * @returns          Lowercase hex string of the digest.
 */
export function hashReceipt(
  input: MazurReceipt | string | Buffer,
  algorithm: HashAlgorithm = "sha256",
): string {
  const bytes =
    typeof input === "string" || Buffer.isBuffer(input)
      ? input
      : emitMazurReceipt(input);
  return createHash(algorithm).update(bytes).digest("hex");
}
