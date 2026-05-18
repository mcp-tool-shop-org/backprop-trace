# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Note: the `schema_version` field inside receipts (`"0.1.0"`, `"0.2.0"`) is the
receipt-format version, which is versioned independently of this npm package
version. A receipt written today against schema 0.1.0 will still validate
against schema 0.1.0 in v0.5 of the package; v0.3 adds schema 0.2.0 for the
generalized topology + multi-step path without retiring schema 0.1.0. v0.4
introduces a SEPARATE input-config schema (`topology-input.v0.4.0.json`) that
validates engine INPUTS — distinct from the receipt schemas that validate
engine OUTPUTS.

## [0.10.3] - 2026-05-18

The v0.10.3 cold-read compression + landing page + handbook wave —
the "make the public-facing story legible" slice. **Not a v1.0.0
promotion.** **Not a publishing step** — local v0.10.x stretch
continues; no tag, no npm publish, no GitHub release, no translations.

v0.10.0-v0.10.2 made the verifier surface strong and the distribution
surface honest. v0.10.3 makes the cold reader's path into the project
not require having been present for the build arc. Three layers:

(a) **README compressed from 323 → 224 lines**; `package.json`
description compressed from ~1500 chars → 198 chars. A cold reader
can now answer in 60 seconds: what is this, what can I run now, what
does it verify, what does it not prove, how do I use the PyTorch
helper, why is it still mid-v0. Deep doctrine (Csmith/CompCert/Fang
PoL framing) preserved but mostly relocated to `docs/live-helpers.md`
+ `docs/reconciliation.md` + the new Handbook security page.

(b) **Landing page** scaffolded via `@mcptoolshop/site-theme init`
at `site/`. `site-config.ts` hand-written for the v0.10 surface
(hero with 3 preview cards including the live PyTorch helper, 6
features sections, 5 code cards). Mid-v0 badge, no npm badge (would
lie about distribution).

(c) **Handbook** scaffolded via `@mcptoolshop/site-theme handbook
--accent blue`. Six pages replace the three starter pages:
`index.md` (0), `getting-started.md` (1), `usage.md` (2),
`reference.md` (4), `architecture.md` (5), `security.md` (6).
Starlight v0.36, pagefind search index built. Site renders 7 pages
(landing + 6 handbook) clean.

### Added

- **`README.md` compressed** to 224 lines. New structure:
  - 3-line status block (mid-v0 v0.10.3; verifier surface; no
    publish locks)
  - 30-second quickstart (existing, kept)
  - "What this is" — 2 short paragraphs
  - **NEW** "Live PyTorch helper (v0.10+)" section — copy-the-helper
    workflow + trust-boundary one-liner + link to docs
  - "What this isn't" — 3 bullets pointing at MLflow / PoL / SLSA
  - "Threat model" — 1 paragraph + link to SECURITY.md
  - CLI table (compressed from prose list)
  - Library section (~15 lines, key exports + subpath imports)
  - "The 26 rules" table (kept; this IS the product)
  - "Determinism scope" — 6 lines + link
  - "What's not in this version (yet)" — 10 honest bullets
  - "Author a custom topology" — 6 lines + link
  - "Where this fits" — 4 bullets (target audiences)
  - "The law stack" — 1-quote
  - Links section (curated)
  - Footer: "Built by MCP Tool Shop" with link
- **`site/` landing page** via `@mcptoolshop/site-theme init`
  (default template). `site/src/site-config.ts` rewritten for the
  v0.10 surface:
  - Hero: badge "Mid-v0 · CPU-only · open source"; headline
    "backprop-trace / verifies one training step."; description
    quoting the Csmith doctrine; primary CTA = Quick start;
    secondary CTA = Read the Handbook (per playbook lock)
  - Hero previews: 3 cards (Verify / Reject / Live PyTorch)
  - Features section: 6 cards covering 26-rule reconciler,
    anti-circularity, live PyTorch helper, canonical JSONL,
    sidecar ingestion, distribution integrity
  - Usage section: 5 code cards (Install / good receipt / bad
    receipt / live helper workflow / sha256 attestation seam)
  - No `npmUrl` — package is not yet published (local v0.10.x
    stretch); adding a broken npm badge would lie about
    distribution
- **`site/` handbook** via `@mcptoolshop/site-theme handbook
  --accent blue`. Six pages replace the 3 starter pages:
  - `index.md` (order 0): elevator pitch + where to start +
    status block (mid-v0 v0.10.3; no publish until gaps close)
  - `getting-started.md` (order 1): prereqs + install + the three
    commands (accept good / reject bad / canonical hash) with
    explanation of each
  - `usage.md` (order 2): Path A (live PyTorch helper — full
    workflow + scope matrix) + Path B (hand-authored sidecars
    for any framework) + multi-step + batched + what to do when
    Rule 14 fails
  - `reference.md` (order 4): full CLI surface (every verb + flag
    + exit code) + TypeScript library exports + subpath imports
    + 26-rule table + closed-enum vocabulary
  - `architecture.md` (order 5): 6-layer diagram (engine +
    reconciler + schemas + importer + helper + distribution
    integrity); trust boundary statement; helper-specific
    discipline (detach+clone, param_groups walk, sign flip);
    pack-smoke architecture
  - `security.md` (order 6): what backprop-trace proves vs.
    doesn't; the Csmith/CompCert ratchet in 3 places; Fang PoL
    spoofing analog explanation; forensic helper block trust
    model; coordinated disclosure pointer to SECURITY.md
- **`.github/workflows/pages.yml`** — created by `site-theme init`;
  deploys `site/dist/` to GitHub Pages on push to main
- **`.gitignore`** extended with `site/dist/`, `site/node_modules/`,
  `mcptoolshop-backprop-trace-*.tgz`
- **GitHub repo metadata refreshed**:
  - `description` bumped to the new 198-char `package.json` text
  - `homepage` set to `https://mcp-tool-shop-org.github.io/backprop-trace/`
  - 20 topics curated: kept (backpropagation, neural-network,
    deterministic, reproducibility, typescript, cli,
    canonical-emission, jsonl, mcptoolshop, trace-verifier,
    reconciler, observer-mode-receipts, attestor); added (adam,
    adamw, sgd-momentum, live-helper, pytorch, jax, tensorflow);
    removed (mazur, cross-entropy, softmax, pytorch-import,
    jax-import, tensorflow-import, external-trace-ingestion —
    replaced with the shorter framework names + live-helper)
- **Repo-knowledge DB entry refreshed** (`F:/AI/repo-knowledge` —
  formerly `E:/AI/repo-knowledge`): 4 new notes added
  - **thesis**: 26-rule verifier; CSC/CC anti-circularity; v0.10
    PyTorch helper closure; mid-v0 distribution-not-yet
  - **architecture**: 6-layer diagram in prose; trust boundary;
    pack-smoke; landing+handbook
  - **release_summary**: v0.10.3 = README compression + landing
    page + handbook + metadata refresh; tests unchanged (502)
  - **next_step**: v0.10.4 pip decision; v0.10.5/v0.11.0
    publishing; v0.11 JAX helper + coupled-L2 + real-world
    fixture; v0.12+ TF helper + adopter validation
  - **convention**: 3 v0.10 doctrines (helper version lockstep,
    bundled-fixture resolution, build-before-test)

### Changed

- **`package.json` version 0.10.2 → 0.10.3.**
- **`package.json` description**: ~1500 chars → **198 chars**
  (`Deterministic 26-rule verifier for neural-network training
  steps. Re-derives gradients + optimizer state from named
  factors; emits canonical JSONL. PyTorch helper + sidecar
  import. Mid-v0; CPU-only.`). Cold reader can decide
  go/no-go in <10 seconds from the npm registry entry.
- **`README.md`** — full rewrite, 323 → 224 lines (-30%). Same
  technical truth; deep doctrine relocated to `docs/` + Handbook.
  All 16 relative links verified resolving.
- **`README.md` badges**: kept CI, MIT license; added Landing Page
  badge; **dropped npm badge** (package not yet published; broken
  badge would lie). Re-enable on first registry publish.

### Notes (forward compatibility)

- **v0.10.4 (next)**: pip-vs-repo-script decision memo. Driven by
  the flip-signal contract in `docs/live-helpers.md` (≥3
  non-team-user pip requests AND non-trivial dependency need).
- **v0.10.5 / v0.11.0**: only then revisit publishing. The first
  npm publish + tag + GitHub release will need translations
  refreshed first (per the canonical release-ordering doctrine in
  global memory).
- **v0.11**: SGD coupled-L2 weight decay (Rule 7 third branch);
  JAX live helper (adopter-pull triggered); real-world (CNN /
  transformer) fixture; multi-hidden-layer topology support;
  Lightning / Accelerate callback integration.
- **Translations are STALE** — the 6 translated README files
  (`README.{ja,zh,es,fr,hi,it,pt-BR}.md`) reflect the v0.9.3 README
  surface. They'll be regenerated as part of v0.10.5/v0.11.0's
  publish step (which is when the canonical translation-ordering
  doctrine fires). Until then, English README is authoritative.

### Numbers

- 502 tests pass (unchanged — no source-code changes beyond README +
  site-config + handbook pages)
- typecheck + build green
- README: 323 → **224 lines** (-30%)
- `package.json` description: ~1500 → **198 chars** (-87%)
- Site build: 7 pages (1 landing + 6 handbook) + pagefind search
  index, in 7.8s
- 9 new files (site/astro.config.mjs + site/src/site-config.ts +
  site/src/styles/{global.css,starlight-custom.css} +
  site/src/pages/index.astro + site/src/content.config.ts +
  site/src/content/docs/handbook/{index,getting-started,usage,
  reference,architecture,security}.md + .github/workflows/pages.yml +
  site/package.json + site/tsconfig.json)
- Tarball size: unchanged (site/ not in npm `files[]` — landing
  page deploys via GitHub Pages, not npm)

### What v0.10.3 does NOT do

- Does **not** promote to v1.0.0
- Does **not** publish to npm (local v0.10.x stretch continues)
- Does **not** tag or create a GitHub release
- Does **not** regenerate translations (deferred to v0.10.5/v0.11.0
  publish prep, per the canonical release-ordering doctrine)
- Does **not** create a pip distribution
- Does **not** make the pip-vs-repo-script decision (v0.10.4)
- Does **not** add new helper / verifier features (purely
  presentation + distribution-visibility)
- Does **not** change schema family (receipt v0.7.0 + framework-trace
  v0.7.0 remain latest)
- Does **not** change CLI / library surface
- Does **not** change pack-smoke or any test
- Does **not** add code coverage (Phase 4's coverage step deferred —
  narrow v0.10.3 scope was README + landing + handbook; coverage is
  a separate slice)

## [0.10.2] - 2026-05-18

The v0.10.2 distribution-integrity wave. **Not a v1.0.0 promotion.**
**Not a publishing step** — local v0.10.x stretch continues; no tag,
no npm publish, no GitHub release, no translations.

