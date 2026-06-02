/**
 * v0.7.0 — Shipcheck B1 (Tier-1 Structured Error Shape) test plate.
 *
 * Verifies the bp CLI's --json error envelope conforms to the shipcheck
 * Tier-1 shape: {ok:false, error:{code, message, hint?, cause?, retryable?}}.
 *
 * Migration discipline: v0.7.0 extends `exitWithUsageError` to support
 * the optional hint/cause/retryable fields. The ENOENT/EACCES/EISDIR/
 * BP_JSONL_PARSE_ERROR/INVALID_JSON/IO_ERROR callers in exitOnReadError
 * are migrated as proof; remaining callers (legacy embed-Hint-in-message
 * style) continue to work without modification. Future v0.7.x can migrate
 * additional callers incrementally.
 *
 * Stage C (cli-B-001..007) extends this plate with humanization coverage:
 * INPUT_TOO_LARGE mapping, the structured read-error catch-all, wrapped
 * import writes, the --json import result-stream contract, the valueFlag
 * missing-value guard, and the stdin-sentinel TTY guard.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, resolve, join } from "node:path"
import {
  openSync,
  ftruncateSync,
  closeSync,
  rmSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { constants as bufferConstants } from "node:buffer"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")

function runBp(args: string[]): {
  status: number | null
  stdout: string
  stderr: string
} {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/bin/bp.ts", ...args],
    { cwd: repoRoot, encoding: "utf-8" },
  )
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/**
 * Like runBp but feeds `input` to the child's stdin. Used to exercise the `-`
 * stdin sentinel WITHOUT the parent's TTY state (spawnSync with an `input`
 * string makes the child's stdin a pipe, so isTTY is false — the normal piped
 * case).
 */
function runBpWithStdin(
  args: string[],
  input: string,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/bin/bp.ts", ...args],
    { cwd: repoRoot, encoding: "utf-8", input },
  )
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

test("--json envelope shape conforms to Tier-1 (ENOENT path)", () => {
  const { status, stdout } = runBp([
    "reconcile",
    "receipt",
    "/tmp/does-not-exist.json",
    "--json",
  ])
  assert.strictEqual(status, 2, "ENOENT must exit 2")
  const parsed = JSON.parse(stdout.trim())
  assert.strictEqual(parsed.ok, false)
  assert.strictEqual(parsed.error.code, "ENOENT")
  assert.match(parsed.error.message, /file not found/)
  // Tier-1 additions: hint + retryable as structured fields (not buried
  // in message string).
  assert.strictEqual(typeof parsed.error.hint, "string")
  assert.match(parsed.error.hint, /check the path/)
  assert.strictEqual(parsed.error.retryable, false)
  // Negative assertion: message must NOT contain "Hint:" (migration
  // removed it from the human-prose message in favor of the structured
  // field).
  assert.doesNotMatch(parsed.error.message, /Hint:/)
})

test("--json envelope shape conforms to Tier-1 (EISDIR path)", () => {
  const { status, stdout } = runBp([
    "reconcile",
    "receipt",
    repoRoot,
    "--json",
  ])
  // The repo root is a directory; reconcile should refuse it with EISDIR.
  assert.strictEqual(status, 2)
  const parsed = JSON.parse(stdout.trim())
  assert.strictEqual(parsed.ok, false)
  assert.strictEqual(parsed.error.code, "EISDIR")
  assert.strictEqual(typeof parsed.error.hint, "string")
  assert.strictEqual(parsed.error.retryable, false)
})

test("--json envelope is still backward-compat for legacy callers (USAGE path)", () => {
  // 'bp reconcile' without 'receipt' subnoun → USAGE error from the
  // dispatcher. Legacy caller without opts.hint — should still produce
  // a valid Tier-1 envelope (hint/cause/retryable omitted).
  const { status, stdout } = runBp(["reconcile", "--json"])
  assert.strictEqual(status, 2)
  const parsed = JSON.parse(stdout.trim())
  assert.strictEqual(parsed.ok, false)
  assert.strictEqual(typeof parsed.error.code, "string")
  assert.strictEqual(typeof parsed.error.message, "string")
  // Legacy callers don't supply hint/cause/retryable; envelope omits
  // those keys entirely (not null, not undefined — absent).
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(parsed.error, "hint"),
    false,
    "legacy callers should not surface a hint field at all (additive optionality)",
  )
})

