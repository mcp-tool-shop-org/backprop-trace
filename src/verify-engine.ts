/**
 * verifyEngineReproduces — re-run the engine and check byte-equality (FT-F-009).
 *
 * Discharges the receipt's `verification_state === "engine_reproduced_byte_equal"`
 * claim. The fixture_status field on a canonical receipt asserts that the
 * recorded bytes ARE reproducible by re-running the engine on the receipt's
 * inputs; this helper composes that check in a single function so the CLI
 * (`bp verify mazur`) doesn't have to re-implement the orchestration.
 *
 * The check is byte-equality on canonical emission output, not deep-equal
 * on the receipt object — that's the load-bearing determinism claim per
 * docs/canonical-emission.md. A receipt that deep-equals but byte-differs
 * (e.g. via different floating-point round-tripping) would still fail the
 * check, which is the desired strictness.
 *
 * Failure path returns the first differing byte offset so the CLI can
 * render a focused diff (rather than dumping two 4 KB strings to the
 * terminal). Callers can recompute a fuller diff from `ourBytes` /
 * `theirBytes` if needed.
 */

import { createHash } from "node:crypto";
import type { MazurInput } from "./mazur.js";
import type { MazurReceipt } from "./engine.js";
import { runMazurStep } from "./engine.js";
import { emitMazurReceipt, emitGeneralReceipt } from "./emit.js";
import { extractEngineInput, extractGeneralEngineInput } from "./extract.js";
import {
  runGeneralStep,
  type GeneralInput,
  type GeneralReceipt,
} from "./general-engine.js";

/**
 * Discriminated-union result of verifyEngineReproduces.
 *
 * On success: `bytes` is the canonical emission text and `digest` is its
 * sha256. On failure: both byte strings and the first index where they
 * diverge, so the CLI can render a useful diff snippet.
 */
export type VerifyEngineResult =
  | { matches: true; bytes: string; digest: string }
  | {
      matches: false;
      ourBytes: string;
      theirBytes: string;
      firstDifferingByte: number;
    };

/**
 * Re-run the engine on a receipt's inputs and verify that the resulting
 * canonical emission byte-equals the receipt's own canonical emission.
 *
 * If `input` is omitted, extracts it from the receipt via
 * extractEngineInput (the receipt is self-sufficient for replay — see
 * src/extract.ts for the rationale).
 *
 * The byte comparison uses canonical emission (emitMazurReceipt) on
 * BOTH sides — so e.g. a receipt that was parsed back from disk and a
 * receipt that was just produced by the engine are normalized to the
 * same emission discipline before comparison. This isolates "the engine
 * produces the recorded math" from "the parser/emitter round-trips."
 *
 * @param receipt  The receipt whose verification_state claim is being
 *                 discharged. Typically loaded via parseReceipt(file).
 * @param input    Optional override for the engine input. If omitted,
 *                 extracted from the receipt itself — which is the
 *                 normal case for `bp verify mazur`. Override only when
 *                 the verifier intentionally wants to feed a *different*
 *                 input than the receipt records (e.g. to prove that
 *                 the receipt is INSENSITIVE to small perturbations,
 *                 which would actually be a Rule failure).
 * @returns        VerifyEngineResult — see above.
 */
export function verifyEngineReproduces(
  receipt: MazurReceipt,
  input?: MazurInput,
): VerifyEngineResult {
  const engineInput = input ?? extractEngineInput(receipt);
  const ourReceipt = runMazurStep(engineInput);
  const ourBytes = emitMazurReceipt(ourReceipt);
  const theirBytes = emitMazurReceipt(receipt);
  if (ourBytes === theirBytes) {
    return { matches: true, bytes: ourBytes, digest: sha256Hex(ourBytes) };
  }
  // Find the first index where the two strings differ. If one is a strict
  // prefix of the other, firstDifferingByte = min(length) which is also
  // the correct "first non-matching position" (where the shorter string
  // ended early).
  let i = 0;
  const minLen = Math.min(ourBytes.length, theirBytes.length);
  while (i < minLen && ourBytes[i] === theirBytes[i]) i++;
  return { matches: false, ourBytes, theirBytes, firstDifferingByte: i };
}

/**
 * Local sha256-hex helper used only by the success path. We don't import
 * from src/hash.ts to avoid the (string | Buffer | MazurReceipt) overload
 * argument-routing logic when we already know we have a string.
 */
function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/**
 * v0.3 sibling of verifyEngineReproduces, generalized over arbitrary
 * topologies. Re-runs the generalized engine on a v0.2.0-schema receipt's
 * inputs and verifies that the resulting canonical emission byte-equals
 * the receipt's own canonical emission.
 *
 * Composition mirrors verifyEngineReproduces exactly — the only delta is
 * which engine + which emitter are dispatched. This lets `bp verify general`
 * surface the same VerifyEngineResult shape as `bp verify mazur`, so the
 * CLI can render diff snippets identically across schema versions.
 *
 * If `input` is omitted, extracts it from the receipt via
 * extractGeneralEngineInput (the v0.3 receipt is self-sufficient for replay).
 *
 * @param receipt  A v0.2.0-schema GeneralReceipt whose verification_state
 *                 claim is being discharged. Typically loaded via parseReceipt(file)
 *                 with schemaVersion === "0.2.0", then cast to GeneralReceipt.
 * @param input    Optional override for the engine input. If omitted,
 *                 extracted from the receipt itself.
 * @returns        VerifyEngineResult — same shape as verifyEngineReproduces.
 */
export function verifyGeneralEngineReproduces(
  receipt: GeneralReceipt,
  input?: GeneralInput,
): VerifyEngineResult {
  const engineInput = input ?? extractGeneralEngineInput(receipt);
  const ourReceipt = runGeneralStep(engineInput);
  const ourBytes = emitGeneralReceipt(ourReceipt);
  const theirBytes = emitGeneralReceipt(receipt);
  if (ourBytes === theirBytes) {
    return { matches: true, bytes: ourBytes, digest: sha256Hex(ourBytes) };
  }
  let i = 0;
  const minLen = Math.min(ourBytes.length, theirBytes.length);
  while (i < minLen && ourBytes[i] === theirBytes[i]) i++;
  return { matches: false, ourBytes, theirBytes, firstDifferingByte: i };
}