v0.10.0/v0.10.1 shipped the live PyTorch helper. v0.10.2 proves the
tarball actually carries it. Distribution integrity is a load-bearing
trust property for v0.10+ — the user-facing claim "`bp examples
pytorch --print > pytorch_trace_helper.py`" only works if the helper
actually ships in the tarball and the CLI verbs that reference it
resolve correctly from the user's install cwd. v0.10.2 makes that
claim CI-enforced.

**Pack-smoke caught 2 real bugs during this slice**:

1. **Helper version drifted from package version.** `HELPER_VERSION =
   "0.10.1"` while `package.json` declared `0.10.2`. A user who ran
   `bp examples pytorch --print > pytorch_trace_helper.py` would have
   gotten a helper whose forensic `helper.version` field disagreed
   with the installed npm package's version — making attribution
   ambiguous.

2. **`bp verify mazur` (and `bp generate xor/iris`) read bundled
   fixtures via cwd-relative paths.** Worked when invoked from the
   repo root during development; FAILED with "file not found" when
   invoked from any other cwd in an installed package. A cold user
   running `bp verify mazur` from their home directory would have
   seen a confusing error. Fixed by introducing
   `resolveBundledFile(relPath)` (mirroring v0.10's
   `resolvePytorchHelperPath`) and routing all bundled-fixture
   reads through it.

Both failures were caught BEFORE any user could see them — that's
the whole point of the distribution-integrity slice.

### Added

- **`scripts/pack-install-smoke.mjs`** (NEW). Six-step smoke runner:
  1. `pnpm pack` — produce a real `.tgz` in REPO_ROOT
  2. Tarball size check (10 MB ceiling — adjustable, but bump
     requires CHANGELOG note)
  3. Tarball content listing via in-process gunzip + manual tar
     header walk (cross-platform — no `tar` binary dep on Windows).
     Asserts every entry in `REQUIRED_TARBALL_ENTRIES` is present
     (helper, example, schemas v0.6.0+v0.7.0+receipt v0.7.0, three
     helper-emitted goldens, Mazur golden, two new bad-helper
     fixtures). Wildcard-count assertions catch missing-glob
     regressions (e.g. forgetting to update `files[]`).
  4. Cold install into `mkdtempSync(tmpdir + 'bp-pack-smoke-')` via
     `npm install <abs-tarball-path>` against a minimal scaffold
     `package.json`. Always cleans up via try/finally.
  5. CLI smoke matrix against the installed `bp` binary:
     - `bp --help` mentions `bp examples pytorch`
     - `bp --version` matches package version
     - `bp examples pytorch` prints an ABSOLUTE helper path that
       exists, resolves inside the installed package (realpath check
       — macOS /var → /private/var symlink handled)
     - `bp examples pytorch --print` outputs ≥1KB and `HELPER_VERSION`
       constant matches package version (catches version drift)
     - `bp verify mazur` works from the temp cwd (catches
       cwd-relative-fixture bugs)
     - `bp import pytorch <installed helper-emitted sidecar>` works
       and emits JSON to stdout
  6. Pipe smoke: `bp verify multi -` via stdin (verifies stdin pipe
     semantics work cross-platform) + file roundtrip (verifies same
     contract through a shell-style intermediate path)
- **`.github/workflows/pack-smoke.yml`** (NEW). Multi-OS CI workflow
  running pack-smoke on push + PR across ubuntu-latest +
  macos-latest + windows-latest. Builds `pnpm build` before pack so
  the tarball carries fresh `dist/`. `NO_COLOR=1 FORCE_COLOR=0`
  environment for deterministic stderr.
- **`package.json` `pack-smoke` script** — `node scripts/pack-install-
  smoke.mjs`. Invokable as `pnpm pack-smoke` locally; same script CI
  runs.
- **`src/bin/bp.ts`: `resolveBundledFile(relPath)` helper** (NEW).
  Resolves an absolute path inside the installed package root (one
  level above `dist/`). Used by:
  - `bp verify mazur` (default fixture path)
  - `bp verify mazur`'s byte-equal-vs-golden check
  - `bp verify mazur`'s published-anchor drift check
  - `bp generate mazur`'s `--check` golden path
  - `bp generate xor`'s `--check` golden path
  - `bp generate iris`'s `--check` golden path
  - `resolvePytorchHelperPath` (refactored to call resolveBundledFile)
- **`test/pack-install-smoke.presence.test.ts`** (NEW). Six presence
  tests in the standard test suite (fast — file-stat + regex only).
  Asserts the smoke gate hasn't been silently disabled by file
  removal / workflow YAML breakage / script-entry deletion.
- **9 bad-helper fixtures + 3 good helper-emitted goldens
  regenerated** with `HELPER_VERSION = "0.10.2"` so the
  fixture-version-matches-package-version lockstep is preserved.

### Changed

- **`package.json` version 0.10.1 → 0.10.2.** Description unchanged.
- **`scripts/extract/pytorch.py`**:
  - `HELPER_VERSION` `"0.10.1"` → `"0.10.2"` (lockstep with package).
  - Docstring header bumped to `v0.10.2`.
  - `SCOPE (v0.10.1)` heading widened to `SCOPE (v0.10.x)` — stable
    across patch bumps; specific version lives in `HELPER_VERSION`.
  - All 19 `helper v0.10.1:` error message strings widened to
    `helper v0.10.x:` (also stable across patch bumps; the FIRST
    line of an error message shouldn't drift on patch versions —
    that's noise, not signal).
- **`scripts/build-pytorch-helper-fixtures.mjs`**:
  - `FIXTURE_HELPER_BLOCK.version` `"0.10.1"` → `"0.10.2"` so
    regenerated goldens declare the current helper version.
  - Source-framework `extractor.version` bumped to `"0.10.2"`.
- **`src/bin/bp.ts`**:
  - `runVerifyMazur`'s default fixture path resolves via
    `resolveBundledFile`; explicit user-supplied paths still honored.
  - `runVerifyMazur`'s byte-equal-vs-golden + published-anchor reads
    use `resolveBundledFile`.
  - `runGenerateMazur`, `runGenerateXor`, `runGenerateIris` use
    `resolveBundledFile` for their `--check` golden paths.
- **`test/import-pytorch-helper.test.ts`** — expected helper version
  `"0.10.1"` → `"0.10.2"` (lockstep with the regenerated fixtures).

### Notes (forward compatibility)

- **v0.10.3 (next)**: README + `package.json` description compression
  for cold readers. Status block to ~3 lines; quickstart to one
  screen; description trimmed to a tight sentence.
- **v0.10.4**: pip-vs-repo-script decision memo (driven by the flip-
  signal contract in `docs/live-helpers.md`).
- **v0.10.5 / v0.11.0**: only then revisit publishing.
- **Lockstep policy earned this slice**: `HELPER_VERSION` in
  `scripts/extract/pytorch.py` MUST match `package.json`'s `version`
  on every release. Bumping the package version without bumping the
  helper version is now a smoke-gate failure. The fixture-generation
  script's pinned helper-block version must also match.
- **Bundled-fixture resolution doctrine earned this slice**: any
  default file path the CLI reads MUST go through `resolveBundledFile`
  (or an equivalent package-root-relative resolver). Cwd-relative
  default paths work in dev but break in installed packages — this
  is the regression class pack-smoke catches.

### Numbers

- 496 → 502 tests pass (+6 presence tests; 1 existing
  helper-version test updated for the lockstep bump)
- typecheck + build green
- Manual `pnpm pack-smoke` run: 6/6 steps pass on Windows; CI matrix
  validates ubuntu + macos + windows on push
- 1 src file modified (`src/bin/bp.ts` — new `resolveBundledFile`
  helper + 5 call sites refactored)
- 1 Python helper modified (`scripts/extract/pytorch.py` — version
  bump + docstring + error-string stability)
- 1 fixture-gen script modified
  (`scripts/build-pytorch-helper-fixtures.mjs` — version bump)
- 1 new pack-smoke script (`scripts/pack-install-smoke.mjs`, ~290
  lines)
- 1 new CI workflow (`.github/workflows/pack-smoke.yml`)
- 1 new test file (`test/pack-install-smoke.presence.test.ts`, 6
  tests)
- 1 test file updated (`test/import-pytorch-helper.test.ts`)
- 9 bad-helper fixtures + 3 good helper-emitted goldens regenerated
  (single-character version-string change inside the `helper` block)
- Tarball size: **0.65 MB** (322 entries; ceiling 10 MB)
- Build artifacts: same as v0.10.1 (no source-code-level changes
  beyond bp.ts)

### What v0.10.2 does NOT do

- Does **not** promote to v1.0.0
- Does **not** publish to npm (local v0.10.x stretch continues)
- Does **not** tag or create a GitHub release
- Does **not** regenerate translations
- Does **not** create a pip distribution (flip-signal contract holds)
- Does **not** compress the README (deferred to v0.10.3)
- Does **not** make the pip-vs-repo-script decision (deferred to v0.10.4)
- Does **not** add new helper / verifier features (purely a
  distribution-integrity slice)
- Does **not** ship JAX / TensorFlow live helpers (v0.11+)
- Does **not** change schema family (receipt v0.7.0 + framework-trace
  v0.7.0 remain latest)
- Does **not** change the helper's behavioral surface (same
  optimizer matrix as v0.10.1: SGD + Adam + AdamW + sgd_momentum
  with sign flip)

## [0.10.1] - 2026-05-18

The v0.10.1 PyTorch optimizer-matrix closure wave. **Not a v1.0.0
promotion.** **Not a publishing step** — local v0.10.x stretch
continues; no tag, no npm publish, no GitHub release, no translations.

v0.10.0 shipped the first live PyTorch helper supporting PyTorch ×
{SGD, Adam}. v0.10.1 closes the helper-vs-verifier optimizer-matrix
gap: **AdamW + sgd_momentum (classical + Nesterov + dampening) now
extract live**, with the load-bearing `momentum_buffer` sign-flip
implemented at the extraction boundary. The helper now matches the
verifier's full PyTorch surface (modulo SGD coupled-L2 weight decay,
which is deferred to v0.11 as Rule 7's third branch).

**The sign flip (load-bearing)**: PyTorch's
`optimizer.state[p]['momentum_buffer']` accumulates the unsigned
gradient (ascent direction) because PyTorch applies the parameter
update as `param.add_(d_p, alpha=-lr)` — the descent sign lives in
the update step, not in the buffer. backprop-trace's
`MomentumState.buffer` lives in descent space — Rule 21a is
`buffer_after = mu * buffer_before + (1 - dampening) * gradient`
where `gradient` is already signed for descent. The helper flips
once at the extraction boundary:
`buf_descent = -state['momentum_buffer']`. Per PyTorch issue #1099
+ docs/schema.md MomentumState section + docs/live-helpers.md
sign-flip pin (carried forward from v0.10.0 documentation).

**Trust boundary unchanged**: the helper remains observer-only. Rule
14 (engine-recompute differential) is the authority on every
helper-emitted sidecar regardless of helper claims. The sign-flip
adversarial fixture (`pytorch-helper.bad-momentum-buffer-not-sign-
flipped`) demonstrates that a non-flipped helper output gets rejected
by Rule 14 — the trust contract is *enforced* by the verifier, not
by the helper's self-claim.

### Added

- **`scripts/extract/pytorch.py` extended to v0.10.1**:
  - `_detect_optimizer_family` no longer rejects `torch.optim.AdamW`
    (returns `"adamw"`) or `torch.optim.SGD` with `momentum > 0`
    (returns `"sgd_momentum"`). Cross-checks: SGD with `weight_decay >
    0` STILL rejected (coupled L2 deferred to v0.11). AMSGrad / NAdam
    / RAdam / Lion / LBFGS still rejected with the v0.10.x rejection
    message.
  - `_build_optimizer_block` emits the full hyperparameter block for:
    - `adam` — `{name, learning_rate, beta1, beta2, epsilon, t}`
    - `adamw` — `{name, learning_rate, beta1, beta2, epsilon, weight_decay, t}`
    - `sgd_momentum` — `{name, learning_rate, momentum, nesterov?, dampening?}`
      with `nesterov` emitted only when `True` and `dampening` only
      when `> 0` (preserves v0.6.0 classical-momentum byte-equality)
  - `_snapshot_optimizer_state` refactored to
    `_snapshot_per_parameter_state(model, optimizer, topology, family,
    step_index)`. Walks `topology.parameter_order` and indexes into
    PyTorch's per-layer state tensors by element coordinate
    (`Linear.weight[h_out, i_in]`). Returns dict keyed by
    backprop-trace `parameter_id` (no more `(group_idx, param_idx)`
    tuple keys — v0.10.0's hidden bug fixed). State shape:
    - adam/adamw: `{m, v, step}` per parameter (pre-first-step zero-init
      for both fields plus the current step_index)
    - sgd_momentum: `{buffer}` per parameter, **SIGN-FLIPPED**
      (`buf_descent = -buf`) per PyTorch issue #1099 + v0.7.0
      MomentumState convention. Pre-first-step `momentum_buffer = None`
      (PyTorch lazy-init, issue #99079) handled with zero-init.
  - `_compute_observables` uses the new state shape — `update_entry.
    optimizer.state_before / state_after` looked up by `parameter_id`
    directly. v0.10.0's broken Adam-state pass-through removed.
  - Sign-flip code path carries an inline citation pointer to PyTorch
    issue #1099 + the docs/schema.md MomentumState section.
- **3 good helper-emitted golden sidecars** under `fixtures/external/`:
  - `pytorch.helper-emitted.sgd.softmax-ce.sidecar.jsonl` (v0.10.0;
    re-derived under v0.10.1 helper version)
  - `pytorch.helper-emitted.adamw.sidecar.jsonl` (v0.10.1 NEW) —
    derived from `pytorch.adamw.sidecar.jsonl`; imports cleanly with
    Rule 14 matched + Rule 7 AdamW branch + Rules 22-24
  - `pytorch.helper-emitted.sgd-momentum.sidecar.jsonl` (v0.10.1 NEW)
    — derived from `pytorch.sgd-momentum.sidecar.jsonl`; descent-
    direction buffer; imports cleanly with Rule 14 matched + Rules
    20/21a/21b/21c/25/26
- **2 new bad-helper adversarial fixtures** under `fixtures/bad/`:
  - `pytorch-helper.bad-momentum-buffer-not-sign-flipped` (Rule 14)
    — simulates a helper that emits PyTorch's ascent-direction buffer
    without sign-flipping. Negates every state_before.buffer +
    state_after.buffer on the sgd_momentum golden; Rule 14 surfaces
    the sign mismatch via engine recompute (Rule 21a would also fire
    on a downstream pass).
  - `pytorch-helper.bad-adamw-as-coupled-l2` (Rule 6) — simulates an
    AdamW helper that neglected to apply the decoupled `(1 - lr*wd)`
    factor to `weight_after`. Rule 6's AdamW branch (per Loshchilov &
    Hutter 2017 Alg 2 line 12) catches the missing decoupled-decay
    factor.
- **Tests** (`test/import-pytorch-helper.test.ts` extended):
  - AdamW helper-emitted sidecar: schema validation + Rule 14 + full
    reconciliation (Rule 7 AdamW branch + Rule 22-24)
  - sgd_momentum helper-emitted sidecar: schema validation + non-zero
    descent-direction buffer presence + Rule 14 + full reconciliation
    (Rule 20 + Rule 21a/b/c + Rule 25/26)
- **Tests** (`test/bp.examples-pytorch.cli.test.ts` extended):
  - sign-flip IMPLEMENTATION presence assertion (not just docstring
    pin) — regex matches `buf_descent = -buf` OR
    `-state["momentum_buffer"]`; PyTorch issue #1099 citation required
    in helper file
  - `_detect_optimizer_family` returns `"adamw"` + `"sgd_momentum"`
    branches present
  - v0.10's "AdamW deferred to v0.10.1" rejection string removed
    (would contradict v0.10.1 shipping the branch)
- **9 bad-helper fixtures total** (was 7 in v0.10.0): the test plate
  `test/reconcile.bad-pytorch-helper.test.ts` auto-discovers all
  `pytorch-helper.bad-*` fixtures and exercises anti-circularity for
  each.

### Changed

- **`package.json` version 0.10.0 → 0.10.1.** Description unchanged
  (v0.10.0's framing carries forward; the optimizer-matrix scope
  expansion is described in the README status line + docs/live-
  helpers.md).
- **`scripts/extract/pytorch.py`**:
  - HELPER_VERSION `"0.10.0"` → `"0.10.1"`
  - `HelperUnsupportedError` docstring updated to reflect the narrower
    v0.10.x rejection scope (AMSGrad/NAdam/RAdam/Lion/LBFGS/coupled-L2/
    AMP/GPU/multi-hidden-layer — NOT AdamW/sgd_momentum any more)
  - All `helper v0.10:` error message strings bumped to `helper v0.10.1:`
- **`scripts/build-pytorch-helper-fixtures.mjs`**:
  - `FIXTURE_HELPER_BLOCK.version` `"0.10.0"` → `"0.10.1"`
  - `buildGoodHelperEmittedSidecar` → `deriveHelperEmittedSidecar`
    (generalized to take source path; derives SGD + AdamW +
    sgd_momentum goldens from corresponding hand-authored sidecars)
  - Bad-fixture loop accepts per-fixture `base` selector ("sgd",
    "adamw", or "sgd_momentum") to mutate the right golden
- **`docs/live-helpers.md`**:
  - Scope matrix rewritten as v0.10.0-vs-v0.10.1 columns (shows the
    closure visually)
  - "v0.10.1 outlook" section rewritten as "v0.10.x outlook"
    (v0.10.1 CLOSED; v0.10.2 pack-smoke / v0.10.3 README compression
    / v0.10.4 pip decision pinned as next slices)
  - Adversarial fixture catalog extended with 2 new v0.10.1 entries
- **`README.md`** — status line updated to v0.10.1 with the explicit
  "live helper now matches verifier surface" framing; "Live framework
  helpers" deferral entry upgraded to reflect AdamW + sgd_momentum
  closure
- **`SHIP_GATE.md`** — Live framework helpers row upgraded from
  "MOSTLY CLOSED in v0.10" to "PyTorch CORE OPTIMIZER MATRIX CLOSED
  in v0.10.1"

### Notes (forward compatibility)

- **v0.10.2 (next)**: `npm pack` / `pnpm pack` cold-install smoke
  testing. Verifies helper + example ship in tarball; `bp examples
  pytorch` resolves the helper from a fresh install; tarball size is
  sane. NEW CI workflow + `scripts/pack-install-smoke.mjs`.
- **v0.10.3**: README + `package.json` description compression for
  cold readers (status block to a 3-line summary; quickstart to one
  screen; description trimmed to a tight sentence).
- **v0.10.4**: pip-vs-repo-script decision memo. Driven by the
  flip-signal contract in docs/live-helpers.md (≥3 non-team-user pip
  requests + non-trivial dependency need).
- **v0.10.5 / v0.11.0**: only then revisit publishing.
- **v0.11**: SGD coupled-L2 weight decay (Rule 7 third branch); JAX
  live helper (adopter-pull triggered); real-world fixture; multi-
  hidden-layer topology support.

### Numbers

- 486 → 496 tests pass (+10 from new AdamW/sgd_momentum coverage +
  sign-flip implementation assertions + extended adversarial plate)
- typecheck + build green
- 1 src file modified (`scripts/extract/pytorch.py`; significant
  refactor: optimizer-family detection, optimizer-block emission,
  per-parameter state snapshot with sign flip)
- 1 fixture-generation script extended
  (`scripts/build-pytorch-helper-fixtures.mjs`)
- 2 new good helper-emitted goldens (`pytorch.helper-emitted.
  adamw.sidecar.jsonl`, `pytorch.helper-emitted.sgd-momentum.
  sidecar.jsonl`)
- 2 new bad-helper adversarial fixtures (with meta files = 4 files)
- 2 test files extended (`import-pytorch-helper.test.ts`,
  `bp.examples-pytorch.cli.test.ts`)
- v0.1.0 through v0.10.0 fixtures remain byte-identical (no schema
  changes; helper output is additive)

### What v0.10.1 does NOT do

- Does **not** promote to v1.0.0
- Does **not** publish to npm (local v0.10.x stretch continues)
- Does **not** tag or create a GitHub release
- Does **not** regenerate translations (status line + helper-section
  framing only)
- Does **not** create a pip distribution (flip-signal contract holds)
- Does **not** ship JAX / TensorFlow live helpers (v0.11+)
- Does **not** ship Lightning / Accelerate callback integration
- Does **not** ship batched live extraction
- Does **not** ship CUDA / MPS / XLA / AMP support
- Does **not** ship SGD coupled-L2 weight decay (Rule 7 third branch
  is v0.11)
- Does **not** add multi-hidden-layer topology support
- Does **not** add a real-world (CNN / transformer) fixture
- Does **not** change SGD / Adam / AdamW / sgd_momentum verifier
  byte-output (v0.1-v0.10.0 fixtures byte-equal under v0.10.1)
- Does **not** bump any schema family (receipt + framework-trace
  schemas unchanged from v0.10.0)
- Does **not** do README compression (deferred to v0.10.3)
- Does **not** do pack-install smoke (deferred to v0.10.2)
- Does **not** make the pip-vs-repo-script decision (deferred to v0.10.4)

## [0.10.0] - 2026-05-18

The v0.10 first-live-helper wave. **Not a v1.0.0 promotion** —
backprop-trace remains mid-v0 (no JAX/TF live helpers; no AdamW or
sgd_momentum live helper yet; no AMP / GPU; no batched live extraction;
no real-world fixture; no adopter validation). What v0.10 actually
does: **closes the "live framework helpers" gap named in v0.9.x's
SHIP_GATE** for the minimum-viable cell — PyTorch × {SGD, Adam}
single- and multi-step on CPU. After v0.10, the next v0.10.x slice
extends the helper's optimizer matrix; v0.11 considers JAX (adopter-
pull triggered).

**Trust boundary (load-bearing)**: the helper is an OBSERVER. It is
NEVER a verifier and never an authority. Every helper-emitted sidecar
is structurally indistinguishable from a hand-authored or adversarial
sidecar at Rule 14's input. Rule 14 (engine-recompute differential
against the sidecar's named factors) MUST fire unconditionally on
`authoring_state === "external_imported"` regardless of how trusted
the helper appears, what framework version it ran against, or whether
the helper reports success. The helper's `source_hash` and version
metadata are FORENSIC — post-hoc attribution when Rule 14 disagrees,
NOT bypass credentials. Csmith / CompCert + Fang et al. 2023 PoL
spoofing doctrine grounding documented in `docs/live-helpers.md`.

**No pip package by design**. Repo-script-only proves the workflow
before committing to a pip surface. The flip-signal contract: ≥3
independent non-team users ask "how do I pip install this?" AND the
helper needs a non-trivial dependency beyond `torch + stdlib`. Until
both fire, the single auditable file pattern is the right answer.

### Added

- **`framework-trace.v0.7.0` schema** (NEW file). FORCED bump over
  framework-trace.v0.6.0: v0.6.0's root-level `additionalProperties:
  false` rejects the new top-level `helper` object that live-extractor
  sidecars MUST carry. v0.6.0 hand-authored sidecars continue to
  validate against v0.6.0 schema byte-identical; v0.10 live-helper-
  emitted sidecars declare `format: "framework-trace.v0.7.0"`.
  - New REQUIRED top-level `helper` object with `additionalProperties:
    false`. Required keys: `name`, `version`, `distribution` (closed
    enum `"repo-script" | "pypi" | "vendored"`), `source_hash`
    (`^sha256:[0-9a-f]{64}$`), `framework`, `runtime`, `extraction`.
  - Conditional `required: ["helper"]` via `allOf if/then` when
    `source_framework.name` ∈ {pytorch, jax, tensorflow} AND
    `source_framework.extractor.name !== "hand_authored"`. Same
    vacuous-properties trap fix as v0.9.3 — the if-clause requires
    `source_framework + source_framework.name` to be PRESENT.
  - Back-compat escape: hand-authored sidecars (declaring
    `extractor.name = "hand_authored"`) may omit the helper block
    and still declare v0.7.0 format — supports fixture re-declaration
    without forcing a hand-authored helper block.
- **`scripts/extract/pytorch.py`** (NEW file). Single auditable
  Python file (~700 lines, MIT-headered, no pip dependencies beyond
  `torch + stdlib`). Public API: `TraceDumper(model, optimizer,
  loss_fn, out=..., trace_id=..., topology_loss=...)` context manager
  with `with dumper.step(inputs=..., targets=...): ...` per-step body.
  - Supports `torch.optim.SGD` (momentum=0) + `torch.optim.Adam` on
    CPU. AdamW + sgd_momentum REJECTED at boundary with clear
    "deferred to v0.10.1" message + sign-flip pin reference for
    sgd_momentum.
  - AMP / `torch.cuda.amp.autocast` REJECTED at boundary (PyTorch
    issue #75224 — fp16/fp32 master confusion).
  - CUDA / MPS / XLA REJECTED at boundary (CPU-first v0.10; v0.11+).
  - Walks `optimizer.param_groups` → `params` in declared order
    (PyTorch issue #1489 — `optimizer.state` keyed by `id()`, not
    name; iterating state directly silently corrupts).
  - `.detach().clone()` snapshot discipline throughout (Adam Paszke
    forum + Elana Simon 2025 — `.detach()` alone shares storage;
    subsequent `optimizer.step()` mutates the snapshot in place).
  - Self-hashes via `hashlib.sha256(Path(__file__).read_bytes())`.
    Documented as FORENSIC — Rule 14 is the authority.
  - Single-hidden-layer feed-forward topologies only (Mazur-shaped).
    CNN / transformer / multi-hidden-layer topologies deferred to v0.11.
  - Emits `framework-trace.v0.7.0` sidecar JSONL to stdout (default)
    or `--out <file>`. Multi-step via shared `trace_id` across steps.
- **`examples/pytorch/extract_step.py`** (NEW file). Minimal Mazur
  2-2-2 SGD single-step example showing the locked workflow:
  copy the helper via `bp examples pytorch --print > pytorch_trace_
  helper.py`, then `from pytorch_trace_helper import TraceDumper`.
  In-repo path uses sys.path injection so the example can smoke-run
  from the repo root without requiring the user to copy anything.
- **`bp examples pytorch` CLI verb** (NEW). Default prints the
  absolute filesystem path of `scripts/extract/pytorch.py`;
  `--print` cats the helper's bytes to stdout (pipe into a local
  file: `bp examples pytorch --print > pytorch_trace_helper.py`).
  - `bp examples pytorch --help` prints usage including the trust-
    boundary statement.
  - `bp examples --help` lists the v0.10 subnouns (only `pytorch`).
  - `bp --help` top-level usage gains a "Live framework helpers"
    section pointing at the new verb.
- **`docs/live-helpers.md`** (NEW file). The full operator + auditor
  reference for the v0.10 helper: trust-boundary statement (verbatim
  with citations: Csmith PLDI 2011 + CompCert CACM 2009 + Fang et al.
  EuroS&P 2023 + SLSA Provenance v1.0 + in-toto v1 + Sigstore model-
  transparency), v0.10 scope matrix, workflow walkthrough, forensic
  helper block field reference, forbidden-in-the-helper list,
  adversarial fixture catalog, no-pip-package rationale + flip-signal
  contract, v0.10.1 outlook, source bibliography.
- **`scripts/build-pytorch-helper-fixtures.mjs`** (NEW file). Per
  Csmith/CompCert discipline: deterministic JS mutation script that
  derives the good helper-emitted golden sidecar from
  `pytorch.softmax-ce.sidecar.jsonl` AND derives 7 bad-helper
  fixtures via targeted byte-level mutations. CI re-runs the script
  and `git diff --exit-code` confirms byte-identical regeneration.
  No RNG; no wall-clock; helper.extraction.timestamp pinned to
  `"2026-05-18T12:00:00Z"` for byte stability.
- **Good helper-emitted golden fixture**:
  - `fixtures/external/pytorch.helper-emitted.sgd.softmax-ce.sidecar.jsonl`
    — v0.7.0 sidecar derived from the existing softmax-ce sidecar
    with format bumped + helper block added. Imports cleanly with
    `verification_state: engine_recompute_matched_within_tolerance`;
    reconciles all 26 rules pass.
- **7 bad-helper adversarial fixtures** under `fixtures/bad/`:
  - `pytorch-helper.bad-grad-captured-after-zero-grad` → Rule 4
    (helper read `param.grad` AFTER `optimizer.zero_grad()`)
  - `pytorch-helper.bad-detach-not-applied` → Rule 6 (`param.data`
    view captured; `optimizer.step()` mutated the snapshot)
  - `pytorch-helper.bad-param-ordering-swapped` → Rule 4 (helper
    iterated `state_dict()` order vs `param_groups` order)
  - `pytorch-helper.bad-loss-stale` → Rule 12 (loss tensor captured
    before `loss.backward()`)
  - `pytorch-helper.bad-forward-out-mismatch` → Rule 11 (cached
    wrong layer's output; softmax simplex broken)
  - `pytorch-helper.bad-weight-after-divergence` → Rule 6
    (`parameters_after` captured before `optimizer.step()` returned)
  - `pytorch-helper.bad-hidden-signal-misrouted` → Rule 8 (used
    `out` instead of `out*(1-out)` for sigmoid `activation_derivative`)
- **Tests**:
  - `test/reconcile.bad-pytorch-helper.test.ts` — 7 anti-circular
    tests (one per bad fixture). For each: import via
    `importPytorchSidecar()`, reconcile, assert expected rule fires
    BEFORE reading `meta.json`; then strip `fixture_status` +
    `attestor` and re-reconcile to PROVE the rule still fires
    without metadata.
  - `test/import-pytorch-helper.test.ts` — 7 tests covering schema
    validation of v0.7.0 helper-emitted sidecars (good + spoofed
    source_hash + missing helper + hand_authored escape), import
    + Rule 14 passage, full reconciliation, and
    `validateFrameworkTraceSidecarOrThrow` parity.
  - `test/bp.examples-pytorch.cli.test.ts` — 14 tests covering CLI
    verb behavior, helper file presence, trust-boundary statement
    presence in the helper docstring, momentum_buffer sign-flip
    pin presence, helper version matches package.json,
    byte-identity between `bp examples pytorch --print` output and
    the on-disk file, help texts, error exit codes.
- **`bp examples pytorch` subcommand recognition** in CLI fuzzy-
  suggester (`suggestSubcommand`) so typos like `bp exampls pytorch`
  point at the right verb.
- **`package.json` `files[]` extended** with `scripts/extract/**` +
  `examples/pytorch/**` so the helper + example ship in the npm
  tarball (verified via `npm pack --dry-run`).

### Changed

- **`package.json` version 0.9.3 → 0.10.0.** Description preserved
  framing (no rewrite — v0.10 is additive over v0.9.x's surface,
  just adds the helper path).
- **`src/schema-loader.ts`** — `FRAMEWORK_TRACE_SCHEMA_VERSIONS`
  appended `"0.7.0"`. Docstring extended with v0.10 helper-block
  rationale.
- **`src/validate.ts`** — `validateFrameworkTraceSidecar` dispatcher
  recognizes `format: "framework-trace.v0.7.0"` and routes to the
  v0.7.0 validator.
- **`src/import-observer.ts`** — `FrameworkTraceSidecar` type union
  extended with `"framework-trace.v0.7.0"`. New `HelperBlock` type
  exported for downstream consumers. Multi-step validator accepts
  v0.7.0.
- **`src/bin/bp.ts`** — added `bp examples pytorch [--print]` verb +
  `resolvePytorchHelperPath()` helper. Top-level usage text gains
  "Live framework helpers" section. `suggestSubcommand()` learns
  the `examples` verb.
- **`docs/schema.md`** — new "v0.10 FORCED bump to framework-trace.
  v0.7.0 (live-helper `helper` block)" section above the v0.9.3
  Nesterov section. Explains the forced-bump rationale, the helper
  block fields, the trust-boundary statement, and the explicit
  "no receipt schema bump" framing.
- **`README.md`** — Status line updated to v0.10.0; description
  framing extended with the live-helper paragraph; CLI usage gains
  `bp examples pytorch` line; "Live framework helpers" deferral
  item upgraded to MOSTLY CLOSED in v0.10; schemas list +
  fixtures list extended.
- **`SHIP_GATE.md`** — "Live framework helpers" gap upgraded to
  MOSTLY CLOSED in v0.10 with explicit AdamW/sgd_momentum/JAX/TF
  deferral roadmap.

### Notes (forward compatibility)

- **v0.10.1**: extends the helper's optimizer matrix with PyTorch
  AdamW (decoupled-decay extraction; same engine path as v0.9.1
  AdamW) and PyTorch sgd_momentum (momentum_buffer sign-flip at
  the extraction boundary; the pin lives in
  `scripts/extract/pytorch.py` docstring + the v0.7.0 MomentumState
  schema description). Helper currently REJECTS both at boundary
  with clear "deferred to v0.10.1" messages.
- **v0.10.x**: Lightning / Accelerate callback integration (vanilla
  `torch.nn.Module` is first per MLflow's documented caveat —
  Lightning is a separate axis).
- **v0.11**: JAX live helper — triggered ONLY when (a) PyTorch
  helper has shipped one bugfix release AND (b) ≥1 external adopter
  filed an issue or PR using the PyTorch helper. If no adopter in
  ~90 days, hold. JAX hand-authored sidecars continue working
  unchanged.
- **v0.12+**: TensorFlow live helper — gated on JAX clean shipment.
  HuggingFace `transformers` v5 retreat to PyTorch-only (2025) is
  a real warning sign for multi-framework breadth.
- **Pip distribution flip signal**: ≥3 independent non-team users
  ask "how do I `pip install` this?" within one release cycle AND
  the helper needs a dependency the user can't reasonably copy-paste
  (beyond `torch` + stdlib). Until both fire, repo-script is the
  right answer.
- **Real-world fixture**: deferred to v0.11. Mazur 2-2-2 + softmax+CE
  + sgd_momentum-Mazur remain the heroes. CNN / transformer-block
  fixture requires multi-hidden-layer topology support (also v0.11+).
- **Adopter validation**: deferred to v0.12 (before v1.0 promotion).

### Numbers

- 486 tests pass (was 458; +28 from new helper-related test suites)
- typecheck + build green
- 5 src files modified (schema-loader, validate, import-observer,
  bin/bp, package.json)
- 1 new schema file (`schemas/framework-trace.v0.7.0.json`)
- 1 new Python helper file (`scripts/extract/pytorch.py`, ~700 lines)
- 1 new Python example file (`examples/pytorch/extract_step.py`)
- 1 new docs file (`docs/live-helpers.md`)
- 1 new fixture-generation script (`scripts/build-pytorch-helper-fixtures.mjs`)
- 1 new good golden fixture (`pytorch.helper-emitted.sgd.softmax-ce.sidecar.jsonl`)
- 7 new bad-helper fixtures (with sibling meta files = 14 files)
- 3 new test files (`reconcile.bad-pytorch-helper.test.ts`,
  `import-pytorch-helper.test.ts`, `bp.examples-pytorch.cli.test.ts`)
- v0.1.0 through v0.9.3 fixtures remain byte-identical (no receipt
  schema bump; helper block lives on sidecars only)

### What v0.10 does NOT do

- Does **not** promote to v1.0.0
- Does **not** create a pip distribution (repo-script-only by design)
- Does **not** ship PyTorch AdamW live extraction (v0.10.1)
- Does **not** ship PyTorch sgd_momentum live extraction — sign-flip
  pin documented but extraction REJECTED at boundary (v0.10.1)
- Does **not** ship JAX live helper (v0.11 — adopter-pull triggered)
- Does **not** ship TensorFlow live helper (v0.12+ — gated on JAX)
- Does **not** ship Lightning / Accelerate callback integration (v0.10.x)
- Does **not** ship AMP / `torch.cuda.amp.autocast` extraction —
  REJECTED at boundary (PyTorch issue #75224 master-confusion)
- Does **not** ship CUDA / MPS / XLA extraction (v0.11+)
- Does **not** ship batched live extraction (hand-authored batched
  sidecars continue working)
- Does **not** add a real-world fixture (CNN / transformer; v0.11+)
- Does **not** add adopter validation (deferred to v0.12)
- Does **not** bump the receipt schema family (helper block lives
  on sidecars only; receipt v0.7.0 remains latest)
- Does **not** change SGD/Adam/AdamW/sgd_momentum byte-output
  (v0.1-v0.9.3 fixtures byte-equal under the v0.10 engine)
- Does **not** tag, publish to npm, or create a GitHub release
- Does **not** regenerate translations (status line + helper section
  only; no operator-language change warranting translation cycle)

## [0.9.3] - 2026-05-18

The v0.9.3 Nesterov + dampening wave. **Not a v1.0.0 promotion** —
backprop-trace remains mid-v0 (no SGD coupled L2 weight decay — deferred
to v0.10; no AMSGrad/NAdam/RAdam/Lion; no live framework helpers; no
real-world fixture; no adopter validation). What v0.9.3 actually does:
**closes the SGD momentum branch cleanly** by widening v0.9.2's
classical-only `sgd_momentum` to PyTorch's full `torch.optim.SGD`
recurrence — Nesterov accelerated gradient + dampening together. After
v0.9.3, the next major product-power move is **v0.10 live framework
helpers**, not more optimizer variants.

**Doctrine guardrail (preserved from v0.9.2)**: Rule 21 is framed as
"**PyTorch-style SGD momentum recurrence**" — NOT "momentum correctness"
in the abstract. Future SGD coupled L2 / AMSGrad / NAdam variants are
NOT bugs in v0.9.3; they are explicitly deferred variants that the
v0.9.3 reconciler does not recognize.

**PyTorch combo rejection**: `nesterov=true && dampening>0` is rejected
at both schema (allOf if/then with `required: ["nesterov"]` to avoid
JSON-Schema's vacuous-properties pitfall) and engine boundary
(`assertOptimizerConfig`). This mirrors PyTorch's
`torch.optim.SGD.__init__` which raises
`ValueError("Nesterov momentum requires a momentum and zero dampening")`.
If someone hands us a trace PyTorch itself would reject, we do not
normalize it into a "variant" — we reject it loudly with the same
boundary discipline.

### Added

- **`receipt.v0.7.0` schema** (NEW file). FORCED bump over `receipt.v0.6.0`:
  the closed `OptimizerConfig.nesterov: const false` + `dampening: const 0`
  reserved-slot widening still counts as a closed-schema change, so
  doctrine forces the bump. v0.7.0 widens `nesterov` to `boolean` and
  `dampening` to `number ∈ [0, 1)` (exclusive upper bound — PyTorch
  default 0.0). Adds `allOf` if/then clause enforcing PyTorch combo
  rejection. **Load-bearing detail**: the if-clause MUST require
  `nesterov` to be PRESENT (`"required": ["nesterov"]`) — otherwise
  JSON-Schema's properties-only check fires vacuously on absent fields
  and the then-clause runs incorrectly on classical-and-dampened
  receipts. `weight_decay` continues to be rejected for sgd_momentum
  (deferred to v0.10). MomentumState docstring extended with live-helper
  sign-flip note (PyTorch ascent vs backprop-trace descent direction —
  see v0.10 helpers).
- **`framework-trace.v0.6.0` schema** (NEW file). FORCED bump for the
  same reasons. Parallel sidecar shape with identical allOf if/then
  + `required: ["nesterov"]` enforcement. v0.1.0 through v0.5.0
  sidecars continue to validate against their own schemas unchanged.
  Importer dispatcher accepts all six versions on the multi-step path.
- **`runGeneralStep` sgd_momentum Nesterov + dampening dispatch** in
  `src/general-engine.ts`. Widened `OptimizerConfig.nesterov` from
  `false` to `boolean` and `dampening` from `0` to `number`. Recurrence
  now: `tau = cfg.dampening ?? 0`; `useNesterov = cfg.nesterov ?? false`;
  `bufferAfter = mu * bufferBefore + (1 - tau) * gradient`;
  `effective = useNesterov ? gradient + mu * bufferAfter : bufferAfter`;
  `update = lr * effective`. The `effective` quantity is derived
  per-rule-application, **never stored** in receipts (preserves
  byte-equality with v0.9.2 classical fixtures). Engine identity stays
  `"backprop-trace-engine@0.6.0"` (additive optimizer variants; existing
  SGD/Adam/AdamW/classical-momentum math byte-equal).
- **`assertOptimizerConfig` sgd_momentum Nesterov + dampening
  acceptance + PyTorch combo rejection**:
  - `nesterov` accepted as boolean (no longer rejected when `true`)
  - `dampening` accepted as `number ∈ [0, 1)` (no longer rejected
    when `> 0`)
  - **NEW**: `nesterov === true && dampening > 0` rejected with clear
    message citing PyTorch's `torch.optim.SGD(dampening=tau)` ValueError
  - Type/range validation: `nesterov` must be boolean; `dampening` must
    be finite number in `[0, 1)`
  - `weight_decay` still rejected for sgd_momentum (deferred to v0.10)
- **Rule 21 split to 21a / 21b / 21c** in `src/reconcile.ts`:
  - **21a**: `buffer_after == momentum * buffer_before + (1 - dampening) * gradient`
    (PyTorch `torch.optim.SGD` recurrence with dampening; Sutskever
    et al. 2013 ICML / Polyak 1964 heavy-ball foundation; `lr` OUTSIDE
    the buffer so LR schedules don't retroactively rescale history)
  - **21b**: `effective = gradient + momentum * buffer_after` if
    `nesterov` else `buffer_after` (derived direction selection;
    NEVER stored in the receipt — preserves canonical bytes;
    Sutskever et al. 2013 lookahead reformulation)
  - **21c**: `update == learning_rate * effective` (descent direction;
    sign already in `gradient`)
  - Each sub-check cascades to skip downstream sub-checks on failure
    (21a fail → skip 21b/21c; 21b fail → skip 21c)
  - GATED on `optimizer.name === "sgd_momentum"`
  - Failure messages cite "PyTorch-style" (NOT "abstract momentum
    correctness") + Sutskever/Polyak/PyTorch references + STRUCTURAL
    CHECK + Fang et al. 2023 PoL spoofing caveat
- **Rule 20 sgd_momentum nesterov + dampening type/range checks** —
  relaxed reserved-slot rejections (`nesterov: false` ONLY / `dampening:
  0` ONLY no longer required); added defense-in-depth PyTorch combo
  rejection (catches a hypothetical schema-bypass where invalid combo
  reaches reconciler).
- **Rule 14 sgd_momentum-aware (v0.9.3 widening)** — when receipt
  declares `optimizer_config.name === "sgd_momentum"`, Rule 14 forwards
  the receipt's `nesterov` (when true) and `dampening` (when != 0) to
  the engine recompute input. Bad fixture coverage extended.
- **PyTorch-style SGD momentum good fixtures** (Nesterov + dampening)
  in `fixtures/external/`:
  - `pytorch.sgd-momentum.nesterov.{sidecar,golden}.jsonl` — single-step
    (Mazur 2-2-2 topology, mu=0.9, dampening=0, nesterov=true, zero-init
    buffer)
  - `pytorch.sgd-momentum.dampening.{sidecar,golden}.jsonl` — single-step
    (mu=0.9, dampening=0.1, nesterov=false)
  - `pytorch.sgd-momentum.nesterov.multi-step.{sidecar,golden}.jsonl` —
    3-step Nesterov exercising Rules 25 buffer chain + 26 config
    constancy + bundle binding (trace_id pinned to
    `d1e2f30405061728394a5b6c7d8e9f02`)
- **Momentum adversarial fixture plate extension (4 new bad fixtures)**
  in `fixtures/bad/`:
  - `momentum.bad-nesterov-flag-mismatch.jsonl` → Rule 21 (RENAMED from
    v0.9.2's `momentum.bad-formula-mismatch.jsonl` — same byte mutation,
    more precise framing now that Nesterov is a recognized branch:
    update mutated to look like a Nesterov-form on a non-Nesterov receipt)
  - `momentum.bad-nesterov-formula-mismatch.jsonl` → Rule 21 (NEW;
    nesterov=true receipt with `update` mutated to NON-Nesterov form;
    sourced from step_index=1 of multi-step Nesterov golden so
    buffer_before is non-zero — at step 0 with buffer_before=0, the
    nesterov / non-nesterov divergence collapses to zero)
  - `momentum.bad-dampening-ignored.jsonl` → Rule 21 (NEW; dampening=0.1
    declared but buffer_after computed as if dampening=0; Rule 21a
    catches it)
  - `momentum-multi-step.bad-nesterov-flag-inconstancy.jsonl` → Rule 26
    (NEW; multi-step bundle where step 0 has nesterov=true and step 1
    has nesterov absent / false — Rule 26 fires on optimizer_config
    constancy)
- **`schemas/receipt.v0.7.0.json` + `schemas/framework-trace.v0.6.0.json`
  subpath exports** in `package.json` exports map
  (`./schema/receipt-0.7.0`, `./schema/framework-trace-0.6.0`).
- **`bp` CLI** Rule 21 label updated for 21a/21b/21c sub-check
  framing (`src/bin/bp.ts` RULE_LABELS).
- **Tests**: 4 new acceptance tests in
  `test/import-pytorch-momentum.test.ts` — accepts `nesterov: true`
  alone, accepts `dampening: 0.1` alone, accepts `nesterov: true +
  dampening: 0` (explicit zero is fine), rejects the PyTorch combo
  (`nesterov: true + dampening > 0`). 4 new bad-fixture entries in
  `test/reconcile.doctrine.test.ts` (replaces v0.9.2's
  `bad-formula-mismatch` entry; `FILENAME_KIND_TO_RULE` extended).
  453 → 458 tests (+5, all passing).

### Changed

- **`package.json` version 0.9.2 → 0.9.3.** Description rewritten:
  "PyTorch-style SGD momentum (classical + Nesterov + dampening)"
  framing; preserves Mid-v0 status flag (CPU-only, SGD/Adam/AdamW/
  sgd_momentum-all-PyTorch-variants; SGD coupled L2 explicitly
  deferred with v0.10 target).
- **`docs/reconciliation.md`** — Quick-reference rule table updated:
  Rule 21 widened to 21a/21b/21c with full PyTorch-style framing
  (`(1 - dampening) * gradient` dampening factor; derived `effective`
  direction selection; descent-direction update). "Classical
  PyTorch-style SGD momentum (v0.9.2)" section renamed and rewritten
  as "PyTorch-style SGD momentum (v0.9.2 + v0.9.3)" with v0.9.2 →
  v0.9.3 transition table explaining the closed-const widening +
  PyTorch combo rejection.
- **`docs/schema.md`** — Added "v0.9.3 FORCED bump to receipt.v0.7.0 +
  framework-trace.v0.6.0 (Nesterov + dampening)" section. Documents
  the `nesterov: const false` → boolean / `dampening: const 0` →
  `number ∈ [0, 1)` widening, the allOf if/then PyTorch combo
  rejection clause with the load-bearing `required: ["nesterov"]`
  trap, and the **v0.10 live-helper sign-convention pin** (PyTorch's
  `momentum_buffer` lives in ascent space; backprop-trace's `buffer`
  lives in descent space; live helpers MUST sign-flip at the
  trace-extraction boundary). v0.9.2 classical fixtures remain
  byte-identical under the v0.9.3 widened engine.
- **`SHIP_GATE.md`** — "Optimizers beyond vanilla SGD" gap upgraded to
  MOSTLY CLOSED in v0.9.3 (Adam/AdamW v0.9.1 + classical sgd_momentum
  v0.9.2 + Nesterov + dampening v0.9.3). "Nesterov accelerated
  gradient + dampening" row marked CLOSED in v0.9.3.
- **`README.md`** — Status line updated to v0.9.3; description framing
  widened from "classical PyTorch-style" to "PyTorch-style" (preserves
  the "not abstract momentum correctness" guardrail); 26-rule table
  Rule 21 widened to 21a/21b/21c; What's-not-in-this-version Nesterov
  + dampening entry marked CLOSED.
- **Schema-loader docstrings** (`src/schema-loader.ts`) —
  `SCHEMA_VERSIONS = ["0.1.0", ..., "0.6.0", "0.7.0"]`;
  `FRAMEWORK_TRACE_SCHEMA_VERSIONS = ["0.1.0", ..., "0.5.0", "0.6.0"]`.
  Docstrings updated.
- **Validator dispatcher** (`src/validate.ts`) —
  `validateFrameworkTraceSidecar` recognizes
  `format: "framework-trace.v0.6.0"` and routes to the new validator.
- **Importer (`src/import-observer.ts`)** — both single-step and
  multi-step receipt construction emit `nesterov: true` (only when
  true) and `dampening: X` (only when > 0). Multi-step path was the
  load-bearing fix discovered during test runs (Edit's replace_all
  matched only one signature; multi-step block needed the same
  conditional emission). Schema_version dispatch: `"0.7.0"` when
  sgd_momentum has nesterov=true OR dampening>0; `"0.6.0"` otherwise
  for sgd_momentum (preserves v0.9.2 byte-equality on classical
  fixtures).

### Notes (forward compatibility)

- **SGD coupled L2 weight decay** is v0.10. Rules 6/7 grow a third
  branch (sgd_momentum + weight_decay applies `grad ← grad + lambda *
  theta` BEFORE the buffer update — coupled L2 form, distinct from
  AdamW's decoupled). Touches Rule 4's factor narrative; needs its
  own slice.
- **AMSGrad / NAdam / RAdam / Lion** are v0.10+. AMSGrad's
  `max(v_t, v_{t-1})` projection doesn't fit Rule 4's
  `product(factors)` vocabulary; needs new rule design pass.
- **Batched sgd_momentum (with Nesterov + dampening)** is v0.9.x /
  v0.10 (same per-sample-runs-then-reduce gap that blocks batched
  Adam). Single-sample (batch.size=1) sgd_momentum works today via
  the unbatched path.
- **Live helpers (v0.10)** MUST sign-flip PyTorch's
  `momentum_buffer` (which lives in ascent space — PyTorch applies
  `param.add_(d_p, alpha=-lr)` so `buf` accumulates gradient sign,
  not descent sign) to backprop-trace's `buffer` (which lives in
  descent space — `update = lr * buffer_after`, where `gradient` is
  already signed for descent). Documented in `docs/schema.md`
  MomentumState section + `receipt.v0.7.0.json` MomentumState
  docstring.

### Numbers

- 458 tests pass (was 453; +5 from new acceptance + PyTorch combo
  rejection tests, plus 4 new bad-fixture entries forced into
  `reconcile.doctrine.test.ts`)
- typecheck + build green
- 8 src files modified (schema-loader, validate, general-engine,
  emit, reconcile, import-observer, bin/bp, package.json;
  schema-loader.test.ts + reconcile.doctrine.test.ts +
  import-pytorch-momentum.test.ts updated)
- 2 new schema files (`schemas/receipt.v0.7.0.json` +
  `schemas/framework-trace.v0.6.0.json`)
- 3 new fixture files in `fixtures/external/` (Nesterov single-step,
  dampening single-step, Nesterov multi-step pairs = 6 actual files)
- 4 new fixture files in `fixtures/bad/` (1 renamed from v0.9.2's
  bad-formula-mismatch + 3 net-new; with sibling meta files = 8 files)
- 2 fixture-generation scripts extended
  (`scripts/generate-pytorch-momentum-fixtures.ts` +
  `scripts/generate-momentum-bad-fixtures.ts`)
- v0.1.0 through v0.9.2 fixtures remain byte-identical (SGD/Adam/AdamW/
  classical-sgd_momentum goldens unchanged under the v0.9.3 widened
  engine; Nesterov + dampening establish a new lineage at
  schema_version `0.7.0`)

### What v0.9.3 does NOT do

- Does **not** promote to v1.0.0
- Does **not** ship SGD coupled L2 weight decay (v0.10)
- Does **not** ship AMSGrad / NAdam / RAdam / Lion (v0.10+)
- Does **not** ship batched sgd_momentum with Nesterov + dampening
  (deferred, same per-sample-runs-then-reduce gap)
- Does **not** ship per-parameter-group hyperparameters (v0.10+)
- Does **not** ship live Python helpers (still hand-authored sidecars;
  v0.10 is next)
- Does **not** add new CLI verbs (Nesterov + dampening dispatch is
  sidecar-driven; same pattern as v0.9.1/v0.9.2)
- Does **not** add a real-world fixture (Mazur 2-2-2 + softmax+CE +
  sgd_momentum-Mazur remain the heroes; CNN / transformer-block
  deferred to v0.11)
- Does **not** add adopter validation (deferred to v0.12)
- Does **not** change SGD/Adam/AdamW/classical-sgd_momentum byte-output
  (v0.1-v0.9.2 fixtures byte-equal under the v0.9.3 widened engine)
- Does **not** tag, publish to npm, or create a GitHub release
- Does **not** regenerate translations (no README user-facing rewrite
  warranting translation cycle; status line + entries only)

## [0.9.2] - 2026-05-19

The v0.9.2 classical PyTorch-style SGD momentum wave. **Not a v1.0.0
promotion** — backprop-trace remains mid-v0 (no Nesterov / dampening
yet — reserved for v0.9.3; no SGD coupled L2 weight decay — deferred
to v0.10; no live framework helpers; no real-world fixture; no adopter
validation). What v0.9.2 actually does: closes the "momentum SGD"
sub-gap named in v0.9.1's SHIP_GATE — classical PyTorch-style SGD
momentum receipts now validate end-to-end (engine + reconciler +
observer-mode ingestion + multi-step buffer chain + bundle binding).

**Doctrine guardrail**: Rule 21 is framed as "**classical PyTorch-style
SGD momentum recurrence**" — NOT "momentum correctness" in the abstract.
Future Nesterov / dampening / weight-decay variants are NOT bugs in
v0.9.2; they are explicitly deferred variants that the v0.9.2 reconciler
does not recognize. A receipt whose `update` matches a non-classical
form (e.g., Nesterov lookahead) fires Rule 21 in v0.9.2 — that's a
"stored update matches a momentum variant the v0.9.2 reconciler does
not recognize" failure, not a "Nesterov is broken" failure.

### Added

- **`receipt.v0.6.0` schema** (NEW file). FORCED bump over `receipt.v0.5.0`:
  the closed `Update.optimizer.name: ["sgd", "adam", "adamw"]` enum +
  closed `AdamState` shape ({m, v} with `additionalProperties: false`)
  prevented in-place evolution. v0.6.0 widens `optimizer.name` to
  `["sgd", "adam", "adamw", "sgd_momentum"]`, adds new `MomentumState =
  { buffer: number }` def (`additionalProperties: false`, `required:
  ["buffer"]`), widens `Update.optimizer.state_before` / `state_after` to
  `OptimizerState = oneOf(AdamState, MomentumState)` (reconciler Rule 20
  enforces shape-matches-name; schema is permissive), adds optional
  `OptimizerConfig.momentum` (conditionally REQUIRED when name ===
  "sgd_momentum"), adds RESERVED `nesterov: const false` + `dampening:
  const 0` (v0.9.3 widens), rejects `weight_decay` on sgd_momentum
  (deferred to v0.10). SGD-only receipts continue to declare
  `schema_version: "0.4.0"`; Adam/AdamW continue at "0.5.0";
  sgd_momentum declares "0.6.0".
- **`framework-trace.v0.5.0` schema** (NEW file). FORCED bump for the
  same reasons. Parallel sidecar shape: `optimizer.name` enum widened,
  `optimizer.momentum` field added, `nesterov: const false` +
  `dampening: const 0` reserved, `weight_decay` rejected for
  sgd_momentum. v0.4.0 / v0.3.0 / v0.2.0 / v0.1.0 sidecars continue
  to validate against their own schemas unchanged. Importer dispatcher
  accepts all five versions on the multi-step path.
- **`runGeneralStep` sgd_momentum dispatch** in `src/general-engine.ts`.
  New types: `MomentumState`, `OptimizerStateAny` (union of `AdamState
  | MomentumState`). Extended `Optimizer` with widened `name` enum and
  union-typed `state_before`/`state_after`. Extended `OptimizerConfig`
  with optional `momentum`, `nesterov: false` (reserved), `dampening: 0`
  (reserved). When `optimizer_config.name === "sgd_momentum"`, the
  engine computes the classical PyTorch-style recurrence: `buffer_after
  = mu * buffer_before + gradient`, `update = lr * buffer_after`
  (descent direction), `weight_after = weight_before + update` (no
  AdamW-style decoupled-decay branch — sgd_momentum + weight_decay
  rejected at boundary). Engine identity stays `"backprop-trace-engine@
  0.6.0"` (additive optimizer dispatch; existing SGD/Adam/AdamW math
  unchanged; v0.1-v0.9.1 receipts byte-equal).
- **`assertOptimizerConfig` sgd_momentum branch** with loud rejection of:
  - `nesterov === true` (deferred to v0.9.3 — clear "Nesterov
    accelerated gradient lookahead form" message citing Sutskever et al.
    2013 ICML §2)
  - `dampening !== 0` (deferred to v0.9.3 — clear "PyTorch's
    torch.optim.SGD(dampening=tau) recurrence" message)
  - `weight_decay !== undefined` (deferred to v0.10 — clear
    "PyTorch's torch.optim.SGD(weight_decay=lambda) applies COUPLED L2"
    message contrasting with AdamW's decoupled)
  - Adam fields (beta1/beta2/epsilon/t) present on sgd_momentum
    (cross-validation: belong to Adam family)
  - `momentum` missing (REQUIRED for sgd_momentum)
  - `momentum` not in (0, 1) (Sutskever 2013 / PyTorch default 0.9)
- **`runBatchedGeneralStep` sgd_momentum guard** — batched sgd_momentum
  rejected with clear "deferred" message (parallel to v0.9.1's batched
  Adam rejection); single-sample sgd_momentum works via the unbatched
  path.
- **Rule 21** (`src/reconcile.ts`):
  `checkRule21SgdMomentumRecurrence`. Sub-checks **21a** (`buffer_after
  == momentum * buffer_before + gradient`; Sutskever et al. 2013 ICML /
  PyTorch `torch.optim.SGD` reference; Polyak 1964 heavy-ball foundation;
  `lr` OUTSIDE the buffer so LR schedules don't retroactively rescale
  history) AND **21b** (`update == learning_rate * buffer_after`;
  descent direction; sign already in `gradient`). GATED on
  `optimizer.name === "sgd_momentum"`. Failure messages explicitly
  cite "classical PyTorch-style" + Sutskever/Polyak/PyTorch references
  + STRUCTURAL CHECK + Fang et al. 2023 PoL spoofing caveat.
- **Rule 20 generalization** — extends in place with sgd_momentum
  branches. Adds `isSgdMomentumUpdate` + `isOptimizerWithStateUpdate`
  helpers. Hyperparameter-presence checks dispatch on optimizer family
  (Adam: beta1/beta2/epsilon/t/weight_decay-for-adamw; sgd_momentum:
  momentum + reserved nesterov/dampening + rejected weight_decay).
  State-shape checks dispatch on optimizer.name: Adam/AdamW gets
  AdamState ({m, v}); sgd_momentum gets MomentumState ({buffer}).
  Cross-shape mismatch (e.g., AdamState shape on sgd_momentum optimizer)
  fires loudly.
- **Rule 25 generalization** — multi-step optimizer-state chain now
  branches on optimizer.name. Adam/AdamW path preserves byte-identical
  v0.9.1 behavior (m + v continuity + t monotonicity). sgd_momentum
  path checks buffer continuity (no t — momentum has no timestep
  field). Bad fixture: `momentum-multi-step.bad-stale-buffer`.
- **Rule 26 generalization** — per-optimizer constancy key list dispatch
  on `optimizer_config.name`. Adam/AdamW: `{beta1, beta2, epsilon,
  weight_decay}`. sgd_momentum: `{momentum, nesterov, dampening}`.
  `name` always checked. `learning_rate` excluded (LR schedules
  legitimate); `t` excluded (Rule 25 handles for Adam; momentum has no
  t).
- **Rule 14 sgd_momentum-aware** — when receipt declares
  `optimizer_config.name === "sgd_momentum"`, Rule 14 re-runs
  `runGeneralStep` with the same momentum hyperparameter +
  per-update state_before; engine emits state_after; differential
  compares engine state_after.buffer against stored. Bad fixture:
  `momentum.bad-engine-recompute-disagrees-momentum` (Fang et al.
  2023 PoL spoofing analog).
- **Rule 5 confirmed gated off for sgd_momentum** (predicate `name
  !== "sgd"` already excludes it; Rule 21b takes over the update
  formula check).
- **No Rule 7 branch needed** for classical sgd_momentum — `weight_after
  = weight_before + update` (same as plain SGD/Adam). AdamW remains the
  only optimizer with a Rule 7 branch (decoupled-decay).
- **Classical SGD momentum good fixtures** in `fixtures/external/`:
  - `pytorch.sgd-momentum.{sidecar,golden}.jsonl` — single-step (Mazur
    2-2-2 topology, mu=0.9, zero-init buffer)
  - `pytorch.sgd-momentum.multi-step.{sidecar,golden}.jsonl` — 3-step
    exercising Rules 25 buffer chain + 26 config constancy + bundle binding
- **Momentum adversarial fixture plate** (6 bad fixtures) in `fixtures/bad/`:
  - `momentum.bad-coefficient-omitted.jsonl` → Rule 20 (`momentum`
    missing from optimizer_config; schema-bypass)
  - `momentum.bad-coefficient-swapped.jsonl` → Rule 21 (mu mutated
    0.9 → 0.99; source receipt is step_index=1 from multi-step golden
    so buffer_before is non-zero — at step 0 with buffer_before=0, mu
    has no effect on the recurrence)
  - `momentum.bad-formula-mismatch.jsonl` → Rule 21 (update mutated to
    Nesterov-like form; scope-agnostic phrasing — fixture survives the
    v0.9.3 Nesterov landing without rename)
  - `momentum-multi-step.bad-stale-buffer.jsonl` → Rule 25 (multi-step
    chain break, value-mutation flavor)
  - `momentum-multi-step.bad-buffer-drop.jsonl` → Rule 20 (multi-step
    chain break, structural drop flavor; schema-bypass)
  - `momentum.bad-engine-recompute-disagrees-momentum.jsonl` → Rule 14
    (load-bearing per Fang et al. 2023 PoL spoofing class; parallel to
    v0.9.1's adam.bad-engine-recompute-disagrees-adam fixture)
- **`schemas/receipt.v0.6.0.json` + `schemas/framework-trace.v0.5.0.json`
  subpath exports** in `package.json` exports map
  (`./schema/receipt-0.6.0`, `./schema/framework-trace-0.5.0`).
- **`bp` CLI** rule labels updated for Rule 21 with classical
  PyTorch-style framing + Sutskever 2013 / PyTorch torch.optim.SGD
  citation + STRUCTURAL CHECK / Fang 2023 PoL spoofing caveat
  (`src/bin/bp.ts` RULE_LABELS).
- **Tests**: `test/import-pytorch-momentum.test.ts` (engine unit tests
  for classical recurrence + parameter update + nesterov/dampening/
  weight_decay rejection at engine boundary + single-step + multi-step
  ingestion + sgd_momentum golden reconciliation + determinism
  round-trip) and `test/reconcile.bad-momentum.test.ts` (anti-circularity
  tests for each momentum bad fixture). 435 → 453 tests (+18, all
  passing).
- **Doctrine ratchet**: `FILENAME_KIND_TO_RULE` extended with 12
  momentum fixture entries (6 prefixed + 6 unprefixed for back-compat).
  `extractImplementedRules()` now expects Rules `[1..26]` (Rule 21
  ACTIVATED; was reserved in v0.9.1).

### Changed

- **`package.json` version 0.9.1 → 0.9.2.** Description rewritten:
  "26-rule reconciler" (was "25-rule"); mentions classical PyTorch-style
  SGD momentum with Sutskever 2013 reference; preserves Mid-v0 status
  flag (CPU-only, SGD/Adam/AdamW/sgd_momentum only; Nesterov +
  dampening + SGD coupled L2 explicitly deferred with target versions).
- **`docs/reconciliation.md`** — Quick-reference rule table updated:
  Rule 21 ACTIVATED ("classical PyTorch-style SGD momentum buffer
  recurrence + parameter update"); Rules 20, 25, 26 generalized
  descriptions. New "Classical PyTorch-style SGD momentum (v0.9.2)"
  section with explicit doctrine guardrail (Rule 21 is precisely scoped
  to CLASSICAL ONLY; future variants are deferred, not bugs);
  Sutskever 2013 / PyTorch / Polyak 1964 citations; sign convention
  + lr-outside-buffer rationale. Adam-rule trust-framing extended to
  include Rule 21.
- **`docs/schema.md`** — Added "v0.9.2 FORCED bump to receipt.v0.6.0 +
  framework-trace.v0.5.0 (classical PyTorch-style SGD momentum)"
  section documenting the closed-enum + new state-shape rationale.
- **`SHIP_GATE.md`** — "Optimizers beyond vanilla SGD" gap marked
  MOSTLY CLOSED in v0.9.2 (Adam/AdamW v0.9.1 + classical sgd_momentum
  v0.9.2). New "Nesterov accelerated gradient + dampening" row added
  with v0.9.3 target + schema-slot-reservation note.
- **`README.md`** — Status line, 30-second quickstart, 26-rule table
  (was 25), Trust-framing caveat extended to Rule 21, What's-not-in-
  this-version Adam/momentum entries updated, new Nesterov-deferred
  entry.
- **Schema-loader docstrings** (`src/schema-loader.ts`) —
  `SCHEMA_VERSIONS = ["0.1.0", "0.2.0", "0.3.0", "0.4.0", "0.5.0",
  "0.6.0"]`; `FRAMEWORK_TRACE_SCHEMA_VERSIONS = ["0.1.0", "0.2.0",
  "0.3.0", "0.4.0", "0.5.0"]`. Docstrings updated.
- **Validator dispatcher** (`src/validate.ts`) —
  `validateFrameworkTraceSidecar` recognizes
  `format: "framework-trace.v0.5.0"` and routes to the new validator.

### Notes (forward compatibility)

- **Nesterov accelerated gradient** is v0.9.3. Schema reserves
  `nesterov: { const: false }` so v0.9.3 just widens the const to
  `boolean`. Engine + Rule 21 + fixtures will gain a Nesterov branch
  (lookahead form `update = -lr * (mu * buf_after + gradient)`).
- **Dampening** is v0.9.3. Schema reserves `dampening: { const: 0 }`
  so v0.9.3 widens to `number` in `[0, 1)`. Recurrence becomes
  `buffer_t = mu * buffer_{t-1} + (1 - tau) * gradient`.
- **SGD coupled L2 weight decay** is v0.10. Rules 6/7 grow a third
  branch (sgd_momentum + weight_decay applies `grad ← grad + lambda *
  theta` BEFORE the buffer update — coupled L2 form, distinct from
  AdamW's decoupled). Touches Rule 4's factor narrative; needs its
  own slice.
- **AMSGrad / NAdam / RAdam / Lion** are v0.10+. AMSGrad's `max(v_t,
  v_{t-1})` projection doesn't fit Rule 4's `product(factors)`
  vocabulary; needs new rule design pass.
- **Batched sgd_momentum** is v0.9.x / v0.10 (same per-sample-runs-then-
  reduce gap that blocks batched Adam). Single-sample (batch.size=1)
  sgd_momentum works today via the unbatched path.

### Numbers

- 453 tests pass (was 435; +18 from new momentum test suites)
- typecheck + build green
- 9 src files modified (schema-loader, validate, general-engine, emit,
  reconcile, import-observer, bin/bp, package.json; schema-loader.test.ts
  + reconcile.doctrine.test.ts + import-pytorch-adam.test.ts updated)
- 2 new schema files (`schemas/receipt.v0.6.0.json` +
  `schemas/framework-trace.v0.5.0.json`)
- 2 new fixture files in `fixtures/external/` (sgd-momentum single-step
  + multi-step pairs = 4 actual files)
- 6 new fixture files in `fixtures/bad/` (momentum adversarial plate;
  with sibling meta files = 12 files)
- 2 new test files (`test/import-pytorch-momentum.test.ts` +
  `test/reconcile.bad-momentum.test.ts`)
- 2 new fixture-generation scripts
  (`scripts/generate-pytorch-momentum-fixtures.ts` +
  `scripts/generate-momentum-bad-fixtures.ts`)
- v0.1.0 through v0.9.2 fixtures remain byte-identical (SGD/Adam/AdamW
  goldens unchanged; sgd_momentum establishes a new lineage starting
  at v0.6.0 schema_version)

### What v0.9.2 does NOT do

- Does **not** promote to v1.0.0
- Does **not** ship Nesterov accelerated gradient (v0.9.3)
- Does **not** ship dampening (v0.9.3)
- Does **not** ship SGD coupled L2 weight decay (v0.10)
- Does **not** ship AMSGrad / NAdam / RAdam / Lion (v0.10+)
- Does **not** ship batched sgd_momentum (deferred)
- Does **not** ship live Python helpers (still hand-authored sidecars)
- Does **not** add new CLI verbs (sgd_momentum dispatch is sidecar-
  driven; same pattern as v0.9 batched + v0.9.1 Adam)
- Does **not** add a real-world fixture (Mazur 2-2-2 + softmax+CE remain
  the heroes; CNN / transformer-block deferred to v0.11)
- Does **not** add adopter validation (deferred to v0.12)
- Does **not** change SGD/Adam/AdamW byte-output (v0.1-v0.9.1 fixtures
  byte-equal under the v0.9.2 engine)

## [0.9.1] - 2026-05-18

The v0.9.1 Adam + AdamW wave. **Not a v1.0.0 promotion** — backprop-trace
remains mid-v0 (no momentum SGD yet, no live framework helpers, no real-
world fixture, no adopter validation). What v0.9.1 actually does: closes
the "SGD-only" gap named in v0.9.0's SHIP_GATE — Adam and AdamW receipts
now validate end-to-end (engine + reconciler + observer-mode ingestion +
multi-step state chain + bundle binding). AdamW adds decoupled weight
decay (Loshchilov & Hutter 2017 arXiv:1711.05101 Algorithm 2 line 12) —
**explicitly contrasted with coupled L2**, the most common AdamW porting
bug. Momentum SGD deferred to v0.9.2.

### Added

- **`receipt.v0.5.0` schema** (NEW file). FORCED bump over `receipt.v0.4.0`:
  the closed `Update.optimizer.name: ["sgd"]` enum + `Update.optimizer`
  `additionalProperties: false` block prevented in-place evolution.
  v0.5.0 widens `optimizer.name` to `["sgd", "adam", "adamw"]`, adds
  optional per-update `state_before` / `state_after` (Adam `m, v`), and
  adds optional top-level `optimizer_config` block (`name`, `learning_rate`,
  `beta1`, `beta2`, `epsilon`, `weight_decay?`, `t`). Conditional `if/then`
  requirements on optimizer_config + per-update state when name in
  `{adam, adamw}`. SGD-only receipts continue to declare `schema_version:
  "0.4.0"` (byte-equal preservation for v0.1-v0.9.0 fixtures).
- **`framework-trace.v0.4.0` schema** (NEW file). FORCED bump for the same
  reasons. Adds optional top-level `optimizer` block + per-update
  `state_before` / `state_after` + widened `optimizer.name` enum.
  v0.3.0 / v0.2.0 / v0.1.0 sidecars continue to validate against their
  own schemas unchanged. Importer dispatcher accepts all four versions
  on the multi-step path.
- **`runGeneralStep` Adam/AdamW dispatch** in `src/general-engine.ts`.
  New types: `OptimizerConfig`, `AdamState`. Extended `GeneralInput` with
  optional `optimizer_config` + `optimizer_state_before`. When
  `optimizer_config.name in {adam, adamw}`, the engine computes m, v,
  m_hat, v_hat per Kingma & Ba 2014 Alg 1, then `update = lr * m_hat /
  (sqrt(v_hat) + epsilon)` (epsilon OUTSIDE sqrt — PyTorch convention).
  AdamW additionally applies decoupled weight decay at the parameter
  step: `weight_after = (1 - lr*wd) * weight_before + update`. SGD
  receipts byte-equal to v0.1-v0.9.0; new `optimizer_config` block
  emitted ONLY for Adam/AdamW (preserves SGD byte-equality).
- **`runBatchedGeneralStep` Adam guard** — batched Adam/AdamW deferred to
  v0.9.x/v0.10 (per-sample-runs-then-reduce pattern doesn't fit the
  single-Adam-step-with-reduced-gradient shape); engine throws a clear
  error if both `batch` and Adam/AdamW are requested. SGD batched
  continues to work unchanged.
- **Rules 20 + 22 + 23 + 24 + 25 + 26** in `src/reconcile.ts`:
  - **Rule 20** — optimizer-state shape consistency (Adam/AdamW
    state_before/state_after presence + finiteness + optimizer_config
    hyperparameter presence + bounds). GATED on Adam-family updates.
  - **Rule 22** (22a + 22b) — Adam moment recurrences (Kingma & Ba 2014
    Alg 1 lines 9-10).
  - **Rule 23** — Adam bias correction + t consistency
    (`optimizer_config.t === step_index + 1` when both present;
    bias-correction divisor non-degeneracy).
  - **Rule 24** — Adam/AdamW parameter update (Kingma & Ba 2014 Alg 1
    line 13; pinned epsilon OUTSIDE sqrt — PyTorch convention; catches
    the famous TF/Keras epsilon-inside-sqrt porting bug).
  - **Rule 25** — multi-step optimizer-state chain (m/v continuity +
    t monotonicity across receipts in a bundle; analog of Rule 9 for
    optimizer state).
  - **Rule 26** — multi-step optimizer-config constancy
    (`name, beta1, beta2, epsilon, weight_decay` identical across
    bundle; `learning_rate` EXCLUDED for LR schedules; `t` EXCLUDED
    — Rule 25 handles it). Analog of Rule 10 for optimizer config.
- **Rules 6 + 7 AdamW branches** — when `update.optimizer.name === "adamw"`,
  `weight_after` (Rule 6) and `parameters_after[pid]` (Rule 7) are
  recomputed as `(1 - lr*wd) * weight_before + update` instead of
  `weight_before + update`. The decoupled-decay term is applied
  DIRECTLY to the parameter, NOT folded into the gradient (coupled L2
  is the alternative — explicitly rejected by the
  `fixtures/bad/adamw.bad-as-coupled-l2.jsonl` fixture). This is the
  load-bearing AdamW math distinction (Loshchilov & Hutter 2017 §2.1).
- **Rule 5 GATED OFF for non-SGD** — Adam/AdamW updates do NOT satisfy
  `update == lr * gradient` (Adam uses `lr * m_hat / (sqrt(v_hat) +
  epsilon)`). Rule 5 silently skips Adam/AdamW updates; Rule 24 takes
  over for the Adam-family update-formula check.
- **Rule 14 (engine-recompute differential) Adam-aware** — when receipt
  declares `optimizer_config.name in {adam, adamw}`, Rule 14 re-runs
  `runGeneralStep` with the same `optimizer_config` + per-update
  `state_before`, then compares engine `state_after` (m, v) against
  stored values. Catches the Fang et al. 2023 spoofing class where a
  malicious actor mutates `weight_after` while keeping internal
  arithmetic consistent. Bad fixture:
  `adam.bad-engine-recompute-disagrees-adam.jsonl`.
- **Adam + AdamW good fixtures** in `fixtures/external/`:
  - `pytorch.adam.{sidecar,golden}.jsonl` — single-step Adam (Mazur 2-2-2
    topology, 9 weights + 1 bias, t=1, zero-init moments)
  - `pytorch.adamw.{sidecar,golden}.jsonl` — single-step AdamW
    (weight_decay=0.01)
  - `pytorch.adam.multi-step.{sidecar,golden}.jsonl` — 3-step Adam
    exercising Rules 25 + 26 + bundle binding
  - `adam.reddi-2018-pathology.note.json` — positive-fixture
    documentation anchor (Reddi et al. 2018 ICLR convergence pathology
    is OUTSIDE verifier scope; rules check internal consistency, NOT
    optimizer convergence quality)
- **Adam adversarial fixture plate** (10 bad fixtures) in `fixtures/bad/`:
  - `adam.bad-bias-correction-omitted.jsonl` → Rule 24
  - `adam.bad-beta-swap.jsonl` → Rule 22
  - `adam.bad-epsilon-inside-sqrt.jsonl` → Rule 24
  - `adamw.bad-as-coupled-l2.jsonl` → Rule 7 (AdamW branch; cross-fires
    Rule 6, Rule 14)
  - `adam.bad-engine-recompute-disagrees-adam.jsonl` → Rule 14
    (load-bearing per Fang et al. 2023 PoL spoofing class)
  - `adam.bad-amsgrad-confusion.jsonl` → Rule 20
  - `adam.bad-zero-init-state-mismatch.jsonl` → Rule 22
  - `adam.bad-stale-moment-state.jsonl` → Rule 25 (multi-step)
  - `adam.bad-timestep-off-by-one.jsonl` → Rule 23 (per-receipt t check
    fires first; Rule 25's multi-step monotonicity check cross-fires)
  - `adam.bad-hyperparameter-inconstancy.jsonl` → Rule 26 (multi-step)
- **`schemas/receipt.v0.5.0.json` + `schemas/framework-trace.v0.4.0.json`
  subpath exports** in `package.json` exports map (`./schema/receipt-0.5.0`,
  `./schema/framework-trace-0.4.0`). Also fixes a v0.9.0 gap by adding
  the missing `./schema/framework-trace-0.2.0` + `./schema/framework-trace-0.3.0`
  subpath exports (the v0.2.0 + v0.3.0 schemas were bundled in `files:`
  but not exposed as subpath exports; fixed in v0.9.1).
- **`bp` CLI** rule labels updated for Rules 20-26 with honest Fang/PoL
  trust framing (`src/bin/bp.ts` RULE_LABELS).
- **Tests**: `test/import-pytorch-adam.test.ts` (Adam engine unit tests +
  Adam sidecar import + Adam multi-step + AdamW differs-from-Adam-by-decoupled-decay
  check) and `test/reconcile.bad-adam.test.ts` (anti-circularity tests
  for each Adam bad fixture). 413 → 435 tests (+22, all passing).
- **Doctrine ratchet**: `FILENAME_KIND_TO_RULE` extended with 11 Adam
  fixture entries. `extractImplementedRules()` now expects Rules
  `[1..26]` minus `21` (reserved for v0.9.2 momentum). Rule 21 stable
  numbering ensures momentum slots into v0.9.2 without renumbering
  Rules 22-26.

### Changed

- **`package.json` version 0.9.0 → 0.9.1.** Description rewritten:
  "25-rule reconciler" (was "19-rule"); mentions Adam + AdamW with
  decoupled weight decay explicitly contrasted with coupled L2;
  preserves Mid-v0 status flag (CPU-only, SGD/Adam/AdamW only;
  momentum + Nesterov + AMSGrad + per-parameter-groups + LR schedules
  + gradient clipping + mixed precision deferred).
- **`docs/reconciliation.md`** — Quick-reference rule table updated for
  Rules 20-26 + Rule 21 reserved note. Added "Adam-rule trust framing
  (load-bearing)" section (Fang et al. 2023 PoL spoofing class
  caveat) + "AdamW: decoupled weight decay, explicitly NOT coupled L2"
  section.
- **`docs/schema.md`** — Added "v0.9.1 FORCED bump to receipt.v0.5.0"
  section documenting why the v0.4.0 in-place additive path closed
  for Adam (closed `optimizer.name` enum + `additionalProperties:
  false` on `Update.optimizer`).
- **`SHIP_GATE.md`** — "Optimizers beyond vanilla SGD" gap marked as
  PARTIALLY CLOSED in v0.9.1 (Adam + AdamW shipped; momentum SGD
  deferred to v0.9.2 in a new row with Rule 21 reservation).
- **`README.md`** — Status line, 30-second quickstart, 25-rule table,
  Trust-framing caveat paragraph (per-step structural complement to
  PoL, not a replacement), What's-not-in-this-version Adam entry
  marked PARTIALLY CLOSED + new momentum-SGD-deferred entry.
- **Schema-loader docstrings** in `src/schema-loader.ts` —
  `SCHEMA_VERSIONS = ["0.1.0", "0.2.0", "0.3.0", "0.4.0", "0.5.0"]`;
  `FRAMEWORK_TRACE_SCHEMA_VERSIONS = ["0.1.0", "0.2.0", "0.3.0",
  "0.4.0"]`. Docstrings updated to describe the v0.5.0 + v0.4.0
  framework-trace additions.
- **Validator dispatcher** (`src/validate.ts`) — `validateFrameworkTraceSidecar`
  recognizes `format: "framework-trace.v0.4.0"` and routes to the new
  validator.
- **Engine identity** stays at `"backprop-trace-engine@0.6.0"` (the
  Adam additions are NEW math paths but they don't change SGD math;
  observer-mode receipts emitted by the importer keep the same engine
  identity for byte-equal preservation). Bump only when SGD math
  changes — Adam is additive surface area, not a SGD-math revision.

### Notes (forward compatibility)

- **Batched Adam** is deferred to v0.9.x / v0.10. The schema CAN
  represent it (`batch` + `optimizer_config` blocks coexist on
  receipt.v0.5.0), but the engine rejects the combination — batched
  Adam requires a reduced-gradient → single-Adam-step dispatch shape
  distinct from `runBatchedGeneralStep`'s per-sample subreceipt
  pattern. Single-sample (batch.size=1) Adam works today via the
  unbatched path.
- **Momentum SGD** is v0.9.2 — Rule 21 reserved. PyTorch convention
  `buffer_t = mu * buffer_{t-1} + gradient; update = -lr * buffer_t`.
  Rules 6 + 7 already accept any update value (SGD/Adam/AdamW dispatch
  is in place); momentum just adds Rule 21 + 1-2 new fixtures.
- **AMSGrad / NAdam / RAdam / Lion** — v0.10+. AMSGrad's `max(v_t,
  v_{t-1})` projection doesn't fit Rule 4's `product(factors)`
  vocabulary cleanly; needs a separate rule design pass.
- **Per-parameter-group hyperparameters** (PyTorch param_groups with
  different lr/wd per group) — v0.9.x. Schema currently assumes
  uniform optimizer per receipt; per-group would extend
  `optimizer_config` to allow `groups: [...]` instead of flat fields.
- **Learning rate schedules** (cosine, warmup) — trainer responsibility,
  not optimizer responsibility. The receipt records the EFFECTIVE
  lr at step t; how that number was scheduled is out of scope for
  the verifier surface.
- **Gradient clipping** (`max_norm` on gradient before optimizer step)
  — trainer responsibility. The receipt records the POST-CLIP
  gradient if clipping happened.
- **Mixed-precision (fp16/bf16) Adam state** — v0.10+. Binary64 scope
  is current Determinism Scope lock per `docs/computation-order.md`.

### Numbers

- 435 tests pass (was 413; +22 from new Adam test suites)
- typecheck + build green
- 9 new src files modified (schema-loader, validate, general-engine,
  emit, reconcile, import-observer, import-pytorch via shared core,
  bin/bp, package.json)
- 2 new schema files (`schemas/receipt.v0.5.0.json` +
  `schemas/framework-trace.v0.4.0.json`)
- 4 new fixture files in `fixtures/external/` (Adam + AdamW +
  Adam-multi-step + Reddi-pathology note)
- 10 new fixture files in `fixtures/bad/` (Adam adversarial plate)
- 2 new test files (`test/import-pytorch-adam.test.ts` +
  `test/reconcile.bad-adam.test.ts`)
- 2 new fixture-generation scripts (`scripts/generate-pytorch-adam-fixtures.ts`
  + `scripts/generate-adam-bad-fixtures.ts`)
- 22nd consecutive byte-identical fixture lineage from v0.1.0 forward
  (SGD goldens unchanged; Adam goldens establish a new lineage starting
  at v0.5.0 schema_version)

### What v0.9.1 does NOT do

- Does **not** promote to v1.0.0
- Does **not** ship batched Adam/AdamW (engine rejects; deferred)
- Does **not** ship momentum SGD (v0.9.2)
- Does **not** ship Nesterov / AMSGrad / per-parameter-groups / LR
  schedules / gradient clipping / mixed precision (v0.10+)
- Does **not** ship live Python helpers (still hand-authored sidecars)
- Does **not** add new CLI verbs (Adam dispatch is sidecar-driven, same
  pattern as v0.9 batched dispatch)
- Does **not** add a real-world fixture (Mazur 2-2-2 + softmax+CE
  remain the heroes; CNN / transformer-block deferred to v0.11)
- Does **not** add adopter validation (deferred to v0.12)
- Does **not** change SGD byte-output (v0.1-v0.9.0 fixtures byte-equal
  under the v0.9.1 engine)

## [0.9.0] - 2026-05-18

The v0.9 batched observer-mode ingestion wave. **Not a v1.0.0 promotion** —
backprop-trace remains mid-v0 (no Adam, no live framework helpers, no
real-world fixture, no adopter validation). What v0.9.0 actually does:
closes the "single-sample only" gap named in v0.8's SHIP_GATE — external
framework traces can now be batched.

### Added

- **`framework-trace.v0.3.0` schema** (NEW file). Additive in spirit over
  v0.2.0 but a hard schema bump because the `format` const + root
  `additionalProperties: false` make additive evolution impossible on the
  same major. Adds optional `batch` block (size, sample_order, reduction)
  + optional top-level `per_sample` block (per-sample inputs/targets/
  forward/loss) + extends `Loss` with optional `reduction` + `per_sample`.
  v0.2.0 / v0.1.0 sidecars continue to validate against their own schemas
  unchanged.
- **`receipt.v0.4.0` schema** additive extension (in-place; following v0.8
  precedent — see `docs/schema.md` compatibility note). New optional top-
  level `batch` + `per_sample` blocks; extended `Loss` with optional
  `reduction` + `per_sample` map. Existing single-sample receipts continue
  to validate byte-identically (the new fields are absent on v0.1-v0.8
  fixtures).
- **`runBatchedGeneralStep`** in `src/general-engine.ts`. Batched engine
  entry point: orchestrates N runs of `runGeneralStep` (one per sample
  in `batch.sample_order`) against shared `parameters_before`, then
  reduces per-sample losses + gradients per `batch.reduction` and
  produces a single batched receipt with canonical per-sample structure.
  Same sign convention as `runGeneralStep` (`update = lr * gradient`,
  `weight_after = weight_before + update`; gradient in descent direction).
- **Batched dispatch in `buildObserverReceiptFromSidecar` and
  `buildObserverReceiptStreamFromSidecar`** (`src/import-observer.ts`).
  Detects sidecars by the presence of the top-level `batch` block and
  dispatches to `runBatchedGeneralStep` instead of `runGeneralStep`.
  Per-sample forward / loss differential check (vs the load-bearing
  single-sample diff check for unbatched). Per-framework subcommand
  discipline preserved.
- **Rule 18 (Batch reduction consistency)** in `src/reconcile.ts`. GATED
  on `receipt.batch` presence + `loss.reduction` in {`mean`, `sum`}.
  Asserts `loss.total == reduction(loss.per_sample.values(),
  batch.reduction)`. Catches the canonical mean-vs-sum confusion attack.
- **Rule 19 (Sample-set coherence, precisely scoped)** in
  `src/reconcile.ts`. GATED on `batch.sample_order` presence. Per the
  v0.9 lock: "every ordered per-sample projection used for reduction,
  emission, or canonical digest construction must be derived by iterating
  exactly that order. Missing, duplicate, or out-of-order sample IDs
  fail." Concretely: per-sample map key sets MUST equal `batch.sample_order`
  set. Rule 19 is defense-in-depth; schema's `uniqueItems` on
  `batch.sample_order` is the first line of defense.
- **`fixtures/external/pytorch.softmax-ce.batched.{sidecar,golden}.jsonl`**
  — canonical 1-step × 4-sample PyTorch softmax+CE SGD batched trace.
- **`fixtures/external/pytorch.softmax-ce.multi-step-batched.{sidecar,golden}.jsonl`**
  — canonical 2-step × 4-sample PyTorch trace; demonstrates the
  end-to-end pipe `bp import pytorch multi <file> | bp verify multi -`
  with batching active across multiple steps + bundle binding (Rule 17).
- **4-fixture batched bad-fixture plate** under `fixtures/bad/`:
  - `batch.bad-reduction-mode-mismatch.jsonl` → Rule 18 (loss.total claims
    `mean` but emits `sum(per_sample)`)
  - `batch.bad-sample-id-missing.jsonl` → Rule 19 (per-sample map missing
    a sample_id declared in batch.sample_order)
  - `batch.bad-sample-order-duplicate.jsonl` → Rule 19 / Rule 0 (schema
    `uniqueItems` rejects at validation; Rule 19 defense-in-depth catches
    at reconcile if schema validation is bypassed)
  - `batch.bad-reduced-gradient-wrong.jsonl` → Rule 14 (existing engine-
    recompute differential generalizes to batched receipts without change
    — proves the v0.6 doctrine "existing rules generalize" holds)
- **`scripts/generate-pytorch-batched-softmax-ce-fixtures.ts`** and
  **`scripts/generate-batch-bad-fixtures.ts`** — reproducible generators.
- **`test/import-pytorch-batched.test.ts`** (~15 tests) — byte-equal
  round-trip on both good fixtures, schema validation, reconcile cleanup,
  batch invariants, runBatchedGeneralStep unit tests (rejects duplicate
  sample_id, rejects per_sample missing declared sample_id), CLI
  end-to-end, end-to-end pipe `bp import pytorch multi <batched> | bp
  verify multi -`.
- **`test/reconcile.bad-batch.test.ts`** (~5 tests) — each bad fixture
  fires its targeted rule; counter-positive sanity that the canonical
  golden reconciles cleanly with no false positives from Rules 18 + 19.
- **Library re-exports**: `runBatchedGeneralStep` + `BatchedGeneralInput`
  type from `./general-engine` (no new subpath needed — existing exports
  cover them).

### Changed

- **`src/general-engine.ts` `GeneralReceipt` type** — additive optional
  fields: `batch?: { size, sample_order, reduction }`, `per_sample?: {
  [sample_id]: { inputs, targets, forward, loss } }`, `loss.per_sample?:
  Record<string, number>`, `loss.reduction?: "mean" | "sum" | "none"`.
  No existing field shapes changed; v0.1-v0.8 receipts continue to type-
  check identically.
- **`src/emit.ts` `emitGeneralReceipt`** — emits optional `batch` and
  `per_sample` blocks at their x-order positions; emits optional `loss.
  per_sample` + `loss.reduction` when present. Unbatched receipts (no
  `batch` block) emit byte-identically to v0.8.
- **`src/import-observer.ts`** — `FrameworkTraceSidecar` type widened to
  accept v0.1.0 / v0.2.0 / v0.3.0 + optional `batch` / `per_sample`
  fields. `buildObserverReceiptFromSidecar` and
  `buildObserverReceiptStreamFromSidecar` dispatch per-record on `batch`
  presence. `source_format` in `attestor.import_provenance` now mirrors
  the sidecar's actual format const (no longer hardcoded).
- **`src/reconcile.ts` Rule 12 (loss formula consistency)** — now SKIPS
  for batched receipts. Top-level loss.per_output / loss.total are
  batch-REDUCED; deriving expected values from top-level forward + targets
  (FIRST-SAMPLE only by canonical convention) would produce single-sample
  values that don't match reduced claims. Rule 18 handles batched loss
  reduction; per-sample loss formula correctness is verified by Rule 14
  (engine recompute) per sample.
- **`src/reconcile.ts` Rule 14 (engine-recompute differential)** — now
  BATCH-AWARE. When `receipt.batch` is present, dispatches to
  `runBatchedGeneralStep` instead of `runGeneralStep`; engine recomputes
  per-sample state via the receipt's `per_sample` data and reduces
  gradients. Rule shape unchanged; engine is batch-aware internally.
- **`src/schema-loader.ts`** — `FRAMEWORK_TRACE_SCHEMA_VERSIONS` extended
  to `["0.1.0", "0.2.0", "0.3.0"]`.
- **`src/validate.ts`** — framework-trace dispatcher recognizes
  `"framework-trace.v0.3.0"` format const.
- **`src/bin/bp.ts` `RULE_LABELS`** — Rules 18 + 19 labels added (with
  precise scoping for Rule 19).
- **`src/bin/bp.ts` `bp import` overview help** — extended to note
  batched sidecars are accepted by the existing subcommands (no new CLI
  surface; batched is a sidecar field).
- **README** — status banner drops "single-sample"; tagline + "What
  this is" updated to 19 rules; CLI usage table updated to note batched
  sidecars; "Bring your own training trace" extended with **"Batched
  ingestion (v0.9+)"** subsection covering sidecar format, top-level
  field semantics for batched receipts, CLI, Rules 18 + 19, and what
  v0.9.0 explicitly does NOT include (per-sample gradients, Adam,
  heterogeneous batch sizes); "The 17 rules" → "The 19 rules" table with
  Rules 18 + 19 rows; Determinism scope adds new batched goldens;
  "What's not in this version (yet)" REMOVES "Batch dimension" bullet
  (shipped) and ADDS two new gaps: per-sample gradients (v0.9.x/v0.10),
  heterogeneous batch sizes across steps (out of scope, may stay).
- **`docs/multi-step.md`** — extended with a full "Batched ingestion
  (v0.9+)" section covering sidecar format, intra-stream invariants,
  top-level field semantics, Rule 18 + Rule 19 precisely-scoped framing,
  adversarial fixture plate.
- **`docs/cli.md`** — annotated existing `bp import * <sidecar>` and
  `bp import * multi <sidecar>` rows to note batched (v0.3.0) sidecars
  are accepted.
- **`docs/reconciliation.md`** — quick-reference table extended to 19
  rules with Rule 17, 18, 19 statements added.
- **`docs/schema.md`** — NEW compatibility note explaining the in-place
  additive evolution discipline for `receipt.v0.4.0`: older package
  versions that vendor the schema independently may reject v0.9 batched
  receipts until upgraded. v0.8's `bundle_root_digest` + v0.9's `batch`
  / `per_sample` additions both follow this pattern. Strict closed-shape
  evolution (v0.5.0 bump on every additive change) is the alternative
  discipline; the v0.8 + v0.9 decision was to defer the bump until a
  load-bearing reason (likely v0.9.1 Adam) forces it.
- **`package.json`** — version 0.9.0; description updated ("17-rule" →
  "19-rule"; "single-step or multi-step" → "single-step or multi-step,
  batched or unbatched").
- **`test/reconcile.doctrine.test.ts`** — `FILENAME_KIND_TO_RULE` gains
  4 new entries for the batched plate. Implemented-rules assertion bumped
  from `[1..17]` to `[1..19]`. Test description updated to name Rules 18
  + 19 with their gating + precise scoping.

### Tests

- 396 → 413 total (+17 v0.9 tests across `test/import-pytorch-batched.test.ts`
  and `test/reconcile.bad-batch.test.ts`). 413 pass / 0 fail / 0 skip.
- All v0.1-v0.8.0 fixtures byte-identical.
- Engine identity stays at `backprop-trace-engine@0.6.0` (engine math
  unchanged; v0.9 wraps `runGeneralStep` in `runBatchedGeneralStep` for
  the batched path; per-sample engine math is identical to v0.6).

### Migration notes (v0.8.0 → v0.9.0)

- **Pure additive on engine semantics for single-sample receipts.** v0.1-
  v0.8 unbatched receipts byte-identical; v0.8 multi-step unbatched
  receipts byte-identical. Batched receipts are NEW.
- **Schema additivity (in-place on receipt.v0.4.0)**: existing v0.4.0
  receipts validate unchanged. New `batch` / `per_sample` / `loss.
  reduction` / `loss.per_sample` fields are optional. Consumers vendoring
  the schema independently and pinned to v0.8's schema copy will reject
  v0.9 batched receipts as having unknown properties — see
  `docs/schema.md` compatibility note. Upgrade vendored schemas.
- **Framework-trace v0.3.0 is a hard new schema** (the `format` const +
  `additionalProperties: false` make additive evolution impossible on
  the same major). v0.1.0 / v0.2.0 sidecars continue to validate against
  their own schemas. The importer dispatches on the `format` const.
- **CLI**: zero new subcommands. Existing `bp import {pytorch,jax,
  tensorflow}` and `bp import {pytorch,jax,tensorflow} multi` subcommands
  detect batched sidecars by the presence of the top-level `batch` block.
- **Reconciler**: Rules 12 and 14 changed BEHAVIOR (skip / dispatch on
  `batch` presence). v0.1-v0.8 receipts (no batch) are unaffected. New
  Rules 18, 19 are GATED on `batch` / `batch.sample_order` presence and
  do not fire on unbatched receipts.
- **Library API**: `runBatchedGeneralStep` + `BatchedGeneralInput` type
  newly exported from `./general-engine`. All additive.

### Not in v0.9.0 (still v1.0 blockers — see SHIP_GATE.md)

- **Optimizers beyond vanilla SGD** (Adam, AdamW, momentum) — v0.9.1.
  Adam adds new closed-shape `Update.optimizer.{name, hyperparameters,
  state_before, state_after}` fields and is likely to force a `receipt.v0.5.0`
  schema bump.
- **Per-sample gradients in batched receipts** — v0.9.x / v0.10. v0.9.0
  ships reduced gradients only.
- **Heterogeneous batch sizes across steps** — out of scope, may stay.
- **Live framework helpers** (`pip install backprop-trace-pytorch`) — v0.10.
- **Real-world fixture** (CNN, transformer block) — v0.11.
- **Adopter validation** — before any v1.0 promotion.
- **Producer-identity binding for multi-step traces** — Rule 17 is
  integrity-only; signature layer is downstream operator work.
- **Heterogeneous multi-framework traces** — out of scope, may stay.
- **GPU determinism** — out of scope (permanent).

### Release discipline

- No git tag (untagged main commit).
- No npm publish.
- No GitHub release.
- No translations.

Per standing user constraint: tagging now would risk reintroducing the
"release equals promotion" pressure v0.7 explicitly corrected. v0.9.0 is
a substantive product slice (single-sample → batched closes the cold-user
adoption killer), not a v1.0 promotion. Translations will re-run when a
tag-bearing release is authorized.

## [0.8.0] - 2026-05-18

The v0.8 multi-step observer-mode ingestion wave. **Not a v1.0.0
promotion** — backprop-trace remains mid-v0 (single-sample, SGD-only,
hand-authored sidecars, no live framework helpers, no real-world fixture,
no adopter validation). What v0.8 actually does: closes the first v1.0
product-completeness gap named in v0.7's SHIP_GATE — external ingestion
is no longer single-step only.

### Added

- **`framework-trace.v0.2.0` schema** (NEW file). Additive over v0.1.0
  in spirit but a hard schema bump because the `format` const + root
  `additionalProperties: false` make additive evolution impossible on
  the same major. Adds optional `trace_id` (32-char hex, W3C
  TraceContext shape) + `step_index` (integer ≥0) + a co-presence
  `allOf`/`anyOf` guard mirroring receipt.v0.4.0's pattern. v0.1.0
  sidecars continue to validate against v0.1.0 unchanged.
- **`receipt.v0.4.0` schema** additive extension — optional
  `attestor.bundle_root_digest` field (sha256 hex). Gates Rule 17.
  Existing v0.4.0 receipts (single-step observer-mode v0.6/v0.7) remain
  byte-identical because the field is optional.
- **`buildObserverReceiptStreamFromSidecar`** shared core in
  `src/import-observer.ts`. Pipeline:
  1. Hash whole sidecar JSONL bytes BEFORE parsing → `source_hash`.
  2. Split + parse + validate each record against framework-trace.v0.2.0
     (dispatched on `format` const).
  3. Assert intra-stream homogeneity (matching `source_framework.name +
     version` across records; `trace_id` co-presence; `step_index` dense
     + monotonic from 0).
  4. Per-step engine recompute via `runGeneralStep` + Rule 14
     differential check.
  5. Two-pass canonical emit: strip-then-rehash to compute
     `bundle_root_digest`, embed on every receipt, re-emit.
- **Per-framework multi-step wrappers** — `importPytorchSidecarStream`
  (`src/import-pytorch.ts`), `importJaxSidecarStream`
  (`src/import-jax.ts`), `importTensorflowSidecarStream`
  (`src/import-tensorflow.ts`). Each is a thin delegate over the shared
  core; each enforces per-framework subcommand discipline (rejects
  sidecars whose `source_framework.name` does not match expected).
- **`bp import {pytorch,jax,tensorflow} multi <sidecar.jsonl>`** CLI
  subnouns (parallel to `bp verify multi`). Exit codes 0 / 1 / 2 / 3
  with explicit per-step + aggregate differential semantics. Documented
  in `bp import <framework> multi --help` and in the `bp import`
  overview help.
- **Rule 17 (Trace-bundle binding, GATED)** in `src/reconcile.ts`.
  Fires only when `attestor.bundle_root_digest` is present on any
  receipt in a multi-record reconcile. Asserts (a) co-presence across
  receipts, (b) value consistency across receipts, (c) recompute matches
  via strip-then-rehash. Wired into `reconcileMultiStep` alongside
  Rules 9 + 10.
- **Honest Rule 17 framing throughout** — README "Bring your own
  training trace" subsection, `docs/multi-step.md` observer-mode
  subsection, `docs/cli.md` "Rule 17 — honest framing" subsection,
  Rule 17 failure-message text, schema docstring, TS type docstring,
  `bp import <framework> multi --help` text. All state explicitly:
  Rule 17 is **bundle integrity** (catches accidental splice / post-
  binding mutation / inconsistent bundle roots when the digest is not
  recomputed), NOT producer authenticity. An attacker who controls all
  receipt bytes AND recomputes the bundle digest passes Rule 17
  trivially. For producer-identity binding, combine with Rule 16
  `signed_subject_digest` or an external signature.
- **`fixtures/external/pytorch.softmax-ce.multi-step.{sidecar,golden}.jsonl`**
  — canonical 3-step PyTorch softmax+CE SGD trace. 3 records in the
  sidecar; 3 receipts in the golden. Loss does NOT converge (3 steps on
  a 2-2-3 network is pedagogical, not real training).
- **5-fixture multi-step bad-fixture plate** under `fixtures/bad/`:
  - `multi-step-external.bad-step-index-gap.jsonl` → Rule 10
  - `multi-step-external.bad-chain-break-cross-step-internally-consistent.jsonl` → Rule 9 (load-bearing: per-step Rule 14 still passes; chain breaks)
  - `multi-step-external.bad-fabricated-mid-step.jsonl` → Rule 9
  - `multi-step-external.bad-cross-trace-splice.jsonl` → Rule 17 (recompute mismatch)
  - `multi-step-external.bad-bundle-digest-tampered.jsonl` → Rule 17 (value-consistency)
- **`scripts/generate-pytorch-multi-step-softmax-ce-fixtures.ts`** and
  **`scripts/generate-multi-step-external-bad-fixtures.ts`** —
  reproducible generators. Re-runs produce byte-identical fixtures.
- **`test/import-pytorch-multi-step.test.ts`** — multi-step round-trip
  byte-equality, schema validation, reconcile cleanup, per-framework
  discipline 3-way matrix on streams, format-const dispatch, CLI
  end-to-end. ~13 new tests.
- **`test/reconcile.bad-multi-step-external.test.ts`** — each bad
  fixture asserts its targeted rule fires; Rule 17 fixtures also assert
  the diagnostic message contains the honest bundle-integrity caveat.
  ~6 new tests.
- **`test/cli.multi-step-import-pipe.test.ts`** — end-to-end
  `bp import pytorch multi <good> | bp verify multi -` produces exit 0;
  each bad fixture produces exit 1 through `verify multi`. ~3 new tests.
- **Library re-exports** — `importPytorchSidecarStream` /
  `importJaxSidecarStream` / `importTensorflowSidecarStream` /
  `buildObserverReceiptStreamFromSidecar` + their option/result types
  from package root.

### Changed

- **`emit.ts`** — `emitAttestor` now emits `bundle_root_digest` at the
  end of the attestor x-order (after `signed_subject_digest`).
  Backward-compat: omitting the field produces byte-identical output to
  v0.7.
- **`reconcile.ts`** — `reconcileMultiStep` now invokes Rule 17 after
  Rule 10. Single-record `reconcileReceipt` is unchanged (Rule 17 does
  not fire on single records).
- **`general-engine.ts`** — `Attestor` type gains optional
  `bundle_root_digest?: string`. `GeneralReceipt.step` widened from
  literal `1` to `number` so multi-step receipts can carry
  `step = step_index + 1`. Engine-authored single-step receipts still
  hardcode `step: 1`; no observable behavior change for existing
  callers.
- **`bp.ts` top-level `bp --help`** — header bumped to 19 subcommands.
  3 new rows for `bp import {pytorch,jax,tensorflow} multi`. Existing
  single-step rows annotated "single-step" for clarity. `bp import`
  overview help reformatted to show single-step + multi-step as
  parallel rows with version markers.
- **`bp.ts` RULE_LABELS** — added Rule 17 label with the explicit
  bundle-integrity-NOT-producer-authenticity caveat baked in.
- **README** — tagline updated ("17-rule reconciler"; "single" dropped
  from the framing); status banner bumped to v0.8.0; "What this is"
  para describes multi-step observer-mode ingestion explicitly + the
  caveat that it does NOT validate the overall training run; CLI usage
  table grew to 19 rows; "Bring your own training trace" section
  extended with "Multi-step ingestion (v0.8+)" subsection and the
  honest Rule 17 framing; "The 17 rules" table (was 16) with Rule 17
  row including the inline NOT-a-producer-authenticity caveat;
  Determinism scope adds `pytorch.softmax-ce.multi-step.golden.jsonl`;
  "What's not in this version (yet)" REMOVES the multi-step bullet
  (shipped) and ADDS two new gaps: heterogeneous multi-framework traces
  + producer-identity binding (Rule 17 is integrity-only).
- **`docs/multi-step.md`** — extended with a full "Observer-mode
  multi-step (v0.8+)" section covering the sidecar format, intra-stream
  invariants, importer output shape, verification flow, Rule 17 honest
  framing, and the adversarial fixture plate.
- **`docs/cli.md`** — 3 new rows in the subcommand summary; new
  "Subcommand: `bp import <framework> multi` (v0.8+)" section; Rule 17
  honest-framing subsection.
- **`package.json`** — version 0.8.0; description rewritten ("single"
  dropped; multi-step + bundle-integrity language added); new
  `./import-tensorflow` was already present from v0.7.0 (multi-step
  pathway shares per-framework subpath modules — no new subpath
  exports needed in v0.8).
- **`test/reconcile.doctrine.test.ts`** — `FILENAME_KIND_TO_RULE` gains
  5 new entries for the multi-step plate. Implemented-rules assertion
  bumped from `[1..16]` to `[1..17]`. Test description updated to name
  Rule 17 with the bundle-integrity caveat.
- **`test/import-jax.test.ts`** + **`test/import-tensorflow.test.ts`**
  — overview-marker regex updated from `shipped vX.Y.Z` to
  `single-step (vX.Y.Z)` to match the reformatted `bp import` overview.

### Tests

- 396 → 396 total. Net +18 v0.8 tests across 3 new test files; -2
  obsolete marker-text assertions updated in-place. 396 pass / 0 fail /
  0 skip.
- All v0.1-v0.7.0 fixtures byte-identical.
- Engine identity stays at `backprop-trace-engine@0.6.0` (engine math
  unchanged; v0.8 adds only the multi-step ingestion path + Rule 17 +
  fixtures + docs).

### Migration notes (v0.7.0 → v0.8.0)

- **Schema additivity**: existing v0.4.0 receipts validate unchanged
  (the new `attestor.bundle_root_digest` field is optional). Existing
  framework-trace.v0.1.0 single-step sidecars validate unchanged. The
  multi-step path requires `framework-trace.v0.2.0`.
- **CLI**: the single-step `bp import {pytorch,jax,tensorflow} <file>`
  path is unchanged. The new `bp import {pytorch,jax,tensorflow} multi
  <file>` path is opt-in via the `multi` subnoun.
- **Reconciler**: `reconcileReceipt` (single-record) is unchanged.
  `reconcileMultiStep` (multi-record) now also runs Rule 17 — but Rule
  17 is GATED on `attestor.bundle_root_digest` presence, so v0.6/v0.7
  multi-step receipts without the field continue to reconcile as
  before (Rule 17 silently skips).
- **Library API**: 4 new exports (`importPytorchSidecarStream`,
  `importJaxSidecarStream`, `importTensorflowSidecarStream`,
  `buildObserverReceiptStreamFromSidecar`) + 6 new types. All additive.

### Not in v0.8 (still v1.0 blockers — see SHIP_GATE.md)

- Optimizers beyond SGD (Adam, AdamW, momentum, weight decay) — v0.9.
- Batch dimension — v0.9.
- Live framework helpers (`pip install backprop-trace-pytorch`) — v0.10.
- Real-world fixture (CNN, transformer block) — v0.11.
- Adopter validation — before any v1.0 promotion.
- Producer-identity binding for multi-step traces (Rule 17 is
  integrity-only; signature layer is downstream operator work) —
  documented as a gap; built-in operator surface may follow.
- Heterogeneous multi-framework traces — out of scope, may stay.
- GPU determinism — out of scope (permanent).

### Release discipline

- No git tag (untagged main commit).
- No npm publish.
- No GitHub release.
- No translations.

Per standing user constraint: tagging now would risk reintroducing the
"release equals promotion" pressure v0.7 explicitly corrected. v0.8 is
a substantive product slice, not a v1.0 promotion. Translations will
re-run when a tag-bearing release (post-v1.0 product gaps closing) is
authorized.

## [0.7.0] - 2026-05-17

The v0.7.0 release-readiness slice. **Not a v1.0.0 promotion** — see
SHIP_GATE.md "Product-completeness gaps blocking v1.0.0" for the
multi-step / Adam / batching / live-helper / real-world-fixture /
adopter-validation work that must close before any v1.0 promotion.
What v0.7.0 actually does:

- **TensorFlow adapter.** Third framework adapter on the v0.6 framework-
  trace pattern; same shared `buildObserverReceiptFromSidecar` core; no
  new schema, no new rule, no new trust model. Confirms the v0.6 pattern
  generalizes beyond two adapters.
- **README rewrite.** Out of the v0.4 frozen mental model; now reflects
  the v0.7.0 product truth (16 rules, softmax+CE, external trace
  ingestion, observer-mode receipts, PyTorch+JAX+TensorFlow). Explicit
  "Threat model" section. Honest "What's not in this version (yet)" section
  naming the v1.0 product-completeness gaps.
- **Shipcheck hard-gate closure.** B1 (Tier-1 structured error envelope),
  D1 (verify script), D3 (pnpm audit step in CI), C4 (--help spot-audit
  across the v0.7 surface).
- **Staleness sweep.** SECURITY.md supported-versions, CONTRIBUTING.md
  rule count (8 → 16 + doctrine-ratchet language), bp.ts header docstring,
  RULE_LABELS docstring, GH repo description + topics.
- **npm package description rewrite.** Replaced internal release-
  engineering paragraph with a cold-user-facing product description that
  states mid-v0 status up front.

### Added

- **`importTensorflowSidecar`** library API (`src/import-tensorflow.ts`).
  Third per-framework wrapper over `buildObserverReceiptFromSidecar`.
  Rejects sidecars whose `source_framework.name !== "tensorflow"`. Same
  `ObserverImportOptions` / `ObserverImportResult` shape as PyTorch + JAX.
- **`bp import tensorflow <sidecar.jsonl> [--out <file>] [--json]`** CLI
  subcommand. Identical ergonomics + exit codes to `bp import pytorch` /
  `bp import jax`. Replaces the v0.6.1-era exit-4 stub.
- **`fixtures/external/tensorflow.softmax-ce.sidecar.jsonl`** — canonical
  TensorFlow framework-trace sidecar. Different weights + sample
  (x1=0.75, x2=0.25, one-hot target class o3) + learning_rate (0.1) than
  the PyTorch / JAX fixtures so the TF golden is byte-distinct.
- **`fixtures/external/tensorflow.softmax-ce.golden.jsonl`** — v0.4.0
  observer-mode receipt produced by `bp import tensorflow`. Reproducible
  via `scripts/generate-tensorflow-softmax-ce-fixtures.ts`.
- **`fixtures/bad/tensorflow.bad-variable-list-order.jsonl`** — single
  TensorFlow-distinctive bad fixture. Swaps `parameters_before.{w_x1_h1,
  w_x2_h1}` to mimic an extractor that sorted `model.trainable_variables`
  alphabetically by `var.name` (instead of preserving the stable creation
  order TF returns by default). Same failure shape as JAX's pytree-
  flatten-order, different root cause. Rule 14 (engine recompute) fires
  on `forward.h1.net`; Rule 7 (parameters_after consistency) also fires.
  No new rule needed.
- **`scripts/generate-tensorflow-softmax-ce-fixtures.ts`** +
  **`scripts/generate-tensorflow-bad-fixtures.ts`** — reproducible
  generators.
- **Library re-exports**: `importTensorflowSidecar`,
  `ImportTensorflowOptions`, `ImportTensorflowResult` from package root +
  `./import-tensorflow` subpath.
- **`bp import tensorflow --help`** text with TF-distinctive authoring
  notes (variable list ordering, trainable vs non-trainable Variables,
  `tf.GradientTape` persistence, eager-vs-graph ULP drift, mixed-
  precision skew).
- **`verify` script** in `package.json`: `pnpm typecheck && pnpm test
  && pnpm build`. Single command for contributors.
- **`audit` script** + dedicated CI job: `pnpm audit
  --audit-level=moderate` runs on every push / PR. Closes shipcheck D3.
- **`test/cli.error-envelope.test.ts`** asserts the Tier-1 structured
  error envelope shape `{ok:false, error:{code, message, hint?, cause?,
  retryable?}}` under `--json`.
- **SHIP_GATE.md "Product-completeness gaps blocking v1.0.0" section** —
  the user-facing version of "v0.7.0 closes artifact hygiene but is NOT
  v1.0.0 ready."

### Changed

- **README.md** — full rewrite from v0.4 frozen surface to v0.7.0 product
  truth. Mid-v0 status banner. Tagline updated (Csmith/CompCert lineage).
  Three NOT-this comparisons by name (MLflow/W&B/TensorBoard, PoL/zkML
  with Fang 2023 forgery caveat, Sigstore model-signing/SLSA/CycloneDX
  ML-BOM). Dedicated Threat model section. 16-rule table. Bring-your-
  own-training-trace section honest about the hand-authored sidecar
  friction. What's not in this version (yet) section with roadmap-target
  versions for multi-step / Adam / batching / live helpers / real-world
  fixture / adopter validation.
- **`exitWithUsageError`** in `src/bin/bp.ts` — extended additively to
  support the Tier-1 shape via optional `opts.hint` / `opts.cause` /
  `opts.retryable`. Legacy callers (embed-Hint-in-message style) continue
  to work; ENOENT / EACCES / EISDIR / BP_JSONL_PARSE_ERROR / INVALID_JSON
  / IO_ERROR paths in `exitOnReadError` migrated to the structured shape
  as proof. Remaining call sites are an incremental v0.7.x task.
- **`bp.ts` header docstring** — v0.3-surface text → v0.7.0-surface text.
  RULE_LABELS docstring — "All 10 rules wired as of v0.3" → "All 16 rules
  wired as of v0.6". Top-level `bp --help` rewritten to include the
  `bp import` block and current rule range. Per-subnoun `--help` texts
  for `bp reconcile receipt`, `bp verify general`, `bp validate` updated
  for the v0.7.0 surface.
- **CONTRIBUTING.md** — "eight reconciler rules" → "sixteen reconciler
  rules"; doctrine-ratchet enforcement explicitly noted; naming-convention
  guidance generalized beyond the v0.2 `mazur.bad-rule-<N>.jsonl` form.
- **SECURITY.md** — supported-versions table refreshed from the stale
  "0.1.x yes" row to a real current/previous/best-effort window for the
  0.5.x → 0.7.x lines. Explicit pre-v1.0 disclosure.
- **`bp import` overview help** — `tensorflow` row flipped from "planned
  for v0.6.x" to "shipped v0.7.0". `importPytorchUsageText` exit-code 4
  description generalized from the now-stale "e.g. `bp import jax` in
  v0.6.0" reference to "Reserved: framework adapter declared but not
  implemented."
- **GitHub repo metadata** — description rewritten ("16 rules", external
  trace ingestion, mid-v0 disclosure); 8 new topics (softmax, cross-
  entropy, pytorch-import, jax-import, tensorflow-import, external-trace-
  ingestion, observer-mode-receipts, attestor); `proof-of-learning`
  dropped (technically misleading per the README's Fang 2023 PoL
  forgeability caveat).
- **`package.json`** — version 0.7.0; description rewritten out of
  internal release-engineering copy; `jax-import` + `tensorflow-import`
  added to keywords; new `./import-tensorflow` subpath export.
- **Doctrine ratchet test** (`test/reconcile.doctrine.test.ts`) —
  `FILENAME_KIND_TO_RULE` gains `bad-variable-list-order → 14` for the
  TensorFlow bad fixture.

### Tests

- 359 → 375 total (+16 v0.7.0 tests across `test/import-tensorflow.test.ts`,
  `test/reconcile.bad-tensorflow.test.ts`, `test/cli.error-envelope.test.ts`,
  minus 2 obsolete stub tests removed from `test/import-pytorch.test.ts`
  and `test/import-jax.test.ts`). 375 pass / 0 fail / 0 skip.
- New test categories:
  - TensorFlow importer round-trip byte-equality vs
    `tensorflow.softmax-ce.golden.jsonl`
  - Schema-validation + reconciliation on the TensorFlow observer-mode
    receipt
  - Per-framework subcommand discipline at the library layer (3-way
    refusal matrix: TF importer rejects PyTorch + JAX sidecars; PyTorch +
    JAX importers reject TF sidecar)
  - `bp import tensorflow` CLI end-to-end (succeeds on TF sidecar;
    rejects PyTorch and JAX sidecars with exit 2)
  - `tensorflow.bad-variable-list-order` fires Rule 14 on `forward.h1.net`
    + Rule 7 on the chain
  - Tier-1 structured error envelope shape under `--json` (ENOENT, EISDIR,
    USAGE; backward-compat for legacy callers without `opts.hint`)
- Pre-existing `error-messages.test.ts` updated: the v0.7.0 envelope
  migration moves "Hint:" out of `error.message` into the structured
  `error.hint` field, so the v0.6.x assertion that the message contains
  "Hint:" was inverted (now asserts message does NOT contain "Hint:" and
  hint is a structured field).
- All v0.1-v0.6.1 fixtures byte-identical. TensorFlow adapter shipped
  through the same shared `buildObserverReceiptFromSidecar` core that
  PyTorch and JAX use; engine identity stays at
  `backprop-trace-engine@0.6.0` (engine semantics unchanged — v0.7.0 adds
  only a third adapter wrapper + CLI dispatch + fixtures + docs).

### Migration notes (v0.6.1 → v0.7.0)

- **Pure additive on engine semantics.** Engine code unchanged. All
  engine-authored receipts byte-identical. PyTorch + JAX importer outputs
  byte-identical (the third adapter shares the same observer-mode core).
- **JSON error envelope shape.** Under `--json`, the `error` object now
  may include `hint` / `cause` / `retryable` as structured fields
  (Tier-1 shape). Existing consumers reading only `error.code` +
  `error.message` continue to work; the new fields are additive optional.
  Consumers that parsed "Hint: …" out of the `message` string for
  migrated callers (ENOENT/EACCES/EISDIR/BP_JSONL_PARSE_ERROR/
  INVALID_JSON/IO_ERROR) should switch to reading `error.hint` directly.
- **`bp import tensorflow`** now exits 0 / 1 / 2 / 3 on real import
  paths instead of the v0.6.1-era universal exit 4. CI consumers that
  tested "`bp import tensorflow exits 4`" as a smoke for adapter
  absence should update to exercise the real adapter, or remove the
  assertion.
- **Exit code 4** remains in the documented surface as RESERVED (for
  framework adapters declared but not implemented). No current code path
  returns it.
- **GitHub repo description + topics changed.** Tooling that scraped the
  repo metadata for the old "10 mathematical rules" phrasing should
  refresh.

## [0.6.1] - 2026-05-17

The JAX adapter pressure test on the v0.6 pattern. v0.6.0 shipped PyTorch
ingestion; v0.6.1 adds JAX with **no new trust model, no schema drift,
no new rule** — confirming the v0.6 framework-trace pattern generalizes.

### Added

- **`importJaxSidecar`** library API (`src/import-jax.ts`). Per-framework
  wrapper that rejects sidecars whose `source_framework.name !== "jax"`.
  Same `ObserverImportOptions` / `ObserverImportResult` shape as PyTorch.
- **`bp import jax <sidecar.jsonl> [--out <file>] [--json]`** CLI subcommand.
  Identical ergonomics + exit codes to `bp import pytorch`; only the
  per-framework `source_framework.name` discriminator differs.
- **`src/import-observer.ts`** — shared `buildObserverReceiptFromSidecar`
  core extracted from the v0.6.0 PyTorch importer. Both per-framework
  importers (Pytorch + JAX, future TensorFlow) delegate to this. Three
  framework-specific arguments: `expectedFrameworkName`, `defaultExtractorIdentity`,
  `callerLabel`. ~30 lines per new adapter going forward.
- **`fixtures/external/jax.softmax-ce.sidecar.jsonl`** — canonical JAX
  framework-trace sidecar. Different weights + sample (x1=0.5, x2=1.0,
  one-hot target class o2) + learning_rate (0.25) than the PyTorch fixture
  so the JAX golden is byte-distinct.
- **`fixtures/external/jax.softmax-ce.golden.jsonl`** — v0.4.0 observer-mode
  receipt produced by `bp import jax`. Reproducible via
  `scripts/generate-jax-softmax-ce-fixtures.ts`.
- **`fixtures/bad/jax.bad-pytree-flatten-order.jsonl`** — single JAX-specific
  bad fixture. Swaps `parameters_before.{w_x1_h1, w_x2_h1}` to mimic an
  extractor that flattened `jax.tree_util.tree_flatten(params)` in the
  wrong order. Rule 14 (engine recompute) fires on `forward.h1.net` because
  swapped weights propagate; Rule 7 (parameters_after consistency) also
  fires because the original (correct) updates don't reconcile with the
  swapped parameters_before. No new rule needed — Rule 14's differential
  catches the new mistake class.
- **`scripts/generate-jax-softmax-ce-fixtures.ts`** + **`scripts/generate-jax-bad-fixtures.ts`** — reproducible generators.
- **Library re-exports**: `importJaxSidecar`, `ImportJaxOptions`, `ImportJaxResult` from package root + `./import-jax` subpath. New `./import-observer` subpath for consumers building additional adapters.

### Changed

- **`src/import-pytorch.ts`** reduced to a thin wrapper over the shared core. Public API + observable behavior unchanged from v0.6.0; the PyTorch golden reproduces byte-identically through the refactored path (verified before commit).
- **`src/bin/bp.ts`** `runImportFramework` extracted as the shared CLI runner; `runImportPytorch` + new `runImportJax` are 1-line delegates. `bp import jax` now exits 0/1/2/3 (real import), no longer exits 4 (the v0.6.0 "planned for v0.6.x" stub). TensorFlow remains the exit-4 stub.
- **`bp import` overview help** + `bp import jax --help` text added.
- **`docs/cli.md`** — `bp import jax` row added to the subcommands table + JAX-specific authoring notes (pytree flatten, float32 drift, JIT fusion, vmap/scan/pmap) added under the import section.
- **Doctrine ratchet test** (`test/reconcile.doctrine.test.ts`) — `FILENAME_KIND_TO_RULE` gains `bad-pytree-flatten-order → 14`.
- **`package.json`** — version 0.6.1; new subpath exports for `./import-jax` and `./import-observer`.

### Tests

- 345 → 359 total (+14 v0.6.1 tests across `test/import-jax.test.ts` and `test/reconcile.bad-jax.test.ts`). 359 pass / 0 fail / 0 skip.
- New test categories:
  - JAX importer round-trip byte-equality vs `jax.softmax-ce.golden.jsonl`
  - Schema-validation + reconciliation on the JAX observer-mode receipt
  - Per-framework subcommand discipline at the library layer (`importJaxSidecar` rejects pytorch sidecars and vice versa)
  - `bp import jax` CLI end-to-end (succeeds on JAX sidecar; rejects PyTorch sidecar with exit 2)
  - `jax.bad-pytree-flatten-order` fires Rule 14 specifically on `forward.h1.net` + Rule 7 on the chain
- One test relabel: the v0.6.0 `bp import jax exits 4` assertion is updated to `bp import tensorflow exits 4` (tensorflow is the remaining unimplemented framework in v0.6.1).
- All v0.1-v0.6.0 fixtures byte-identical. Importer refactor preserves the v0.6.0 PyTorch golden through the new shared path (verified BEFORE commit; verifier identity stays at `backprop-trace-engine@0.6.0` because engine semantics are unchanged — engine identity is the semantic version of the deterministic verifier, NOT the npm package version).

### Migration notes (v0.6.0 → v0.6.1)

- **Pure additive on engine semantics.** Engine code unchanged. All
  engine-authored receipts byte-identical. PyTorch importer's public API
  + observable output byte-identical (the refactor's purpose was to share
  the import body with JAX without changing it).
- **`importPytorchSidecar` still exported under its v0.6.0 name** + type
  aliases (`ImportPytorchOptions`, `ImportPytorchResult`, `FrameworkTraceSidecar`)
  preserved. v0.6.0 consumers importing from `"@mcptoolshop/backprop-trace"`
  or `"@mcptoolshop/backprop-trace/import-pytorch"` continue to compile
  unchanged.
- **New optional `./import-jax` + `./import-observer` subpaths.** Consumers
  building additional adapters (e.g., a third-party `import-flax` package)
  can import `buildObserverReceiptFromSidecar` directly.
- **`bp import jax`** now ships (exit 0 on success, no longer exit 4).
  Consumers that previously hard-coded "`bp import jax` exits 4" should
  update.
- **No reconciler changes.** Rules 1-16 unchanged. JAX-specific extractor
  mistakes surface as existing-rule firings (Rule 14 catches pytree
  flatten swaps; Rule 7 catches downstream consistency; Rule 0.8 catches
  probability bound violations regardless of framework). The pressure
  test confirmed: v0.6 generalizes without weakening any defense.

### Out of scope (deferred by standing constraint or intent)

- **TensorFlow adapter** (`bp import tensorflow`) — planned for v0.6.x.
  Pattern is now proven by JAX; TensorFlow follows as another ~30-line
  wrapper.
- **Python helpers as separate npm packages** — v0.6.1 keeps the helper
  scripts documented (planned location: `scripts/python-helpers/dump_{pytorch,jax}_trace.py`).
  Promotion to separate npm scoped packages (`@mcptoolshop/backprop-trace-import-pytorch`,
  etc.) follows when user demand justifies the split.
- **Multi-step observer-mode receipts** — v0.6.1 still ships single-step
  only.
- npm publish / git tag / `gh release create` — user-deferred.
- Translations / landing / handbook — user-deferred.

---

## [0.6.0] - 2026-05-17

The external trace ingestion wave. Observer-mode receipts let foreign
frameworks (PyTorch / JAX / TensorFlow) become **evidence sources**
without becoming **trusted authorities**. The engine remains the verifier,
not a framework wrapper. v0.6.0 ships PyTorch ingestion; JAX + TensorFlow
follow as v0.6.x patches with the same shape.

Design decisions locked by the v0.6 study consolidator (5-agent dispatch
+ user greenlight before any code landed):
- **Trust model**: Rule 14 (engine-recompute differential) is **MANDATORY**
  for `external_imported` receipts, no-op for engine-authored. This is
  the load-bearing defense against collapsed-trace laundering. The
  importer's claim is not the verifier's truth — `bp verify general`
  re-runs the differential check independently.
- **Schema strategy**: bump to receipt **v0.4.0** (additive over v0.3.0).
  `source_framework` + `attestor` + extended `fixture_status` enums sit
  in receipt truth, not in a separate imported-receipt family. v0.3.0
  softmax+CE receipts continue to validate against v0.3.0 unchanged.
- **CLI shape**: per-framework subcommands (`bp import pytorch <file>`),
  NO auto-detection from file contents. SARIF Multitool / HF Optimum
  precedent — silent misdetection in a verifier defeats the purpose.
- **No live runtime dependency**: `bp` core does NOT import PyTorch / JAX
  / TensorFlow. The sidecar is plain JSON (no pickle, no protobuf, no
  binary). A Python helper for emitting sidecars from a PyTorch training
  loop is documented as a script, not shipped as a peer dep.

### Added

- **Schema `receipt.v0.4.0.json`** (additive over v0.3.0):
  - Optional top-level `source_framework` block: `{name (closed enum: pytorch | jax | tensorflow | hand_derived | backprop_trace_engine), version, information_uri?, extractor?}`.
  - Optional top-level `attestor` block: `{computed_by, verified_by, differential_tolerance, import_provenance?, skip_basis?, signed_subject_digest?}`. `computed_by` and `verified_by` are typed `AttestorIdentity` (`{kind: framework | engine | hand_derivation, identity}`) — the kind enum is the trust class, identity is the free-form URN/framework@version string.
  - `fixture_status.authoring_state` enum extended with `"external_imported"`.
  - `fixture_status.verification_state` enum extended with three external states: `"engine_recompute_matched_within_tolerance"`, `"engine_recompute_disagreed"`, `"engine_recompute_skipped_with_basis"`.
  - Receipt schema_version: `"0.4.0"`. v0.3.0 softmax+CE receipts continue to validate against v0.3.0 unchanged.

- **Schema `framework-trace.v0.1.0.json`** (NEW input-schema family — separate from receipt + topology-input):
  - The user-authored JSONL sidecar contract consumed by `bp import <framework>`. Carries `format` discriminator, `source_framework`, `topology`, `learning_rate`, optional `numeric_policy`/`bias_policy`, `inputs`, `targets`, `parameters_before`, claimed `forward`/`loss`/`backward`/`updates`/`parameters_after`, optional `post_update_*`.
  - Three schema families coexist: `receipt.v<N>.json` (output of engine/import), `topology-input.v<N>.json` (input to `bp generate from-config`), `framework-trace.v<N>.json` (input to `bp import`).

- **Rule 14 — Engine-recompute differential** (`src/reconcile.ts`):
  - Fires when `fixture_status.authoring_state === "external_imported"` AND `verification_state !== "engine_recompute_skipped_with_basis"`.
  - Re-runs `runGeneralStep` from the receipt's `parameters_before` + `inputs` + `targets` + `topology` + policies. Compares engine output to foreign claims (forward, loss, backward, updates, parameters_after) field-by-field within `attestor.differential_tolerance` (default `{atol: 1e-6, rtol: 1e-4}` — looser than engine-authored to accommodate cross-framework FP precision drift).
  - No-op for engine-authored receipts. All v0.1-v0.5 fixtures unchanged.
  - The load-bearing defense against the collapsed-trace laundering attack: a mutated `signal_value` on a collapsed-only sidecar (where Rule 13 is GATED-silent) is independently recomputed by the engine and the disagreement surfaces. The defense doesn't require ungating Rule 13.

- **Rule 15 — Skip-basis required** (`src/reconcile.ts`):
  - Fires when `verification_state === "engine_recompute_skipped_with_basis"` AND `attestor.skip_basis` is absent or not in the closed enum `EXTERNAL_TRUST_BASIS = { hardware_nondeterminism, framework_op_unsupported, distributed_only_field, attested_third_party }`.
  - Leroy's verified-vs-trusted discipline applied: skipping the math gate requires naming the basis on the record. Silent skipping is rejected.

- **Rule 16 — Attestation digest binding (GATED)** (`src/reconcile.ts`):
  - Fires only when `attestor.signed_subject_digest` is present. Recomputes the canonical-byte hash of the receipt (with the digest field stripped) via `emitGeneralReceipt + hashReceipt` and asserts it matches the declared `sha256:<hex>` digest.
  - Catches SolarWinds-style "signed-but-substituted" attacks. Signature *validity* (cosign verification) is OUT of scope — Rule 16 only checks digest-binding integrity.

- **`EXTERNAL_TRUST_BASIS` closed enum** (`src/general-engine.ts` + mirrored in `src/reconcile.ts`):
  - 4 values: `hardware_nondeterminism`, `framework_op_unsupported`, `distributed_only_field`, `attested_third_party`. Snapshot-asserted (matches v0.5's RECOVERY_ACTIONS pattern); additions force a deliberate edit.

- **`SourceFramework`, `Attestor`, `AttestorIdentity`, `ExternalTrustBasis`** TypeScript types (`src/general-engine.ts`):
  - Re-exported from package root for consumers handling imported receipts.

- **`bp import pytorch <sidecar.jsonl> [--out <file>] [--json]`** CLI subcommand:
  - Per-framework subcommand discipline (Agent 3 finding, SARIF Multitool precedent).
  - Reads `framework-trace.v0.1.0` sidecar, runs the differential check via `runGeneralStep`, emits a v0.4.0 observer-mode receipt with `attestor + source_framework + fixture_status`.
  - Exit codes: 0 (success + differential passed), 1 (success but differential disagreed; receipt still emitted for audit), 2 (sidecar invalid), 3 (CLI arg invalid), 4 (framework adapter not implemented — e.g., `bp import jax` in v0.6.0).
  - JAX + TensorFlow subcommands return exit 4 with a planned-for-v0.6.x message. No auto-detection from file contents — unknown framework names exit 2.

- **`importPytorchSidecar(sidecarBytes, opts?)`** library API (`src/import-pytorch.ts`):
  - Programmatic ingestion. Returns `{receipt, emittedBytes, differentialPassed, differentialDisagreements[]}`.
  - Hashes the raw sidecar bytes (SHA-256) for `attestor.import_provenance.source_hash` BEFORE parsing. Validates against framework-trace.v0.1.0. Rejects sidecars whose `source_framework.name !== "pytorch"` (per-framework subcommand contract enforced at the library level too).
  - Optional overrides: `differentialTolerance`, `extractorIdentity`, `importTimestamp` (mainly for fixture authoring with pinned timestamps), `fixtureLabel`.

- **`scripts/generate-pytorch-softmax-ce-fixtures.ts`** — reproducible generator for the good fixture pair:
  - `fixtures/external/pytorch.softmax-ce.sidecar.jsonl` (framework-trace.v0.1.0)
  - `fixtures/external/pytorch.softmax-ce.golden.jsonl` (observer-mode v0.4.0 receipt)
  - The sidecar's claimed math is byte-identical to what `runGeneralStep(SOFTMAX_CE_INPUT)` produces (v0.6.0 doesn't yet have PyTorch in CI; the canonical fixture demonstrates shape correctness). A real-PyTorch-authored sidecar would carry minor FP drift within `attestor.differential_tolerance`.

- **`scripts/generate-external-bad-fixtures.ts`** — reproducible generator for the 8 bad-external fixtures.

- **8 bad fixtures** under `fixtures/bad/external.bad-*.jsonl` (paired with `.meta.json`):
  - `bad-shape-not-math` — Rule 12 (CE per_output mutated; schema validates)
  - `bad-framework-spoof` — Rule 0.8 (out > 1.0; source_framework cannot mute math gate)
  - `bad-collapsed-laundered` — Rule 14 (mutated signal_value on collapsed-only; Rule 13 GATED-silent; Rule 14 catches via differential)
  - `bad-skip-without-basis` — Rule 15 ALONE (skip declared without attestor.skip_basis)
  - `bad-attested-mutated-after` — Rule 16 (signed digest no longer binds; cross-fires Rule 7 + Rule 14)
  - `bad-partial-tamper-internally-consistent` — Rule 7 + Rule 14 (parameters_after mutated; existing rule fires on ingest path; differential confirms)
  - `bad-trusted-source-bad-math` — Rule 0.8 (information_uri claims hub; identity does not mute math)
  - `bad-engine-reproduce-disagrees` — Rule 14 (forward drift beyond differential_tolerance; sum still ≈ 1.0)

- **Subpath exports** (`package.json`):
  - `./schema/receipt-0.4.0` → `schemas/receipt.v0.4.0.json`
  - `./schema/framework-trace-0.1.0` → `schemas/framework-trace.v0.1.0.json`
  - `./import-pytorch` → `dist/import-pytorch.js` (library API entry point)

- **Library re-exports** (`src/index.ts`):
  - `importPytorchSidecar`, `FrameworkTraceSidecar`, `ImportPytorchOptions`, `ImportPytorchResult`
  - `SourceFramework`, `Attestor`, `AttestorIdentity`, `ExternalTrustBasis` + the value `EXTERNAL_TRUST_BASIS`
  - `getFrameworkTraceSchema`, `FRAMEWORK_TRACE_SCHEMA_VERSIONS`, `FrameworkTraceSchemaVersion`
  - `validateFrameworkTraceSidecar`, `validateFrameworkTraceSidecarOrThrow`

### Changed

- **`SCHEMA_VERSIONS`** extended to `["0.1.0", "0.2.0", "0.3.0", "0.4.0"]`. v0.3.0 softmax+CE receipts validate against v0.3.0 unchanged.
- **`RULE_DESCRIPTIONS[14|15|16]`** added with explicit observer-mode semantics + GATED notes.
- **`bp` CLI `RULE_LABELS[14|15|16]`** added.
- **`bp` CLI `--help` text** + `suggestSubcommand` updated to include `import`.
- **Doctrine ratchet test** updated: implemented-rules expectation is now `[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]`. `FILENAME_KIND_TO_RULE` map gains entries for all 8 v0.6 bad fixtures.
- **`docs/reconciliation.md`** — Rules 14/15/16 sections added with attack-class descriptions, fixture cross-references, and the GATED scope-limit on Rule 16 (digest-binding-integrity only; signature validity is out of scope).
- **`docs/cli.md`** — `bp import pytorch` subcommand documented with trust-boundary explanation, exit codes, examples, and the per-framework / no-auto-detection discipline.
- **`Receipt`** + **`TopologyShape`** + new `AttestorShape` + `SourceFrameworkShape` types in `src/reconcile.ts` widened additively.
- **`OutputErrorSignal`** in `src/engine.ts` already widened with optional `dual_form` in v0.5; v0.6 doesn't change it.
- **`emit.ts`** emits the optional `source_framework` + `attestor` blocks only when present (preserves byte-equality for all v0.1-v0.5 receipts). Two new helpers: `emitSourceFramework`, `emitAttestor`.
- **`general-engine.ts`** `GeneralReceipt.schema_version` widened from `"0.2.0" | "0.3.0"` to `"0.2.0" | "0.3.0" | "0.4.0"`. `runGeneralStep` itself does NOT produce v0.4.0 receipts — observer-mode receipts come from `importPytorchSidecar`, not the engine first-run path.
- **`validate.ts`** registers `framework-trace.v0.1.0` validator on the shared Ajv instance. New `x-purpose` annotation registered as no-op for Ajv strict mode (alongside existing `x-order`, `x-rule`, `x-changes-from-*` strip).

### Tests

- 322 → 345 total (+23 v0.6 tests). 345 pass / 0 fail / 0 skip.
- New test files:
  - `test/import-pytorch.test.ts` — importer round-trip (sidecar → byte-equal golden), schema validation, reconcile cleanly, per-framework subcommand enforcement, malformed-input rejection, bp CLI end-to-end (4 subprocess tests: import + help + missing-framework + unknown-framework + unimplemented-framework).
  - `test/reconcile.bad-external.test.ts` — Rule 14 isolation (collapsed-laundered + engine-reproduce-disagrees), Rule 15 alone (skip-without-basis), Rule 16 (attested-mutated-after with cross-fire), cross-fire fixtures (shape-not-math, framework-spoof, partial-tamper, trusted-source-bad-math), Rules 14/15/16 no-op on engine-authored fixtures.
- All v0.1-v0.5.1 fixtures byte-identical. Engine bytes unchanged. The Mazur / XOR / iris / per-neuron-bias / softmax+CE goldens reconcile cleanly under the v0.6 reconciler (Rules 14/15/16 no-op on them per the authoring_state check).

### Migration notes (v0.5.1 → v0.6.0)

- Pure additive on engine-authored receipts. v0.1-v0.5.1 receipts validate, reconcile, and emit byte-identically. The engine's `runGeneralStep` path is unchanged — it still produces v0.2.0 or v0.3.0 receipts depending on topology.loss.
- New schema version `0.4.0` is RESERVED for observer-mode receipts. Engine-authored receipts MUST NOT declare it (and the engine never emits it).
- Consumers iterating `result.failures[*].rule` should be prepared for `rule: 14`, `rule: 15`, and `rule: 16` entries. All three are no-ops on engine-authored receipts so existing consumers' rule-handling switches don't need updates unless they handle observer-mode receipts.
- `fixture_status.authoring_state` and `fixture_status.verification_state` enums extended. Schema validators pinned to v0.3.0 (or earlier) will REJECT observer-mode receipts — that's the correct failure mode (Confluent schema-evolution discipline). Consumers that need to handle observer receipts should bump to v0.4.0.
- Topology-input schema (v0.4.0) is UNCHANGED — it remains the input contract for `bp generate from-config`. The new `framework-trace.v0.1.0` schema is a SEPARATE family for `bp import <framework>`.

### Out of scope (deferred by standing constraint or intent)

- **JAX + TensorFlow adapters** (`bp import jax` / `bp import tensorflow`) — planned for v0.6.x patch releases. Same schema, same Rule 14/15/16, same CLI pattern, different sidecar emitter.
- **Python helper as separate npm package** (e.g., `@mcptoolshop/backprop-trace-import-pytorch`) — v0.6.0 ships the helper as a documented script (planned location: `scripts/python-helpers/dump_pytorch_trace.py`). Promotion to a separate package follows when user demand justifies the split.
- **Signature validity verification** (cosign / Sigstore Rekor inclusion proofs) — out of scope for the reconciler. Rule 16 only checks digest-binding integrity within the receipt. CI-side signature verification is a separate layer.
- **`@dual_form` auto-synthesis on import** — explicitly rejected per the v0.5 consolidator Q2 decision, carried forward unchanged.
- **Multi-step observer-mode receipts** — v0.6.0 ships single-step only. Multi-step (`trace_id` + `step_index` carried through observer receipts) follows in a v0.6.x patch.
- npm publish / git tag / `gh release create` — user-deferred (commit + push only this wave).
- Translations / landing / handbook / SHIP_GATE walkthrough — user-deferred.

---

## [0.5.1] - 2026-05-17

Focused ratchet on v0.5.0. No new math semantics. Closes the two v0.3-era
carry-over skips, audits the v0.3.0 export surface, adds a softmax+CE
worked example to docs + library JSDoc, and adds a generator script for
the new XOR multi-step good golden so it's reproducible from clean.

### Added

- **`fixtures/xor.multi-step.jsonl`** — canonical 2-record multi-step
  golden (XOR-sigmoid 2-2-1). Step 0 is the XOR_INPUT first run with
  `trace_id` + `step_index=0`; step 1 reuses the same XOR sample with
  `parameters_before` == step 0's `parameters_after` byte-for-byte. All
  per-record rules pass AND Rules 9 (parameter chain) and 10 (trace
  identity + sequential step_index) pass cleanly. Pairs with the existing
  `fixtures/bad/multi-step.bad-{chain,trace-id}.jsonl` plate as the
  "all-rules-pass" baseline.
- **`scripts/generate-xor-multi-step-golden.ts`** — reproducible
  generator for the multi-step golden. Reads no files; runs
  `runGeneralStep` over `XOR_INPUT` twice with a pinned `trace_id` and
  chains the parameters. Re-running it from clean produces byte-identical
  output to the shipped golden.
- **v0.5 surface re-exports** in `src/index.ts`:
  - `SOFTMAX_CE_TOPOLOGY`, `SOFTMAX_CE_INPUT`, `SHARED_NUMERIC_POLICY_V05_SOFTMAX_CE` from `./mazur`.
  - `softmaxVector` + `OutputActivationName` type from `./activations`.
  - `DualForm` + `JacobianTerm` types from `./general-engine` (canonical declaration lives in `./engine` for emit-side type sharing).
  - Updated quick-usage JSDoc with a softmax+CE worked example block (engine run, dual_form access, custom-topology authoring, Rule 13 gated-skip note).
- **`bp verify general` v0.1 redirect** — when a receipt declares
  `schema_version: "0.1.0"` (the Mazur 2-2-2 pinned schema), the verifier
  early-exits with status 1 and a "use `bp verify mazur`" diagnostic on
  the schema-dispatch check. Detection is purely string-level on the
  `schema_version` field (no Ajv invocation, no engine call) so the
  redirect is fast and decoupled from validator state. Receipts without
  a `schema_version` field fall through to normal validation, which
  reports the missing field through the schema check.
- **Softmax+CE worked example** in `docs/reconciliation.md` "Command
  surface" section. Shows the engine-run → validate → reconcile → verify
  general pipeline, plus the GATED Rule 13 note (collapsed-only receipts
  silently skip Rule 13).

### Changed

- `docs/reconciliation.md` "Command surface" expanded: `bp verify general`,
  `bp verify multi`, and `bp reconcile receipt` now have full descriptions
  including the v0.1 redirect, multi-record verification, and Rule
  enumeration. The "eight rules" naming is preserved for back-compat with
  v0.2 readers, but the section header was already "13 rules" since v0.5.

### Tests

- 322 total tests unchanged. 320 → 322 passing. 0 fail.
  **Both carry-over skips closed** (2 → 0):
  - `bp verify general on mazur (v0.1) — policy decision deferred`
    replaced with an active test that asserts the v0.5.1 v0.1 redirect:
    exit 1 + diagnostic naming `bp verify mazur` and the offending
    `schema_version`.
  - `bp verify multi <good multi-step file> exits 0` was previously
    skipped because the fixture didn't exist. With
    `fixtures/xor.multi-step.jsonl` now present, the test runs and
    passes — per-record Rules 1-8/11/12/13 + cross-step Rules 9/10 all
    green on the 2-record XOR multi-step run.
- All v0.1-v0.5.0 fixtures byte-identical. Engine bytes unchanged.

### Migration notes (v0.5.0 → v0.5.1)

- Pure additive. No schema bump, no rule additions, no engine math
  changes. All v0.5.0 receipts validate, reconcile, and emit byte-identically.
- Consumers using `bp verify general` on v0.1.0 Mazur receipts (uncommon
  — Mazur receipts should use `bp verify mazur`) now get an exit 1 with
  a redirect message instead of a cryptic engine-reproduce schema error.
  The shipped Mazur golden is the only v0.1.0 receipt in the repo; no
  downstream consumer is known to call `bp verify general` on a v0.1
  receipt.

### Out of scope (deferred by standing constraint or intent)

- v0.6 external trace ingestion (PyTorch / JAX collapsed-only softmax+CE
  receipts) — the next study-swarm subject. Rule 13's GATED design was
  built exactly to support that adoption path.
- npm publish / git tag / `gh release create` — user-deferred.
- Translations / landing / handbook / SHIP_GATE walkthrough — user-deferred.

---

## [0.5.0] - 2026-05-17

The softmax + cross-entropy wave. v0.4.2's Rule 12 polymorphic dispatcher
was deliberately shaped so v0.5 could extend it with a
`cross_entropy_softmax` branch without reshaping any rule signatures or
schema fields. This release fills in that branch and lands the three other
softmax+CE verifier rules + the engine path + the schema additive bump that
the v0.5 study-swarm locked.

Design decisions baked in (per the v0.5 consolidator memo + user-locked
Q1/Q2/Q3 decisions before greenlight):
- **Q1: Rule 13 is GATED**, not mandatory. Fires only when
  `OutputErrorSignal.dual_form` is present. Receipts authored from PyTorch
  / JAX / other frameworks can omit `dual_form` and Rule 13 silently
  skips. The engine emits `dual_form` for every softmax+CE receipt it
  generates so the in-house path is fully verified.
- **Q2: NO engine auto-synthesis** of Jacobian factors. The engine emits
  the collapsed `dL/dz_u = y_u - p_u` form (descent direction) as the
  primary `OutputErrorSignal.factors`. The dual-form Jacobian
  decomposition is emitted ALONGSIDE the collapsed form when the engine
  generates softmax+CE receipts; it is never back-filled onto receipts
  that lack it.
- **Q3: SPLIT** — v0.4.2 shipped Rule 12's half_squared_error branch as a
  focused trust patch BEFORE this wave. v0.5 is the full softmax+CE wave.

### Added

- **Schema v0.3.0** (additive over v0.2.0):
  - `topology.activation_output` enum widened from `[sigmoid, identity, relu]` to `[sigmoid, identity, relu, softmax]`.
  - `topology.loss` enum widened from `[half_squared_error]` to `[half_squared_error, cross_entropy_softmax]`.
  - `OutputErrorSignal` gains optional `dual_form` (DualForm) for Rule 13 verification surface. Receipts that don't carry `dual_form` continue to validate against v0.3.0 unchanged.
  - New `$defs/DualForm` (jacobian_terms[], product_order, summation_order, summed_value) and `$defs/JacobianTerm` (target_unit, factors[], term_value).
  - Receipt schema_version: `0.3.0`. v0.2.0 receipts continue to validate against the v0.2.0 schema unchanged.
- **Rule 0.8 — Softmax probability bounds** (a Rule 0 sub-check). When `topology.activation_output === "softmax"`, every `forward[output].out` MUST be in `[0, 1]` within the receipt's atol slack. Fires inside `checkRule0Structural` Phase 0 and short-circuits before Rules 1-13. Failure record uses `rule: 0` with `"Rule 0.8 (probability bounds)"` in the message — the doctrine ratchet (which scans integer rule numbers) sees Rule 0 with a paired `softmax-ce.bad-prob-bound` fixture and is satisfied.
- **Rule 11 — Softmax normalization**. When `topology.activation_output === "softmax"`, `sum(forward[output_unit].out) == 1.0` within tolerance. Sum is computed left-to-right in `topology.unit_order.output` order for deterministic reproduction. Independent of Rule 0.8 (a receipt could pass either while failing the other).
- **Rule 12 cross_entropy_softmax branch**. Fills in the v0.4.2 stub:
  - Per-output: `loss.per_output[u] == (y_u == 0 ? 0 : -y_u * log(p_u))`. The `y_u === 0` short-circuit is mathematically faithful (the `y * log(p) → 0` limit holds at any `p`) AND defends against the `-0 * log(0) = NaN` JavaScript footgun. The engine and the reconciler apply the same short-circuit so engine-emitted receipts pass cleanly.
  - Total: `loss.total == sum_u loss.per_output[u]` (recomputed from forward + targets, independent of `loss.per_output[*]`).
- **Rule 13 — Gated dual-form consistency** (softmax+CE). Three sub-checks:
  - 13a per-term multiplication: each `jacobian_terms[j].term_value == multiply(jacobian_terms[j].factors, left_to_right)`.
  - 13b summation: `dual_form.summed_value == sum(jacobian_terms[*].term_value)` in `dual_form.summation_order`.
  - 13c collapsed-vs-dual: `dual_form.summed_value == OutputErrorSignal.signal_value`.
  GATED: silently skips when `dual_form` is absent.
- **Softmax engine path** (`src/general-engine.ts`):
  - Forward output layer branches on `activation_output === "softmax"`. Phase 1 computes logits per unit left-to-right in `unit_order.output`; Phase 2 invokes `softmaxVector` once over the assembled logit vector (LSE-stable: subtract max, exp, sum, divide).
  - Loss branches on `topology.loss === "cross_entropy_softmax"` for the CE formula.
  - Backward output_error_signals branches on softmax+CE: collapsed `signal_value = y_u - p_u` (descent direction; the textbook `p_u - y_u` is the positive-direction gradient, negated to match the existing `gradient_convention: "descent_direction"`). Single factor `target_minus_probability`.
  - Engine ALWAYS emits `dual_form` for every output unit when topology declares softmax+CE. Each term contains two factors (`y_j` with provenance `targets.<j>`, and `delta_ju_minus_p_u` derived). `summed_value` equals `signal_value` by construction.
  - Post-update forward + loss also branch identically for softmax / CE.
  - Topology pairing invariant: `loss === "cross_entropy_softmax"` iff `activation_output === "softmax"` — enforced by `assertTopologyValid` at the engine boundary.
- **softmaxVector activation** in `src/activations.ts`. Stable log-sum-exp form. New type `OutputActivationName = ActivationName | "softmax"` for the topology output-layer slot (softmax stays out of `ActivationName` because it's a vector op, not per-scalar — the `activate()` dispatcher remains per-scalar).
- **SHARED_NUMERIC_POLICY_V05_SOFTMAX_CE** in `src/mazur.ts`: hybrid tolerance widened to `{atol: 1e-11, rtol: 1e-7}` (up from v0.3's `{1e-12, 1e-8}`) to accommodate softmax (subtract max, exp, sum, divide), log() in CE, and dual_form term products. ~3x headroom over the theoretical chained-error budget.
- **Canonical softmax+CE topology + input** (`SOFTMAX_CE_TOPOLOGY` + `SOFTMAX_CE_INPUT` in `src/mazur.ts`): 2 inputs → 2 hidden sigmoid → 3 output softmax, one-hot target class o1. Deterministic initial weights. bias_policy.mode = constant (Mazur convention preserved).
- **`fixtures/softmax-ce.golden.jsonl`** — canonical first-run receipt. schema_version `0.3.0`. Byte-equal-reproducible by `runGeneralStep(SOFTMAX_CE_INPUT) + emitGeneralReceipt`.
- **7 bad fixtures** under `fixtures/bad/`:
  - `softmax-ce.bad-prob-bound.jsonl` — forward.o1.out → -0.01 (Rule 0.8 short-circuits).
  - `softmax-ce.bad-softmax-sum.jsonl` — forward.o2.out += 0.1 (Rule 11 fires; no cascade thanks to widened tolerance).
  - `softmax-ce.bad-ce-per-output.jsonl` — loss.per_output.o1 += 0.1 (Rule 12 CE per_output; no cascade).
  - `softmax-ce.bad-ce-total.jsonl` — loss.total += 0.1 (Rule 12 CE total; no cascade).
  - `softmax-ce.bad-dual-term.jsonl` — dual_form jacobian_terms[0].term_value mutated (Rules 13a + 13b).
  - `softmax-ce.bad-dual-sum.jsonl` — dual_form.summed_value mutated (Rules 13b + 13c).
  - `softmax-ce.bad-collapsed-vs-dual.jsonl` — dual_form mutated self-consistently (Rule 13c ALONE — isolates the cross-form check).
  Each ships with a sibling `.meta.json` carrying `reconciliation_check_targeted_first` for the doctrine ratchet.
- **`scripts/generate-softmax-ce-bad-fixtures.ts`** — single-source-of-truth generator for the 7 bad fixtures. Read golden → mutate one field → re-emit via the canonical engine emitter so non-mutated bytes are preserved. Re-runnable if the golden ever needs to be regenerated (e.g., V8 Math.exp drift).
- **Math.exp + Math.log determinism canaries** in `test/determinism.math-exp-canary.test.ts`: `Math.exp(0.5)`, the softmax intermediate `exp(z_o2 - z_max)` from SOFTMAX_CE_INPUT, and `Math.log(p_o1)` at the golden's pinned probability magnitude. CI failure surfaces drift BEFORE any softmax+CE golden regenerates silently.

### Changed

- **`RULE_DESCRIPTIONS`** gains entries 11 + 13; entry 12 updated to note both branches; entry 0 updated to mention Rule 0.8 sub-check.
- **`bp` CLI `RULE_LABELS`** gains entries 11 + 13.
- **`Receipt`** + **`TopologyShape`** in `src/reconcile.ts` widened: TopologyShape gains optional `activation_output`. OutputErrorSignal shape gains optional `dual_form` with JacobianTerm + DualForm sub-types.
- **`OutputErrorSignal`** in `src/engine.ts` widened with optional `dual_form` (additive). Mazur v0.1 receipts that never emit `dual_form` stay byte-identical to the shipped golden.
- **`emit.ts`** emits the optional `dual_form` key only when present (preserves byte-equality for half_squared_error receipts). Two new helpers: `emitDualForm` and `emitJacobianTerm`.
- **`general-engine.ts`** `GeneralReceipt.schema_version` widened from `"0.2.0"` to `"0.2.0" | "0.3.0"`. The engine picks the version based on `topology.loss` so callers don't have to.
- **`assertSupportedPolicy`** in `general-engine.ts` accepts `cross_entropy_softmax` loss now.
- **`assertTopologyValid`** in `topology.ts` accepts `activation_output === "softmax"` and `loss === "cross_entropy_softmax"`. Enforces the softmax+CE pairing invariant (one requires the other).
- **`schema-loader.ts`** `SCHEMA_VERSIONS` tuple extended with `"0.3.0"`. `validate.ts`'s default version remains `"0.2.0"` (receipts declare their own schema_version so the default rarely matters).
- **`package.json`** adds `./schema/0.3.0` subpath export pointing at `schemas/receipt.v0.3.0.json`.
- **Doctrine ratchet test** updated: implemented-rules expectation is now `[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]`. FILENAME_KIND_TO_RULE map adds entries for all 7 v0.5 bad fixtures.

### Tests

- 299 → 322 total (+23). 297 → 320 passing. 0 fail. 2 carry-over skips unchanged.
- New test files:
  - `test/reconcile.bad-prob-bound.test.ts` — Rule 0.8 short-circuits, no numeric cascade.
  - `test/reconcile.bad-softmax-sum.test.ts` — Rule 11 fires on the sum site.
  - `test/reconcile.bad-ce-per-output.test.ts` — Rule 12 CE per_output + total, each in isolation.
  - `test/reconcile.bad-dual-form.test.ts` — Rule 13a/13b/13c, GATED behavior (Mazur + XOR goldens pass cleanly with no dual_form), softmax-ce golden passes all three.
  - `test/softmax-ce.engine.test.ts` — byte-equality vs golden, schema_version 0.3.0, softmax sum-to-1, collapsed-equals-dual property, per-term multiplication property, CE per_output formula.
- All v0.1-v0.4.2 fixtures remain byte-identical (Mazur, XOR, iris, per-neuron-bias). The widened `OutputErrorSignal.dual_form` field is optional and `emit.ts` only emits it when present.

### Migration notes (v0.4.2 → v0.5.0)

- Pure additive on receipts that don't declare softmax+CE. Existing
  half_squared_error receipts validate, reconcile, and emit byte-identically.
- New schema version `0.3.0`. v0.2.0 receipts continue to validate against
  v0.2.0; v0.5 receipts that use softmax / CE declare `schema_version: "0.3.0"`.
- Topology pairing invariant: `topology.loss === "cross_entropy_softmax"`
  REQUIRES `topology.activation_output === "softmax"` (and vice versa).
  `assertTopologyValid` rejects mixed pairings at the engine boundary.
- Rule 13 is GATED: receipts can opt into the extra verification surface
  by emitting `dual_form` alongside the collapsed factors. The engine emits
  dual_form when authoring softmax+CE receipts; receipts authored from
  PyTorch / JAX / etc. may omit it and Rule 13 silently skips.
- Consumers iterating `result.failures[*].rule` should be prepared for
  `rule: 11` and `rule: 13` entries. Rule 0.8 surfaces as `rule: 0` with
  "Rule 0.8" in the message (no new integer rule number to handle).
- The `OutputErrorSignal` TypeScript type widened with optional `dual_form`
  (additive). Consumers that pattern-match on the narrow shape continue
  to work.

### Out of scope (deferred by standing constraint)

- npm publish / git tag / `gh release create` — user-deferred (commit + push only this wave)
- Translations — user-deferred
- Landing page / handbook / SHIP_GATE walkthrough — user-deferred
- Multi-class CE with non-one-hot targets — current implementation accepts arbitrary normalized targets (the math holds), but no fixture exercises non-one-hot yet. Could land in v0.5.x as a fixture-only addition.
- Bias updates on softmax+CE — bias_policy mode "constant" is the only path shipped with the canonical fixture; bias_policy mode "sgd" + softmax+CE would work mathematically but no fixture covers it.
- In-toto v1 attestation + DSSE PAE — still deferred to v0.6+ per the v0.4 study.

---

## [0.4.2] - 2026-05-17

Focused trust patch closing a real v0.4.1 gap surfaced by the v0.5 study-swarm:
`loss.total` was schema-validated but never math-checked by any reconciler rule.
A receipt could mutate `loss.total` arbitrarily and `reconcileReceipt` would
return `ok===true`. v0.4.2 wires Rule 12 (loss formula consistency) as a
polymorphic dispatcher on `topology.loss`; the half_squared_error branch ships
now, cross_entropy_softmax branch is reserved for v0.5 alongside the softmax
+ CE engine path.

### Added

- **Rule 12 — Loss formula consistency** (per-output + total). Polymorphic
  dispatcher on `topology.loss`:
  - `half_squared_error` (v0.4.2): `loss.per_output[u] == 0.5 * (targets[u] - forward[u].out)^2` AND `loss.total == sum(loss.per_output[*])`. Both checks fire independently; either or both can surface a Rule 12 failure.
  - `cross_entropy_softmax` (RESERVED for v0.5): no-op in v0.4.2; will land with the softmax + CE engine path. Receipts with v0.5 cross_entropy_softmax declarations pass v0.4.2's reconciler without firing Rule 12 (it skips silently rather than firing a structural failure — Rule 0 will gate the wider topology declaration when v0.5 ships).
- New paired bad fixture: `fixtures/bad/mazur.bad-loss-total.jsonl` + `.meta.json`. Mutates `loss.total` from 0.298371109 to 0.298372109 (delta +1e-6, ~1000x scalar tolerance) while leaving per-output entries, targets, and forward outputs byte-identical. Rule 12 catches; Rules 1-8 do NOT cascade (loss is independent of backward).
- New test file `test/reconcile.bad-loss-total.test.ts` covers: (1) bad fixture fires Rule 12 on loss.total alone with no cascade to Rules 1-8, (2) Mazur / XOR / iris / per-neuron-bias goldens all pass Rule 12 cleanly under the half_squared_error branch.

### Changed

- `RULE_DESCRIPTIONS[12]` added with explicit reference to topology.loss dispatch + the v0.4.1 trust gap it closes.
- `bp` CLI `RULE_LABELS[12]` added so `bp reconcile receipt` renders "Rule 12: loss formula consistency violation..." instead of the generic "rule mismatch" placeholder.
- `Receipt` type in `src/reconcile.ts` widened with optional `inputs`, `targets`, `forward`, `loss` fields (additive; v0.1 Mazur receipts that don't declare topology.loss fall back to the implicit half_squared_error assumption only when both forward and targets are present).
- `TopologyShape` widened with `loss?: "half_squared_error" | "cross_entropy_softmax"` for v0.5 forward-compat.
- Doctrine ratchet test `test/reconcile.doctrine.test.ts` updated: implemented-rules expectation is now `[1-10, 12]` (Rules 11/13 reserved for v0.5); FILENAME_KIND_TO_RULE map adds `bad-loss-total → 12` plus the v0.4.1 sub-checks that were missing from the static map.

### Tests

- 294 → 299 total; 292 → 297 passing; skips unchanged at 2 (carry-overs from v0.3: cross-version verify-general policy + good multi-step fixture).
- 0 fail. Mazur byte-equal preserved. All v0.4.0/v0.4.1 behavior unchanged.

### Migration notes (v0.4.1 → v0.4.2)

- Pure additive on the reconciler surface. Receipts that pass v0.4.1 continue to pass v0.4.2 IF they were math-consistent on `loss.total` (engine-emitted receipts always are). Receipts that v0.4.1 silently accepted with mutated `loss.total` now surface Rule 12 failures — these were always structurally inconsistent.
- v0.1 Mazur receipts (which use the narrow Mazur Topology without `topology.loss`) gracefully fall back to half_squared_error when `forward` and `targets` are present. No schema bump.
- Consumers iterating `result.failures[*].rule` should be prepared for `rule: 12` entries.

### Out of scope (v0.5 study deferrals, restated)

- Rule 11 (softmax sum-to-unity) — v0.5
- Rule 13 (collapsed↔Jacobian) — v0.5, gated by author intent
- Rule 0.8 (softmax non-negativity sub-check) — v0.5
- `cross_entropy_softmax` engine path + receipt fields — v0.5
- Schema v0.3.0 (additive widening for softmax+CE) — v0.5
- Hybrid tolerance widen to `{1e-11, 1e-7}` — v0.5 (current `{1e-12, 1e-8}` is sufficient for half_squared_error)
- Translations / release pipeline / landing / handbook / npm publish — standing constraint

---

## [0.4.1] - 2026-05-17

Focused trust patch on the v0.4.0 ship: closes the known reconciler gap
flagged independently by 3 agents during the v0.4 swarm — the
`bias_policy.mode` vs `Update.kind` contradiction surfaces only via
`bp verify general`'s engine-reproduce stage, never via `reconcileReceipt`.
v0.4.1 wires a Rule 0 cross-consistency Phase 0 that catches this and 6
other receipt-internal structural contradictions before any numeric rule
runs.

### Added

- `checkRule0Structural` Phase 0 in `reconcileReceipt`. Catches
  receipt-internal contradictions before Rules 1-8. Short-circuits if
  any Rule 0 failure fires (numeric rules on a structurally-broken
  receipt produce confusing quartets — the structural failure alone is
  what the operator needs to fix). Each sub-check gracefully no-ops for
  v0.1 Mazur receipts (which don't carry the v0.2+ topology metadata it
  consults). Sub-checks:
  - **0a**: `bias_policy.mode='constant'` contradicts `updates[*].kind='bias'`
  - **0b**: `bias_policy.mode='constant'` contradicts drifted bias `parameters_after`
  - **0c**: `bias_policy.mode='sgd'` declares biases but no `kind='bias'` updates exist
  - **0d/0e**: `bias_sharing` vs `applies_to_units.length` mismatch
  - **0f**: `Update.kind` vs `topology.parameters[].role` mismatch
  - **0g**: `topology.{input,hidden,output}_size` vs `unit_order.{input,hidden,output}.length` mismatch
- 3 new bad-* fixtures (paired per Csmith doctrine), each isolating one
  Rule 0 sub-check:
  - `fixtures/bad/xor.bad-bias-sharing-mismatch.jsonl` (Rule 0e)
  - `fixtures/bad/xor.bad-kind-vs-role.jsonl` (Rule 0f)
  - `fixtures/bad/xor.bad-topology-size.jsonl` (Rule 0g)
  Sub-checks 0a + 0b are covered by the pre-existing v0.4.0
  `xor.bad-bias-mode-mismatch.jsonl` fixture (which was a skipped test
  in v0.4.0; now passes naturally).
- 3 new tests targeting the new fixtures.

### Changed

- `RULE_DESCRIPTIONS[0]` expanded to mention the v0.4.1+ cross-consistency
  checks alongside the legacy "shape invalid / unsupported product_order /
  non-finite arithmetic" cases.
- `xor.bad-bias-mode-mismatch.test.ts` no longer skips — it fires the
  defensive assertion path and passes (Rule 0a + 0b both surface on this
  fixture per its meta.json mutation).

### Tests

- 291 → 294 total tests; 288 → 292 passing; 3 → 2 skipped.
- 0 fail (Mazur byte-equal preserved; all v0.4.0 behavior unchanged).
- Remaining 2 skips are carry-overs from v0.3: `bp verify general on Mazur (v0.1)`
  cross-version policy + `bp verify multi <good-fixture>` (no good multi-step
  fixture yet).

### Migration notes (v0.4.0 → v0.4.1)

- Pure additive. Existing receipts that pass v0.4.0 reconcile continue to
  pass v0.4.1 reconcile. v0.1/v0.2 Mazur receipts are unaffected (Rule 0
  sub-checks no-op when their input fields are absent).
- Consumers that pattern-match on `result.failures[*].rule` may now see
  `rule: 0` failures where v0.4.0 returned `ok: true` — these are receipts
  that v0.4.0 silently accepted but were always structurally inconsistent.

### Out of scope (deferred)

- Softmax + cross-entropy (v0.5 with factor-decomposition design phase)
- `bp attest` / DSSE / in-toto (premature without consumer)
- Optimizer state (momentum, Adam, weight decay)
- Batched receipts

---

## [0.4.0] - 2026-05-16

### Added

- `bp generate from-config <file>` — read a topology+input JSON, produce a
  canonical receipt. Authoring tools surface (Agent D path from v0.4
  study-swarm).
- `bp scaffold topology --topology mazur|xor|iris [--out <file>]` — write a
  sample input file to bootstrap a new topology.
- `bp validate-input <file>` — schema-validate an input config without
  running the engine.
- Per-neuron bias support: `bias_sharing: "per_neuron"` in Topology,
  `Update.kind: "bias"` populated, `Update.layer_edge: "bias_to_unit"`
  populated. Bias updates are one-factor products of the unit's error
  signal.
- New library exports: `parseTopologyInput`, `validateTopologyInput`,
  `validateTopologyInputOrThrow`, `getInputSchema`,
  `INPUT_SCHEMA_VERSIONS`, `XOR_PER_NEURON_BIAS_INPUT`.
- NEW: `schemas/topology-input.v0.4.0.json` — input schema separate from
  receipt schema. `additionalProperties: false` enforces that receipt-only
  fields (forward, loss, updates, parameters_after, post_update_forward,
  post_update_loss, fixture_status) are PROHIBITED in input files. The
  trust boundary is preserved: authored bytes can never become receipt
  bytes.
- XOR per-neuron-bias golden fixture + 6 bad-bias-* fixtures (one per
  applicable rule, per Csmith doctrine).
- Determinism canary test: `Math.exp(-0.5)` constant pinned across the CI
  matrix (Agent E's early-warning siren for V8 fdlibm drift).
- New CI matrix cell: `node-version: '22.11.0'` alongside the existing
  `22.x` cells.
- NEW: `docs/authoring.md` walkthrough of authoring a custom topology via
  `bp scaffold` → edit → `bp generate from-config` → `bp verify general`.

### Changed

- `schemas/receipt.v0.2.0.json` additive widening: `bias_sharing.enum`
  adds `"per_neuron"`; `OutputErrorSignal.factors.minItems` relaxed from
  2 to 1 (per-neuron bias gradient is a one-factor product).
- README: added "Determinism boundary" section documenting the V8/Node 22
  byte-equal contract scope and the no-go list (Bun/Deno, decimal.js,
  custom Math.exp, Sigstore embedding).

### Determinism scope (unchanged)

- V8/Node 22 scalar IEEE 754 doubles. ECMA-262 §21.3 leaves Math.exp
  precision implementation-defined; backprop-trace's byte-equal contract
  holds on the pinned matrix only.
- Per-neuron bias adds no new transcendentals; the math is `+`, `*` only.

### Doctrine ratchet

- v0.4 study-swarm output (consolidator-decision.md) explicitly REJECTS
  softmax+CE (defer to v0.5; factor-decomposition reshape required),
  `bp attest`/DSSE/in-toto (premature without downstream consumer), tanh
  (surface area without lift), momentum/Adam/weight-decay/batching
  (deferred), custom Math.exp / decimal.js / Bun-Deno matrix
  (thesis-erosion).

### Migration notes (v0.3.0 → v0.4.0)

- v0.1/v0.2 receipts continue to validate against v0.1.0/v0.2.0 schemas.
- v0.2.0 schema's per_layer-only constraint is widened; existing per_layer
  receipts still validate.
- New per-neuron-bias receipts emit `bias_sharing: "per_neuron"` in
  topology and include per-unit bias parameters in `parameter_order` +
  `parameters_before` + `parameters_after`.
- Authoring tooling is opt-in; existing programmatic API (`runGeneralStep`
  with hand-constructed `GeneralInput`) unchanged.

[0.4.0]: https://github.com/mcp-tool-shop-org/backprop-trace/releases/tag/v0.4.0

## [0.3.0] - 2026-05-16

### Added

- Generalized engine (`runGeneralStep`, `src/general-engine.ts`) supporting
  arbitrary N-input N-hidden N-output sigmoid+ReLU+identity topologies via
  explicit `unit_order` + `parameter_order` declarations on a `Topology`
  value. The existing Mazur 2-2-2 path (`runMazurStep`) is unchanged and
  remains the byte-equal golden source; `runGeneralStep` ships alongside it
  and produces v0.2.0-schema receipts.
- Schema v0.2.0 (`schemas/receipt.v0.2.0.json`): additive on top of v0.1.0.
  `unit_order` + `parameter_order` are REQUIRED at the top level for general-
  topology receipts; `trace_id` (128-bit lowercase hex) + `step_index`
  (0-based integer) are OPTIONAL for multi-step receipts;
  `numeric_policy.tolerance` becomes an object `{atol, rtol}` (the scalar
  form is retained as v0.1 compat sugar — read as `{atol: <value>, rtol: 0}`);
  `topology.activation` enum widens to `{sigmoid, identity, relu}`;
  layer-size fields widen from `const 2` to integer 1-64.
- Hybrid tolerance: `|a - b| <= max(atol, rtol * max(|a|, |b|))` — symmetric
  max form per Boost.Test FPC_STRONG, Bruce Dawson (2012), and
  floating-point-gui.de. Defaults `atol = 1e-12`, `rtol = 1e-9`.
- Rule 9 — multi-step parameter chain: for `step_index = N` (N > 0),
  `parameters_before[N]` MUST equal the prior receipt's `parameters_after[N-1]`
  within tolerance. Single-step receipts (`step_index = 0`) skip Rule 9.
- Rule 10 — multi-step trace identity: across a JSONL training run, every
  receipt MUST share `trace_id` and `step_index` MUST be sequential
  (0, 1, 2, ..., N-1, monotonic and dense).
- Activation library (`src/activations.ts`): `sigmoid` (existing),
  `identity` (NEW), `relu` (NEW), each as `activate(x): number` plus
  `*DerivativeFromOut(out): number` siblings. Plus `activate` /
  `activationDerivativeFromOut` dispatch helpers consumed by the general
  engine.
- Topology types and validators (`src/topology.ts`): `Topology`, `Parameter`,
  `ParameterRole`, `UnitOrder`, `UnitId`, `ParameterId`, plus
  `assertTopologyValid`, `findWeight`, `findHiddenBias`, `findOutputBias`
  helpers.
- XOR-sigmoid 2-2-1 fixture (`fixtures/xor.golden.jsonl` +
  `fixtures/xor.published.json`) — operator-chosen seeded init; engine-
  anchored (no published source provides this exact trace).
- Iris 4-3-3 sigmoid fixture (`fixtures/iris.golden.jsonl` +
  `fixtures/iris.published.json`) — first iris flower
  `(5.1, 3.5, 1.4, 0.2)` targeting one-hot setosa `[1, 0, 0]`;
  engine-anchored.
- Bad fixtures for the multi-step rules (`fixtures/bad/multi-step.bad-chain.jsonl`,
  `fixtures/bad/multi-step.bad-trace-id.jsonl`) per the Csmith
  bad-receipts-precede-good doctrine — each ships with a sibling
  `.meta.json` documenting the mutation and the targeted invariant.
- CLI subcommands: `bp verify general <file>` (generalized verify gate for
  v0.2.0-schema receipts), `bp verify multi <file.jsonl>` (multi-record
  verify; Rules 9, 10 + per-record Rules 1-8), `bp generate xor` and
  `bp generate iris` (emit canonical bytes for the new fixtures).
  `bp verify mazur` keeps v0.1.0 semantics unchanged.
- Library exports added to the package barrel: `runGeneralStep`,
  `runMultiStep`, `emitGeneralReceipt`, `XOR_INPUT`, `XOR_TOPOLOGY`,
  `IRIS_INPUT`, `IRIS_TOPOLOGY`, `MAZUR_TOPOLOGY`, `sigmoid` /
  `sigmoidDerivativeFromOut` / `identity` / `identityDerivativeFromOut` /
  `relu` / `reluDerivativeFromOut`, `activate`,
  `activationDerivativeFromOut`, `applyToleranceCheck`,
  `normalizeTolerance`, `checkRule9`, `checkRule10`, `reconcileMultiStep`,
  `verifyGeneralEngineReproduces`, `extractGeneralEngineInput`,
  `assertTopologyValid`, `findWeight`, `findHiddenBias`, `findOutputBias`.
- New subpath exports: `./general-engine`, `./topology`, `./activations`,
  `./schema/0.1.0`, `./schema/0.2.0`. The bare `./schema` alias keeps
  pointing at `receipt.v0.1.0.json` for backward compatibility.
- New docs:
  - `docs/topology.md` — authoring guide for general topologies (the
    `Topology` type, the four `ParameterRole`s, unit-id / parameter-id
    constraints, the `unit_order` + `parameter_order` canonicalization,
    per-layer bias sharing, and a worked example walking through
    `XOR_INPUT`).
  - `docs/multi-step.md` — multi-step training receipts (parameter-chain
    integrity, `trace_id` + `step_index` semantics, multi-record JSONL
    framing, two-phase verification model, `bp verify multi` workflow).

### Changed

- All 8 existing reconciliation rules now route through
  `applyToleranceCheck(a, b, policy)`. v0.1 receipts that supply a scalar
  `numeric_policy.tolerance` continue to reconcile under pure-atol semantics
  (the scalar `X` is normalized to `{atol: X, rtol: 0}`, so the symmetric
  max-form collapses to `|a - b| <= X` — identical to v0.1 behavior).
- `validateReceiptSchema` auto-detects v0.1 vs v0.2 by inspecting
  `schema_version` on the receipt. Both validators are compiled once at
  module load and cached. Callers that need to pin a specific schema can
  pass `opts.version`.
- `emitReceipts` dispatches on receipt schema_version — Mazur receipts emit
  via the v0.1 emitter, generalized receipts via the v0.2 emitter. Multi-
  record framing is unchanged (trailing LF per record; concatenating two
  emitter outputs is itself a valid emitter output).
- `RULE_DESCRIPTIONS` expanded to 10 entries (Rules 9, 10 added).
- `docs/reconciliation.md`: quick-reference table updated to list all 10
  rules; new "Multi-step receipts" section explains the two-phase
  verification model and the 128-bit hex `trace_id` convention.
- `docs/computation-order.md`: new "Hybrid tolerance (v0.3+)" section
  documenting the symmetric max form, defaults (`atol = 1e-12`,
  `rtol = 1e-9`), backward-compat with scalar `tolerance: 1e-9`, and
  rationale (absorbs the v0.1 w6/w8 product drift previously documented
  in `fixtures/bad/mazur.bad-gradient.meta.json`).
- `docs/cli.md`: documents the four new subcommands and the exit-code
  conventions for each.
- `docs/schema.md`: dedicated walk-through of `schemas/receipt.v0.2.0.json`,
  highlighting the v0.1 → v0.2 diffs (required unit_order/parameter_order;
  tolerance becomes object-or-scalar; activation widened; layer sizes
  widened; optional trace_id / step_index for multi-step).
- `docs/quickstart.md`: adds a "Beyond Mazur — XOR and iris" section
  showing programmatic and CLI flows for the new fixtures.
- `README.md`: updated CLI section, new "Quick demos" block with XOR + iris
  one-liners, and the "What this is" section now mentions v0.3 generalized
  engine + hybrid tolerance + multi-step.

### Determinism scope

Unchanged from v0.2 for sigmoid (Math.exp on V8 / Node 22 — see
`docs/canonical-emission.md` for the binary64 pinning policy). ReLU is
exact arithmetic (no transcendental). Identity is trivially exact. The XOR
and iris fixtures inherit the V8/Node 22 ULP envelope from the Mazur
spine — they're pinned against the same runtime, not against an external
published anchor.

### Migration notes (v0.2.0 → v0.3.0)

- Receipts with `schema_version: "0.1.0"` (Mazur) continue to validate
  against the v0.1.0 schema unchanged. `bp reconcile receipt`,
  `bp verify mazur`, `bp generate mazur`, and `bp validate` all keep
  their v0.2 behavior.
- Receipts emitted by `runGeneralStep` declare
  `schema_version: "0.2.0"`. Consumers that read receipts and need to
  route by version should branch on `receipt.schema_version` (the v0.2
  validator surfaces the dispatched version in its result envelope —
  see `ValidationResult.schemaVersion`).
- Consumers that parsed receipts via `JSON.parse` directly and accessed
  `numeric_policy.tolerance` as a number must now handle both shapes —
  use `normalizeTolerance(receipt.numeric_policy.tolerance)` to flatten
  to `{atol, rtol}` and read `atol` (which equals the scalar value for
  v0.1 receipts). `parseReceipt`, `validateReceiptSchema`, and the
  reconciler handle both shapes automatically.
- The Mazur golden fixture (`fixtures/mazur.golden.jsonl`) is byte-equal
  preserved against v0.2. The byte-equal regression test that pinned v0.1
  / v0.2 is unaffected by the v0.3 schema additions.

[0.3.0]: https://github.com/mcp-tool-shop-org/backprop-trace/releases/tag/v0.3.0

## [0.2.0] - 2026-05-16

### Added

- Reconciler now implements all 8 rules from `docs/reconciliation.md`. Rules 1, 2, 3, 5, 6, 7, 8 are wired alongside the v0.1 Rule 4 implementation. The `bp reconcile receipt` command now catches `output_error_signal` product mismatches (Rule 1), per-contribution and backpropagated-sum mismatches (Rule 2), `hidden_error_signal` mismatches (Rule 3), `update == learning_rate * gradient` mismatches (Rule 5), `weight_after == weight_before + update` mismatches (Rule 6), `parameters_after` consistency including the constant-bias exact-zero-delta path (Rule 7), and `factor.from` provenance reference mismatches (Rule 8).
- Eight anti-circularity bad-* fixtures shipping alongside the rule wirings (Csmith doctrine): `fixtures/bad/mazur.bad-output-signal.jsonl` (Rule 1), `mazur.bad-contribution.jsonl` + `mazur.bad-backprop-sum.jsonl` (Rule 2 per-contribution and sum paths), `mazur.bad-hidden-signal.jsonl` (Rule 3), `mazur.bad-update-value.jsonl` (Rule 5), `mazur.bad-weight-after.jsonl` (Rule 6), `mazur.bad-params-after.jsonl` (Rule 7), `mazur.bad-provenance.jsonl` (Rule 8). Each ships with a `.meta.json` sibling documenting the mutation, the targeted invariant, expected cascades, and the `bp reconcile` exit-code contract. All seven new fixtures are byte-precise mutations of `fixtures/mazur.golden.jsonl` (single-field surgery + `fixture_status` block rewrite).
- Cascade detection: when Rule N fails on parameter P and Rule N-1 also failed on the same parameter, the report marks Rule N's failure with `cascade_of_rule: N-1` so renderers can show "Note: cascades from Rule N-1. Fix Rule N-1 first." (FT-E-017).
- Factor decomposition on `ReconciliationFailure`: Rules 1, 3, 4 populate an optional `factors[]` + `product_order` so renderers can show the multiplicand chain matching the example in `docs/reconciliation.md` (FT-E-018; closes D-A-012 docs drift).
- New library exports:
  - `validateReceiptSchema` / `validateReceiptOrThrow` — Ajv-based JSON Schema validation against the bundled schema (FT-F-001).
  - `parseReceipt` / `parseReceiptJsonl` — parse + validate combo with discriminated-union error shape (FT-F-002).
  - `hashReceipt` — canonical-byte sha256 hex; the in-toto v1 attestation seam (FT-F-003).
  - `getReceiptSchema` / `SCHEMA_VERSIONS` — load the bundled schema by version, with the known-version registry (FT-F-005).
  - `verifyEngineReproduces` — re-runs the engine against a parsed receipt and reports byte-equal status (FT-F-009).
  - `extractEngineInput` — recover a `MazurInput` from a `MazurReceipt` for the verify-engine round-trip (FT-F-012).
  - `emitReceipts` — multi-record JSONL framing helper (FT-F-006).
- New `bp` CLI subcommands:
  - `bp verify mazur [<file>]` — full gate: schema validation + reconciliation + engine-reproduction (byte-equal) + `fixture_status` lifecycle + published-anchor drift. Composes the format/engine/reconciler primitives per the sigstore-go fixed-order short-circuit pattern (study-swarm finding 2).
  - `bp generate mazur [--out file] [--check]` — re-runs the engine, emits canonical bytes to stdout or `--out`, and (with `--check`) diffs against an existing file.
  - `bp validate <file>` — schema-only validation, exit 0/1 buckets.
- CLI: `--color=auto|never|always` and `NO_COLOR` environment variable support (FT-C-004).
- CLI: stdin `-` support for `reconcile receipt` and `validate` (FT-C-005).

### Changed

- `ReconciliationFailure` type adds optional `factors`, `product_order`, and `message` fields. Existing consumers that pattern-match on the v0.1 quartet (rule / parameter_id / field_path / stored / recomputed / delta / tolerance / cascade_of_rule) continue to work; the new fields are additive.
- Updated `docs/reconciliation.md` quick-reference table: all 8 rules now show "implemented (v0.2)" or "implemented (v0.1)" status. Removed obsolete "v0.2+" language elsewhere in the doc.
- `fixtures/bad/mazur.bad-gradient.meta.json`: the Rule 5 cascade from Rule 4 is now observed (no longer "expected when Rule 5 lands"). Added a v0.2 observation note about an incidental Rule 3 firing on h2 due to precision drift in the original hand-derivation (the existing T-A-005 test filters specifically on Rule 4 and is unaffected).

### Dependencies

- Added: `ajv ^8.20.0` (runtime; Ajv-based schema validation via the 2020-12 draft entry).

### Infrastructure

- New `docs/cli.md` — reference for all four `bp` subcommands (reconcile / verify / generate / validate), flags, exit-code buckets, and stdin support.
- New `docs/attestation.md` — explains canonical-byte hashing, the in-toto v1 attestation seam via `hashReceipt`, and what's deferred to v0.3+ (DSSE envelope wrapping, Sigstore/Rekor transparency log integration).
- `docs/canonical-emission.md`: documented multi-record JSONL framing (trailing-LF-after-each-record semantics per ndjson convention; `emitReceipts([r1, r2, r3])` produces `{...}\n{...}\n{...}\n`).
- New subpath exports for the v0.2 library modules: `./validate`, `./parse`, `./hash`, `./schema-loader`, `./verify-engine`, `./extract` — consumers can tree-shake to a single helper.

### Determinism scope

Unchanged from v0.1 — Node 22.x on V8. The schema validator (Ajv 2020-12) is pure-JS with no native deps and inherits V8's IEEE-754 determinism. `hashReceipt` uses `node:crypto`'s sha256, which is deterministic across Node versions for identical byte input.

[0.2.0]: https://github.com/mcp-tool-shop-org/backprop-trace/releases/tag/v0.2.0

## [0.1.0] - 2026-05-16

### Added

- Reconciler entry point `reconcileReceipt()` with Rule 4 (update gradient consistency) wired. Rules 1-3 and 5-8 reserved for v0.2+ — each will ship with a deliberately-broken fixture per the Csmith (Yang et al. PLDI 2011) doctrine of bad receipts preceding good receipts.
- Canonical JSONL emission with schema-ordered traversal (`x-order` annotations on every object type in the schema drive byte placement; not alphabetical, not insertion order, not `JSON.stringify`).
- Mazur 2-2-2 hand-derived fixture (`fixtures/mazur.golden.jsonl`) — single training step on the canonical pedagogical 2-input / 2-hidden / 2-output sigmoid+MSE network.
- Engine (`runMazurStep`) reproducing the Mazur fixture at 9-sig-fig trace fidelity within the V8/Node 22 ULP envelope.
- Formatter policy fixture (`fixtures/formatter.policy.golden.json`) with 24 test cases covering round-half-to-even, carry propagation, negative-zero normalization, scope rejection, and tie cases.
- Anti-circularity bad-gradient fixture (`fixtures/bad/mazur.bad-gradient.jsonl`) — deliberately mutates `updates[4].gradient` by 1e-6 (1000x tolerance) so the reconciler must catch the rule violation BEFORE consulting `fixture_status` lifecycle metadata.
- `bp` CLI with `reconcile receipt <file>` subcommand.
- Receipt JSON Schema (`schemas/receipt.v0.1.0.json`) — JSON Schema draft 2020-12, `additionalProperties: false`, `x-order` on every object.
- Doctrine docs: `docs/canonical-emission.md`, `docs/computation-order.md`, `docs/reconciliation.md`.

### Documentation

- Add `docs/schema.md` walking through `schemas/receipt.v0.1.0.json` field-by-field with rationale, cross-referencing canonical-emission (RFC 8785 / RFC 8949 §4.2 alternatives) and the in-toto attestation seam.
- Add `docs/quickstart.md` — five-minute walk-through from install through CLI + library usage.
- Add "Why backprop-trace?" + "30-second quickstart" to `README.md`.
- Add quick-reference table for the eight reconciliation rules in `docs/reconciliation.md` (v0.1 implemented vs v0.2+ deferred).
- Add `human_readable_summary` field to `fixtures/mazur.published.json` so readers understand the drift ledger before parsing the structured claims.
- Cite Csmith (Yang et al. PLDI 2011) and CompCert (Leroy CACM 2009) as the academic lineage for the anti-circularity / "bad receipts precede good receipts" doctrine (in `docs/reconciliation.md`).

### Infrastructure

- Add `.github/workflows/codeql.yml` — weekly CodeQL scans (javascript-typescript) on Mondays 06:00 UTC plus on every push/PR to main.
- Add `.github/dependabot.yml` — weekly npm and github-actions update scans, grouped dev-dependency updates.
- Add `.github/ISSUE_TEMPLATE/bug_report.md` and `.github/ISSUE_TEMPLATE/feature_request.md` so first-time reporters know what context to include (version, Node, OS, receipt file, law-stack alignment for feature requests).
- Add `.github/pull_request_template.md` with an explicit anti-circularity checklist for PRs that wire new reconciler rules.

### Determinism scope

Pinned to Node 22.x on V8. Cross-engine portability (Hermes, JSC, Bun-JSC) is not tested. The widely-cited downstream anchor `0.291027924` differs from the engine value `0.29102777369359933` by ~1.5e-7; see `fixtures/mazur.published.json` for the drift ledger.

[0.1.0]: https://github.com/mcp-tool-shop-org/backprop-trace/releases/tag/v0.1.0
