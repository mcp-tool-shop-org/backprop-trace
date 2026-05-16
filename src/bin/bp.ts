#!/usr/bin/env node
/**
 * bp — backprop-trace CLI
 *
 * v0.2 surface (still no framework, still dep-light dispatch):
 *
 *   bp reconcile receipt <file>      Run the reconciler on a receipt JSON/JSONL.
 *                                    Exit 0 if all 8 rules pass within tolerance.
 *                                    Exit 1 with stderr describing failures.
 *
 *   bp verify mazur [<file>]         Full gate per docs/reconciliation.md:264:
 *                                    schema-validate + reconcile + engine-reproduce
 *                                    + byte-equal-vs-golden + fixture_status enum
 *                                    + published-anchor drift (hard vs soft gate).
 *                                    Default subject: fixtures/mazur.golden.jsonl.
 *
 *   bp generate mazur                Re-run the Mazur 2-2-2 engine and emit the
 *                                    canonical JSONL receipt to stdout, or to
 *                                    --out <file>, or compare against the golden
 *                                    with --check (exit 1 on drift).
 *
 *   bp validate <file>               Schema-validate a receipt against
 *                                    schemas/receipt.v0.1.0.json. No math.
 *
 *   bp --version | -v                Print package version, exit 0.
 *   bp --help    | -h                Print usage, exit 0.
 *
 *   bp ... --json                    Machine-readable JSON output to stdout.
 *                                    Color is suppressed under --json.
 *
 *   bp ... --verbose | -V            Diagnostic stderr (file path, schema_version,
 *                                    fixture id) before the run.
 *
 *   bp ... --color=auto|never|always Control ANSI color on stderr/stdout text
 *                                    output. Honors NO_COLOR. Default: auto
 *                                    (color iff the destination is a TTY).
 *
 *   <file> = "-"                     For reconcile/validate, read receipt JSON
 *                                    from stdin (assume .json shape; no .jsonl
 *                                    extension sniffing).
 *
 * Exit codes (4-bucket; aligns with study-swarm + shellcheck convention):
 *   0  success / pass
 *   1  reconciliation or verification failure
 *   2  usage or I/O error (missing file, permission denied, malformed JSON, …)
 *   3  invalid CLI argument (unknown flag, malformed --color value, …)
 *
 * The CLI is itself a consumer of the public library API — every domain
 * primitive comes from "../index.js" (the published barrel) so the surface
 * tested by the CLI matches the surface a third-party caller would see.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { createRequire } from "node:module";
import {
  reconcileReceipt,
  type ReconciliationFailure,
  validateReceiptSchema,
  verifyEngineReproduces,
  runMazurStep,
  emitMazurReceipt,
  MAZUR_INPUT,
} from "../index.js";

const require = createRequire(import.meta.url);
// Path resolves identically from both src/bin/bp.ts (test via tsx) and
// dist/bin/bp.js (built artifact) — both live two directories deep from
// the package root.
const pkg = require("../../package.json") as { version: string };

/**
 * Human-readable label per reconciliation rule index. Matches
 * docs/reconciliation.md "The eight rules" section. All 8 rules are wired
 * as of v0.2; rule 0 is the structural-failure sentinel.
 */
const RULE_LABELS: Record<number, string> = {
  0: "structural failure",
  1: "output_error_signal mismatch",
  2: "backpropagated_sum or contribution mismatch",
  3: "hidden_error_signal mismatch",
  4: "update.gradient mismatch",
  5: "update.update inconsistent with update.gradient",
  6: "weight_after inconsistent with weight_before + update",
  7: "parameters_after inconsistent with parameters_before + update",
  8: "factor value disagrees with provenance",
};

// =============================================================================
// argv parsing
// =============================================================================

const rawArgv = process.argv.slice(2);

// Flags handled here are agnostic to subcommand position so users can write
// `bp --json reconcile receipt foo.json` or
// `bp reconcile receipt foo.json --json`. Help/version are intentionally
// still position-sensitive (they're meant to be the first token).
const FLAG_TOKENS = new Set([
  "--json",
  "--format=json",
  "--verbose",
  "-V",
  "--warn-as-fail",
  "--strict",
  "--check",
]);

function valueFlag(flag: string): string | undefined {
  // Supports both `--flag value` and `--flag=value`.
  const eqPrefix = `${flag}=`;
  for (let i = 0; i < rawArgv.length; i += 1) {
    const token = rawArgv[i] ?? "";
    if (token.startsWith(eqPrefix)) return token.slice(eqPrefix.length);
    if (token === flag) return rawArgv[i + 1];
  }
  return undefined;
}

function hasFlag(flag: string): boolean {
  return rawArgv.includes(flag);
}

const jsonMode = rawArgv.some((a) => a === "--json" || a === "--format=json");
const verboseMode = rawArgv.some((a) => a === "--verbose" || a === "-V");
const warnAsFail = hasFlag("--warn-as-fail");
const strictMode = hasFlag("--strict");
const checkMode = hasFlag("--check");
const outFile = valueFlag("--out");
const colorOpt = valueFlag("--color");

// Validate --color value early so the user gets exit-3 with a clear message
// before any subcommand work begins.
if (colorOpt !== undefined && !["auto", "never", "always"].includes(colorOpt)) {
  process.stderr.write(
    `bp: invalid value for --color: '${colorOpt}'. Expected 'auto', 'never', or 'always'.\n`,
  );
  process.exit(3);
}

