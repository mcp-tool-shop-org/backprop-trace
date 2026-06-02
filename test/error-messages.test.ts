/**
 * Stage C humanization: hint-suffix presence tests.
 *
 * Pins that the helpfulness improvements landed in Stage B+C cannot regress
 * silently. Each error path in the public API and CLI must emit a "Hint:"
 * suffix telling the caller what to do next — not just what went wrong. If
 * a future PR strips the hint to "shorten the message," this test breaks.
 *
 * Covered paths:
 *   1. FormatPolicyError messages (NON_PLAIN_DECIMAL_INPUT and
 *      PLAIN_DECIMAL_OUT_OF_SCOPE) — call formatDecimalStringForFixture
 *      with bad input, assert err.message.includes('Hint:').
 *   2. formatNumberForEngine non-finite error — call with NaN, assert
 *      err.message.includes('Hint:'). (NaN routes through the
 *      non-finite branch before reaching policy, so the hint here
 *      points at the upstream engine-input-validation layer.)
 *   3. runMazurStep input-validation error — call with NaN in input,
 *      assert error.message.includes('Hint:').
 *   4. bp CLI ENOENT error — invoke `bp reconcile receipt nonexistent.json`,
 *      assert stderr.includes('Hint:'). Also test JSON mode: the hint goes
 *      into the JSON error object's `message` field.
 *
 * Why this exists: research-grounding.md Finding 1 (Petricek &
 * Plasmeijer-style helpfulness norms — error messages that name the
 * remediation, not just the failure). The Hint: convention is the
 * lightweight in-message form of that practice. This test makes the
 * convention load-bearing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  formatDecimalStringForFixture,
  FormatPolicyError,
} from "../src/format.js";
import { formatNumberForEngine } from "../src/runtime-format.js";
import { runMazurStep } from "../src/engine.js";
import { MAZUR_INPUT, type MazurInput } from "../src/mazur.js";
// Public-surface re-export (G-047): the library re-exports RULE_DESCRIPTIONS
// from ./reconcile via src/index.ts. Imported here so the sync-ratchet test
// also pins that the public re-export stays wired and in sync.
import { RULE_DESCRIPTIONS as PUBLIC_RULE_DESCRIPTIONS } from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function runBp(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/bin/bp.ts", ...args],
    { cwd: repoRoot, encoding: "utf-8" },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// =============================================================================
// 1. FormatPolicyError — both kinds must include "Hint:"
// =============================================================================

test("Stage C: FormatPolicyError(NON_PLAIN_DECIMAL_INPUT) message contains 'Hint:'", () => {
  let caught: unknown;
  try {
    // "1.5e3" is scientific notation — fails PLAIN_DECIMAL_REGEX,
    // triggering NON_PLAIN_DECIMAL_INPUT.
    formatDecimalStringForFixture("1.5e3");
  } catch (e) {
    caught = e;
  }
  assert.ok(
    caught instanceof FormatPolicyError,
    `expected FormatPolicyError, got ${String(caught)}`,
  );
  assert.strictEqual(
    (caught as FormatPolicyError).kind,
    "NON_PLAIN_DECIMAL_INPUT",
  );
  assert.ok(
    (caught as Error).message.includes("Hint:"),
    `NON_PLAIN_DECIMAL_INPUT message must include 'Hint:' (humanization); got ${JSON.stringify((caught as Error).message)}`,
  );
});

test("Stage C: FormatPolicyError(PLAIN_DECIMAL_OUT_OF_SCOPE) below min message contains 'Hint:'", () => {
  let caught: unknown;
  try {
    // "0.00000000000001" (1e-14) is below the v0.3 floor (1e-12 user-intent,
    // accepts down to leading-exponent -13 for IEEE-754 1e-12 round-trips).
    formatDecimalStringForFixture("0.00000000000001");
  } catch (e) {
    caught = e;
  }
  assert.ok(
    caught instanceof FormatPolicyError,
    `expected FormatPolicyError, got ${String(caught)}`,
  );
  assert.strictEqual(
    (caught as FormatPolicyError).kind,
    "PLAIN_DECIMAL_OUT_OF_SCOPE",
  );
  assert.ok(
    (caught as Error).message.includes("Hint:"),
    `PLAIN_DECIMAL_OUT_OF_SCOPE (below min) message must include 'Hint:'; got ${JSON.stringify((caught as Error).message)}`,
  );
});

test("Stage C: FormatPolicyError(PLAIN_DECIMAL_OUT_OF_SCOPE) above max message contains 'Hint:'", () => {
  let caught: unknown;
  try {
    // "99999999" is >= 1e7.
    formatDecimalStringForFixture("99999999");
  } catch (e) {
    caught = e;
  }
  assert.ok(
    caught instanceof FormatPolicyError,
    `expected FormatPolicyError, got ${String(caught)}`,
  );
  assert.strictEqual(
    (caught as FormatPolicyError).kind,
    "PLAIN_DECIMAL_OUT_OF_SCOPE",
  );
  assert.ok(
    (caught as Error).message.includes("Hint:"),
    `PLAIN_DECIMAL_OUT_OF_SCOPE (above max) message must include 'Hint:'; got ${JSON.stringify((caught as Error).message)}`,
  );
});

// =============================================================================
// 2. formatNumberForEngine non-finite error must include "Hint:"
// =============================================================================

test("Stage C: formatNumberForEngine(NaN) error message contains 'Hint:'", () => {
  let caught: unknown;
  try {
    formatNumberForEngine(Number.NaN);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof Error, `expected Error, got ${String(caught)}`);
  assert.ok(
    (caught as Error).message.includes("Hint:"),
    `formatNumberForEngine(NaN) error must include 'Hint:'; got ${JSON.stringify((caught as Error).message)}`,
  );
});

test("Stage C: formatNumberForEngine(Infinity) error message contains 'Hint:'", () => {
  let caught: unknown;
  try {
    formatNumberForEngine(Number.POSITIVE_INFINITY);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof Error, `expected Error, got ${String(caught)}`);
  assert.ok(
    (caught as Error).message.includes("Hint:"),
    `formatNumberForEngine(Infinity) error must include 'Hint:'; got ${JSON.stringify((caught as Error).message)}`,
  );
});

// =============================================================================
// 3. runMazurStep input-validation error must include "Hint:"
// =============================================================================

test("Stage C: runMazurStep(NaN in inputs) error message contains 'Hint:'", () => {
  // Clone MAZUR_INPUT via structuredClone and mutate inputs.i1 to NaN.
  const input = structuredClone(MAZUR_INPUT) as unknown as {
    inputs: { i1: number; i2: number };
  };
  input.inputs.i1 = Number.NaN;
  let caught: unknown;
  try {
    runMazurStep(input as unknown as MazurInput);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof Error, `expected Error, got ${String(caught)}`);
  assert.ok(
    (caught as Error).message.includes("Hint:"),
    `runMazurStep(NaN input) error must include 'Hint:'; got ${JSON.stringify((caught as Error).message)}`,
  );
});

test("Stage C: runMazurStep(learning_rate <= 0) error message contains 'Hint:'", () => {
  const input = structuredClone(MAZUR_INPUT) as unknown as {
    learning_rate: number;
  };
  input.learning_rate = 0;
  let caught: unknown;
  try {
    runMazurStep(input as unknown as MazurInput);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof Error, `expected Error, got ${String(caught)}`);
  assert.ok(
    (caught as Error).message.includes("Hint:"),
    `runMazurStep(lr=0) error must include 'Hint:'; got ${JSON.stringify((caught as Error).message)}`,
  );
});

test("Stage C: runMazurStep(bad bias_sharing) error message contains 'Hint:'", () => {
  const input = structuredClone(MAZUR_INPUT) as unknown as {
    topology: { bias_sharing: string };
  };
  input.topology.bias_sharing = "per_neuron";
  let caught: unknown;
  try {
    runMazurStep(input as unknown as MazurInput);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof Error, `expected Error, got ${String(caught)}`);
  assert.ok(
    (caught as Error).message.includes("Hint:"),
    `runMazurStep(bad bias_sharing) error must include 'Hint:'; got ${JSON.stringify((caught as Error).message)}`,
  );
});

// =============================================================================
// 4. bp CLI ENOENT error must include "Hint:"
// =============================================================================

test("Stage C: bp reconcile receipt <nonexistent> stderr contains 'Hint:' (human mode)", () => {
  const { status, stderr } = runBp([
    "reconcile",
    "receipt",
    "fixtures/this/file/does/not/exist.json",
  ]);
  assert.strictEqual(status, 2, "missing-file path must exit 2");
  assert.ok(
    stderr.includes("Hint:"),
    `bp ENOENT stderr must include 'Hint:' for humanization; got ${JSON.stringify(stderr)}`,
  );
});

test("Stage C: bp --json reconcile receipt <nonexistent> emits Tier-1 envelope with structured hint (json mode)", () => {
  // v0.7.0 shipcheck B1 migration: the ENOENT path emits hint as a
  // STRUCTURED field, not embedded in the message string. The pre-v0.7
  // assertion that error.message contains "Hint:" no longer holds because
  // the migration moves the hint out into error.hint per Tier-1 shape.
  const { status, stdout, stderr } = runBp([
    "--json",
    "reconcile",
    "receipt",
    "fixtures/this/file/does/not/exist.json",
  ]);
  assert.strictEqual(status, 2, "missing-file path must exit 2 even in --json mode");
  assert.strictEqual(
    stderr,
    "",
    "--json mode must suppress stderr so stdout is parseable; got " + JSON.stringify(stderr),
  );
  const parsed = JSON.parse(stdout.trim()) as {
    ok: boolean;
    error: {
      code?: string;
      message?: string;
      hint?: string;
      retryable?: boolean;
    };
  };
  assert.strictEqual(parsed.ok, false, `error envelope must have ok:false; got ${JSON.stringify(parsed)}`);
  assert.strictEqual(parsed.error?.code, "ENOENT");
  assert.ok(
    typeof parsed.error?.message === "string" && parsed.error.message.includes("file not found"),
    `error.message must describe the not-found state; got ${JSON.stringify(parsed)}`,
  );
  // v0.7.0 Tier-1 assertion: hint is a STRUCTURED field, not embedded
  // in message. The migration is the intentional shipcheck B1 win.
  assert.ok(
    typeof parsed.error?.hint === "string" && parsed.error.hint.includes("check the path"),
    `--json ENOENT error.hint must be a structured field with the recovery instruction; got ${JSON.stringify(parsed)}`,
  );
  // Negative assertion: message must NOT contain "Hint:" (it now lives
  // in the structured field; this is the Tier-1 contract).
  assert.ok(
    !parsed.error.message!.includes("Hint:"),
    `v0.7.0 Tier-1 migration: hint must NOT be embedded in error.message; it lives in error.hint. ` +
      `Got message: ${JSON.stringify(parsed.error.message)}`,
  );
});

test("Stage C: bp reconcile receipt <malformed JSON> stderr contains 'Hint:' (human mode)", () => {
  // Avoid overwriting any production fixture — write to tmp/ which is
  // gitignored. The runtime-format test already writes here so the path exists.
  const tmpDir = resolve(repoRoot, "tmp");
  mkdirSync(tmpDir, { recursive: true });
  const path = resolve(tmpDir, "bp-cli-error-message-malformed.json");
  writeFileSync(path, "{not valid", { encoding: "utf-8" });

  const { status, stderr } = runBp(["reconcile", "receipt", path]);
  assert.strictEqual(status, 2, "malformed JSON must exit 2");
  assert.ok(
    stderr.includes("Hint:"),
    `bp invalid-JSON stderr must include 'Hint:' for humanization; got ${JSON.stringify(stderr)}`,
  );
});

// =============================================================================
// G-046: renderFailure must use NEUTRAL wording, not gradient-specific labels.
//
// renderFailure (src/bin/bp.ts) historically hardcoded "stored gradient:" /
// "recomputed gradient:" for EVERY rule. Many rules are not about gradients:
// Rule 1 (output error signal), Rule 11 (softmax sum), Rule 12 (loss formula),
// Rules 16/17 (attestation/bundle digests). For those, "gradient" is simply
// wrong. The fix renders neutral "stored value:" / "recomputed value:"; the
// per-rule nature of the mismatch is already named on the header line via
// RULE_LABELS[f.rule].
//
// We exercise a Rule 12 (loss formula) failure — unambiguously NOT a gradient
// — via fixtures/bad/mazur.bad-loss-total.jsonl and assert the rendered human
// output uses the neutral labels and does NOT say "gradient".
// =============================================================================

test("G-046: non-gradient rule failure (Rule 12 loss) renders neutral 'value' labels, not 'gradient'", () => {
  const { status, stderr } = runBp([
    "reconcile",
    "receipt",
    "fixtures/bad/mazur.bad-loss-total.jsonl",
  ]);
  assert.strictEqual(status, 1, "a failing reconcile must exit 1");
  // Sanity: we are actually exercising the loss-formula rule (Rule 12), a
  // rule that has nothing to do with gradients.
  assert.match(
    stderr,
    /Rule 12:/,
    `expected a Rule 12 (loss formula) failure from the bad-loss-total fixture; got ${JSON.stringify(stderr)}`,
  );
  // Neutral wording present.
  assert.match(
    stderr,
    /stored value:/,
    `renderFailure must emit neutral 'stored value:' for non-gradient rules; got ${JSON.stringify(stderr)}`,
  );
  assert.match(
    stderr,
    /recomputed value:/,
    `renderFailure must emit neutral 'recomputed value:' for non-gradient rules; got ${JSON.stringify(stderr)}`,
  );
  // Gradient-specific wording GONE. This is the load-bearing assertion: it
  // fails against the pre-G-046 hardcoded "stored gradient:" / "recomputed
  // gradient:" labels.
  assert.doesNotMatch(
    stderr,
    /stored gradient:/,
    `renderFailure must NOT hardcode 'stored gradient:' for a loss-formula failure; got ${JSON.stringify(stderr)}`,
  );
  assert.doesNotMatch(
    stderr,
    /recomputed gradient:/,
    `renderFailure must NOT hardcode 'recomputed gradient:' for a loss-formula failure; got ${JSON.stringify(stderr)}`,
  );
});

test("G-046: a genuine gradient rule (Rule 4 update.gradient) STILL renders 'gradient'", () => {
  // The G-046 fix is per-rule, not a blanket rename: rules whose compared
  // quantity literally IS a gradient must keep the precise "gradient" noun.
  // mazur.bad-gradient.jsonl mutates update.gradient on w5 → a Rule 4 failure.
  // This pins the OTHER direction of the contract so a future "just neutralize
  // everything" change can't silently make Rule 4 read "value" (which would
  // also break the reconciler-owned reconcile.bad-gradient.cli.test.ts).
  const { status, stderr } = runBp([
    "reconcile",
    "receipt",
    "fixtures/bad/mazur.bad-gradient.jsonl",
  ]);
  assert.strictEqual(status, 1, "the bad-gradient fixture must fail reconcile");
  assert.match(
    stderr,
    /Rule 4: .* on w5/,
    `expected a Rule 4 failure naming w5; got ${JSON.stringify(stderr)}`,
  );
  assert.match(
    stderr,
    /stored gradient:\s+-0\.082166041/,
    `Rule 4's stored quantity IS a gradient and must render as 'stored gradient:'; got ${JSON.stringify(stderr)}`,
  );
  assert.match(
    stderr,
    /recomputed gradient:/,
    `Rule 4 must render 'recomputed gradient:'; got ${JSON.stringify(stderr)}`,
  );
});

// =============================================================================
// G-047: RULE_LABELS (src/bin/bp.ts) and RULE_DESCRIPTIONS (src/reconcile.ts)
// must cover the SAME rule-number set — a sync ratchet.
//
// RULE_LABELS supplies the per-rule header line in renderFailure; if the
// reconciler can emit a failure for rule N but RULE_LABELS has no entry for N,
// renderFailure silently falls back to "rule mismatch" (an information loss for
// the user). Conversely, an orphan RULE_LABELS entry signals dead/duplicated
// rule numbering. Both directions are drift; this test pins set equality.
//
// Implemented as a STATIC source lint (regex over the two object-literal key
// sets) rather than importing the modules. bp.ts is an executable script with
// top-level dispatch that calls process.exit() on import, so it cannot be
// imported into a test harness; parsing the source keeps the ratchet
// side-effect-free and works regardless of module load semantics.
// =============================================================================

/**
 * Extract the integer keys of a `const <NAME>: Record<number, string> = { … }`
 * object literal from TypeScript source. Returns a sorted ascending array of
 * the leading-integer property keys (`  17: "…"` → 17). Throws if the literal
 * is not found, so a rename of either map breaks the ratchet loudly instead of
 * vacuously passing on an empty set.
 */
