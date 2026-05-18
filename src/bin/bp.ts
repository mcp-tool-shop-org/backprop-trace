#!/usr/bin/env node
/**
 * bp — backprop-trace CLI (v0.7.0 surface)
 *
 * Subcommand surface:
 *
 *   bp reconcile receipt <file>      Reconcile a receipt against the 16 rules
 *                                    (Rules 1-8 per-receipt math, 9-10 multi-step,
 *                                    11 softmax normalization, 12 loss formula,
 *                                    13 GATED dual-form, 14 engine-recompute
 *                                    differential, 15 skip-basis, 16 GATED
 *                                    attestation digest binding).
 *                                    Exit 0 if all applicable rules pass within
 *                                    tolerance; exit 1 with stderr describing failures.
 *
 *   bp verify mazur [<file>]         Full Mazur gate per docs/reconciliation.md:
 *                                    schema-validate + reconcile + engine-reproduce
 *                                    + byte-equal-vs-golden + fixture_status enum
 *                                    + published-anchor drift (hard vs soft gate).
 *                                    Default subject: fixtures/mazur.golden.jsonl.
 *                                    v0.1.0-schema receipts.
 *
 *   bp verify general <file>         Generalized verify gate. Works on any
 *                                    v0.2+ receipt (XOR, iris, softmax+CE,
 *                                    observer-mode imports, arbitrary user-
 *                                    authored topology). Composes schema-validate
 *                                    (auto-detects v0.2.0 / v0.3.0 / v0.4.0) +
 *                                    Rules 1-16 as applicable + engine reproduction
 *                                    (engine-authored) or Rule 14 differential
 *                                    (observer-mode imports). Skips Mazur-specific
 *                                    checks (byte-equal vs Mazur golden, published-
 *                                    anchor drift).
 *
 *   bp verify multi <file.jsonl>     Multi-record verify. Reads N-record JSONL,
 *                                    validates + reconciles each record (Rules
 *                                    1-8), then runs reconcileMultiStep for the
 *                                    parameter-chain (Rule 9) and trace-identity
 *                                    (Rule 10) cross-record checks.
 *
 *   bp generate {mazur,xor,iris,from-config}    Re-run the named engine and emit
 *                                    the canonical JSONL receipt to stdout, or to
 *                                    --out <file>, or compare against the golden
 *                                    with --check (exit 1 on drift). from-config
 *                                    reads a topology+input JSON.
 *
 *   bp import {pytorch,jax,tensorflow} <sidecar.jsonl>
 *                                    Ingest an external framework trace (v0.6+).
 *                                    Reads a framework-trace.v0.1.0 sidecar and
 *                                    produces an observer-mode v0.4.0 receipt.
 *                                    Runs Rule 14 engine-recompute differential
 *                                    at import time; downstream reconcile re-runs
 *                                    it independently (Reproducible Builds discipline).
 *                                    Per-framework subcommand discipline: no
 *                                    auto-detection from file contents.
 *
 *   bp scaffold topology --topology mazur|xor|iris    Write a starter
 *                                    GeneralInput JSON for editing.
 *
 *   bp validate-input <file>         Schema-validate a topology+input config
 *                                    without running the engine.
 *
 *   bp validate <file>               Schema-validate a receipt against the schema
 *                                    matching its declared schema_version
 *                                    (auto-detects v0.1.0 / v0.2.0 / v0.3.0 / v0.4.0).
 *                                    No math.
 *
 *   bp --version | -v                Print package version, exit 0.
 *   bp --help    | -h                Print usage, exit 0.
 *
 *   bp ... --json                    Machine-readable JSON output to stdout.
 *                                    Errors follow the Tier-1 structured shape
 *                                    {ok:false, error:{code, message, hint?,
 *                                    cause?, retryable?}}. Color is suppressed
 *                                    under --json.
 *
 *   bp ... --verbose | -V            Diagnostic stderr (file path, schema_version,
 *                                    fixture id) before the run.
 *
 *   bp ... --color=auto|never|always Control ANSI color on stderr/stdout text
 *                                    output. Honors NO_COLOR. Default: auto
 *                                    (color iff the destination is a TTY).
 *
 *   <file> = "-"                     For reconcile / validate / verify general /
 *                                    import, read from stdin. For verify multi,
 *                                    read JSONL from stdin.
 *
 * Exit codes (5-bucket; aligns with study-swarm + shellcheck convention):
 *   0  success / pass
 *   1  reconciliation or verification failure (or import differential disagreement)
 *   2  usage or I/O error (missing file, permission denied, malformed JSON, …)
 *   3  invalid CLI argument (unknown flag, malformed --color value, …)
 *   4  reserved (framework adapter declared but not implemented)
 *
 * The CLI is itself a consumer of the public library API — every domain
 * primitive comes from "../index.js" (the published barrel) so the surface
 * tested by the CLI matches the surface a third-party caller would see.
 *
 * Import strategy: the generalized-engine surface (runGeneralStep,
 * emitGeneralReceipt, XOR_INPUT, IRIS_INPUT, reconcileMultiStep,
 * verifyGeneralEngineReproduces, importPytorchSidecar, importJaxSidecar,
 * importTensorflowSidecar) is consumed via the namespace import `bplib`.
 * Named-import would fail at ESM load time on a missing binding —
 * namespace import returns `undefined` at access time, so v0.1/v0.2
 * subcommands keep loading cleanly and the lazy `requireLibExport` helper
 * surfaces a clear runtime error pointing at any missing export.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { createRequire } from "node:module";
import {
  reconcileReceipt,
  type ReconciliationFailure,
  type MazurReceipt,
  validateReceiptSchema,
  verifyEngineReproduces,
  runMazurStep,
  emitMazurReceipt,
  MAZUR_INPUT,
} from "../index.js";
import * as bplib from "../index.js";

const require = createRequire(import.meta.url);
// Path resolves identically from both src/bin/bp.ts (test via tsx) and
// dist/bin/bp.js (built artifact) — both live two directories deep from
// the package root.
const pkg = require("../../package.json") as { version: string };

/**
 * Human-readable label per reconciliation rule index. Matches
 * docs/reconciliation.md. All 16 rules are wired as of v0.6 (v0.7
 * adds no new rules; only a third adapter). Rule 0 is the structural-
 * failure sentinel; Rules 1-8 are per-step (fire on `bp verify mazur`
 * and `bp verify general` and once per record under `bp verify multi`);
 * Rules 9, 10 are cross-step (fire only on `bp verify multi`); Rules
 * 11, 12, 13 fire on softmax+CE receipts (v0.5+); Rules 14, 15, 16 fire
 * on observer-mode imported receipts (v0.6+).
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
  9: "multi-step parameter chain violation (parameters_before != prior parameters_after)",
  10: "multi-step trace identity violation (trace_id or step_index)",
  11: "softmax normalization violation (sum(forward[output].out) != 1.0)",
  12: "loss formula consistency violation (loss.per_output[u] or loss.total disagrees with topology.loss formula)",
  13: "dual-form consistency violation (jacobian_terms multiplication / summation / collapsed-vs-dual)",
  14: "engine-recompute differential (observer-mode receipt's foreign claim disagrees with backprop-trace engine recomputation)",
  15: "skip-basis required (engine_recompute_skipped_with_basis verification_state needs attestor.skip_basis from closed enum)",
  16: "attestation digest binding (attestor.signed_subject_digest does not match recomputed canonical-byte digest)",
  17: "trace-bundle binding (attestor.bundle_root_digest mismatch / heterogeneous bundle binding / post-binding mutation; INTEGRITY check only, not producer-authenticity)",
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
const topologyOpt = valueFlag("--topology");

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
    if (a === "--topology") {
      // skip the next token (the value)
      i += 1;
      continue;
    }
    if (a.startsWith("--topology=")) continue;
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
  // Explicit user flag wins over environment. --color=always is treated as
  // "I really want color even if NO_COLOR is set in the env" (matches
  // ripgrep/fd/git's convention — NO_COLOR is for "no color by default,"
  // explicit flags override it).
  if (colorOpt === "always") return true;
  if (colorOpt === "never") return false;
  if (process.env.NO_COLOR !== undefined) return false;
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
 * v0.7.0 — Emit a usage/IO error in the shipcheck Tier-1 Structured Error
 * Shape (`code`, `message`, `hint`, `cause?`, `retryable?`). Additive over
 * the v0.6.x signature: `hint` / `cause` / `retryable` are optional via
 * `opts`. Existing callers that pass only (message, code, exitCode) get
 * the v0.6.x envelope shape (no hint / cause / retryable fields). Callers
 * that pass `opts` get the full Tier-1 shape — preferred for new code.
 *
 * In human mode (default): writes the message to stderr; if `opts.hint`
 * is supplied, writes "Hint: <hint>" on the following line. In JSON mode:
 * writes a structured error envelope to stdout. Stderr is suppressed under
 * --json so CI consumers can parse stdout cleanly.
 *
 * Migration strategy: legacy callers embed "Hint: …" in the message string.
 * New callers should pass hint via `opts.hint` so CI consumers can parse
 * the structured field. Migration is incremental — both styles work; the
 * Tier-1 envelope is the eventual canonical shape.
 */