// Strip every flag we recognize from argv before subcommand dispatch.
// Value-bearing flags also consume their next-token form (--out FILE).
function stripFlags(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] ?? "";
    if (FLAG_TOKENS.has(a)) continue;
    if (a.startsWith("--color")) continue;
    if (a === "--out") {
      // skip the next token (the value)
      i += 1;
      continue;
    }
    if (a.startsWith("--out=")) continue;
    out.push(a);
  }
  return out;
}

const argv = stripFlags(rawArgv);

// =============================================================================
// color helpers (FT-C-004)
// =============================================================================

function shouldUseColor(stream: NodeJS.WriteStream): boolean {
  if (jsonMode) return false; // JSON output is never colorized.
  if (process.env.NO_COLOR !== undefined) return false;
  if (colorOpt === "never") return false;
  if (colorOpt === "always") return true;
  // auto / undefined: only when destination is a TTY.
  return Boolean(stream.isTTY);
}

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function color(text: string, code: string, enabled: boolean): string {
  return enabled ? `${code}${text}${RESET}` : text;
}

// =============================================================================
// output helpers
// =============================================================================

/**
 * Emit a usage/IO error. In human mode (default): writes to stderr and
 * exits with the given code (default 2). In JSON mode: writes a structured
 * error envelope to stdout and exits with the same code. Stderr is
 * suppressed under --json so CI consumers can parse stdout cleanly.
 */
function exitWithUsageError(message: string, code = "USAGE", exitCode = 2): never {
  if (jsonMode) {
    const envelope = JSON.stringify({
      ok: false,
      error: { code, message },
    });
    process.stdout.write(`${envelope}\n`);
  } else {
    process.stderr.write(`bp: ${message}\n`);
  }
  process.exit(exitCode);
}

function verboseLog(message: string): void {
  if (!verboseMode) return;
  // verbose diagnostics always go to stderr, even under --json, so they
  // don't pollute the parseable stdout. Prefix with `bp:` so CI grep
  // can pick them up.
  process.stderr.write(`bp: ${message}\n`);
}

// =============================================================================
// receipt reading (file + stdin)
// =============================================================================

/**
 * Read and parse a receipt file. Supports `.json` (whole-file JSON) and
 * `.jsonl` (one JSON record per line, v0.1 = exactly one record).
 *
 * For `.jsonl` we first try strict line-by-line parsing. If every
 * non-empty line is a valid standalone JSON document, that is the record
 * set and v0.1 requires exactly one. Otherwise the file may be a
 * pretty-printed JSON object with a `.jsonl` extension (the v0.1
 * mazur.bad-gradient.jsonl fixture is shaped this way) — fall back to
 * parsing the whole file as a single JSON document.
 *
 * The special filename "-" reads from stdin and assumes JSON shape
 * (no extension to sniff).
 *
 * Throws on I/O errors and on JSON SyntaxError — callers translate
 * to exit-2.
 */
function readReceipt(file: string): unknown {
  if (file === "-") {
    const raw = readFileSync(0, "utf-8");
    return JSON.parse(raw);
  }

  const raw = readFileSync(file, "utf-8");
  const ext = extname(file).toLowerCase();

  if (ext === ".jsonl") {
    const nonEmptyLines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);

    // Try strict line-by-line JSONL parse first.
    const lineRecords: unknown[] = [];
    let allLinesParseStandalone = true;
    for (const line of nonEmptyLines) {
      try {
        lineRecords.push(JSON.parse(line));
      } catch {
        allLinesParseStandalone = false;
        break;
      }
    }

    if (allLinesParseStandalone && lineRecords.length > 0) {
      if (lineRecords.length !== 1) {
        const err = new Error(
          `v0.1 bp reconcile receipt accepts only single-record JSONL files; got ${lineRecords.length} records`,
        );
        (err as Error & { code?: string }).code = "BP_JSONL_MULTI_RECORD";
        throw err;
      }
      return lineRecords[0];
    }

    // Fallback: whole-file parse (pretty-printed JSON masquerading as
    // .jsonl). This yields exactly one record by construction.
    return JSON.parse(raw);
  }

  // .json (or anything else): parse whole file.
  return JSON.parse(raw);
}

/**
 * Translate I/O / parse errors thrown by readReceipt into the canonical
 * exit-2 envelope. Centralized here so reconcile + validate share the
 * recovery hints verbatim.
 */
function exitOnReadError(err: unknown, file: string): never {
  const e = err as NodeJS.ErrnoException;
  if (e && e.code === "ENOENT") {
    exitWithUsageError(
      `file not found: ${file}. Hint: check the path or run from the repo root.`,
      "ENOENT",
    );
  }
  if (e && e.code === "EACCES") {
    exitWithUsageError(
      `permission denied: ${file}. Hint: check file permissions.`,
      "EACCES",
    );
  }
  if (e && e.code === "EISDIR") {
    exitWithUsageError(
      `path is a directory, not a file: ${file}. Hint: provide a file path.`,
      "EISDIR",
    );
  }
  if ((e as Error & { code?: string }).code === "BP_JSONL_MULTI_RECORD") {
    exitWithUsageError(e.message, "BP_JSONL_MULTI_RECORD");
  }
  if (err instanceof SyntaxError) {
    exitWithUsageError(
      `invalid JSON in ${file}: ${err.message}. Hint: validate the receipt structure against schemas/receipt.v0.1.0.json before reconciling.`,
      "INVALID_JSON",
    );
  }
  // Unknown I/O failure — preserve the stack for developer visibility
  // in human mode; emit a structured fallback in JSON mode.
  if (jsonMode) {
    const message = err instanceof Error ? err.message : String(err);
    exitWithUsageError(`unexpected error reading ${file}: ${message}`, "IO_ERROR");
  }
  throw err;
}

