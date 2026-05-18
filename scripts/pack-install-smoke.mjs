#!/usr/bin/env node
/**
 * v0.10.2 — pack/install smoke for @mcptoolshop/backprop-trace.
 *
 * Proves the package artifact actually carries the helper, examples,
 * schemas, fixtures, and CLI surface across the npm tarball boundary.
 * Distribution integrity is a load-bearing trust property for v0.10+ —
 * the user-facing claim "bp examples pytorch --print > pytorch_trace_
 * helper.py" only works if the helper actually ships in the tarball.
 *
 * Steps:
 *   1. Run `pnpm pack` to produce a real tarball in the repo root.
 *   2. Assert tarball size is under a sane ceiling (catches accidental
 *      bloat — adding fixtures or schemas should be deliberate).
 *   3. Parse tar headers (gunzip + manual walk; cross-platform — no
 *      `tar` binary dependency on Windows) and assert every REQUIRED_
 *      TARBALL_ENTRY is present.
 *   4. Cold-install the tarball into a fresh temp dir via `npm install`
 *      against a minimal scaffold package.json.
 *   5. Invoke the installed `bp` CLI via the temp dir's
 *      node_modules/.bin/bp and run a CLI smoke matrix.
 *   6. Pipe-smoke: import a sidecar (write to disk; not stdin because
 *      Windows pipe semantics differ across shells) + verify multi.
 *
 * Exits 0 on all checks pass; 1 on first failure with a clear message.
 * Cleans up the temp dir + the local tarball in a try/finally block so
 * the repo working tree stays clean even on partial-run failure.
 *
 * Honors the Csmith/CompCert + observer-not-verifier doctrine: this
 * script does NOT test that the helper produces correct numerics (Rule
 * 14 does that, and is exercised by the test plate). This script tests
 * that the helper FILE arrives in the user's install and that the CLI
 * verbs that reference it WORK on the installed copy.
 */

import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, statSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, resolve, join } from "node:path"
import { fileURLToPath } from "node:url"
import { gunzipSync } from "node:zlib"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, "..")
const PKG_JSON = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf-8"))
const PKG_VERSION = PKG_JSON.version
const IS_WINDOWS = process.platform === "win32"

/**
 * Sane upper bound on tarball size. Current ~5 MB; ceiling at 10 MB to
 * leave headroom for v0.11 real-world fixture (CNN / transformer) without
 * forcing a ceiling bump every release. Going above 10 MB should require
 * an explicit decision (bumping this constant and the CHANGELOG note).
 */
const TARBALL_SIZE_CEILING_MB = 10

/**
 * Every entry below MUST be present in the tarball, verbatim. These are
 * the load-bearing v0.10.x distribution-integrity claims:
 *   - The PyTorch live helper (the literal file users `bp examples
 *     pytorch --print > pytorch_trace_helper.py` against)
 *   - The example file (proves the workflow is dogfoodable from a fresh
 *     install)
 *   - The v0.7.0 framework-trace schema (live-helper sidecar contract)
 *   - The v0.6.0 framework-trace schema (back-compat for hand-authored
 *     pre-v0.10 sidecars users have on disk)
 *   - The receipt schemas (v0.4.0 SGD canonical, v0.7.0 latest)
 *   - Three good helper-emitted sidecar fixtures (SGD / AdamW /
 *     sgd_momentum — the v0.10.1 optimizer-matrix closure)
 *   - The dist/ build artifacts (bp.js entry + index.js barrel)
 *   - Standard package metadata (package.json, README.md, LICENSE,
 *     CHANGELOG.md, SECURITY.md)
 *
 * Adding a new claim to v0.10.x README / docs / CLI? Add the file
 * here. The smoke gate catches "we shipped a doc that points at a file
 * we forgot to bundle" — that's exactly the v0.10.2 distribution-
 * integrity proposition.
 */