test("human-mode (non-JSON) emits Hint: on second stderr line when supplied", () => {
  const { status, stderr } = runBp([
    "reconcile",
    "receipt",
    "/tmp/does-not-exist.json",
  ])
  assert.strictEqual(status, 2)
  // Expected: two-line output — first line is "bp: file not found: ...",
  // second line is "Hint: check the path or run from the repo root."
  assert.match(stderr, /^bp: file not found: /m)
  assert.match(stderr, /^Hint: check the path/m)
})

// =============================================================================
// cli-B-001 — oversized input (>512MB JSONL) -> INPUT_TOO_LARGE, never a raw
// stack (human) and never a misleading retryable:true (JSON).
//
// We materialize a SPARSE file just past V8's MAX_STRING_LENGTH (~512MB). On
// NTFS / most CI tmpfs, ftruncate is O(1) and allocates no real blocks, so this
// is fast and cheap. readFileSync(path,"utf-8") throws ERR_STRING_TOO_LONG
// after a fast size check — it never tries to materialize 512MB.
// =============================================================================

/** Create a sparse file strictly larger than MAX_STRING_LENGTH; returns its path. */
function makeOversizedFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "bp-oversize-"))
  const p = join(dir, "huge.jsonl")
  const size = bufferConstants.MAX_STRING_LENGTH + 1024
  const fd = openSync(p, "w")
  try {
    ftruncateSync(fd, size)
  } finally {
    closeSync(fd)
  }
  return p
}

test("cli-B-001: oversized JSONL (human mode) emits a structured envelope, NOT a raw Node stack", () => {
  const p = makeOversizedFile()
  try {
    const { status, stderr, stdout } = runBp(["reconcile", "receipt", p])
    assert.strictEqual(status, 2, `oversized input must exit 2 (got ${status})`)
    // The load-bearing assertion: no raw Node stack trace leaks to a CLI user.
    assert.doesNotMatch(
      stderr,
      /at readFileSync|node:fs:|at runReconcileReceipt|at readReceipt/,
      `human-mode oversized input must NOT print a raw Node stack; got: ${JSON.stringify(stderr.slice(0, 300))}`,
    )
    // Structured human output: "bp: input too large ..." + a Hint line.
    assert.match(stderr, /^bp: input too large to read/m)
    assert.match(stderr, /512MB/)
    assert.match(stderr, /^Hint: .*split the JSONL/m)
    assert.strictEqual(stdout, "", "human-mode error must not write to stdout")
  } finally {
    rmSync(p, { recursive: true, force: true })
  }
})

test("cli-B-001: oversized JSONL (--json) emits INPUT_TOO_LARGE with retryable:false", () => {
  const p = makeOversizedFile()
  try {
    const { status, stdout, stderr } = runBp([
      "reconcile",
      "receipt",
      p,
      "--json",
    ])
    assert.strictEqual(status, 2, `oversized input must exit 2 (got ${status})`)
    assert.strictEqual(stderr, "", "--json error must suppress stderr")
    const parsed = JSON.parse(stdout.trim())
    assert.strictEqual(parsed.ok, false)
    assert.strictEqual(
      parsed.error.code,
      "INPUT_TOO_LARGE",
      `oversized input must map to INPUT_TOO_LARGE, not IO_ERROR; got ${JSON.stringify(parsed.error)}`,
    )
    // The historic bug: retryable:true. Re-reading the same 512MB file can
    // NEVER succeed, so it must be false.
    assert.strictEqual(
      parsed.error.retryable,
      false,
      `oversized input is not retryable; got ${JSON.stringify(parsed.error)}`,
    )
    assert.match(parsed.error.message, /512MB/)
    assert.strictEqual(typeof parsed.error.hint, "string")
    assert.match(parsed.error.hint, /split the JSONL|batches/)
  } finally {
    rmSync(p, { recursive: true, force: true })
  }
})