/**
 * Best-effort extraction of schema_version + fixture id from a parsed
 * receipt, for verbose-mode diagnostics. Tolerates any shape — never
 * throws.
 */
function describeReceipt(receipt: unknown): { schemaVersion?: string; fixtureId?: string } {
  if (typeof receipt !== "object" || receipt === null) return {};
  const r = receipt as Record<string, unknown>;
  const out: { schemaVersion?: string; fixtureId?: string } = {};
  if (typeof r.schema_version === "string") out.schemaVersion = r.schema_version;
  // fixture id can live under fixture, fixture_id, id, or under provenance.fixture_id.
  if (typeof r.fixture === "string") {
    out.fixtureId = r.fixture;
  } else if (typeof r.fixture_id === "string") {
    out.fixtureId = r.fixture_id;
  } else if (typeof r.id === "string") {
    out.fixtureId = r.id;
  } else {
    const provenance = r.provenance;
    if (typeof provenance === "object" && provenance !== null) {
      const p = provenance as Record<string, unknown>;
      if (typeof p.fixture_id === "string") out.fixtureId = p.fixture_id;
      else if (typeof p.id === "string") out.fixtureId = p.id;
    }
  }
  return out;
}

// =============================================================================
// renderers
// =============================================================================

function renderFailure(f: ReconciliationFailure): string {
  const label = RULE_LABELS[f.rule] ?? "rule mismatch";
  const lines = [
    `Rule ${f.rule}: ${label} on ${f.parameter_id ?? "(unknown parameter)"}`,
    `  field_path:          ${f.field_path}`,
    `  stored gradient:     ${f.stored}`,
    `  recomputed gradient: ${f.recomputed}`,
    `  delta:               ${f.delta.toExponential(9)}`,
    `  tolerance:           ${f.tolerance.toExponential(9)}`,
  ];
  if (f.cascade_of_rule !== undefined) {
    lines.push(
      `  Note: cascades from Rule ${f.cascade_of_rule}. Fix Rule ${f.cascade_of_rule} first.`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

// =============================================================================
// usage text
// =============================================================================

function usageText(): string {
  return [
    `bp — backprop-trace CLI v${pkg.version}`,
    "",
    "Usage:",
    "  bp reconcile receipt <file>     Reconcile a receipt against the 8 rules",
    "  bp verify mazur [<file>]        Full gate: schema + reconcile + byte-equal + drift",
    "  bp generate mazur               Re-run engine, emit canonical bytes",
    "  bp validate <file>              Schema-validate a receipt",
    "  bp --version                    Print version",
    "  bp --help                       Print this message",
    "",
    "OPTIONS",
    "  --json                          Machine-readable JSON output",
    "  --verbose, -V                   Diagnostic stderr",
    "  --color=auto|never|always       Color output (auto detects TTY; honors NO_COLOR)",
    "  --out <file>                    (generate mazur only) write to file",
    "  --check                         (generate mazur only) compare vs golden, exit 1 on drift",
    "  --warn-as-fail                  (verify mazur only) treat WARNs as failures",
    "  --strict                        (verify mazur only) treat any non-PASS as failure",
    "  -                               (file arg) read from stdin",
    "  --help, -h                      Print this message",
    "",
    "Exit codes",
    "  0  success / pass",
    "  1  reconciliation/verification failure",
    "  2  usage or I/O error",
    "  3  invalid CLI argument",
    "",
    "EXAMPLES",
    "  bp reconcile receipt fixtures/mazur.golden.jsonl",
    "  bp verify mazur",
    "  bp generate mazur --check",
    "  bp validate fixtures/mazur.golden.jsonl",
    "  echo '{...}' | bp validate -",
    "",
    "For more information: https://github.com/mcp-tool-shop-org/backprop-trace",
    "",
  ].join("\n");
}

function receiptUsageText(): string {
  return [
    "Usage: bp reconcile receipt <file> [--json] [--verbose]",
    "",
    "  Reconcile the math claims in a receipt against the 8 rules in",
    "  docs/reconciliation.md.",
    "",
    "  <file>  Path to a receipt JSON document. Accepted extensions:",
    "            .json   — parsed as a single JSON document.",
    "            .jsonl  — parsed as JSONL containing exactly one record",
    "                      (v0.1 limitation).",
    "            -       — read JSON from stdin.",
    "",
    "  Options:",
    "    --json         Emit machine-readable JSON to stdout instead of human text.",
    "    --verbose, -V  Print processing diagnostics to stderr before the run.",
    "",
    "  Exit codes:",
    "    0  All implemented rules pass within tolerance.",
    "    1  At least one rule failed; details on stderr (or stdout with --json).",
    "    2  Usage or I/O error (missing file, unreadable, invalid JSON,",
    "       or >1 record in a .jsonl file).",
    "",
  ].join("\n");
}

function verifyUsageText(): string {
  return [
    "Usage: bp verify mazur [<file>] [--json] [--verbose] [--warn-as-fail] [--strict]",
    "",
    "  Full gate per docs/reconciliation.md:264. Composes:",
    "    1. Schema validation against schemas/receipt.v0.1.0.json",
    "    2. Reconciliation against the 8 rules",
    "    3. Engine reproduction (re-run the engine, compare receipts)",
    "    4. Byte equality against fixtures/mazur.golden.jsonl",
    "    5. Fixture status enum checks",
    "    6. Published-anchor drift against fixtures/mazur.published.json",
    "       (hard_gate=true claims fail the build; hard_gate=false claims WARN)",
    "",
    "  <file>  Optional path to the receipt to verify. Default:",
    "          fixtures/mazur.golden.jsonl.",
    "",
    "  Options:",
    "    --json           Emit machine-readable JSON to stdout.",
    "    --verbose, -V    Diagnostic stderr.",
    "    --warn-as-fail   Treat WARN findings (e.g. soft-drift) as failures.",
    "    --strict         Treat any non-PASS finding (WARN, SKIP) as failure.",
    "",
    "  Exit codes:",
    "    0  All checks pass (or warn-only with default gating).",
    "    1  At least one check failed.",
    "    2  Usage or I/O error.",
    "    3  Invalid CLI argument.",
    "",
  ].join("\n");
}

function generateUsageText(): string {
  return [
    "Usage: bp generate mazur [--out <file>] [--check] [--json] [--verbose]",
    "",
    "  Re-run the Mazur 2-2-2 engine and emit the canonical JSONL receipt.",
    "",
    "  Default (no flags): write the canonical bytes to stdout.",
    "  --out <file>     Write to <file> instead of stdout.",
    "  --check          Compare against fixtures/mazur.golden.jsonl;",
    "                   exit 0 if byte-equal, exit 1 on drift.",
    "  --json           In --check mode, emit a JSON envelope to stdout",
    "                   reporting ok/false and drift_offset.",
    "",
    "  Exit codes:",
    "    0  Success (bytes written or --check passed).",
    "    1  Drift detected under --check.",
    "    2  Usage or I/O error.",
    "",
  ].join("\n");
}

function validateUsageText(): string {
  return [
    "Usage: bp validate <file> [--json] [--verbose]",
    "",
    "  Validate a receipt against schemas/receipt.v0.1.0.json.",
    "  Schema only — no math reconciliation, no engine reproduction.",
    "",
    "  <file>  Path to a receipt (.json or .jsonl), or '-' to read from stdin.",
    "",
    "  Options:",
    "    --json         Emit machine-readable JSON with errors[] array.",
    "    --verbose, -V  Diagnostic stderr.",
    "",
    "  Exit codes:",
    "    0  Receipt is structurally valid.",
    "    1  Receipt failed schema validation.",
    "    2  Usage or I/O error.",
    "",
  ].join("\n");
}

/**
 * Levenshtein-light suggestion for unknown subcommand. Hand-rolled
 * because the v0.2 surface only has four real top-level tokens.
 */
function suggestSubcommand(unknown: string): string | null {
  const candidates: Array<{ verb: string; example: string }> = [
    { verb: "reconcile", example: "bp reconcile receipt <file>" },
    { verb: "verify", example: "bp verify mazur" },
    { verb: "generate", example: "bp generate mazur" },
    { verb: "validate", example: "bp validate <file>" },
  ];
  for (const c of candidates) {
    if (c.verb.startsWith(unknown) || unknown.startsWith(c.verb)) {
      return c.example;
    }
  }
  return null;
}

// =============================================================================
// verify mazur (FT-C-001)
// =============================================================================

type VerifyCheckStatus = "pass" | "fail" | "warn" | "skip";
type VerifyCheck = {
  name: string;
  status: VerifyCheckStatus;
  message?: string;
  evidence?: unknown;
};
type VerifyReport = {
  overall: "pass" | "fail" | "warn";
  checks: VerifyCheck[];
};

const VALID_AUTHORING_STATES = new Set([
  "hand_derived",
  "engine_generated",
  "deliberately_corrupted",
]);
const VALID_VERIFICATION_STATES = new Set([
  "pending_engine_reproduction",
  "engine_reproduced_byte_equal",
  "expected_to_fail_reconciliation",
]);

type PublishedClaim = {
  id: string;
  value: number;
  hard_gate: boolean;
  engine_reproduced_value?: number;
  drift_absolute?: number;
};

type PublishedAnchor = {
  schema_version?: string;
  fixture?: string;
  claims?: PublishedClaim[];
};

/**
 * Drill into a parsed receipt by dot-separated key path. Returns undefined
 * if any segment is missing (does not throw — that's a soft-WARN later).
 * Tolerates numeric-indexed segments only for objects (no array indexing
 * in v0.2; the published-anchor claims target object paths).
 */
function resolveReceiptPath(receipt: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = receipt;
  for (const part of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
    if (cur === undefined) return undefined;
  }
  return cur;
}

/**
 * Default published-claim lookup paths. The v0.1 mazur.published.json
 * ships a single claim id (`post_update_total_error`); newer ids inherit
 * the default mapping below when added. Unknown ids resolve to undefined
 * and produce a SKIP rather than a FAIL.
 */
const CLAIM_PATHS: Record<string, string> = {
  post_update_total_error: "post_update_loss.total",
};

function runVerifyMazur(opts: {
  receiptPath: string;
  warnAsFail: boolean;
  strict: boolean;
}): VerifyReport {
  const checks: VerifyCheck[] = [];

  // 1. Read + parse the candidate receipt.
  let receipt: unknown;
  try {
    receipt = readReceipt(opts.receiptPath);
  } catch (err) {
    // Bubble up via the caller — verify is not the place to print I/O
    // hints; runVerifyMazur emits structured failures only for
    // semantic checks that ran.
    throw err;
  }

  // 2. Schema validation (FT-C-001 / FT-F-001).
  const validation = validateReceiptSchema(receipt);
  if (validation.ok) {
    checks.push({ name: "schema", status: "pass" });
  } else {
    checks.push({
      name: "schema",
      status: "fail",
      message: `schema validation failed (${validation.errors.length} error(s))`,
      evidence: validation.errors,
    });
  }

  // Short-circuit composition: don't try to reconcile or engine-reproduce
  // a receipt that doesn't structurally match the schema — the downstream
  // checks would crash on missing fields rather than report cleanly.
  if (!validation.ok) {
    return finalizeReport(checks, opts);
  }
  const typedReceipt = validation.receipt;

  // 3. Reconciliation (engine math).
  const reconciliation = reconcileReceipt(typedReceipt);
  if (reconciliation.ok) {
    checks.push({ name: "reconcile", status: "pass" });
  } else {
    checks.push({
      name: "reconcile",
      status: "fail",
      message: `${reconciliation.failures.length} rule failure(s)`,
      evidence: reconciliation.failures,
    });
  }

  // 4. Engine reproduction (re-run engine, compare to receipt).
  try {
    const engineRepro = verifyEngineReproduces(typedReceipt);
    if (engineRepro.matches) {
      checks.push({ name: "engine-reproduce", status: "pass" });
    } else {
      checks.push({
        name: "engine-reproduce",
        status: "fail",
        message: `engine output diverges from receipt at byte ${engineRepro.firstDifferingByte}`,
        evidence: {
          first_differing_byte: engineRepro.firstDifferingByte,
          our_length: engineRepro.ourBytes.length,
          their_length: engineRepro.theirBytes.length,
        },
      });
    }
  } catch (err) {
    checks.push({
      name: "engine-reproduce",
      status: "fail",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // 5. Byte equality vs the bundled golden — re-run the engine, emit
  // canonical bytes, compare against fixtures/mazur.golden.jsonl. This
  // is the load-bearing determinism claim.
  try {
    const goldenBytes = readFileSync("fixtures/mazur.golden.jsonl", "utf-8");
    const emitted = emitMazurReceipt(runMazurStep(MAZUR_INPUT));
    if (emitted === goldenBytes) {
      checks.push({ name: "byte-equal-vs-golden", status: "pass" });
    } else {
      // Find the first divergent offset so the failure message
      // pinpoints where the drift starts.
      let driftOffset = 0;
      const n = Math.min(emitted.length, goldenBytes.length);
      while (driftOffset < n && emitted[driftOffset] === goldenBytes[driftOffset]) {
        driftOffset += 1;
      }
      checks.push({
        name: "byte-equal-vs-golden",
        status: "fail",
        message: `engine bytes diverge from fixtures/mazur.golden.jsonl at offset ${driftOffset}`,
        evidence: { drift_offset: driftOffset, emitted_length: emitted.length, golden_length: goldenBytes.length },
      });
    }
  } catch (err) {
    checks.push({
      name: "byte-equal-vs-golden",
      status: "fail",
      message:
        err instanceof Error
          ? `byte-equal check could not run: ${err.message}`
          : "byte-equal check could not run",
    });
  }

  // 6. Fixture status enum checks.
  const fixtureStatus = (receipt as Record<string, unknown>).fixture_status as
    | Record<string, unknown>
    | undefined;
  if (!fixtureStatus || typeof fixtureStatus !== "object") {
    checks.push({
      name: "fixture-status",
      status: "fail",
      message: "fixture_status block is missing or not an object",
    });
  } else {
    const issues: string[] = [];
    const authoring = fixtureStatus.authoring_state;
    const verification = fixtureStatus.verification_state;
    const canonical = fixtureStatus.canonical;
    if (typeof authoring !== "string" || !VALID_AUTHORING_STATES.has(authoring)) {
      issues.push(
        `authoring_state must be one of ${[...VALID_AUTHORING_STATES].join(", ")}; got ${JSON.stringify(authoring)}`,
      );
    }
    if (
      typeof verification !== "string" ||
      !VALID_VERIFICATION_STATES.has(verification)
    ) {
      issues.push(
        `verification_state must be one of ${[...VALID_VERIFICATION_STATES].join(", ")}; got ${JSON.stringify(verification)}`,
      );
    }
    if (typeof canonical !== "boolean") {
      issues.push(`canonical must be boolean; got ${JSON.stringify(canonical)}`);
    }
    if (issues.length === 0) {
      checks.push({ name: "fixture-status", status: "pass" });
    } else {
      checks.push({
        name: "fixture-status",
        status: "fail",
        message: issues.join("; "),
        evidence: issues,
      });
    }
  }

  // 7. Published-anchor drift (hard vs soft gate).
  try {
    const publishedRaw = readFileSync("fixtures/mazur.published.json", "utf-8");
    const published = JSON.parse(publishedRaw) as PublishedAnchor;
    const claims = published.claims ?? [];
    if (claims.length === 0) {
      checks.push({
        name: "published-anchor-drift",
        status: "skip",
        message: "fixtures/mazur.published.json has no claims to check",
      });
    } else {
      const failures: string[] = [];
      const warnings: string[] = [];
      for (const claim of claims) {
        const lookupPath = CLAIM_PATHS[claim.id];
        if (!lookupPath) {
          // Unknown claim id — SKIP rather than FAIL; the published
          // ledger is the authority on which ids exist, and v0.2
          // ships only one known mapping.
          warnings.push(
            `claim ${claim.id}: no known receipt path (skipped); add a CLAIM_PATHS entry in bp.ts to enable.`,
          );
          continue;
        }
        const actual = resolveReceiptPath(receipt, lookupPath);
        if (typeof actual !== "number") {
          const msg = `claim ${claim.id}: receipt path '${lookupPath}' did not resolve to a number (got ${JSON.stringify(actual)})`;
          if (claim.hard_gate) failures.push(msg);
          else warnings.push(msg);
          continue;
        }
        // Tolerance: prefer the claim's documented drift if present
        // (mazur.published.json records drift_absolute for known
        // anchors), otherwise fall back to the receipt's
        // numeric_policy.tolerance.
        const documentedDrift = claim.drift_absolute;
        const policyTolerance =
          (
            (receipt as Record<string, unknown>).numeric_policy as
              | Record<string, unknown>
              | undefined
          )?.tolerance;
        const tolerance =
          typeof documentedDrift === "number"
            ? documentedDrift * 1.5 // small slack on documented drift
            : typeof policyTolerance === "number"
              ? policyTolerance
              : 1e-9;
        const drift = Math.abs(actual - claim.value);
        if (drift > tolerance) {
          const msg = `claim ${claim.id}: receipt value ${actual} drifts from published ${claim.value} by ${drift.toExponential(3)} (tolerance ${tolerance.toExponential(3)})`;
          if (claim.hard_gate) failures.push(msg);
          else warnings.push(msg);
        }
      }
      if (failures.length === 0 && warnings.length === 0) {
        checks.push({ name: "published-anchor-drift", status: "pass" });
      } else if (failures.length > 0) {
        checks.push({
          name: "published-anchor-drift",
          status: "fail",
          message: `${failures.length} hard-gate drift(s)`,
          evidence: { failures, warnings },
        });
      } else {
        checks.push({
          name: "published-anchor-drift",
          status: "warn",
          message: `${warnings.length} soft-gate drift(s) — WARN only`,
          evidence: warnings,
        });
      }
    }
  } catch (err) {
    checks.push({
      name: "published-anchor-drift",
      status: "fail",
      message:
        err instanceof Error
          ? `published-anchor check could not run: ${err.message}`
          : "published-anchor check could not run",
    });
  }

  return finalizeReport(checks, opts);
}

function finalizeReport(
  checks: VerifyCheck[],
  opts: { warnAsFail: boolean; strict: boolean },
): VerifyReport {
  let hasFail = false;
  let hasWarn = false;
  let hasSkip = false;
  for (const c of checks) {
    if (c.status === "fail") hasFail = true;
    else if (c.status === "warn") hasWarn = true;
    else if (c.status === "skip") hasSkip = true;
  }
  let overall: VerifyReport["overall"];
  if (hasFail) overall = "fail";
  else if (opts.strict && (hasWarn || hasSkip)) overall = "fail";
  else if (opts.warnAsFail && hasWarn) overall = "fail";
  else if (hasWarn) overall = "warn";
  else overall = "pass";
  return { overall, checks };
}

function renderVerifyReport(report: VerifyReport): string {
  const useColor = shouldUseColor(process.stderr);
  const lines: string[] = [];
  const header =
    report.overall === "pass"
      ? color("verification passed", `${BOLD}${GREEN}`, useColor)
      : report.overall === "warn"
        ? color("verification passed with warnings", `${BOLD}${YELLOW}`, useColor)
        : color("verification failed", `${BOLD}${RED}`, useColor);
  lines.push(header);
  lines.push("");
  for (const check of report.checks) {
    const tag =
      check.status === "pass"
        ? color("PASS", GREEN, useColor)
        : check.status === "warn"
          ? color("WARN", YELLOW, useColor)
          : check.status === "skip"
            ? color("SKIP", YELLOW, useColor)
            : color("FAIL", RED, useColor);
    lines.push(`  [${tag}] ${check.name}${check.message ? `: ${check.message}` : ""}`);
    if (check.status === "fail" && check.evidence !== undefined) {
      const evidence = JSON.stringify(check.evidence, null, 2)
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n");
      lines.push(evidence);
    }
  }
  lines.push("");
  return lines.join("\n");
}

// =============================================================================
// generate mazur (FT-C-002)
// =============================================================================

function runGenerateMazur(): void {
  // Always re-run the engine and emit canonical bytes; downstream branches
  // dispatch on --check / --out.
  const bytes = emitMazurReceipt(runMazurStep(MAZUR_INPUT));

  if (checkMode) {
    let goldenBytes: string;
    try {
      goldenBytes = readFileSync("fixtures/mazur.golden.jsonl", "utf-8");
    } catch (err) {
      exitOnReadError(err, "fixtures/mazur.golden.jsonl");
    }
    if (bytes === goldenBytes) {
      if (jsonMode) {
        process.stdout.write(`${JSON.stringify({ ok: true })}\n`);
      } else if (verboseMode) {
        verboseLog("generate mazur --check: byte-equal");
      }
      process.exit(0);
    }
    let driftOffset = 0;
    const n = Math.min(bytes.length, goldenBytes.length);
    while (driftOffset < n && bytes[driftOffset] === goldenBytes[driftOffset]) {
      driftOffset += 1;
    }
    if (jsonMode) {
      process.stdout.write(
        `${JSON.stringify({
          ok: false,
          drift_offset: driftOffset,
          emitted_length: bytes.length,
          golden_length: goldenBytes.length,
        })}\n`,
      );
    } else {
      const useColor = shouldUseColor(process.stderr);
      process.stderr.write(
        `${color("generate mazur --check: drift detected", `${BOLD}${RED}`, useColor)}\n`,
      );
      process.stderr.write(`  drift_offset:   ${driftOffset}\n`);
      process.stderr.write(`  emitted_length: ${bytes.length}\n`);
      process.stderr.write(`  golden_length:  ${goldenBytes.length}\n`);
    }
    process.exit(1);
  }

  if (outFile !== undefined && outFile !== "") {
    try {
      writeFileSync(outFile, bytes);
    } catch (err) {
      exitOnReadError(err, outFile);
    }
    if (jsonMode) {
      process.stdout.write(`${JSON.stringify({ ok: true, out: outFile, bytes: bytes.length })}\n`);
    } else if (verboseMode) {
      verboseLog(`generate mazur: wrote ${bytes.length} bytes to ${outFile}`);
    }
    process.exit(0);
  }

  // Default: write to stdout.
  process.stdout.write(bytes);
  process.exit(0);
}

// =============================================================================
// validate (FT-C-003)
// =============================================================================

function runValidate(file: string): void {
  verboseLog(`processing ${file}`);

  let receipt: unknown;
  try {
    receipt = readReceipt(file);
  } catch (err) {
    exitOnReadError(err, file);
  }

  if (verboseMode) {
    const desc = describeReceipt(receipt);
    if (desc.schemaVersion) verboseLog(`schema_version: ${desc.schemaVersion}`);
    if (desc.fixtureId) verboseLog(`fixture_id: ${desc.fixtureId}`);
    verboseLog("validating...");
  }

  const result = validateReceiptSchema(receipt);
  if (result.ok) {
    if (jsonMode) {
      process.stdout.write(`${JSON.stringify({ ok: true })}\n`);
    } else {
      const useColor = shouldUseColor(process.stdout);
      process.stdout.write(`${color("valid", GREEN, useColor)}\n`);
    }
    process.exit(0);
  }

  if (jsonMode) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, errors: result.errors })}\n`,
    );
    process.exit(1);
  }
  const useColor = shouldUseColor(process.stderr);
  process.stderr.write(`${color("schema validation failed", `${BOLD}${RED}`, useColor)}\n\n`);
  for (const err of result.errors) {
    const path = err.instancePath || "(root)";
    process.stderr.write(`  ${color("error", RED, useColor)} at ${path}: ${err.message}\n`);
    if (err.params && Object.keys(err.params).length > 0) {
      process.stderr.write(`    params: ${JSON.stringify(err.params)}\n`);
    }
  }
  process.stderr.write("\n");
  process.exit(1);
}

// =============================================================================
// reconcile receipt (existing v0.1 surface, refactored)
// =============================================================================

function runReconcileReceipt(file: string): void {
  verboseLog(`processing ${file}`);

  let receipt: unknown;
  try {
    receipt = readReceipt(file);
  } catch (err) {
    exitOnReadError(err, file);
  }

  if (verboseMode) {
    const desc = describeReceipt(receipt);
    if (desc.schemaVersion) verboseLog(`schema_version: ${desc.schemaVersion}`);
    if (desc.fixtureId) verboseLog(`fixture_id: ${desc.fixtureId}`);
    verboseLog("reconciling...");
  }

  // v0.1 contract preserved: pass the parsed receipt straight to the
  // reconciler. Structural failures are surfaced as Rule 0 in the
  // reconciler's failure stream, so bad-* fixtures keep working unchanged.
  // (Schema-only validation lives in `bp validate`; `bp verify mazur`
  // composes schema + reconcile + engine-reproduce + byte-equal.)
  const result = reconcileReceipt(receipt);
  if (result.ok) {
    if (jsonMode) {
      process.stdout.write(`${JSON.stringify({ ok: true })}\n`);
    }
    process.exit(0);
  }
  if (jsonMode) {
    // Failures envelope — keep ReconciliationFailure shape as-is so
    // downstream consumers see the same field names as the reconciler.
    process.stdout.write(
      `${JSON.stringify({ ok: false, failures: result.failures })}\n`,
    );
    process.exit(1);
  }
  const useColor = shouldUseColor(process.stderr);
  process.stderr.write(`${color("reconciliation failed", `${BOLD}${RED}`, useColor)}\n\n`);
  for (const f of result.failures) {
    process.stderr.write(renderFailure(f));
  }
  process.exit(1);
}

// =============================================================================
// top-level dispatch
// =============================================================================

// Top-level --version / -v. Not affected by --json (usage path).
if (argv[0] === "--version" || argv[0] === "-v") {
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}

// Top-level --help / -h, or no args. Not affected by --json (usage path).
if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
  process.stdout.write(usageText());
  process.exit(0);
}

// -----------------------------------------------------------------------------
// bp reconcile receipt <file>
// -----------------------------------------------------------------------------

if (argv[0] === "reconcile") {
  // Missing `receipt` subnoun — fuzzy-suggest the intended shape.
  if (argv[1] === undefined) {
    exitWithUsageError(
      "incomplete command 'reconcile'. Did you mean 'bp reconcile receipt <file>'? Run 'bp --help' for usage.",
    );
  }
  if (argv[1] !== "receipt") {
    exitWithUsageError(
      `unknown subcommand 'reconcile ${argv[1]}'. Did you mean 'bp reconcile receipt <file>'? Run 'bp --help' for usage.`,
    );
  }

  // Subcommand help.
  if (argv[2] === "--help" || argv[2] === "-h") {
    process.stdout.write(receiptUsageText());
    process.exit(0);
  }

  const file = argv[2];

  if (typeof file !== "string" || file.length === 0) {
    // Missing <file>: the receipt-usage text on stderr is the canonical
    // recovery path. JSON-mode users get a structured envelope instead.
    if (jsonMode) {
      exitWithUsageError(
        "missing required argument <file> for 'reconcile receipt'. Run 'bp reconcile receipt --help' for usage.",
        "MISSING_FILE_ARG",
      );
    }
    process.stderr.write(receiptUsageText());
    process.exit(2);
  }

  // Reject anything that looks like a flag (starts with `-`) except the
  // bare `-` stdin sentinel.
  if (file.startsWith("-") && file !== "-" && file !== "--") {
    exitWithUsageError(
      `refusing to treat ${JSON.stringify(file)} as a filename (starts with '-'). ` +
        `Use 'bp reconcile receipt --help' for usage.`,
      "INVALID_FILE_ARG",
    );
  }

  runReconcileReceipt(file);
}

// -----------------------------------------------------------------------------
// bp verify mazur [<file>]
// -----------------------------------------------------------------------------

if (argv[0] === "verify") {
  if (argv[1] === undefined) {
    exitWithUsageError(
      "incomplete command 'verify'. Did you mean 'bp verify mazur'? Run 'bp --help' for usage.",
    );
  }
  if (argv[1] !== "mazur") {
    exitWithUsageError(
      `unknown subcommand 'verify ${argv[1]}'. Did you mean 'bp verify mazur'? Run 'bp --help' for usage.`,
    );
  }
  if (argv[2] === "--help" || argv[2] === "-h") {
    process.stdout.write(verifyUsageText());
    process.exit(0);
  }
  const candidateFile = argv[2];
  const receiptPath =
    typeof candidateFile === "string" && candidateFile.length > 0
      ? candidateFile
      : "fixtures/mazur.golden.jsonl";

  // Reject flag-shaped args except the bare `-` stdin sentinel.
  if (receiptPath.startsWith("-") && receiptPath !== "-") {
    exitWithUsageError(
      `refusing to treat ${JSON.stringify(receiptPath)} as a filename (starts with '-'). ` +
        `Use 'bp verify mazur --help' for usage.`,
      "INVALID_FILE_ARG",
      3,
    );
  }

  verboseLog(`verify subject: ${receiptPath}`);

  let report: VerifyReport;
  try {
    report = runVerifyMazur({
      receiptPath,
      warnAsFail,
      strict: strictMode,
    });
  } catch (err) {
    exitOnReadError(err, receiptPath);
  }

  if (jsonMode) {
    process.stdout.write(`${JSON.stringify({ ok: report.overall !== "fail", report })}\n`);
  } else {
    process.stderr.write(renderVerifyReport(report));
  }
  process.exit(report.overall === "fail" ? 1 : 0);
}

// -----------------------------------------------------------------------------
// bp generate mazur
// -----------------------------------------------------------------------------

if (argv[0] === "generate") {
  if (argv[1] === undefined) {
    exitWithUsageError(
      "incomplete command 'generate'. Did you mean 'bp generate mazur'? Run 'bp --help' for usage.",
    );
  }
  if (argv[1] !== "mazur") {
    exitWithUsageError(
      `unknown subcommand 'generate ${argv[1]}'. Did you mean 'bp generate mazur'? Run 'bp --help' for usage.`,
    );
  }
  if (argv[2] === "--help" || argv[2] === "-h") {
    process.stdout.write(generateUsageText());
    process.exit(0);
  }
  runGenerateMazur();
}

// -----------------------------------------------------------------------------
// bp validate <file>
// -----------------------------------------------------------------------------

if (argv[0] === "validate") {
  // Subcommand help.
  if (argv[1] === "--help" || argv[1] === "-h") {
    process.stdout.write(validateUsageText());
    process.exit(0);
  }

  const file = argv[1];
  if (typeof file !== "string" || file.length === 0) {
    if (jsonMode) {
      exitWithUsageError(
        "missing required argument <file> for 'validate'. Run 'bp validate --help' for usage.",
        "MISSING_FILE_ARG",
      );
    }
    process.stderr.write(validateUsageText());
    process.exit(2);
  }
  if (file.startsWith("-") && file !== "-" && file !== "--") {
    exitWithUsageError(
      `refusing to treat ${JSON.stringify(file)} as a filename (starts with '-'). ` +
        `Use 'bp validate --help' for usage.`,
      "INVALID_FILE_ARG",
      3,
    );
  }
  runValidate(file);
}

// -----------------------------------------------------------------------------
// unknown command — fuzzy-suggest before dumping usage.
// -----------------------------------------------------------------------------

// argv.length === 0 was already handled above, so argv[0] is defined here.
const unknown = argv[0] ?? "";
const suggestion = suggestSubcommand(unknown);
if (suggestion) {
  exitWithUsageError(
    `unknown command '${unknown}'. Did you mean '${suggestion}'? Run 'bp --help' for usage.`,
  );
}
if (jsonMode) {
  exitWithUsageError(`unknown command '${unknown}'. Run 'bp --help' for usage.`);
}
process.stderr.write(`bp: unknown command '${unknown}'. Run 'bp --help' for usage.\n\n`);
process.stderr.write(usageText());
process.exit(2);