const REQUIRED_TARBALL_ENTRIES = [
  "package/package.json",
  "package/README.md",
  "package/LICENSE",
  "package/CHANGELOG.md",
  "package/SECURITY.md",
  // Build artifacts
  "package/dist/bin/bp.js",
  "package/dist/index.js",
  // v0.10 PyTorch live helper + example
  "package/scripts/extract/pytorch.py",
  "package/examples/pytorch/extract_step.py",
  // Schemas (latest receipt + helper-block framework-trace + back-compat)
  "package/schemas/receipt.v0.4.0.json",
  "package/schemas/receipt.v0.7.0.json",
  "package/schemas/framework-trace.v0.6.0.json",
  "package/schemas/framework-trace.v0.7.0.json",
  // v0.10.1 helper-emitted golden fixtures (3 — SGD, AdamW, sgd_momentum)
  "package/fixtures/external/pytorch.helper-emitted.sgd.softmax-ce.sidecar.jsonl",
  "package/fixtures/external/pytorch.helper-emitted.adamw.sidecar.jsonl",
  "package/fixtures/external/pytorch.helper-emitted.sgd-momentum.sidecar.jsonl",
  // Mazur golden (for `bp verify mazur` from cold install)
  "package/fixtures/mazur.golden.jsonl",
  // Adversarial helper plate (at least one — full plate covered by
  // the wildcard count assertion below)
  "package/fixtures/bad/pytorch-helper.bad-momentum-buffer-not-sign-flipped.jsonl",
  "package/fixtures/bad/pytorch-helper.bad-adamw-as-coupled-l2.jsonl",
]

/**
 * Wildcard-style assertion: the tarball must contain at least N entries
 * matching the given prefix. Catches "we forgot to update files[] when
 * adding new helper-emitted goldens" without forcing every fixture name
 * into REQUIRED_TARBALL_ENTRIES.
 */
const WILDCARD_MIN_COUNTS = [
  { prefix: "package/fixtures/bad/pytorch-helper.bad-", min: 9 },
  { prefix: "package/scripts/extract/", min: 1 },
  { prefix: "package/examples/pytorch/", min: 1 },
]

function log(msg) {
  process.stdout.write(`[pack-smoke] ${msg}\n`)
}

function die(msg, hint) {
  process.stderr.write(`[pack-smoke] FAIL: ${msg}\n`)
  if (hint) process.stderr.write(`[pack-smoke] hint: ${hint}\n`)
  process.exit(1)
}

// ===========================================================================
// Step 1 — pnpm pack (create real tarball in REPO_ROOT/<tarball-name>)
// ===========================================================================

log(`step 1/6 — pnpm pack v${PKG_VERSION}`)
let tarballPath
try {
  // pnpm pack prints the resolved tarball path on stdout (last line)
  const out = execFileSync("pnpm", ["pack", "--pack-destination", REPO_ROOT], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    shell: IS_WINDOWS, // shell needed on Windows for `pnpm.cmd` resolution
  })
  // The last non-empty line of pnpm pack's output is the absolute tarball path.
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  // Pick the line that looks like a path ending in .tgz; pnpm formats vary
  // (sometimes preceded by progress lines; sometimes relative-to-cwd).
  // Resolve to absolute against REPO_ROOT — npm install needs an absolute
  // path when invoked from the temp dir (relative paths resolve against
  // the temp dir's cwd, which doesn't contain the tarball).
  for (const line of lines.reverse()) {
    if (line.endsWith(".tgz")) {
      const candidate = resolve(REPO_ROOT, line)
      if (existsSync(candidate)) {
        tarballPath = candidate
        break
      }
    }
  }
  if (!tarballPath) {
    // Fallback: pnpm's conventional name for scoped packages
    const fallback = resolve(REPO_ROOT, `mcptoolshop-backprop-trace-${PKG_VERSION}.tgz`)
    if (existsSync(fallback)) tarballPath = fallback
  }
} catch (err) {
  die(`pnpm pack failed: ${err.message}`, "ensure pnpm is on PATH and `pnpm build` has run")
}
if (!tarballPath || !existsSync(tarballPath)) {
  die(`pnpm pack produced no .tgz at the expected location`)
}
log(`  tarball: ${tarballPath}`)