test("cli-B-001: oversized JSONL via 'verify multi' is also mapped (not a raw stack)", () => {
  // verify multi uses readMultiRecordJsonl, a different read path — prove the
  // mapping covers it too (exitOnReadError is shared).
  const p = makeOversizedFile()
  try {
    const { status, stdout } = runBp(["verify", "multi", p, "--json"])
    assert.strictEqual(status, 2)
    const parsed = JSON.parse(stdout.trim())
    assert.strictEqual(parsed.error.code, "INPUT_TOO_LARGE")
    assert.strictEqual(parsed.error.retryable, false)
  } finally {
    rmSync(p, { recursive: true, force: true })
  }
})

// =============================================================================
// cli-B-001 (catch-all) — the final branch of exitOnReadError used to be a bare
// `throw err`, which Node prints as a raw stack trace (exit 1) for any I/O
// failure not matched by an earlier branch. The fix replaces it with a
// structured Tier-1 envelope so NO read-error path surfaces a raw stack.
//
// A truly-unmapped errno is hard to trigger portably through spawnSync (NUL
// paths are rejected by spawnSync itself; over-long paths normalize to ENOENT
// on Windows). The behavioral proof that "no path surfaces a raw stack" for a
// real read error is carried by the INPUT_TOO_LARGE human-mode test above
// (that scenario previously fell through to the bare `throw err`). Here we add
// a durable SOURCE-level guard that the dangling `throw err` is gone and a
// structured catch-all (code "IO_ERROR" + retryable) replaced it — matching the
// finding's explicit remediation.
// =============================================================================

test("cli-B-001: exitOnReadError has no dangling 'throw err' catch-all (structured fallback instead)", () => {
  const src = readFileSync(resolve(repoRoot, "src/bin/bp.ts"), "utf-8")
  const start = src.indexOf("function exitOnReadError(")
  assert.ok(start >= 0, "exitOnReadError must exist")
  // Body runs from the signature to the next top-level closing brace (a `}` at
  // column 0 on its own line).
  const after = src.slice(start)
  const endRel = after.search(/\n\}/)
  assert.ok(endRel > 0, "exitOnReadError must have a body")
  const body = after.slice(0, endRel)
  // The historic bug: the function ended with a bare `throw err;`.
  assert.doesNotMatch(
    body,
    /\n\s*throw err;\s*$/,
    "exitOnReadError must not end with a bare 'throw err' (would surface a raw stack)",
  )
  // It must instead end by emitting a structured envelope via exitWithUsageError
  // with an IO_ERROR code and a retryable flag set by error class.
  assert.match(body, /"IO_ERROR"/, "catch-all must emit a structured IO_ERROR envelope")
  assert.match(body, /retryable/, "catch-all must set a retryable flag by error class")
  // And it must explicitly handle the oversized-input error classes.
  assert.match(
    body,
    /ERR_STRING_TOO_LONG/,
    "exitOnReadError must explicitly map ERR_STRING_TOO_LONG",
  )
  assert.match(
    body,
    /ERR_FS_FILE_TOO_LARGE/,
    "exitOnReadError must explicitly map ERR_FS_FILE_TOO_LARGE",
  )
  assert.match(body, /INPUT_TOO_LARGE/, "exitOnReadError must emit the INPUT_TOO_LARGE code")
})

// =============================================================================
// cli-B-007 — `-` stdin sentinel with an interactive TTY (no piped input) must
// fail fast with a clear hint instead of hanging.
//
// We cannot fake a TTY portably under the test harness, so we assert the
// operationally-critical complement: piped stdin still works (isTTY false ->
// reads normally), and empty piped stdin is a clean diagnosable error (not a
// hang). The TTY-guard branch shares the same Tier-1 envelope path as every
// other structured exit, and a source guard below pins that it exists.
// =============================================================================

test("cli-B-007: piped stdin via '-' still reads normally (guard does not regress the happy path)", () => {
  const { status, stdout } = runBpWithStdin(
    ["validate", "-", "--json"],
    // A structurally-invalid-but-parseable JSON object: validate should RUN
    // (not hang, not TTY-error) and report a schema failure (exit 1).
    JSON.stringify({ not: "a receipt" }),
  )
  // Exit 1 = schema validation ran and failed; crucially NOT a hang and NOT the
  // STDIN_IS_TTY exit-2 path.
  assert.strictEqual(status, 1, `piped '-' must run validation (got ${status})`)
  const parsed = JSON.parse(stdout.trim())
  assert.strictEqual(parsed.ok, false)
  assert.ok(Array.isArray(parsed.errors), "piped '-' validate must emit errors[]")
})