function exitWithUsageError(
  message: string,
  code = "USAGE",
  exitCode = 2,
  opts?: { hint?: string; cause?: string; retryable?: boolean },
): never {
  if (jsonMode) {
    const errorBody: {
      code: string;
      message: string;
      hint?: string;
      cause?: string;
      retryable?: boolean;
    } = { code, message };
    if (opts?.hint !== undefined) errorBody.hint = opts.hint;
    if (opts?.cause !== undefined) errorBody.cause = opts.cause;
    if (opts?.retryable !== undefined) errorBody.retryable = opts.retryable;
    const envelope = JSON.stringify({ ok: false, error: errorBody });
    process.stdout.write(`${envelope}\n`);
  } else {
    process.stderr.write(`bp: ${message}\n`);
    if (opts?.hint !== undefined) {
      process.stderr.write(`Hint: ${opts.hint}\n`);
    }
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
          `single-record JSONL is required here; got ${lineRecords.length} records. Use 'bp verify multi <file.jsonl>' for multi-record JSONL.`,
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
 * Read a multi-record JSONL file and return the parsed records (one per
 * non-empty line). Used by `bp verify multi`.
 *
 * Unlike `readReceipt`, this function does NOT fall back to whole-file
 * JSON parsing — multi-record JSONL strictly requires one JSON document
 * per line. The special filename "-" reads from stdin.
 *
 * Throws on I/O errors and on per-line JSON SyntaxError with the line
 * number annotated — callers translate to exit-2 via exitOnReadError.
 */
function readMultiRecordJsonl(file: string): unknown[] {
  let raw: string;
  if (file === "-") {
    raw = readFileSync(0, "utf-8");
  } else {
    raw = readFileSync(file, "utf-8");
  }
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    const err = new Error(
      `bp verify multi: ${file === "-" ? "stdin" : file} contains no JSON records (empty or whitespace-only).`,
    );
    (err as Error & { code?: string }).code = "BP_JSONL_EMPTY";
    throw err;
  }
  return lines.map((line, i) => {
    try {
      return JSON.parse(line);
    } catch (err) {
      const message = `Invalid JSON at line ${i + 1}: ${(err as Error).message}`;
      const wrapped = new Error(message);
      (wrapped as Error & { code?: string }).code = "BP_JSONL_PARSE_ERROR";
      throw wrapped;
    }
  });
}

/**
 * Translate I/O / parse errors thrown by readReceipt and
 * readMultiRecordJsonl into the canonical exit-2 envelope. Centralized
 * here so reconcile + validate + verify share the recovery hints
 * verbatim.
 */
function exitOnReadError(err: unknown, file: string): never {
  const e = err as NodeJS.ErrnoException;
  // v0.7.0: migrated to Tier-1 envelope shape — hint, cause?, retryable?
  // emitted as structured fields under --json. Human-mode output
  // unchanged for ENOENT/EACCES/EISDIR (hint appears on second stderr
  // line via exitWithUsageError's opts.hint handling).
  if (e && e.code === "ENOENT") {
    exitWithUsageError(
      `file not found: ${file}.`,
      "ENOENT",
      2,
      {
        hint: "check the path or run from the repo root.",
        retryable: false,
      },
    );
  }
  if (e && e.code === "EACCES") {
    exitWithUsageError(
      `permission denied: ${file}.`,
      "EACCES",
      2,
      { hint: "check file permissions.", retryable: false },
    );
  }
  if (e && e.code === "EISDIR") {
    exitWithUsageError(
      `path is a directory, not a file: ${file}.`,
      "EISDIR",
      2,
      { hint: "provide a file path.", retryable: false },
    );
  }
  const codeStr = (e as Error & { code?: string }).code;
  if (codeStr === "BP_JSONL_MULTI_RECORD") {
    exitWithUsageError(e.message, "BP_JSONL_MULTI_RECORD");
  }
  if (codeStr === "BP_JSONL_EMPTY") {
    exitWithUsageError(e.message, "BP_JSONL_EMPTY");
  }
  if (codeStr === "BP_JSONL_PARSE_ERROR") {
    exitWithUsageError(
      e.message,
      "BP_JSONL_PARSE_ERROR",
      2,
      {
        hint: "each line of a multi-record JSONL file must be a standalone JSON object.",
        retryable: false,
      },
    );
  }
  if (err instanceof SyntaxError) {
    exitWithUsageError(
      `invalid JSON in ${file}: ${err.message}.`,
      "INVALID_JSON",
      2,
      {
        hint: "validate the receipt structure against schemas/receipt.v0.1.0.json or schemas/receipt.v0.2.0.json before reconciling.",
        retryable: false,
      },
    );
  }
  // Unknown I/O failure — preserve the stack for developer visibility
  // in human mode; emit a structured fallback in JSON mode.
  if (jsonMode) {
    const message = err instanceof Error ? err.message : String(err);
    exitWithUsageError(`unexpected error reading ${file}: ${message}`, "IO_ERROR", 2, {
      hint: "this is an unexpected I/O error; retry after checking the path and file permissions.",
      retryable: true,
    });
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

/**
 * Render a reconciliation-failure value (stored / recomputed / delta /
 * tolerance) without assuming it's a number.
 *
 * Rules 1-8 emit numeric stored/recomputed (the historic shape, and what
 * the ReconciliationFailure type declares). Rule 10 (trace identity, new
 * in v0.3) may emit string values when the mismatch is on a `trace_id`
 * (a 128-bit hex string, not a number) or on a `step_index` rendered as
 * a labelled string for clarity. Centralizing the coercion here keeps
 * the renderer tolerant of both shapes without leaking string-handling
 * into the per-rule code paths.
 *
 * For non-number values delta + tolerance have no meaningful engineering-
 * form readout — formatValue falls back to a plain String() coercion. The
 * Reconciler agent will widen the ReconciliationFailure type to mirror
 * this in v0.3.
 */
function formatValue(v: unknown): string {
  if (typeof v === "number") return String(v);
  return String(v);
}

/**
 * Render delta/tolerance specifically — numeric values use the engineering-
 * form exponential readout (9 decimal places, matching v0.2's display
 * convention); non-numeric values (Rule 10 trace-id / step-index) fall
 * back to plain String() coercion since exponentiation is meaningless.
 */
function formatDeltaOrTolerance(v: unknown): string {
  if (typeof v === "number") return v.toExponential(9);
  return String(v);
}

function renderFailure(f: ReconciliationFailure): string {
  const label = RULE_LABELS[f.rule] ?? "rule mismatch";
  const lines = [
    `Rule ${f.rule}: ${label} on ${f.parameter_id ?? "(unknown parameter)"}`,
    `  field_path:          ${f.field_path}`,
    `  stored gradient:     ${formatValue(f.stored)}`,
    `  recomputed gradient: ${formatValue(f.recomputed)}`,
    `  delta:               ${formatDeltaOrTolerance(f.delta)}`,
    `  tolerance:           ${formatDeltaOrTolerance(f.tolerance)}`,
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
    "  Reconcile / verify:",
    "    bp reconcile receipt <file>     Reconcile a receipt against the 16 rules",
    "    bp verify mazur [<file>]        Full Mazur gate (v0.1 receipts)",
    "    bp verify general <file>        Generalized verify (v0.2+ receipts; softmax+CE; observer-mode)",
    "    bp verify multi <file.jsonl>    Multi-record verify (Rules 1-8 per record + Rules 9, 10)",
    "    bp validate <file>              Schema-validate receipt (auto-detects v0.1/0.2/0.3/0.4)",
    "",
    "  Generate canonical receipt bytes (engine-authored fixtures):",
    "    bp generate mazur [--out <file>]              Re-run Mazur engine",
    "    bp generate xor   [--out <file>]              Re-run XOR engine",
    "    bp generate iris  [--out <file>]              Re-run iris engine",
    "    bp generate from-config <file> [--out <file>] Re-run engine from a topology+input JSON",
    "",
    "  Ingest external framework traces (v0.6+; observer-mode receipts):",
    "    bp import pytorch    <sidecar.jsonl>          Ingest PyTorch framework trace + Rule 14 diff",
    "    bp import jax        <sidecar.jsonl>          Ingest JAX framework trace + Rule 14 diff",
    "    bp import tensorflow <sidecar.jsonl>          Ingest TensorFlow framework trace + Rule 14 diff",
    "",
    "  Author / validate topology+input configs:",
    "    bp scaffold topology --topology mazur|xor|iris [--out <file>]",
    "                                    Write a starter GeneralInput JSON for editing",
    "    bp validate-input <file>        Schema-validate a topology+input config",
    "",
    "  Meta:",
    "    bp --version                    Print version",
    "    bp --help                       Print this message",
    "",
    "OPTIONS",
    "  --json                          Machine-readable JSON output (Tier-1 error envelope)",
    "  --verbose, -V                   Diagnostic stderr",
    "  --color=auto|never|always       Color output (auto detects TTY; honors NO_COLOR)",
    "  --out <file>                    (generate / scaffold / import) write to file",
    "  --check                         (generate) compare vs golden, exit 1 on drift",
    "  --topology <name>               (scaffold topology) which seed topology to write",
    "  --warn-as-fail                  (verify) treat WARNs as failures",
    "  --strict                        (verify) treat any non-PASS as failure",
    "  -                               (file arg) read from stdin",
    "  --help, -h                      Print this message",
    "",
    "Exit codes",
    "  0  success / pass",
    "  1  reconciliation/verification failure (or import differential disagreement)",
    "  2  usage or I/O error",
    "  3  invalid CLI argument",
    "  4  reserved (framework adapter declared but not implemented)",
    "",
    "EXAMPLES",
    "  bp reconcile receipt fixtures/mazur.golden.jsonl",
    "  bp verify mazur",
    "  bp verify general fixtures/xor.golden.jsonl",
    "  bp verify general fixtures/softmax-ce.golden.jsonl",
    "  bp verify multi fixtures/xor.multi-step.jsonl",
    "  bp generate mazur --check",
    "  bp generate xor   --out my-xor.jsonl",
    "  bp generate iris  --check",
    "  bp generate from-config my-topology.json",
    "  bp import pytorch    fixtures/external/pytorch.softmax-ce.sidecar.jsonl",
    "  bp import jax        fixtures/external/jax.softmax-ce.sidecar.jsonl",
    "  bp import tensorflow fixtures/external/tensorflow.softmax-ce.sidecar.jsonl",
    "  bp scaffold topology --topology xor --out my-xor.input.json",
    "  bp validate-input my-topology.json",
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
    "  Reconcile the math claims in a receipt against the 16 rules in",
    "  docs/reconciliation.md (Rules 1-8 per-receipt math, Rules 9-10",
    "  multi-step, Rule 11 softmax normalization, Rule 12 loss formula,",
    "  Rule 13 GATED dual-form, Rule 14 engine-recompute differential",
    "  for observer-mode imports, Rule 15 skip-basis, Rule 16 GATED",
    "  attestation digest binding).",
    "",
    "  <file>  Path to a receipt JSON document. Accepted extensions:",
    "            .json   — parsed as a single JSON document.",
    "            .jsonl  — parsed as JSONL containing exactly one record.",
    "                      For multi-record JSONL use 'bp verify multi'.",
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

function verifyGeneralUsageText(): string {
  return [
    "Usage: bp verify general <file> [--json] [--verbose] [--warn-as-fail] [--strict]",
    "",
    "  Generalized verify gate for v0.2+ receipts (XOR, iris, softmax+CE,",
    "  observer-mode imports). Composes:",
    "    1. Schema validation (auto-detects v0.2.0 / v0.3.0 / v0.4.0)",
    "    2. Reconciliation against Rules 1-16 as applicable",
    "    3. Engine reproduction (engine-authored) or Rule 14 differential",
    "       (observer-mode imported) via verifyGeneralEngineReproduces",
    "",
    "  This subcommand intentionally skips Mazur-specific checks:",
    "    - No byte-equal vs a Mazur golden fixture",
    "    - No published-anchor drift (Mazur-only)",
    "    - Multi-step Rules 9, 10 fire only on 'bp verify multi'",
    "",
    "  <file>  Path to a v0.2+ receipt (.json or .jsonl, single",
    "          record), or '-' to read from stdin.",
    "",
    "  Options:",
    "    --json           Emit machine-readable JSON to stdout.",
    "    --verbose, -V    Diagnostic stderr.",
    "    --warn-as-fail   Treat WARN findings as failures.",
    "    --strict         Treat any non-PASS finding (WARN, SKIP) as failure.",
    "",
    "  Exit codes:",
    "    0  All checks pass.",
    "    1  At least one check failed.",
    "    2  Usage or I/O error.",
    "    3  Invalid CLI argument.",
    "",
  ].join("\n");
}

function verifyMultiUsageText(): string {
  return [
    "Usage: bp verify multi <file.jsonl> [--json] [--verbose] [--warn-as-fail] [--strict]",
    "",
    "  Multi-record verify for training-run JSONL. Each line of the input",
    "  file is parsed as a v0.2-schema receipt representing one training",
    "  step. The gate runs:",
    "",
    "    Per record:",
    "      1. Schema validation",
    "      2. Reconciliation against Rules 1-8",
    "",
    "    Cross record:",
    "      3. Rule 9  — parameter chain (parameters_before equals prior",
    "                   record's parameters_after within tolerance)",
    "      4. Rule 10 — trace identity (shared trace_id, sequential",
    "                   step_index 0..N-1)",
    "",
    "  <file.jsonl>  Path to a multi-record JSONL file, or '-' to read",
    "                from stdin.",
    "",
    "  Options:",
    "    --json           Emit machine-readable JSON to stdout.",
    "    --verbose, -V    Diagnostic stderr (record count, schema_versions).",
    "    --warn-as-fail   Treat WARN findings as failures.",
    "    --strict         Treat any non-PASS finding (WARN, SKIP) as failure.",
    "",
    "  Exit codes:",
    "    0  All per-record + cross-record checks pass.",
    "    1  At least one check failed.",
    "    2  Usage or I/O error (missing file, bad JSON on a line, empty file).",
    "    3  Invalid CLI argument.",
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

function generateXorUsageText(): string {
  return [
    "Usage: bp generate xor [--out <file>] [--check] [--json] [--verbose]",
    "",
    "  Re-run the XOR-sigmoid 2-2-1 engine and emit the canonical JSONL",
    "  receipt.",
    "",
    "  Default (no flags): write the canonical bytes to stdout.",
    "  --out <file>     Write to <file> instead of stdout.",
    "  --check          Compare against fixtures/xor.golden.jsonl;",
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

function generateIrisUsageText(): string {
  return [
    "Usage: bp generate iris [--out <file>] [--check] [--json] [--verbose]",
    "",
    "  Re-run the iris 4-3-3 sigmoid engine and emit the canonical JSONL",
    "  receipt for the canonical first iris sample.",
    "",
    "  Default (no flags): write the canonical bytes to stdout.",
    "  --out <file>     Write to <file> instead of stdout.",
    "  --check          Compare against fixtures/iris.golden.jsonl;",
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
    "  Validate a receipt against the schema matching its declared",
    "  schema_version. Auto-detects v0.1.0 / v0.2.0 / v0.3.0 / v0.4.0.",
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

function generateFromConfigUsageText(): string {
  return [
    "Usage: bp generate from-config <file> [--out <file>] [--check] [--json] [--verbose]",
    "",
    "  Read a topology+input JSON config, run the generalized engine (Math",
    "  agent's runGeneralStep), and emit the canonical v0.2.0-schema JSONL",
    "  receipt. Reuses the same emission pipeline as `bp generate xor|iris`",
    "  so authored configs and shipped fixtures share one byte-equal contract.",
    "",
    "  The input file is validated against schemas/topology-input.v0.4.0.json",
    "  before the engine runs. Receipt-only fields (forward, loss, updates,",
    "  parameters_after, post_update_forward, post_update_loss, fixture_status)",
    "  are explicitly REJECTED by that schema — authored bytes can never",
    "  masquerade as receipt bytes (trust-boundary mitigation, design memo §7).",
    "",
    "  <file>  Path to a topology+input JSON document, or '-' to read JSON",
    "          from stdin. Use `bp scaffold topology --topology xor` to",
    "          generate a starter file to edit.",
    "",
    "  Default (no flags): write canonical bytes to stdout.",
    "  --out <file>     Write to <file> instead of stdout.",
    "  --check          Compare emitted bytes against an existing golden",
    "                   fixture (path supplied via --out, e.g.",
    "                   `bp generate from-config my.json --check --out",
    "                   fixtures/my.golden.jsonl`); exit 0 on byte-equal,",
    "                   exit 1 on drift.",
    "  --json           In --check mode, emit a JSON envelope to stdout",
    "                   reporting ok/false + drift_offset.",
    "",
    "  Exit codes:",
    "    0  Success (bytes written or --check passed).",
    "    1  Drift detected under --check, or input schema-invalid.",
    "    2  Usage or I/O error.",
    "    3  Invalid CLI argument (e.g. --check without --out).",
    "",
  ].join("\n");
}

function scaffoldTopologyUsageText(): string {
  return [
    "Usage: bp scaffold topology --topology mazur|xor|iris [--out <file>] [--json]",
    "",
    "  Write a starter topology+input JSON config matching one of the",
    "  shipped fixtures (Mazur 2-2-2, XOR-sigmoid 2-2-1, iris 4-3-3). The",
    "  emitted file is a valid `bp generate from-config` input — edit it to",
    "  experiment with weights, learning rates, or activations without",
    "  touching TypeScript.",
    "",
    "  Default (no flags): write the JSON to stdout.",
    "  --topology mazur|xor|iris   Which seed topology to emit. Required.",
    "  --out <file>                Write to <file> instead of stdout.",
    "  --json                      With --out, emit a {ok, output_path}",
    "                              envelope to stdout (the file itself is",
    "                              always JSON). Without --out, behaves the",
    "                              same as the default.",
    "",
    "  Note (mazur path): if the library has not yet exported a generalized",
    "  MAZUR_GENERAL_INPUT binding (Library/Engine agent coordination), this",
    "  subcommand assembles one at scaffold time by combining the v0.1",
    "  MAZUR_INPUT scalars with MAZUR_TOPOLOGY. The output is structurally a",
    "  GeneralInput either way.",
    "",
    "  Exit codes:",
    "    0  Success.",
    "    2  Usage or I/O error.",
    "    3  Invalid --topology value, or missing --topology argument.",
    "",
  ].join("\n");
}

function validateInputUsageText(): string {
  return [
    "Usage: bp validate-input <file> [--json] [--verbose]",
    "",
    "  Schema-validate a topology+input config against",
    "  schemas/topology-input.v0.4.0.json. Schema-only — does NOT run the",
    "  engine. Use `bp generate from-config <file>` to run the engine.",
    "",
    "  <file>  Path to a topology+input JSON document (.json or .jsonl with",
    "          exactly one record), or '-' to read JSON from stdin.",
    "",
    "  Options:",
    "    --json         Emit machine-readable JSON with errors[] array.",
    "    --verbose, -V  Diagnostic stderr.",
    "",
    "  Exit codes:",
    "    0  Input is structurally valid.",
    "    1  Input failed schema validation.",
    "    2  Usage or I/O error.",
    "    3  Invalid CLI argument.",
    "",
  ].join("\n");
}

function importUsageText(): string {
  return [
    "Usage: bp import <framework> <sidecar-file> [--out <file>]",
    "",
    "  Convert a framework-trace sidecar (JSONL) into an observer-mode",
    "  v0.4.0 receipt. The sidecar carries the foreign framework's",
    "  claimed math; the importer adds attestor + source_framework +",
    "  fixture_status and runs the backprop-trace engine as differential",
    "  witness. Use `bp verify general <out>` afterward to independently",
    "  re-run the verification.",
    "",
    "  Frameworks (per-framework subcommands; no auto-detection):",
    "    bp import pytorch    <sidecar.jsonl>            — single-step (v0.6.0)",
    "    bp import jax        <sidecar.jsonl>            — single-step (v0.6.1)",
    "    bp import tensorflow <sidecar.jsonl>            — single-step (v0.7.0)",
    "    bp import pytorch    multi <sidecar.jsonl>      — multi-step JSONL stream (v0.8)",
    "    bp import jax        multi <sidecar.jsonl>      — multi-step JSONL stream (v0.8)",
    "    bp import tensorflow multi <sidecar.jsonl>      — multi-step JSONL stream (v0.8)",
    "",
    "  Multi-step ingestion reads a framework-trace.v0.2.0 JSONL stream and",
    "  emits N observer-mode v0.4.0 receipts (one per line) suitable for",
    "  piping into `bp verify multi -` for cross-step Rules 9 + 10.",
    "  Optional Rule 17 (bundle-integrity binding, NOT producer authenticity)",
    "  is always added by the multi-step importer.",
    "",
    "  Run `bp import <framework> --help` for framework-specific details.",
    "",
  ].join("\n");
}

function importJaxUsageText(): string {
  return [
    "Usage: bp import jax <sidecar.jsonl> [--out <file>] [--json]",
    "",
    "  Convert a framework-trace.v0.1.0 sidecar (emitted by a JAX",
    "  training-loop helper) into an observer-mode v0.4.0 receipt.",
    "",
    "  Same trust model as bp import pytorch: foreign claims become the",
    "  canonical fields, the backprop-trace engine runs differentially",
    "  as witness, Rule 14 enforces agreement within",
    "  attestor.differential_tolerance at reconcile time.",
    "",
    "  <sidecar.jsonl>  Path to a framework-trace.v0.1.0 sidecar JSON file.",
    "                   The file must declare source_framework.name == 'jax'.",
    "                   Use '-' to read from stdin.",
    "",
    "  Options:",
    "    --out <file>   Write the receipt to <file> instead of stdout.",
    "    --json         Emit machine-readable JSON summary with the",
    "                    import result + differential check outcome.",
    "    --verbose, -V  Diagnostic stderr.",
    "",
    "  JAX-specific authoring notes (extractor side, not importer):",
    "    - Flatten jax.tree_util.tree_flatten(params) to a {param_id: value}",
    "      dict. A flatten-order swap surfaces as Rule 14 disagreement.",
    "    - JAX float32 default vs Node binary64: default differential_tolerance",
    "      {atol:1e-6, rtol:1e-4} absorbs cross-precision drift for small",
    "      networks. Larger networks may need looser per-receipt tolerance.",
    "    - vmap/scan/pmap produce batched values; emit one sidecar per step,",
    "      not one per batch. Schema validation rejects extra dimensions.",
    "",
    "  Exit codes (identical to bp import pytorch):",
    "    0  Import succeeded AND engine-recompute differential agreed.",
    "    1  Import succeeded but differential check DISAGREED.",
    "    2  Usage / I/O / schema-validation error.",
    "    3  Invalid CLI argument.",
    "",
  ].join("\n");
}

function importStreamUsageText(framework: "pytorch" | "jax" | "tensorflow"): string {
  return [
    `Usage: bp import ${framework} multi <sidecar.jsonl> [--out <file>] [--json]`,
    "",
    `  v0.8 multi-step observer-mode ingestion. Reads a framework-trace.v0.2.0`,
    `  JSONL stream (one ${framework} sidecar record per line, in step order)`,
    `  and emits N observer-mode v0.4.0 receipts (one per line on stdout, or`,
    `  to --out <file>) ready to pipe into 'bp verify multi -' for cross-step`,
    `  Rules 9 (parameter chain) + 10 (trace identity).`,
    "",
    `  Per-step Rule 14 (engine-recompute differential) fires inside the`,
    `  importer at ingest time. All receipts in the bundle are bound by a`,
    `  Rule 17 'attestor.bundle_root_digest' (recomputed sha256 over the`,
    `  canonical-byte concatenation of every receipt with bundle_root_digest`,
    `  stripped). Rule 17 catches BUNDLE INTEGRITY failures — accidental`,
    `  splice, post-binding mutation, inconsistent bundle roots — but does`,
    `  NOT prove producer authenticity (an attacker who controls all receipt`,
    `  bytes and recomputes the bundle digest passes Rule 17 trivially).`,
    `  For producer-identity binding, combine with Rule 16 signed_subject_digest`,
    `  or an external signature.`,
    "",
    `  Constraints (rejected at ingest with exit 2):`,
    `    - Every record must declare format='framework-trace.v0.2.0'`,
    `    - Every record must declare source_framework.name='${framework}'`,
    `    - source_framework.name + version must be identical across records`,
    `    - trace_id must be present on all records or absent on all`,
    `    - step_index must be dense + monotonic from 0 to N-1`,
    `    - Mid-stream framework swap, trace_id swap, or step_index gap`,
    `      fails fast at the offending record`,
    "",
    `  <sidecar.jsonl>  Path to a framework-trace.v0.2.0 JSONL stream.`,
    `                   Use '-' to read from stdin.`,
    "",
    "  Options:",
    `    --out <file>   Write the receipt stream to <file> instead of stdout.`,
    `    --json         Emit machine-readable JSON summary on stderr (or`,
    `                    stdout under -- json) with per-step + aggregate`,
    `                    differential outcome + bundle_root_digest.`,
    `    --verbose, -V  Diagnostic stderr.`,
    "",
    "  Exit codes:",
    "    0  All N steps imported AND every per-step Rule 14 differential agreed.",
    "    1  All N steps imported; ≥1 per-step differential DISAGREED. All",
    "        receipts emitted (verification_state per step) for audit.",
    "    2  Usage / I/O / schema-validation error (incl. mid-stream framework",
    "        swap, trace_id swap, step_index gap, format-const mismatch).",
    "    3  Invalid CLI argument.",
    "",
    "  Example end-to-end (PyTorch 3-step trace):",
    `    bp import ${framework} multi train.multi-step.sidecar.jsonl | bp verify multi -`,
    "",
  ].join("\n");
}

function importTensorflowUsageText(): string {
  return [
    "Usage: bp import tensorflow <sidecar.jsonl> [--out <file>] [--json]",
    "",
    "  Convert a framework-trace.v0.1.0 sidecar (emitted by a TensorFlow",
    "  training-loop helper) into an observer-mode v0.4.0 receipt.",
    "",
    "  Same trust model as bp import pytorch / bp import jax: foreign claims",
    "  become the canonical fields, the backprop-trace engine runs",
    "  differentially as witness, Rule 14 enforces agreement within",
    "  attestor.differential_tolerance at reconcile time.",
    "",
    "  <sidecar.jsonl>  Path to a framework-trace.v0.1.0 sidecar JSON file.",
    "                   The file must declare source_framework.name == 'tensorflow'.",
    "                   Use '-' to read from stdin.",
    "",
    "  Options:",
    "    --out <file>   Write the receipt to <file> instead of stdout.",
    "    --json         Emit machine-readable JSON summary with the",
    "                    import result + differential check outcome.",
    "    --verbose, -V  Diagnostic stderr.",
    "",
    "  TensorFlow-specific authoring notes (extractor side, not importer):",
    "    - model.trainable_variables returns vars in creation order (stable",
    "      but non-obvious). Sorting that list — e.g., alphabetically by",
    "      var.name — surfaces as Rule 14 disagreement on forward fields.",
    "    - BatchNorm / moving-stats parameters are non-trainable Variables.",
    "      Don't pull them into parameters_before — they have no gradient",
    "      update, and Rule 7 will fire on parameters_after.",
    "    - tf.GradientTape default is non-persistent. tape.gradient(...) may",
    "      be called only once. Use persistent=True deliberately.",
    "    - Eager vs graph mode (tf.function / XLA): constant folding + op",
    "      fusion may diverge slightly in the last few ULPs from eager-mode",
    "      recompute. Default differential_tolerance {atol:1e-6, rtol:1e-4}",
    "      absorbs this for small networks; tighten per-receipt if needed.",
    "    - Mixed precision (float16 / bfloat16 policies): per-tensor values",
    "      carry the framework precision; cross-precision drift against",
    "      engine binary64 is bounded by attestor.differential_tolerance.",
    "",
    "  Exit codes (identical to bp import pytorch / bp import jax):",
    "    0  Import succeeded AND engine-recompute differential agreed.",
    "    1  Import succeeded but differential check DISAGREED.",
    "    2  Usage / I/O / schema-validation error.",
    "    3  Invalid CLI argument.",
    "",
  ].join("\n");
}

function importPytorchUsageText(): string {
  return [
    "Usage: bp import pytorch <sidecar.jsonl> [--out <file>] [--json]",
    "",
    "  Convert a framework-trace.v0.1.0 sidecar (emitted by a PyTorch",
    "  training-loop helper) into an observer-mode v0.4.0 receipt.",
    "",
    "  The receipt carries the foreign framework's claimed forward / loss /",
    "  backward / updates / parameters_after as canonical fields, plus an",
    "  attestor block recording the import provenance + differential",
    "  tolerance. Rule 14 (engine-recompute differential) fires when the",
    "  resulting receipt is reconciled.",
    "",
    "  <sidecar.jsonl>  Path to a framework-trace.v0.1.0 sidecar JSON file.",
    "                   The file must declare source_framework.name == 'pytorch'.",
    "                   Use '-' to read from stdin.",
    "",
    "  Options:",
    "    --out <file>   Write the receipt to <file> instead of stdout.",
    "    --json         Emit machine-readable JSON summary with the",
    "                    import result + differential check outcome.",
    "    --verbose, -V  Diagnostic stderr.",
    "",
    "  Exit codes:",
    "    0  Import succeeded AND engine-recompute differential agreed",
    "         within attestor.differential_tolerance.",
    "    1  Import succeeded but differential check DISAGREED. Receipt is",
    "         still produced (verification_state == 'engine_recompute_disagreed')",
    "         for audit, but the verifier-side gate has flagged it.",
    "    2  Usage / I/O / schema-validation error.",
    "    3  Invalid CLI argument.",
    "    4  Reserved: framework adapter declared but not implemented.",
    "",
  ].join("\n");
}

/**
 * Levenshtein-light suggestion for unknown top-level subcommand. Hand-
 * rolled because the v0.3 surface still has only four real top-level
 * tokens (reconcile, verify, generate, validate). The example string
 * for each top-level verb summarizes the full subnoun set so a user
 * who typed `bp verfy` sees the three valid `verify` shapes inline.
 */
function suggestSubcommand(unknown: string): string | null {
  // `validate` is a proper prefix of `validate-input`. Two-pass match:
  // 1. EXACT or `unknown.startsWith(verb)` wins first (matches the user's
  //    actual typed prefix — `validat` -> `validate`, `validate-inp` ->
  //    `validate-input`).
  // 2. Else fall through to `verb.startsWith(unknown)` (matches short typos
  //    like `gen` -> `generate`).
  const candidates: Array<{ verb: string; example: string }> = [
    { verb: "reconcile", example: "bp reconcile receipt <file>" },
    { verb: "verify", example: "bp verify mazur | general <file> | multi <file.jsonl>" },
    { verb: "generate", example: "bp generate mazur | xor | iris | from-config <file>" },
    { verb: "import", example: "bp import pytorch <sidecar.jsonl>" },
    { verb: "scaffold", example: "bp scaffold topology --topology mazur|xor|iris" },
    { verb: "validate-input", example: "bp validate-input <file>" },
    { verb: "validate", example: "bp validate <file>" },
  ];
  // Pass 1 (user-typo bias): the user typed something the system doesn't
  // recognize. Prefer the SHORTEST known verb that starts with the typed
  // input — that's the canonical "you meant this" suggestion. `validat`
  // -> `validate` (not `validate-input`); `gen` -> `generate`.
  let bestSuffix: { verb: string; example: string } | null = null;
  for (const c of candidates) {
    if (c.verb.startsWith(unknown)) {
      if (bestSuffix === null || c.verb.length < bestSuffix.verb.length) {
        bestSuffix = c;
      }
    }
  }
  if (bestSuffix) return bestSuffix.example;
  // Pass 2 (overlong-input bias): if no known verb starts with the typed
  // input, see whether the typed input itself starts with a known verb
  // (likely the user typed extra characters after a real verb name).
  // Prefer the LONGEST matching verb so `validate-inp` picks
  // `validate-input` over `validate`.
  let bestPrefix: { verb: string; example: string } | null = null;
  for (const c of candidates) {
    if (unknown.startsWith(c.verb)) {
      if (bestPrefix === null || c.verb.length > bestPrefix.verb.length) {
        bestPrefix = c;
      }
    }
  }
  if (bestPrefix) return bestPrefix.example;
  return null;
}

/**
 * Suggest the canonical form of a known `verify` subnoun. Recognizes
 * `mazur`, `general`, `multi`. Returns the closest match's full example,
 * or null if no match.
 */
function suggestVerifySubnoun(unknown: string): string | null {
  const candidates: Array<{ verb: string; example: string }> = [
    { verb: "mazur", example: "bp verify mazur" },
    { verb: "general", example: "bp verify general <file>" },
    { verb: "multi", example: "bp verify multi <file.jsonl>" },
  ];
  for (const c of candidates) {
    if (c.verb.startsWith(unknown) || unknown.startsWith(c.verb)) {
      return c.example;
    }
  }
  return null;
}

/**
 * Suggest the canonical form of a known `generate` subnoun. Recognizes
 * `mazur`, `xor`, `iris`. Returns the closest match's full example, or
 * null if no match.
 */
function suggestGenerateSubnoun(unknown: string): string | null {
  const candidates: Array<{ verb: string; example: string }> = [
    { verb: "mazur", example: "bp generate mazur" },
    { verb: "xor", example: "bp generate xor" },
    { verb: "iris", example: "bp generate iris" },
    { verb: "from-config", example: "bp generate from-config <file>" },
  ];
  for (const c of candidates) {
    if (c.verb.startsWith(unknown) || unknown.startsWith(c.verb)) {
      return c.example;
    }
  }
  return null;
}

/**
 * Suggest the canonical form of a known `scaffold` subnoun. Currently
 * accepts only `topology` (per design memo §7: scaffolding receipt bytes
 * is explicitly disallowed — only INPUT scaffolding is permitted because
 * authored bytes must NEVER masquerade as receipt bytes).
 */
function suggestScaffoldSubnoun(unknown: string): string | null {
  const candidates: Array<{ verb: string; example: string }> = [
    {
      verb: "topology",
      example: "bp scaffold topology --topology mazur|xor|iris [--out <file>]",
    },
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

  // 2. Schema validation (FT-C-001 / FT-F-001). bp verify mazur is the
  // v0.1.0-pinned Mazur path — force-dispatch against schemas/receipt.v0.1.0.json
  // so the typed-narrow to MazurReceipt below is sound regardless of what
  // schema_version field the input declares. The CLI agent's v0.3 work
  // adds a sibling `bp verify general` for v0.2.0 receipts.
  const validation = validateReceiptSchema(receipt, { version: "0.1.0" });
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
  // validation.receipt is typed `unknown` by the multi-version validator;
  // the explicit { version: "0.1.0" } dispatch above means Ajv asserted the
  // input structurally conforms to MazurReceipt's schema, so the cast is
  // sound. CLI agent's v0.3 work splits this into per-schema-version helpers.
  const typedReceipt = validation.receipt as MazurReceipt;

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
// generate (FT-C-002 mazur / FT-C-007 xor / FT-C-008 iris)
// =============================================================================

/**
 * Shared --check / --out / stdout dispatch for all `bp generate <topology>`
 * subcommands. The three topologies (Mazur, XOR, iris) differ only in
 * which engine produces the bytes and which golden fixture --check
 * compares against; centralizing the dispatch here keeps the human-facing
 * behavior identical across topologies and makes adding a fourth (e.g.
 * xor-relu in v0.4) a one-line addition at the call site.
 */
function emitGenerated(args: { bytes: string; label: string; goldenPath: string }): void {
  const { bytes, label, goldenPath } = args;

  if (checkMode) {
    let goldenBytes: string;
    try {
      goldenBytes = readFileSync(goldenPath, "utf-8");
    } catch (err) {
      exitOnReadError(err, goldenPath);
    }
    if (bytes === goldenBytes) {
      if (jsonMode) {
        process.stdout.write(`${JSON.stringify({ ok: true })}\n`);
      } else if (verboseMode) {
        verboseLog(`generate ${label} --check: byte-equal`);
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
        `${color(`generate ${label} --check: drift detected`, `${BOLD}${RED}`, useColor)}\n`,
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
      verboseLog(`generate ${label}: wrote ${bytes.length} bytes to ${outFile}`);
    }
    process.exit(0);
  }

  // Default: write to stdout.
  process.stdout.write(bytes);
  process.exit(0);
}

function runGenerateMazur(): void {
  // Always re-run the engine and emit canonical bytes; downstream branches
  // dispatch on --check / --out.
  const bytes = emitMazurReceipt(runMazurStep(MAZUR_INPUT));
  emitGenerated({
    bytes,
    label: "mazur",
    goldenPath: "fixtures/mazur.golden.jsonl",
  });
}

/**
 * Require a v0.3 namespace member at the moment of use, surfacing a
 * focused error if the Math / Library / Reconciler agent hasn't landed
 * its export yet. The error path exits with code 2 (usage/I/O) and
 * names the missing export so the operator can identify which agent
 * still needs to finish.
 *
 * This pattern is preferred over `import { runGeneralStep }` because a
 * top-level named import from an ESM module errors at module-load time
 * if the binding is missing — which would break the existing v0.1/v0.2
 * subcommand surface even when the user is only running `bp verify
 * mazur`. Lazy resolution defers the error to invocation time.
 */
function requireLibExport<T>(name: string): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = (bplib as unknown as Record<string, unknown>)[name];
  if (v === undefined) {
    exitWithUsageError(
      `library export '${name}' is not available. This subcommand requires the v0.3 generalized-engine surface (Math + Library + Reconciler agents). Hint: ensure src/index.ts exports it, then rebuild.`,
      "MISSING_LIB_EXPORT",
    );
  }
  return v as T;
}

function runGenerateXor(): void {
  // Lazy-resolve the v0.3 exports so the binary still loads cleanly
  // even if the Math agent hasn't shipped XOR_INPUT / runGeneralStep /
  // emitGeneralReceipt yet.
  const runGeneralStep = requireLibExport<(input: unknown) => unknown>("runGeneralStep");
  const emitGeneralReceipt = requireLibExport<(r: unknown) => string>("emitGeneralReceipt");
  const XOR_INPUT = requireLibExport<unknown>("XOR_INPUT");

  const bytes = emitGeneralReceipt(runGeneralStep(XOR_INPUT));
  emitGenerated({
    bytes,
    label: "xor",
    goldenPath: "fixtures/xor.golden.jsonl",
  });
}

function runGenerateIris(): void {
  const runGeneralStep = requireLibExport<(input: unknown) => unknown>("runGeneralStep");
  const emitGeneralReceipt = requireLibExport<(r: unknown) => string>("emitGeneralReceipt");
  const IRIS_INPUT = requireLibExport<unknown>("IRIS_INPUT");

  const bytes = emitGeneralReceipt(runGeneralStep(IRIS_INPUT));
  emitGenerated({
    bytes,
    label: "iris",
    goldenPath: "fixtures/iris.golden.jsonl",
  });
}

// =============================================================================
// generate from-config (v0.4)
// =============================================================================

/**
 * Read the raw text of a topology+input config file, supporting `-` for
 * stdin. Translates I/O errors via exitOnReadError.
 */
function readInputConfigText(file: string): string {
  try {
    if (file === "-") return readFileSync(0, "utf-8");
    return readFileSync(file, "utf-8");
  } catch (err) {
    exitOnReadError(err, file === "-" ? "<stdin>" : file);
  }
}

/**
 * Discriminated-union shape returned by the library's parseTopologyInput.
 *
 * The Library agent's src/parse-input.ts is responsible for combining
 * JSON.parse with Ajv validation against schemas/topology-input.v0.4.0.json
 * and returning this shape. Mirrors src/parse.ts ParseResult: callers
 * pattern-match on `ok` rather than try/catch. The CLI consumes it through
 * the lazy `requireLibExport` resolver so the binary still loads cleanly
 * if the Library agent hasn't shipped the export yet — invocation surfaces
 * a focused MISSING_LIB_EXPORT error pointing at `parseTopologyInput`.
 *
 * The `error.errors` array carries the structured Ajv errors so the CLI
 * can render JSON or human-readable per-error diagnostics. Each entry's
 * shape matches src/validate.ts SchemaError (instancePath / schemaPath /
 * keyword / message / params); the type below names only the fields the
 * CLI itself reads (kind, message, errors).
 */
type ParseTopologyInputResult =
  | { ok: true; input: unknown }
  | {
      ok: false;
      error: {
        kind: "JSON_SYNTAX" | "SCHEMA_VIOLATION";
        message: string;
        errors?: Array<{
          instancePath?: string;
          schemaPath?: string;
          keyword?: string;
          message?: string;
          params?: Record<string, unknown>;
        }>;
      };
    };

function runGenerateFromConfig(file: string): void {
  // Lazy-resolve the v0.4 library surface. parseTopologyInput is the
  // Library agent's new export; runGeneralStep + emitGeneralReceipt are
  // the v0.3 generalized-engine entrypoints. Each resolution surfaces a
  // distinct MISSING_LIB_EXPORT diagnostic if its agent hasn't shipped yet.
  const parseTopologyInput = requireLibExport<
    (text: string) => ParseTopologyInputResult
  >("parseTopologyInput");
  const runGeneralStep = requireLibExport<(input: unknown) => unknown>("runGeneralStep");
  const emitGeneralReceipt = requireLibExport<(r: unknown) => string>("emitGeneralReceipt");

  verboseLog(`processing ${file === "-" ? "<stdin>" : file}`);

  const text = readInputConfigText(file);
  const parsed = parseTopologyInput(text);
  if (!parsed.ok) {
    // Schema / JSON failure on input. Exit 1 ("verification failure"
    // bucket) matches `bp validate` / `bp validate-input` semantics —
    // a schema-rejecting input is a verification failure, not an I/O
    // error. Render the structured error list under --json so CI
    // consumers see the same shape as `bp validate-input --json`.
    if (jsonMode) {
      process.stdout.write(
        `${JSON.stringify({
          ok: false,
          error: {
            kind: parsed.error.kind,
            message: parsed.error.message,
            errors: parsed.error.errors ?? [],
          },
        })}\n`,
      );
      process.exit(1);
    }
    const useColor = shouldUseColor(process.stderr);
    process.stderr.write(
      `${color(`generate from-config: input rejected (${parsed.error.kind})`, `${BOLD}${RED}`, useColor)}\n`,
    );
    process.stderr.write(`  ${parsed.error.message}\n`);
    for (const e of parsed.error.errors ?? []) {
      const path = e.instancePath || "(root)";
      process.stderr.write(
        `  ${color("error", RED, useColor)} at ${path}: ${e.message ?? "(no message)"}\n`,
      );
      if (e.params && Object.keys(e.params).length > 0) {
        process.stderr.write(`    params: ${JSON.stringify(e.params)}\n`);
      }
    }
    process.stderr.write("\n");
    process.exit(1);
  }

  // Engine run + canonical emission. Any thrown error here surfaces as a
  // usage-error envelope rather than crashing the CLI — runGeneralStep
  // throws on parameter_order / unit_order mismatches that schema validation
  // cannot catch (those are runtime invariants enforced by the engine).
  let bytes: string;
  try {
    bytes = emitGeneralReceipt(runGeneralStep(parsed.input));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    exitWithUsageError(
      `generate from-config: engine rejected input: ${msg}. Hint: validate the input first with 'bp validate-input <file>'; if that passes, the failure is a runtime invariant (parameter_order / unit_order / finite-numeric check) that the schema does not enforce.`,
      "ENGINE_RUNTIME_ERROR",
    );
  }

  // --check mode is only meaningful when paired with --out so the user
  // names the golden to compare against. Validate that pairing here rather
  // than in emitGenerated (which receives a synthetic goldenPath from the
  // mazur/xor/iris call sites and would otherwise read the wrong file).
  if (checkMode) {
    if (outFile === undefined || outFile === "") {
      exitWithUsageError(
        "generate from-config --check requires --out <file> to name the golden fixture to compare against. Example: bp generate from-config my.json --check --out fixtures/my.golden.jsonl",
        "MISSING_CHECK_GOLDEN",
        3,
      );
    }
    emitGenerated({
      bytes,
      label: "from-config",
      goldenPath: outFile,
    });
    // emitGenerated calls process.exit; the line below is unreachable.
    return;
  }

  emitGenerated({
    bytes,
    label: "from-config",
    // Unused when --check is absent; emitGenerated only reads goldenPath
    // inside the --check branch. Pass the file argument back as a
    // placeholder so verbose diagnostics stay legible.
    goldenPath: outFile ?? file,
  });
}

// =============================================================================
// scaffold topology (v0.4)
// =============================================================================

/**
 * Emit a canonical pretty-printed JSON string for a GeneralInput literal.
 *
 * Two-space indent + trailing LF. The output is deliberately NOT the
 * canonical-emission JSONL shape (that is reserved for receipts) — scaffold
 * outputs are author-facing source files, not engine-produced artifacts.
 *
 * The key order is the natural object-literal order from src/mazur.ts (or
 * the synthesized MAZUR_GENERAL_INPUT below): topology, learning_rate,
 * inputs, targets, parameters_before, numeric_policy, bias_policy,
 * fixture?, metadata?. JSON.stringify preserves insertion order for the
 * already-constructed input object.
 */
function formatInputAsJson(input: unknown): string {
  return `${JSON.stringify(input, null, 2)}\n`;
}

function runScaffoldTopology(): void {
  if (topologyOpt === undefined) {
    exitWithUsageError(
      "scaffold topology requires --topology <name>. Expected one of: mazur, xor, iris. Run 'bp scaffold topology --help' for usage.",
      "MISSING_TOPOLOGY_ARG",
      3,
    );
  }
  if (!["mazur", "xor", "iris"].includes(topologyOpt)) {
    exitWithUsageError(
      `unknown topology '${topologyOpt}'. Expected one of: mazur, xor, iris.`,
      "INVALID_TOPOLOGY_ARG",
      3,
    );
  }

  // Resolve the seed input. xor + iris are already GeneralInput literals
  // exported from src/mazur.ts. mazur is a MazurInput (v0.1 shape) — prefer
  // the library's MAZUR_GENERAL_INPUT export if Library/Engine has shipped
  // it; otherwise fall back to assembling one here from the v0.1 MAZUR_INPUT
  // scalars + MAZUR_TOPOLOGY. Either path yields a structurally-valid
  // GeneralInput (validate-input round-trip + generate-from-config use it
  // directly).
  let input: unknown;
  if (topologyOpt === "xor") {
    input = requireLibExport<unknown>("XOR_INPUT");
  } else if (topologyOpt === "iris") {
    input = requireLibExport<unknown>("IRIS_INPUT");
  } else {
    // mazur — try Library agent's MAZUR_GENERAL_INPUT first.
    const direct = (bplib as unknown as Record<string, unknown>)["MAZUR_GENERAL_INPUT"];
    if (direct !== undefined) {
      input = direct;
    } else {
      // Fallback: synthesize from the v0.1 MAZUR_INPUT + the v0.3
      // MAZUR_TOPOLOGY. The v0.1 scalars (learning_rate, inputs, targets,
      // parameters_before) carry over byte-equal; numeric_policy and
      // bias_policy are the v0.1 shapes (tolerance: scalar 1e-9) which
      // the v0.4 topology-input schema accepts via the legacy scalar
      // tolerance form. The output is a structurally-valid GeneralInput.
      const MAZUR_TOPOLOGY = requireLibExport<unknown>("MAZUR_TOPOLOGY");
      input = {
        topology: MAZUR_TOPOLOGY,
        learning_rate: MAZUR_INPUT.learning_rate,
        inputs: { ...MAZUR_INPUT.inputs },
        targets: { ...MAZUR_INPUT.targets },
        parameters_before: { ...MAZUR_INPUT.parameters_before },
        numeric_policy: MAZUR_INPUT.numeric_policy,
        bias_policy: MAZUR_INPUT.bias_policy,
        fixture: "mazur-2-2-2-engine-first-run",
        metadata: {
          source: "src/bin/bp.ts scaffold topology --topology mazur (synthesized from MAZUR_INPUT + MAZUR_TOPOLOGY; library MAZUR_GENERAL_INPUT export not yet available)",
          url_reference:
            "https://mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example/",
          gradient_convention: "descent_direction",
        },
      };
    }
  }

  const text = formatInputAsJson(input);

  if (outFile !== undefined && outFile !== "") {
    try {
      writeFileSync(outFile, text);
    } catch (err) {
      exitOnReadError(err, outFile);
    }
    if (jsonMode) {
      process.stdout.write(
        `${JSON.stringify({ ok: true, output_path: outFile, bytes: text.length })}\n`,
      );
    } else if (verboseMode) {
      verboseLog(`scaffold topology ${topologyOpt}: wrote ${text.length} bytes to ${outFile}`);
    }
    process.exit(0);
  }

  // Default: write the JSON to stdout. --json without --out emits the
  // same JSON (the output IS JSON) — there's no separate envelope wrapper
  // since the stdout payload would otherwise be ambiguous.
  process.stdout.write(text);
  process.exit(0);
}

// =============================================================================
// validate-input (v0.4)
// =============================================================================

function runValidateInput(file: string): void {
  const parseTopologyInput = requireLibExport<
    (text: string) => ParseTopologyInputResult
  >("parseTopologyInput");

  verboseLog(`processing ${file === "-" ? "<stdin>" : file}`);

  const text = readInputConfigText(file);
  const parsed = parseTopologyInput(text);

  if (parsed.ok) {
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
      `${JSON.stringify({
        ok: false,
        error: {
          kind: parsed.error.kind,
          message: parsed.error.message,
          errors: parsed.error.errors ?? [],
        },
      })}\n`,
    );
    process.exit(1);
  }
  const useColor = shouldUseColor(process.stderr);
  process.stderr.write(
    `${color(`input schema validation failed (${parsed.error.kind})`, `${BOLD}${RED}`, useColor)}\n\n`,
  );
  process.stderr.write(`  ${parsed.error.message}\n`);
  for (const e of parsed.error.errors ?? []) {
    const path = e.instancePath || "(root)";
    process.stderr.write(
      `  ${color("error", RED, useColor)} at ${path}: ${e.message ?? "(no message)"}\n`,
    );
    if (e.params && Object.keys(e.params).length > 0) {
      process.stderr.write(`    params: ${JSON.stringify(e.params)}\n`);
    }
  }
  process.stderr.write("\n");
  process.exit(1);
}

// =============================================================================
// import <framework> (v0.6 PyTorch / v0.6.1 JAX)
// =============================================================================

/**
 * Shared CLI runner for `bp import <framework>`. Reads sidecar bytes,
 * dispatches to the named library import function, writes the resulting
 * receipt to stdout (or --out file), reports the differential outcome,
 * and exits with the documented per-importer exit codes.
 *
 * Per-framework dispatch is at the bp.ts top level (the `if (framework ===
 * "pytorch")` / "jax" branches above). This runner is the common machinery
 * — it takes the resolved per-framework library export name and calls it
 * via requireLibExport so the bp binary stays free of compile-time imports
 * from the library.
 *
 * Exit codes (identical across frameworks):
 *   0  — Import succeeded; differential check agreed within tolerance.
 *   1  — Import succeeded; differential check DISAGREED. Receipt still
 *         emitted so the operator can audit the disagreement.
 *   2  — Sidecar invalid or I/O error.
 */
function runImportFramework(
  file: string,
  libExportName:
    | "importPytorchSidecar"
    | "importJaxSidecar"
    | "importTensorflowSidecar",
  callerLabel: string,
): void {
  const outPath = valueFlag("--out");

  const importSidecar = requireLibExport<
    (
      sidecarBytes: string,
      opts?: {
        differentialTolerance?: { atol: number; rtol: number };
        extractorIdentity?: string;
        importTimestamp?: string;
        fixtureLabel?: string;
      },
    ) => {
      emittedBytes: string;
      differentialPassed: boolean;
      differentialDisagreements: Array<{
        fieldPath: string;
        delta: number;
        appliedTolerance: number;
      }>;
    }
  >(libExportName);

  verboseLog(`importing ${file === "-" ? "<stdin>" : file} via ${callerLabel}`);

  const sidecarBytes = readInputConfigText(file);

  let result: ReturnType<typeof importSidecar>;
  try {
    result = importSidecar(sidecarBytes);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (jsonMode) {
      process.stdout.write(
        `${JSON.stringify({
          ok: false,
          error: { kind: "IMPORT_FAILED", message },
        })}\n`,
      );
      process.exit(2);
    }
    const useColor = shouldUseColor(process.stderr);
    process.stderr.write(
      `${color("import failed", `${BOLD}${RED}`, useColor)}\n\n`,
    );
    process.stderr.write(`  ${message}\n\n`);
    process.exit(2);
  }

  if (outPath !== undefined && outPath.length > 0) {
    const { writeFileSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(outPath, result.emittedBytes);
    verboseLog(`wrote ${outPath}`);
  } else {
    process.stdout.write(result.emittedBytes);
  }

  if (result.differentialPassed) {
    if (jsonMode) {
      process.stderr.write(
        `${JSON.stringify({
          ok: true,
          differential: { passed: true, disagreements: [] },
        })}\n`,
      );
    } else if (outPath !== undefined) {
      const useColor = shouldUseColor(process.stderr);
      process.stderr.write(
        `${color(
          "import ok",
          GREEN,
          useColor,
        )}: differential check passed; wrote ${outPath}\n`,
      );
    }
    process.exit(0);
  }

  if (jsonMode) {
    process.stdout.write(
      `${JSON.stringify({
        ok: false,
        differential: {
          passed: false,
          disagreements: result.differentialDisagreements,
        },
      })}\n`,
    );
    process.exit(1);
  }
  const useColor = shouldUseColor(process.stderr);
  process.stderr.write(
    `${color(
      "import warning",
      `${BOLD}${RED}`,
      useColor,
    )}: engine-recompute differential DISAGREED on ${
      result.differentialDisagreements.length
    } field(s).\n`,
  );
  process.stderr.write(
    "  The receipt was still emitted with verification_state='engine_recompute_disagreed' for audit.\n",
  );
  for (const d of result.differentialDisagreements.slice(0, 10)) {
    process.stderr.write(
      `  ${color("disagree", RED, useColor)} ${d.fieldPath}: delta=${d.delta} (tolerance=${d.appliedTolerance})\n`,
    );
  }
  if (result.differentialDisagreements.length > 10) {
    process.stderr.write(
      `  ... and ${result.differentialDisagreements.length - 10} more.\n`,
    );
  }
  process.stderr.write("\n");
  process.exit(1);
}

/**
 * Per-framework thin wrapper for PyTorch. v0.6.0 shipped this as
 * runImportPytorch; v0.6.1 refactored the body into runImportFramework
 * so JAX (and TensorFlow as of v0.7.0) share the same CLI machinery.
 */
function runImportPytorch(file: string): void {
  runImportFramework(file, "importPytorchSidecar", "bp import pytorch");
}

/**
 * Per-framework thin wrapper for JAX (v0.6.1). Same CLI ergonomics as
 * runImportPytorch; same observer-mode pipeline; only the library export
 * name differs ("importJaxSidecar").
 */
function runImportJax(file: string): void {
  runImportFramework(file, "importJaxSidecar", "bp import jax");
}

/**
 * Per-framework thin wrapper for TensorFlow (v0.7.0). Third adapter on
 * the v0.6 framework-trace pattern. Same CLI ergonomics + same observer-
 * mode pipeline as PyTorch and JAX; only the library export name differs
 * ("importTensorflowSidecar"). Validates the v0.6 framework-trace pattern
 * generalizes to a third adapter without trust-model drift, schema drift,
 * or new rules.
 */
function runImportTensorflow(file: string): void {
  runImportFramework(file, "importTensorflowSidecar", "bp import tensorflow");
}

// =============================================================================
// import <framework> multi (v0.8 — multi-step observer-mode ingestion)
// =============================================================================

/**
 * v0.8 — shared CLI runner for `bp import <framework> multi <file>`.
 * Reads a JSONL stream of framework-trace.v0.2.0 sidecar records,
 * dispatches to the named library stream-import function, emits N
 * observer-mode v0.4.0 receipts (one per line on stdout, or to --out
 * file), and reports per-step + aggregate differential outcome.
 *
 * Exit codes:
 *   0  — All N steps imported AND every step's Rule 14 differential
 *         agreed within tolerance.
 *   1  — All N steps imported but ≥1 step's differential DISAGREED.
 *         All N receipts still emitted (verification_state on each
 *         disagreed step is 'engine_recompute_disagreed') for audit.
 *   2  — Usage / I/O / schema-validation error (also covers partial
 *         mid-stream failures: malformed JSONL line, schema-invalid
 *         record, mid-stream framework swap, mid-stream trace_id swap,
 *         non-sequential step_index).
 *   3  — Invalid CLI argument.
 */
function runImportFrameworkStream(
  file: string,
  libExportName:
    | "importPytorchSidecarStream"
    | "importJaxSidecarStream"
    | "importTensorflowSidecarStream",
  callerLabel: string,
): void {
  const outPath = valueFlag("--out");

  const importStream = requireLibExport<
    (
      sidecarBytes: string,
      opts?: {
        differentialTolerance?: { atol: number; rtol: number };
        extractorIdentity?: string;
        importTimestamp?: string;
        fixtureLabel?: string;
      },
    ) => {
      emittedBytes: string;
      allDifferentialsPassed: boolean;
      bundleRootDigest: string;
      steps: Array<{
        differentialPassed: boolean;
        differentialDisagreements: Array<{
          fieldPath: string;
          delta: number;
          appliedTolerance: number;
        }>;
      }>;
    }
  >(libExportName);

  verboseLog(`importing multi-step ${file === "-" ? "<stdin>" : file} via ${callerLabel}`);

  const sidecarBytes = readInputConfigText(file);

  let result: ReturnType<typeof importStream>;
  try {
    result = importStream(sidecarBytes);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (jsonMode) {
      process.stdout.write(
        `${JSON.stringify({
          ok: false,
          error: { kind: "IMPORT_STREAM_FAILED", message },
        })}\n`,
      );
      process.exit(2);
    }
    const useColor = shouldUseColor(process.stderr);
    process.stderr.write(
      `${color("multi-step import failed", `${BOLD}${RED}`, useColor)}\n\n`,
    );
    process.stderr.write(`  ${message}\n\n`);
    process.exit(2);
  }

  if (outPath !== undefined && outPath.length > 0) {
    const { writeFileSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(outPath, result.emittedBytes);
    verboseLog(
      `wrote ${outPath} (${result.steps.length} receipts, bundle_root_digest=${result.bundleRootDigest})`,
    );
  } else {
    process.stdout.write(result.emittedBytes);
  }

  if (result.allDifferentialsPassed) {
    if (jsonMode) {
      process.stderr.write(
        `${JSON.stringify({
          ok: true,
          steps: result.steps.length,
          bundle_root_digest: result.bundleRootDigest,
          differential: { all_passed: true },
        })}\n`,
      );
    } else if (outPath !== undefined) {
      const useColor = shouldUseColor(process.stderr);
      process.stderr.write(
        `${color(
          "multi-step import ok",
          GREEN,
          useColor,
        )}: ${result.steps.length} receipts; all per-step differentials passed; bundle_root_digest=${result.bundleRootDigest}; wrote ${outPath}\n`,
      );
    }
    process.exit(0);
  }

  // ≥1 step disagreed.
  const disagreedStepIndices = result.steps
    .map((s, i) => ({ s, i }))
    .filter((x) => !x.s.differentialPassed)
    .map((x) => x.i);
  if (jsonMode) {
    process.stdout.write(
      `${JSON.stringify({
        ok: false,
        steps: result.steps.length,
        bundle_root_digest: result.bundleRootDigest,
        differential: {
          all_passed: false,
          disagreed_step_indices: disagreedStepIndices,
          disagreements: result.steps.map((s, i) => ({
            step_index: i,
            passed: s.differentialPassed,
            disagreements: s.differentialDisagreements,
          })),
        },
      })}\n`,
    );
    process.exit(1);
  }
  const useColor = shouldUseColor(process.stderr);
  process.stderr.write(
    `${color(
      "multi-step import warning",
      `${BOLD}${RED}`,
      useColor,
    )}: engine-recompute differential DISAGREED on ${disagreedStepIndices.length} of ${result.steps.length} step(s) (indices: ${disagreedStepIndices.join(", ")}).\n`,
  );
  process.stderr.write(
    "  All receipts emitted with per-step verification_state for audit.\n",
  );
  for (const idx of disagreedStepIndices.slice(0, 5)) {
    const s = result.steps[idx]!;
    process.stderr.write(`  step ${idx}: ${s.differentialDisagreements.length} field(s) disagreed\n`);
    for (const d of s.differentialDisagreements.slice(0, 5)) {
      process.stderr.write(
        `    ${color("disagree", RED, useColor)} ${d.fieldPath}: delta=${d.delta} (tolerance=${d.appliedTolerance})\n`,
      );
    }
  }
  process.stderr.write("\n");
  process.exit(1);
}

function runImportPytorchStream(file: string): void {
  runImportFrameworkStream(file, "importPytorchSidecarStream", "bp import pytorch multi");
}

function runImportJaxStream(file: string): void {
  runImportFrameworkStream(file, "importJaxSidecarStream", "bp import jax multi");
}

function runImportTensorflowStream(file: string): void {
  runImportFrameworkStream(file, "importTensorflowSidecarStream", "bp import tensorflow multi");
}

// =============================================================================
// verify general (v0.3, FT-C-005)
// =============================================================================

/**
 * Generalized verify gate. Works on any v0.2-schema receipt (XOR, iris,
 * arbitrary user-authored topology). Composes schema validation, Rules
 * 1-8 reconciliation, and engine-reproduction via the generalized engine
 * path. Skips Mazur-specific checks (byte-equal vs golden, published-
 * anchor drift) — those are scope-only for `bp verify mazur`.
 *
 * Multi-step Rules 9, 10 are NOT run here. They require the full per-
 * record list and fire only on `bp verify multi`.
 */
function runVerifyGeneral(opts: {
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
    throw err;
  }

  // v0.5.1 — early dispatch for v0.1 Mazur receipts. The general engine
  // requires unit_order + parameter_order, which v0.1 receipts don't
  // carry; running this verifier on a v0.1 receipt would always fail at
  // engine-reproduce with a cryptic schema-shape error. Redirect the
  // operator to `bp verify mazur` with an explicit diagnostic before any
  // schema validation runs. The dedicated `bp verify mazur` path handles
  // v0.1 receipts including byte-equal-vs-golden and published-anchor
  // drift checks that this verifier deliberately skips.
  //
  // Detection is purely string-level on the receipt's declared
  // schema_version field — no Ajv invocation, no engine call. A receipt
  // with no schema_version or a non-string value falls through to normal
  // validation (which will report the missing/invalid field).
  if (receipt !== null && typeof receipt === "object") {
    const sv = (receipt as { schema_version?: unknown }).schema_version;
    if (sv === "0.1.0") {
      checks.push({
        name: "schema-dispatch",
        status: "fail",
        message:
          `Receipt declares schema_version "0.1.0" (the Mazur 2-2-2 pinned schema). ` +
          `Use 'bp verify mazur ${opts.receiptPath}' instead — that verifier handles ` +
          `v0.1 receipts including byte-equal-vs-golden + published-anchor drift checks. ` +
          `'bp verify general' targets v0.2.0+ generalized receipts (XOR, iris, softmax+CE, ` +
          `custom topologies) which carry topology.unit_order + topology.parameter_order ` +
          `that the general engine requires.`,
      });
      return finalizeReport(checks, opts);
    }
  }

  // 2. Schema validation. Without an explicit version override the
  // validator dispatches on the receipt's declared schema_version
  // (Library agent's v0.3 work auto-routes "0.2.0" receipts to
  // schemas/receipt.v0.2.0.json; v0.5 adds "0.3.0" for softmax+CE).
  // The v0.1 redirect above means we only ever validate v0.2.0+ shapes
  // here.
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

  if (!validation.ok) {
    return finalizeReport(checks, opts);
  }
  const typedReceipt = validation.receipt;

  // 3. Reconciliation (Rules 1-8).
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

  // 4. Engine reproduction via the generalized engine path. Library
  // agent exposes verifyGeneralEngineReproduces; it consumes the
  // receipt's topology declaration (unit_order + parameter_order +
  // activation choices) to drive the engine, then compares the emitted
  // bytes against the receipt's canonical form.
  type GeneralEngineRepro = {
    matches: boolean;
    firstDifferingByte: number;
    ourBytes: { length: number };
    theirBytes: { length: number };
  };
  const verifyGeneralEngineReproduces = requireLibExport<
    (r: unknown) => GeneralEngineRepro
  >("verifyGeneralEngineReproduces");
  try {
    const engineRepro = verifyGeneralEngineReproduces(typedReceipt);
    if (engineRepro.matches) {
      checks.push({ name: "engine-reproduce", status: "pass" });
    } else {
      checks.push({
        name: "engine-reproduce",
        status: "fail",
        message: `engine output diverges from receipt at byte ${engineRepro.firstDifferingByte}`,
        evidence: {
          first_differing_byte: engineRepro.firstDifferingByte,
          our_length: engineRepro.ourBytes?.length,
          their_length: engineRepro.theirBytes?.length,
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

  return finalizeReport(checks, opts);
}

// =============================================================================
// verify multi (v0.3, FT-C-006)
// =============================================================================

type MultiSubReport = {
  step_index: number;
  schema_version?: string;
  fixture_id?: string;
  schema: VerifyCheck;
  reconcile: VerifyCheck;
};

type VerifyMultiReport = {
  overall: "pass" | "fail" | "warn";
  record_count: number;
  per_record: MultiSubReport[];
  cross_record_checks: VerifyCheck[];
};

/**
 * Multi-record verify gate. Reads an N-record JSONL training run,
 * validates + reconciles each record (Rules 1-8), then runs the cross-
 * record reconcileMultiStep helper for Rule 9 (parameter chain) and
 * Rule 10 (trace identity).
 *
 * Each per-record sub-report mirrors the shape of verify general — schema
 * + reconcile checks per step — so a consumer can pinpoint which step
 * failed without re-running anything. The cross-record checks live in a
 * separate flat list so the overall report stays jq-friendly.
 *
 * Multi-step rules require ALL records to be structurally valid; if any
 * record fails schema validation, the cross-record pass is skipped (a
 * partial chain would yield meaningless Rule 9 / Rule 10 failures).
 */
function runVerifyMulti(opts: {
  receiptsPath: string;
  warnAsFail: boolean;
  strict: boolean;
}): VerifyMultiReport {
  // 1. Read + parse the multi-record file. Caller translates I/O errors.
  let records: unknown[];
  try {
    records = readMultiRecordJsonl(opts.receiptsPath);
  } catch (err) {
    throw err;
  }

  const perRecord: MultiSubReport[] = [];
  const typedReceipts: unknown[] = [];

  // 2. Per-record schema + reconcile loop. Collect typed receipts for
  // the cross-record pass; if a record fails schema, skip its reconcile
  // step (it's already failed; running reconcile would crash on missing
  // fields) and DO NOT contribute it to the cross-record list (multi-
  // step rules require a structurally valid record).
  for (let i = 0; i < records.length; i += 1) {
    const rec = records[i];
    const desc = describeReceipt(rec);
    const validation = validateReceiptSchema(rec);

    const schemaCheck: VerifyCheck = validation.ok
      ? { name: `schema[${i}]`, status: "pass" }
      : {
          name: `schema[${i}]`,
          status: "fail",
          message: `schema validation failed (${validation.errors.length} error(s))`,
          evidence: validation.errors,
        };

    let reconcileCheck: VerifyCheck;
    if (validation.ok) {
      const r = reconcileReceipt(validation.receipt);
      reconcileCheck = r.ok
        ? { name: `reconcile[${i}]`, status: "pass" }
        : {
            name: `reconcile[${i}]`,
            status: "fail",
            message: `${r.failures.length} rule failure(s)`,
            evidence: r.failures,
          };
      typedReceipts.push(validation.receipt);
    } else {
      reconcileCheck = {
        name: `reconcile[${i}]`,
        status: "skip",
        message: "skipped — schema validation failed for this record",
      };
    }

    perRecord.push({
      step_index: i,
      schema_version: desc.schemaVersion,
      fixture_id: desc.fixtureId,
      schema: schemaCheck,
      reconcile: reconcileCheck,
    });
  }

  // 3. Cross-record reconciliation (Rules 9, 10). Only fires if every
  // record passed schema — Rule 9 traverses parameters_before/after
  // chains and Rule 10 checks trace_id/step_index, neither of which is
  // safe on a structurally invalid record.
  const crossChecks: VerifyCheck[] = [];
  const allRecordsValidated = typedReceipts.length === records.length;
  if (!allRecordsValidated) {
    crossChecks.push({
      name: "multi-step-rules-9-10",
      status: "skip",
      message:
        "skipped — at least one record failed schema validation; multi-step rules require all records to be structurally valid",
    });
  } else {
    type MultiStepResult =
      | { ok: true }
      | { ok: false; failures: ReconciliationFailure[] };
    const reconcileMultiStep = requireLibExport<
      (receipts: unknown[]) => MultiStepResult
    >("reconcileMultiStep");
    try {
      const multi = reconcileMultiStep(typedReceipts);
      if (multi.ok) {
        crossChecks.push({ name: "multi-step-rules-9-10", status: "pass" });
      } else {
        // reconcileMultiStep returns the same ReconciliationFailure
        // shape; failures with rule === 9 or rule === 10 are the new
        // multi-step rules. Anything else would indicate the helper
        // also surfaced per-record failures (the per-record loop above
        // would have already caught those; downstream consumers may
        // double-count, which is acceptable for a fail signal).
        crossChecks.push({
          name: "multi-step-rules-9-10",
          status: "fail",
          message: `${multi.failures.length} cross-record rule failure(s)`,
          evidence: multi.failures,
        });
      }
    } catch (err) {
      crossChecks.push({
        name: "multi-step-rules-9-10",
        status: "fail",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 4. Compute overall verdict using the same gating logic as verify
  // mazur / verify general — but over the union of all per-record +
  // cross-record checks.
  const allChecks: VerifyCheck[] = [];
  for (const sub of perRecord) {
    allChecks.push(sub.schema, sub.reconcile);
  }
  for (const c of crossChecks) {
    allChecks.push(c);
  }
  const rolled = finalizeReport(allChecks, opts);

  return {
    overall: rolled.overall,
    record_count: records.length,
    per_record: perRecord,
    cross_record_checks: crossChecks,
  };
}

function renderVerifyMultiReport(report: VerifyMultiReport): string {
  const useColor = shouldUseColor(process.stderr);
  const lines: string[] = [];
  const header =
    report.overall === "pass"
      ? color(`verify multi passed (${report.record_count} record(s))`, `${BOLD}${GREEN}`, useColor)
      : report.overall === "warn"
        ? color(`verify multi passed with warnings (${report.record_count} record(s))`, `${BOLD}${YELLOW}`, useColor)
        : color(`verify multi failed (${report.record_count} record(s))`, `${BOLD}${RED}`, useColor);
  lines.push(header);
  lines.push("");

  const tagOf = (s: VerifyCheckStatus): string =>
    s === "pass"
      ? color("PASS", GREEN, useColor)
      : s === "warn"
        ? color("WARN", YELLOW, useColor)
        : s === "skip"
          ? color("SKIP", YELLOW, useColor)
          : color("FAIL", RED, useColor);

  for (const sub of report.per_record) {
    const idTag = sub.fixture_id ? ` (${sub.fixture_id})` : "";
    lines.push(`record ${sub.step_index}${idTag}:`);
    for (const check of [sub.schema, sub.reconcile]) {
      lines.push(`  [${tagOf(check.status)}] ${check.name}${check.message ? `: ${check.message}` : ""}`);
      if (check.status === "fail" && check.evidence !== undefined) {
        const evidence = JSON.stringify(check.evidence, null, 2)
          .split("\n")
          .map((l) => `    ${l}`)
          .join("\n");
        lines.push(evidence);
      }
    }
  }
  lines.push("");
  lines.push("cross-record:");
  for (const check of report.cross_record_checks) {
    lines.push(`  [${tagOf(check.status)}] ${check.name}${check.message ? `: ${check.message}` : ""}`);
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
// bp verify mazur [<file>] | bp verify general <file> | bp verify multi <file.jsonl>
// -----------------------------------------------------------------------------

if (argv[0] === "verify") {
  if (argv[1] === undefined) {
    exitWithUsageError(
      "incomplete command 'verify'. Did you mean 'bp verify mazur', 'bp verify general <file>', or 'bp verify multi <file.jsonl>'? Run 'bp --help' for usage.",
    );
  }

  // ---------------------------------------------------------------------------
  // bp verify mazur [<file>]
  // ---------------------------------------------------------------------------
  if (argv[1] === "mazur") {
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

  // ---------------------------------------------------------------------------
  // bp verify general <file>
  // ---------------------------------------------------------------------------
  if (argv[1] === "general") {
    if (argv[2] === "--help" || argv[2] === "-h") {
      process.stdout.write(verifyGeneralUsageText());
      process.exit(0);
    }
    const candidateFile = argv[2];
    if (typeof candidateFile !== "string" || candidateFile.length === 0) {
      if (jsonMode) {
        exitWithUsageError(
          "missing required argument <file> for 'verify general'. Run 'bp verify general --help' for usage.",
          "MISSING_FILE_ARG",
        );
      }
      process.stderr.write(verifyGeneralUsageText());
      process.exit(2);
    }
    if (candidateFile.startsWith("-") && candidateFile !== "-") {
      exitWithUsageError(
        `refusing to treat ${JSON.stringify(candidateFile)} as a filename (starts with '-'). ` +
          `Use 'bp verify general --help' for usage.`,
        "INVALID_FILE_ARG",
        3,
      );
    }

    verboseLog(`verify general subject: ${candidateFile}`);

    let report: VerifyReport;
    try {
      report = runVerifyGeneral({
        receiptPath: candidateFile,
        warnAsFail,
        strict: strictMode,
      });
    } catch (err) {
      exitOnReadError(err, candidateFile);
    }

    if (jsonMode) {
      process.stdout.write(`${JSON.stringify({ ok: report.overall !== "fail", report })}\n`);
    } else {
      process.stderr.write(renderVerifyReport(report));
    }
    process.exit(report.overall === "fail" ? 1 : 0);
  }

  // ---------------------------------------------------------------------------
  // bp verify multi <file.jsonl>
  // ---------------------------------------------------------------------------
  if (argv[1] === "multi") {
    if (argv[2] === "--help" || argv[2] === "-h") {
      process.stdout.write(verifyMultiUsageText());
      process.exit(0);
    }
    const candidateFile = argv[2];
    if (typeof candidateFile !== "string" || candidateFile.length === 0) {
      if (jsonMode) {
        exitWithUsageError(
          "missing required argument <file.jsonl> for 'verify multi'. Run 'bp verify multi --help' for usage.",
          "MISSING_FILE_ARG",
        );
      }
      process.stderr.write(verifyMultiUsageText());
      process.exit(2);
    }
    if (candidateFile.startsWith("-") && candidateFile !== "-") {
      exitWithUsageError(
        `refusing to treat ${JSON.stringify(candidateFile)} as a filename (starts with '-'). ` +
          `Use 'bp verify multi --help' for usage.`,
        "INVALID_FILE_ARG",
        3,
      );
    }

    verboseLog(`verify multi subject: ${candidateFile}`);

    let report: VerifyMultiReport;
    try {
      report = runVerifyMulti({
        receiptsPath: candidateFile,
        warnAsFail,
        strict: strictMode,
      });
    } catch (err) {
      exitOnReadError(err, candidateFile);
    }

    if (jsonMode) {
      process.stdout.write(`${JSON.stringify({ ok: report.overall !== "fail", report })}\n`);
    } else {
      process.stderr.write(renderVerifyMultiReport(report));
    }
    process.exit(report.overall === "fail" ? 1 : 0);
  }

  // Unknown verify subnoun — fuzzy-suggest the closest match.
  const verifySubnoun = argv[1];
  const verifySuggestion = suggestVerifySubnoun(verifySubnoun);
  exitWithUsageError(
    verifySuggestion
      ? `unknown subcommand 'verify ${verifySubnoun}'. Did you mean '${verifySuggestion}'? Run 'bp --help' for usage.`
      : `unknown subcommand 'verify ${verifySubnoun}'. Expected 'mazur', 'general', or 'multi'. Run 'bp --help' for usage.`,
  );
}

// -----------------------------------------------------------------------------
// bp generate mazur | bp generate xor | bp generate iris
// -----------------------------------------------------------------------------

if (argv[0] === "generate") {
  if (argv[1] === undefined) {
    exitWithUsageError(
      "incomplete command 'generate'. Did you mean 'bp generate mazur', 'bp generate xor', 'bp generate iris', or 'bp generate from-config <file>'? Run 'bp --help' for usage.",
    );
  }
  if (argv[1] === "mazur") {
    if (argv[2] === "--help" || argv[2] === "-h") {
      process.stdout.write(generateUsageText());
      process.exit(0);
    }
    runGenerateMazur();
  }
  if (argv[1] === "xor") {
    if (argv[2] === "--help" || argv[2] === "-h") {
      process.stdout.write(generateXorUsageText());
      process.exit(0);
    }
    runGenerateXor();
  }
  if (argv[1] === "iris") {
    if (argv[2] === "--help" || argv[2] === "-h") {
      process.stdout.write(generateIrisUsageText());
      process.exit(0);
    }
    runGenerateIris();
  }
  if (argv[1] === "from-config") {
    if (argv[2] === "--help" || argv[2] === "-h") {
      process.stdout.write(generateFromConfigUsageText());
      process.exit(0);
    }
    const candidateFile = argv[2];
    if (typeof candidateFile !== "string" || candidateFile.length === 0) {
      if (jsonMode) {
        exitWithUsageError(
          "missing required argument <file> for 'generate from-config'. Run 'bp generate from-config --help' for usage.",
          "MISSING_FILE_ARG",
        );
      }
      process.stderr.write(generateFromConfigUsageText());
      process.exit(2);
    }
    if (candidateFile.startsWith("-") && candidateFile !== "-") {
      exitWithUsageError(
        `refusing to treat ${JSON.stringify(candidateFile)} as a filename (starts with '-'). ` +
          `Use 'bp generate from-config --help' for usage.`,
        "INVALID_FILE_ARG",
        3,
      );
    }
    runGenerateFromConfig(candidateFile);
  }

  // Unknown generate subnoun — fuzzy-suggest the closest match.
  const generateSubnoun = argv[1];
  const generateSuggestion = suggestGenerateSubnoun(generateSubnoun);
  exitWithUsageError(
    generateSuggestion
      ? `unknown subcommand 'generate ${generateSubnoun}'. Did you mean '${generateSuggestion}'? Run 'bp --help' for usage.`
      : `unknown subcommand 'generate ${generateSubnoun}'. Expected 'mazur', 'xor', 'iris', or 'from-config'. Run 'bp --help' for usage.`,
  );
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
// bp scaffold topology --topology mazur|xor|iris [--out <file>] (v0.4)
// -----------------------------------------------------------------------------

if (argv[0] === "scaffold") {
  if (argv[1] === undefined) {
    exitWithUsageError(
      "incomplete command 'scaffold'. Did you mean 'bp scaffold topology --topology mazur|xor|iris'? Run 'bp --help' for usage.",
    );
  }
  if (argv[1] === "topology") {
    if (argv[2] === "--help" || argv[2] === "-h") {
      process.stdout.write(scaffoldTopologyUsageText());
      process.exit(0);
    }
    runScaffoldTopology();
  }

  // Unknown scaffold subnoun — only `topology` is permitted in v0.4 (see
  // design memo §7 — scaffolding receipt bytes is explicitly excluded).
  const scaffoldSubnoun = argv[1];
  const scaffoldSuggestion = suggestScaffoldSubnoun(scaffoldSubnoun);
  exitWithUsageError(
    scaffoldSuggestion
      ? `unknown subcommand 'scaffold ${scaffoldSubnoun}'. Did you mean '${scaffoldSuggestion}'? Run 'bp --help' for usage.`
      : `unknown subcommand 'scaffold ${scaffoldSubnoun}'. Expected 'topology'. Run 'bp --help' for usage.`,
  );
}

// -----------------------------------------------------------------------------
// bp validate-input <file> (v0.4)
// -----------------------------------------------------------------------------

if (argv[0] === "validate-input") {
  if (argv[1] === "--help" || argv[1] === "-h") {
    process.stdout.write(validateInputUsageText());
    process.exit(0);
  }

  const file = argv[1];
  if (typeof file !== "string" || file.length === 0) {
    if (jsonMode) {
      exitWithUsageError(
        "missing required argument <file> for 'validate-input'. Run 'bp validate-input --help' for usage.",
        "MISSING_FILE_ARG",
      );
    }
    process.stderr.write(validateInputUsageText());
    process.exit(2);
  }
  if (file.startsWith("-") && file !== "-" && file !== "--") {
    exitWithUsageError(
      `refusing to treat ${JSON.stringify(file)} as a filename (starts with '-'). ` +
        `Use 'bp validate-input --help' for usage.`,
      "INVALID_FILE_ARG",
      3,
    );
  }
  runValidateInput(file);
}

// -----------------------------------------------------------------------------
// bp import <framework> <file> (v0.6 external trace ingestion)
// -----------------------------------------------------------------------------
//
// Per-framework subcommands (Agent 3 finding, SARIF Multitool / HF Optimum
// precedent), not auto-detection. v0.6.0 ships pytorch only; jax / tensorflow
// follow as patch releases with the same shape.
//
// `bp import pytorch <sidecar.jsonl> [--out <file>]` produces an observer-mode
// v0.4.0 receipt that carries the foreign framework's claimed math as
// canonical fields + attestor + source_framework blocks. The differential
// engine check runs at import time AND again on `bp verify general` of the
// produced receipt (Reproducible Builds discipline — producer's claim is
// not the verifier's truth).

if (argv[0] === "import") {
  const framework = argv[1];
  if (framework === undefined || framework === "--help" || framework === "-h") {
    process.stdout.write(importUsageText());
    process.exit(framework === undefined ? 2 : 0);
  }

  if (framework === "pytorch") {
    // v0.8 multi-step subnoun. Same per-framework subcommand discipline
    // as single-step; the `multi` subnoun selects the JSONL-stream path.
    if (argv[2] === "multi") {
      const file = argv[3];
      if (typeof file !== "string" || file.length === 0) {
        if (jsonMode) {
          exitWithUsageError(
            "missing required argument <sidecar.jsonl> for 'import pytorch multi'. Run 'bp import pytorch multi --help' for usage.",
            "MISSING_FILE_ARG",
          );
        }
        process.stderr.write(importStreamUsageText("pytorch"));
        process.exit(2);
      }
      if (file === "--help" || file === "-h") {
        process.stdout.write(importStreamUsageText("pytorch"));
        process.exit(0);
      }
      if (file.startsWith("-") && file !== "-" && file !== "--") {
        exitWithUsageError(
          `refusing to treat ${JSON.stringify(file)} as a filename (starts with '-'). ` +
            `Use 'bp import pytorch multi --help' for usage.`,
          "INVALID_FILE_ARG",
          3,
        );
      }
      runImportPytorchStream(file);
    }
    const file = argv[2];
    if (typeof file !== "string" || file.length === 0) {
      if (jsonMode) {
        exitWithUsageError(
          "missing required argument <sidecar-file> for 'import pytorch'. Run 'bp import pytorch --help' for usage.",
          "MISSING_FILE_ARG",
        );
      }
      process.stderr.write(importPytorchUsageText());
      process.exit(2);
    }
    if (file === "--help" || file === "-h") {
      process.stdout.write(importPytorchUsageText());
      process.exit(0);
    }
    if (file.startsWith("-") && file !== "-" && file !== "--") {
      exitWithUsageError(
        `refusing to treat ${JSON.stringify(file)} as a filename (starts with '-'). ` +
          `Use 'bp import pytorch --help' for usage.`,
        "INVALID_FILE_ARG",
        3,
      );
    }
    runImportPytorch(file);
  }

  // v0.6.1: bp import jax — thin wrapper over the same observer-mode
  // pipeline as bp import pytorch. Same trust model, same Rule 14, same
  // observer-mode v0.4.0 receipt; only the source_framework name +
  // extractor identity differ.
  if (framework === "jax") {
    if (argv[2] === "multi") {
      const file = argv[3];
      if (typeof file !== "string" || file.length === 0) {
        if (jsonMode) {
          exitWithUsageError(
            "missing required argument <sidecar.jsonl> for 'import jax multi'. Run 'bp import jax multi --help' for usage.",
            "MISSING_FILE_ARG",
          );
        }
        process.stderr.write(importStreamUsageText("jax"));
        process.exit(2);
      }
      if (file === "--help" || file === "-h") {
        process.stdout.write(importStreamUsageText("jax"));
        process.exit(0);
      }
      if (file.startsWith("-") && file !== "-" && file !== "--") {
        exitWithUsageError(
          `refusing to treat ${JSON.stringify(file)} as a filename (starts with '-'). ` +
            `Use 'bp import jax multi --help' for usage.`,
          "INVALID_FILE_ARG",
          3,
        );
      }
      runImportJaxStream(file);
    }
    const file = argv[2];
    if (typeof file !== "string" || file.length === 0) {
      if (jsonMode) {
        exitWithUsageError(
          "missing required argument <sidecar-file> for 'import jax'. Run 'bp import jax --help' for usage.",
          "MISSING_FILE_ARG",
        );
      }
      process.stderr.write(importJaxUsageText());
      process.exit(2);
    }
    if (file === "--help" || file === "-h") {
      process.stdout.write(importJaxUsageText());
      process.exit(0);
    }
    if (file.startsWith("-") && file !== "-" && file !== "--") {
      exitWithUsageError(
        `refusing to treat ${JSON.stringify(file)} as a filename (starts with '-'). ` +
          `Use 'bp import jax --help' for usage.`,
        "INVALID_FILE_ARG",
        3,
      );
    }
    runImportJax(file);
  }

  // v0.7.0: bp import tensorflow — third adapter on the v0.6 framework-
  // trace pattern. Same dispatch shape as pytorch and jax above; only the
  // source_framework name + extractor identity + library export differ.
  if (framework === "tensorflow") {
    if (argv[2] === "multi") {
      const file = argv[3];
      if (typeof file !== "string" || file.length === 0) {
        if (jsonMode) {
          exitWithUsageError(
            "missing required argument <sidecar.jsonl> for 'import tensorflow multi'. Run 'bp import tensorflow multi --help' for usage.",
            "MISSING_FILE_ARG",
          );
        }
        process.stderr.write(importStreamUsageText("tensorflow"));
        process.exit(2);
      }
      if (file === "--help" || file === "-h") {
        process.stdout.write(importStreamUsageText("tensorflow"));
        process.exit(0);
      }
      if (file.startsWith("-") && file !== "-" && file !== "--") {
        exitWithUsageError(
          `refusing to treat ${JSON.stringify(file)} as a filename (starts with '-'). ` +
            `Use 'bp import tensorflow multi --help' for usage.`,
          "INVALID_FILE_ARG",
          3,
        );
      }
      runImportTensorflowStream(file);
    }
    const file = argv[2];
    if (typeof file !== "string" || file.length === 0) {
      if (jsonMode) {
        exitWithUsageError(
          "missing required argument <sidecar-file> for 'import tensorflow'. Run 'bp import tensorflow --help' for usage.",
          "MISSING_FILE_ARG",
        );
      }
      process.stderr.write(importTensorflowUsageText());
      process.exit(2);
    }
    if (file === "--help" || file === "-h") {
      process.stdout.write(importTensorflowUsageText());
      process.exit(0);
    }
    if (file.startsWith("-") && file !== "-" && file !== "--") {
      exitWithUsageError(
        `refusing to treat ${JSON.stringify(file)} as a filename (starts with '-'). ` +
          `Use 'bp import tensorflow --help' for usage.`,
        "INVALID_FILE_ARG",
        3,
      );
    }
    runImportTensorflow(file);
  }

  // Unknown framework.
  const knownFrameworks = ["pytorch", "jax", "tensorflow"];
  exitWithUsageError(
    `unknown framework '${framework}' for 'bp import'. Known: ${knownFrameworks.join(", ")}. ` +
      `bp does NOT auto-detect framework from file contents — name it explicitly. ` +
      `Run 'bp import --help' for the current import surface.`,
    "UNKNOWN_FRAMEWORK",
    2,
  );
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