// Wrap everything that follows in try/finally so the tarball + temp dir
// are cleaned up even on assertion failure.
let tmp = null
let cleanedTarball = false
try {
  // =========================================================================
  // Step 2 — size ceiling
  // =========================================================================

  const tarballBytes = statSync(tarballPath).size
  const tarballMB = tarballBytes / 1024 / 1024
  log(`step 2/6 — tarball size: ${tarballMB.toFixed(2)} MB (ceiling ${TARBALL_SIZE_CEILING_MB} MB)`)
  if (tarballMB > TARBALL_SIZE_CEILING_MB) {
    die(
      `tarball ${tarballMB.toFixed(2)} MB exceeds ${TARBALL_SIZE_CEILING_MB} MB ceiling`,
      `if this growth is deliberate, bump TARBALL_SIZE_CEILING_MB in scripts/pack-install-smoke.mjs and note in CHANGELOG`,
    )
  }

  // =========================================================================
  // Step 3 — tarball content listing (gunzip + tar header walk)
  //
  // Cross-platform: no dependency on a `tar` binary (not always on Windows).
  // We parse the 512-byte ustar header format directly. PaxHeader entries
  // and global metadata are filtered out — we only care about file paths.
  // =========================================================================

  log("step 3/6 — tarball content listing")
  const tarBytes = gunzipSync(readFileSync(tarballPath))
  const entries = []
  let offset = 0
  while (offset + 512 <= tarBytes.length) {
    const block = tarBytes.subarray(offset, offset + 512)
    // End-of-archive: two consecutive zero-blocks. Detect via all-zero header.
    let allZero = true
    for (let i = 0; i < 512; i += 1) {
      if (block[i] !== 0) { allZero = false; break }
    }
    if (allZero) break
    const name = block.subarray(0, 100).toString("utf-8").replace(/\0.*$/, "")
    const sizeOctal = block.subarray(124, 136).toString("utf-8").replace(/\0.*$/, "").trim()
    const size = parseInt(sizeOctal || "0", 8)
    if (name && !name.includes("PaxHeader") && !name.includes("/.")) {
      entries.push(name)
    }
    offset += 512 + Math.ceil(size / 512) * 512
  }
  log(`  tarball contains ${entries.length} entries`)

  const missing = REQUIRED_TARBALL_ENTRIES.filter((p) => !entries.includes(p))
  if (missing.length > 0) {
    die(
      `tarball missing required entries:\n  - ${missing.join("\n  - ")}`,
      "either the file wasn't built (run `pnpm build`) or package.json `files[]` doesn't include its path glob",
    )
  }

  for (const { prefix, min } of WILDCARD_MIN_COUNTS) {
    const matched = entries.filter((e) => e.startsWith(prefix))
    if (matched.length < min) {
      die(
        `tarball has ${matched.length} entries matching ${JSON.stringify(prefix)}; expected at least ${min}`,
        "if entries were deliberately removed, lower WILDCARD_MIN_COUNTS in scripts/pack-install-smoke.mjs",
      )
    }
  }

  // =========================================================================
  // Step 4 — cold install into temp dir
  // =========================================================================

  tmp = mkdtempSync(join(tmpdir(), "bp-pack-smoke-"))
  log(`step 4/6 — cold install into ${tmp}`)
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify(
      { name: "bp-pack-smoke-temp", version: "0.0.0", private: true },
      null, 2,
    ),
  )
  try {
    execFileSync(
      "npm",
      ["install", tarballPath, "--no-audit", "--no-fund", "--loglevel=error"],
      { cwd: tmp, stdio: "inherit", shell: IS_WINDOWS },
    )
  } catch (err) {
    die(`npm install <tarball> failed: ${err.message}`, "tarball produced by step 1 may be malformed")
  }

  const installed = join(tmp, "node_modules", "@mcptoolshop", "backprop-trace")
  if (!existsSync(installed)) {
    die(`installed package directory missing at ${installed}`)
  }

  // =========================================================================
  // Step 5 — CLI smoke against installed copy
  // =========================================================================

  log("step 5/6 — CLI smoke matrix (installed bp)")
  const bpExec = IS_WINDOWS
    ? join(tmp, "node_modules", ".bin", "bp.cmd")
    : join(tmp, "node_modules", ".bin", "bp")
  if (!existsSync(bpExec)) {
    die(`bp executable not found at ${bpExec}`, "the package's `bin` entry may be misconfigured")
  }

  function runBp(args, stdinInput) {
    const opts = {
      cwd: tmp,
      encoding: "utf-8",
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      shell: IS_WINDOWS,
    }
    if (typeof stdinInput === "string") opts.input = stdinInput
    const result = spawnSync(bpExec, args, opts)
    return {
      code: result.status ?? -1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    }
  }

  // 5a — bp --help mentions v0.10's examples verb
  const help = runBp(["--help"])
  if (help.code !== 0) die(`bp --help exited ${help.code}`)
  if (!/bp examples pytorch/.test(help.stdout)) {
    die("bp --help missing 'bp examples pytorch' — the v0.10 verb didn't survive the install")
  }
  log("  bp --help: ok")

  // 5b — bp --version matches package version
  const version = runBp(["--version"])
  if (version.code !== 0) die(`bp --version exited ${version.code}`)
  if (!version.stdout.includes(PKG_VERSION)) {
    die(`bp --version output does not contain ${PKG_VERSION}; got: ${version.stdout.trim()}`)
  }
  log(`  bp --version: ${version.stdout.trim()}`)

  // 5c — bp examples pytorch prints an absolute helper path that exists
  const examplesPath = runBp(["examples", "pytorch"])
  if (examplesPath.code !== 0) die(`bp examples pytorch exited ${examplesPath.code}`)
  const helperPath = examplesPath.stdout.trim()
  if (!helperPath.endsWith("pytorch.py")) {
    die(`bp examples pytorch did not print a pytorch.py path; got: ${helperPath}`)
  }
  // Path must be ABSOLUTE so the user can copy/cat without resolution ambiguity
  const isAbs = IS_WINDOWS ? /^[A-Z]:[\\/]/.test(helperPath) : helperPath.startsWith("/")
  if (!isAbs) die(`helper path '${helperPath}' is not absolute`)
  if (!existsSync(helperPath)) {
    die(`helper path '${helperPath}' does not exist on disk after install`)
  }
  // On macOS the temp dir resolves through a /var → /private/var symlink;
  // realpath the installed package root and check the helper sits inside.
  const installedReal = realpathSync(installed)
  const helperReal = realpathSync(helperPath)
  if (!helperReal.startsWith(installedReal)) {
    die(`bp examples pytorch resolved to ${helperReal}, which is OUTSIDE the installed package at ${installedReal}`)
  }
  log(`  bp examples pytorch: ${helperPath}`)

  // 5d — bp examples pytorch --print emits the helper bytes + version matches
  const examplesPrint = runBp(["examples", "pytorch", "--print"])
  if (examplesPrint.code !== 0) die(`bp examples pytorch --print exited ${examplesPrint.code}`)
  if (examplesPrint.stdout.length < 1024) {
    die(`bp examples pytorch --print output too short (${examplesPrint.stdout.length} bytes; expected >1KB)`)
  }
  if (!/HELPER_VERSION/.test(examplesPrint.stdout)) {
    die("printed helper missing HELPER_VERSION constant")
  }
  const versionEscaped = PKG_VERSION.replace(/\./g, "\\.")
  const versionRegex = new RegExp(`HELPER_VERSION\\s*=\\s*"${versionEscaped}"`)
  if (!versionRegex.test(examplesPrint.stdout)) {
    die(
      `printed helper's HELPER_VERSION does not match package version ${PKG_VERSION}`,
      "helper version constant must track package.json version (v0.10 v0.10.1 v0.10.2 ...)",
    )
  }
  log(`  bp examples pytorch --print: ${examplesPrint.stdout.length} bytes; HELPER_VERSION=${PKG_VERSION} confirmed`)

  // 5e — bp verify mazur succeeds (bundled fixture path)
  const verifyMazur = runBp(["verify", "mazur"])
  if (verifyMazur.code !== 0) {
    die(`bp verify mazur exited ${verifyMazur.code}; stderr: ${verifyMazur.stderr.slice(0, 500)}`)
  }
  log("  bp verify mazur: ok")

  // 5f — bp import pytorch <installed helper-emitted sidecar>
  const installedSidecar = join(
    installed, "fixtures", "external", "pytorch.helper-emitted.sgd.softmax-ce.sidecar.jsonl",
  )
  if (!existsSync(installedSidecar)) {
    die(`installed helper-emitted sidecar missing at ${installedSidecar}`)
  }
  const importPy = runBp(["import", "pytorch", installedSidecar])
  if (importPy.code !== 0) {
    die(`bp import pytorch <sidecar> exited ${importPy.code}; stderr: ${importPy.stderr.slice(0, 500)}`)
  }
  if (!importPy.stdout.startsWith("{")) {
    die(`bp import pytorch did not emit JSON on stdout; got: ${importPy.stdout.slice(0, 200)}`)
  }
  log("  bp import pytorch <helper-emitted sidecar>: ok")

  // =========================================================================
  // Step 6 — pipe smoke (import | verify multi via stdin)
  // =========================================================================

  log("step 6/6 — pipe smoke (import → verify multi via stdin)")
  // Two passes: (a) stdin-pipe via spawnSync's `input` option — verifies
  // that `bp verify multi -` reads JSONL correctly cross-platform.
  // (b) file roundtrip via tmp file — verifies the same thing through a
  // shell-style intermediate path. Either failing is a smoke regression.
  const verifyMultiStdin = runBp(["verify", "multi", "-"], importPy.stdout)
  if (verifyMultiStdin.code !== 0) {
    die(
      `bp verify multi - (stdin pipe) exited ${verifyMultiStdin.code}; ` +
        `stderr: ${verifyMultiStdin.stderr.slice(0, 500)}`,
    )
  }
  log("  pipe (stdin): ok")

  const tmpReceipt = join(tmp, "imported.jsonl")
  writeFileSync(tmpReceipt, importPy.stdout)
  const verifyMultiFile = runBp(["verify", "multi", tmpReceipt])
  if (verifyMultiFile.code !== 0) {
    die(`bp verify multi <file> exited ${verifyMultiFile.code}; stderr: ${verifyMultiFile.stderr.slice(0, 500)}`)
  }
  log("  pipe (file roundtrip): ok")

  log("")
  log("===========================================================================")
  log(`ALL PACK-SMOKE CHECKS PASSED for @mcptoolshop/backprop-trace@${PKG_VERSION}`)
  log(`  tarball:   ${tarballMB.toFixed(2)} MB (${entries.length} entries)`)
  log(`  install:   ${installed}`)
  log(`  helper:    ${helperPath}`)
  log("===========================================================================")
} finally {
  // Always clean up — even on assertion failure — so the working tree stays
  // clean. The tarball is never committed; the temp dir is throwaway.
  try {
    rmSync(tarballPath, { force: true })
    cleanedTarball = true
  } catch (e) {
    process.stderr.write(`[pack-smoke] (cleanup warning) failed to remove tarball ${tarballPath}: ${e.message}\n`)
  }
  if (tmp) {
    try {
      rmSync(tmp, { recursive: true, force: true })
    } catch (e) {
      process.stderr.write(`[pack-smoke] (cleanup warning) failed to remove temp dir ${tmp}: ${e.message}\n`)
    }
  }
  if (!cleanedTarball) {
    process.stderr.write(`[pack-smoke] (cleanup warning) tarball may still be at ${tarballPath} — remove manually\n`)
  }
}