test("cli-B-007: piped EMPTY stdin via '-' to verify multi is a diagnosable error, not a hang", () => {
  const { status, stdout } = runBpWithStdin(["verify", "multi", "-", "--json"], "")
  // Empty stdin -> BP_JSONL_EMPTY (exit 2), a clean diagnosable failure.
  assert.strictEqual(status, 2)
  const parsed = JSON.parse(stdout.trim())
  assert.strictEqual(parsed.ok, false)
  assert.strictEqual(parsed.error.code, "BP_JSONL_EMPTY")
})

test("cli-B-007: the '-' stdin path has a TTY guard (STDIN_IS_TTY) instead of a silent block", () => {
  const src = readFileSync(resolve(repoRoot, "src/bin/bp.ts"), "utf-8")
  // The shared stdin reader must check process.stdin.isTTY and emit a
  // structured STDIN_IS_TTY error rather than calling readFileSync(0) blindly.
  assert.match(src, /function readStdinText\(/, "a shared stdin reader must exist")
  assert.match(src, /STDIN_IS_TTY/, "the TTY guard must emit a STDIN_IS_TTY code")
  // The helper must check isTTY BEFORE the blocking readFileSync(0, ...): a
  // guard that fires after the read would not prevent the hang.
  const fnStart = src.indexOf("function readStdinText(")
  const fnEndRel = src.slice(fnStart).indexOf("\n}")
  assert.ok(fnEndRel > 0, "readStdinText must have a body")
  const helperBody = src.slice(fnStart, fnStart + fnEndRel + 2)
  assert.match(
    helperBody,
    /process\.stdin\.isTTY[\s\S]*readFileSync\(0,/,
    "readStdinText must check isTTY BEFORE the blocking readFileSync(0, ...)",
  )
  // Callers must use the helper, not raw stdin reads. readReceipt /
  // readMultiRecordJsonl / readInputConfigText each reference readStdinText.
  for (const caller of [
    "function readReceipt(",
    "function readMultiRecordJsonl(",
    "function readInputConfigText(",
  ]) {
    const cStart = src.indexOf(caller)
    assert.ok(cStart >= 0, `${caller} must exist`)
    const cBody = src.slice(cStart, cStart + 1200)
    assert.match(
      cBody,
      /readStdinText\(\)/,
      `${caller} must read stdin via the guarded readStdinText() helper`,
    )
  }
})

// =============================================================================
// cli-B-006 — valueFlag missing-value guard: `--out` immediately followed by
// another flag must NOT swallow that flag as the output filename.
// =============================================================================

test("cli-B-006: '--out --json' does not swallow --json as the output filename", () => {
  // Before the guard, outFile became "--json" and the CLI tried to write the
  // receipt to a file literally named "--json". With the guard, --out has no
  // value (treated absent) AND --json is still recognized -> JSON envelope on
  // stdout. We use a good fixture so the only variable is flag parsing.
  const { status, stdout, stderr } = runBp([
    "generate",
    "mazur",
    "--out",
    "--json",
  ])
  // The receipt bytes go to stdout (no --out value), exit 0. Crucially: no file
  // named "--json" is created and no raw error about it.
  assert.strictEqual(
    status,
    0,
    `--out --json must succeed via stdout (got ${status}); stderr=${JSON.stringify(stderr.slice(0, 200))}`,
  )
  // stdout is the canonical receipt JSONL (a single JSON object line), NOT an
  // {ok:true,out:"--json"} write-confirmation envelope.
  assert.doesNotMatch(
    stdout,
    /"out"\s*:\s*"--json"/,
    `--json must not be consumed as the --out value; got: ${JSON.stringify(stdout.slice(0, 200))}`,
  )
})

// =============================================================================
// cli-B-002 — runImportFramework / runImportFrameworkStream --out writes are
// wrapped: a write to an unwritable --out path surfaces a Tier-1 envelope, not
// a raw stack. We point --out at a path UNDER a regular file so the write
// fails deterministically (ENOENT on Windows, ENOTDIR on POSIX — both route
// through exitOnReadError) without needing root/perms.
// =============================================================================

test("cli-B-002: import --out to an unwritable path surfaces a structured error, not a raw stack", () => {
  const dir = mkdtempSync(join(tmpdir(), "bp-out-"))
  try {
    const blockingFile = join(dir, "blocker")
    writeFileSync(blockingFile, "x")
    // A path nested under a regular file: writing it cannot succeed.
    const badOut = join(blockingFile, "nested", "receipt.jsonl")
    const sidecar = resolve(
      repoRoot,
      "fixtures/external/pytorch.softmax-ce.sidecar.jsonl",
    )
    const { status, stderr } = runBp([
      "import",
      "pytorch",
      sidecar,
      "--out",
      badOut,
    ])
    // Load-bearing: a CLI user must never see a raw Node stack from the write.
    assert.doesNotMatch(
      stderr,
      /at writeFileSync|\bnode:fs:\d+\b|at runImportFramework/,
      `import --out failure must be structured, not a raw stack; got: ${JSON.stringify(stderr.slice(0, 300))}`,
    )
    // The wrapped write routes through exitOnReadError (the shared I/O-error
    // translator), exit 2, with a structured `bp: ` line. Accept any of the
    // platform-specific mapped messages.
    assert.strictEqual(status, 2, `unwritable --out must exit 2 (got ${status})`)
    assert.match(
      stderr,
      /^bp: (could not read|file not found|path is a directory|permission denied|input too large)/m,
      `expected a structured I/O error line; got: ${JSON.stringify(stderr.slice(0, 300))}`,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// =============================================================================
// cli-B-003 — under --json, the import RESULT envelope (success AND failure)
// goes to the SAME stream (STDERR), keeping STDOUT a clean receipt channel.
// =============================================================================

test("cli-B-003: import --json failure envelope goes to STDERR, not STDOUT (same stream as success)", () => {
  // Feed a malformed sidecar so the importer throws -> the IMPORT_FAILED result
  // envelope is produced. Pre-fix it went to STDOUT; it must now be on STDERR.
  const { status, stdout, stderr } = runBpWithStdin(
    ["import", "pytorch", "-", "--json"],
    "this is not valid jsonl\n",
  )
  assert.strictEqual(status, 2, `malformed sidecar import must exit 2 (got ${status})`)
  // STDOUT must NOT carry the result envelope (it is the receipt channel).
  assert.strictEqual(
    stdout,
    "",
    `import --json result envelope must NOT be on STDOUT; got: ${JSON.stringify(stdout.slice(0, 200))}`,
  )
  // STDERR carries the structured envelope.
  const parsed = JSON.parse(stderr.trim())
  assert.strictEqual(parsed.ok, false)
  assert.ok(
    parsed.error && typeof parsed.error.kind === "string",
    `STDERR must carry the structured import-failure envelope; got: ${JSON.stringify(stderr.slice(0, 200))}`,
  )
})

test("cli-B-003: import --json SUCCESS envelope is also on STDERR (one stream for the summary)", () => {
  // A clean import via stdin with --json: the receipt goes to STDOUT, the
  // {ok:true,differential} summary to STDERR. Consistency with the failure
  // path above is the whole point of cli-B-003.
  const sidecar = resolve(
    repoRoot,
    "fixtures/external/pytorch.softmax-ce.sidecar.jsonl",
  )
  const sidecarBytes = readFileSync(sidecar, "utf-8")
  const { status, stdout, stderr } = runBpWithStdin(
    ["import", "pytorch", "-", "--json"],
    sidecarBytes,
  )
  // Differential should agree on the shipped good sidecar -> exit 0.
  assert.strictEqual(status, 0, `clean import must exit 0 (got ${status}); stderr=${JSON.stringify(stderr.slice(0, 200))}`)
  // STDOUT carries the receipt (a JSON object line), NOT the summary envelope.
  assert.doesNotMatch(
    stdout,
    /"differential"\s*:/,
    `the differential summary must NOT be on STDOUT; got: ${JSON.stringify(stdout.slice(0, 120))}`,
  )
  // STDERR carries the {ok:true, differential:{passed:true}} summary.
  const parsed = JSON.parse(stderr.trim())
  assert.strictEqual(parsed.ok, true)
  assert.strictEqual(parsed.differential.passed, true)
})
