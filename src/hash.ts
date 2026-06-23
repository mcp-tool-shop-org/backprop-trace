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
 * meaningless for cross-machine comparison. The receipt-object overload is
 * the safe path for any caller that has the receipt object in hand.
 *
 * The object overload accepts BOTH receipt families — the v0.1 Mazur receipt
 * (schema_version "0.1.0") and any v0.2+ General receipt (xor/iris/softmax/
 * observer-imported, schema_version "0.2.0".."0.7.0"). It discriminates on the
 * receipt's own `schema_version` (the same in-band discriminator the validator
 * dispatches on — see pickSchemaVersion in src/validate.ts) and routes to
 * emitMazurReceipt vs emitGeneralReceipt accordingly, so each family is hashed
 * over ITS canonical bytes. Routing a General receipt through emitMazurReceipt
 * (the pre-fix behavior) threw a raw formatter error rather than returning a
 * digest, since the two emitters expect structurally different receipt shapes.
 */

import { createHash } from "node:crypto";
import type { MazurReceipt } from "./engine.js";
import type { GeneralReceipt } from "./general-engine.js";
import { emitMazurReceipt, emitGeneralReceipt, EmitError } from "./emit.js";

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
 * @param input      A MazurReceipt or GeneralReceipt (recommended — both
 *                   guarantee canonical bytes; the family is auto-detected
 *                   via schema_version), or a raw string/Buffer of bytes
 *                   the caller has already canonicalized.
 * @param algorithm  "sha256" (default, in-toto baseline) or "sha512".
 * @returns          Lowercase hex string of the digest.
 */
export function hashReceipt(
  input: MazurReceipt | GeneralReceipt | string | Buffer,
  algorithm: HashAlgorithm = "sha256",
): string {
  let bytes: string | Buffer;
  if (typeof input === "string" || Buffer.isBuffer(input)) {
    // EMS-1 defense-in-depth: the raw-bytes overload trusts the caller to
    // supply canonical-emission-equivalent bytes. A digest is only meaningful
    // over valid canonical bytes — non-JSON bytes (e.g. a poisoned emit output
    // that interpolated the bare token "undefined") must NEVER be digested, or
    // the in-toto subject digest is silently corrupted. Assert parseability
    // here so the raw-bytes path fails LOUDLY rather than returning a
    // meaningless digest. The object overload below routes through
    // emitMazurReceipt, which runs its own parseability self-check (see
    // assertParseable in src/emit.ts).
    //
    // JSONL-aware: this overload is legitimately handed BOTH a single
    // canonical record AND a multi-record bundle (`{...}\n{...}\n...`, as Rule
    // 16/17 build via emitGeneralReceipt + join in src/reconcile.ts). A
    // multi-record bundle is NOT a single JSON document, so we validate each
    // non-empty newline-delimited line parses as JSON rather than the whole
    // blob. A poisoned line (bare "undefined" token) still fails per-line, so
    // the defense holds; a valid bundle passes.
    assertCanonicalBytes(
      typeof input === "string" ? input : input.toString("utf-8"),
    );
    bytes = input;
  } else {
    // Receipt-object overload. Discriminate the family on the receipt's own
    // schema_version — the SAME in-band discriminator the validator dispatches
    // on (pickSchemaVersion in src/validate.ts: "0.1.0" is the Mazur-pinned
    // schema; "0.2.0".."0.7.0" are the generalized schemas). The Mazur emitter
    // and the General emitter expect structurally different receipt shapes, so
    // routing must follow the version: a General receipt (xor/iris/softmax/
    // observer) through emitMazurReceipt throws a raw formatter error instead
    // of returning a digest. "0.1.0" → Mazur; everything else → General.
    bytes =
      input.schema_version === "0.1.0"
        ? emitMazurReceipt(input)
        : emitGeneralReceipt(input);
  }
  return createHash(algorithm).update(bytes).digest("hex");
}

/**
 * EMS-1 defense-in-depth — assert that `text` is a valid canonical JSONL
 * blob: every non-empty newline-delimited line parses as JSON. Throws a typed
 * EmitError(NON_JSON_OUTPUT) on the first line that fails, so hashReceipt
 * never digests non-JSON bytes (which would poison the subject digest). An
 * empty string is rejected too — an empty digest input is never a meaningful
 * receipt/bundle.
 */
function assertCanonicalBytes(text: string): void {
  // Split on LF; the canonical framing terminates every record with LF, so
  // the final element after the trailing LF is an empty string we skip.
  const lines = text.split("\n");
  let sawRecord = false;
  for (const line of lines) {
    if (line.length === 0) continue; // trailing-LF artifact / blank line
    sawRecord = true;
    try {
      JSON.parse(line);
    } catch (cause) {
      throw new EmitError(
        "NON_JSON_OUTPUT",
        `hashReceipt: refusing to digest non-JSON bytes — a JSONL line does not parse as JSON. ` +
          `A receipt/bundle digest is only meaningful over canonical-emission bytes; hashing malformed ` +
          `bytes (e.g. a poisoned emit output that interpolated the bare token "undefined") would silently ` +
          `poison the in-toto subject digest. Use the MazurReceipt overload (which canonicalizes via ` +
          `emitMazurReceipt) unless you have already produced canonical bytes. ` +
          `Underlying parse error: ${cause instanceof Error ? cause.message : String(cause)}.`,
        { cause },
      );
    }
  }
  if (!sawRecord) {
    throw new EmitError(
      "NON_JSON_OUTPUT",
      `hashReceipt: refusing to digest empty/blank bytes — an empty digest input is never a meaningful ` +
        `receipt or bundle. Pass canonical-emission bytes (a single record or a multi-record JSONL bundle).`,
    );
  }
}