function extractRuleNumberKeys(source: string, constName: string): number[] {
  const startMarker = `const ${constName}: Record<number, string> = {`;
  const startIdx = source.indexOf(startMarker);
  assert.notStrictEqual(
    startIdx,
    -1,
    `could not locate '${constName}' object literal — did it get renamed? ` +
      `The G-047 sync ratchet depends on the '${startMarker}' marker.`,
  );
  // Find the matching closing brace by tracking depth from the opening '{'.
  const openBraceIdx = startIdx + startMarker.length - 1;
  let depth = 0;
  let endIdx = -1;
  for (let i = openBraceIdx; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }
  assert.notStrictEqual(
    endIdx,
    -1,
    `could not find the closing brace for '${constName}'`,
  );
  const body = source.slice(openBraceIdx + 1, endIdx);
  // Match keys at the start of a line (allowing indentation): `  17:`.
  const keys: number[] = [];
  const keyRe = /(?:^|\n)\s*(\d+)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(body)) !== null) {
    keys.push(Number(m[1]));
  }
  return [...new Set(keys)].sort((a, b) => a - b);
}

test("G-047: RULE_LABELS (bp.ts) and RULE_DESCRIPTIONS (reconcile.ts) cover the same rule-number set", () => {
  const bpSource = readFileSync(resolve(repoRoot, "src/bin/bp.ts"), "utf-8");
  const reconcileSource = readFileSync(
    resolve(repoRoot, "src/reconcile.ts"),
    "utf-8",
  );

  const labelKeys = extractRuleNumberKeys(bpSource, "RULE_LABELS");
  const descKeys = extractRuleNumberKeys(reconcileSource, "RULE_DESCRIPTIONS");

  // Non-vacuity guard: both maps must actually carry rules (catches a regex
  // that silently matched nothing).
  assert.ok(
    labelKeys.length >= 10,
    `RULE_LABELS parse looks empty/under-populated (${labelKeys.length} keys); ratchet would be vacuous`,
  );
  assert.ok(
    descKeys.length >= 10,
    `RULE_DESCRIPTIONS parse looks empty/under-populated (${descKeys.length} keys); ratchet would be vacuous`,
  );

  const labelSet = new Set(labelKeys);
  const descSet = new Set(descKeys);
  const labelsMissingFromDesc = labelKeys.filter((k) => !descSet.has(k));
  const descsMissingFromLabels = descKeys.filter((k) => !labelSet.has(k));

  assert.deepStrictEqual(
    labelsMissingFromDesc,
    [],
    `every RULE_LABELS rule must have a RULE_DESCRIPTIONS entry (orphan labels => dead/duplicated numbering). ` +
      `Missing from RULE_DESCRIPTIONS: ${JSON.stringify(labelsMissingFromDesc)}`,
  );
  assert.deepStrictEqual(
    descsMissingFromLabels,
    [],
    `every RULE_DESCRIPTIONS rule must have a RULE_LABELS entry, else renderFailure falls back to "rule mismatch". ` +
      `Missing from RULE_LABELS: ${JSON.stringify(descsMissingFromLabels)}`,
  );
  // Belt-and-braces: the full sets must be identical.
  assert.deepStrictEqual(
    labelKeys,
    descKeys,
    `RULE_LABELS and RULE_DESCRIPTIONS rule-number sets must be identical. ` +
      `labels=${JSON.stringify(labelKeys)} descriptions=${JSON.stringify(descKeys)}`,
  );

  // G-047 part 1: the PUBLIC re-export (src/index.ts → ./reconcile) must be
  // wired and expose the same rule-number set as the reconcile.ts source.
  // Catches a dropped/renamed re-export in index.ts independently of the
  // static source parse above.
  const publicDescKeys = Object.keys(PUBLIC_RULE_DESCRIPTIONS)
    .map(Number)
    .sort((a, b) => a - b);
  assert.deepStrictEqual(
    publicDescKeys,
    descKeys,
    `the public RULE_DESCRIPTIONS re-export (src/index.ts) must expose the same ` +
      `rule set as reconcile.ts. public=${JSON.stringify(publicDescKeys)} source=${JSON.stringify(descKeys)}`,
  );
});
