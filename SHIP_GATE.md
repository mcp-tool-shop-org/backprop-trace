# Ship Gate — backprop-trace

> Audit re-run: 2026-05-17 against the v0.7.0 work session.
> Applicable tags: `[all]` `[npm]` `[cli]`. SKIP: `[mcp]` `[desktop]` `[vsix]` `[container]` `[complex]`.

---

## ⚠ v0.7.0 is NOT a v1.0.0 promotion

This Ship Gate's hard gates A–D close at v0.7.0 — the **artifact-hygiene** readiness slice. **They do NOT clear v1.0.0 promotion.** v1.0.0 requires the [Product-completeness gaps](#product-completeness-gaps-blocking-v100) section below to close first, which is multiple subsequent v0.x slices of work.

The shipcheck doctrine line "v0.x → promote, never patch-bump" means *the minimum public-release version is v1.0.0* (don't ship a real product with semver-major-zero forever). It does NOT mean *as soon as hard gates close, you must promote*. For genuinely mid-v0 products like backprop-trace today, you stay v0 until the product itself is v1.0-honest, and then you make a sober promotion.

Calling v0.7.0 "v1.0.0" would be overclaiming. The README's [What's not in this version (yet)](./README.md#whats-not-in-this-version-yet) section is the cold-user-facing version of the same disclosure.

---

## A. Security Baseline

- [x] `[all]` SECURITY.md exists (2026-05-17) — content-rich; in-scope/out-of-scope; disclosure timeline; supported-versions table refreshed for the 0.5.x → 0.7.x window.
- [x] `[all]` README includes threat model paragraph (2026-05-17) — dedicated `## Threat model` section added in v0.7.0 README rewrite. Names in-scope (schema bypass, NaN poisoning, canonical-emission divergence, anti-circularity, engine-recompute disagreement) + out-of-scope + determinism perimeter + producer-trust-boundary; links to SECURITY.md for full enumeration.
- [x] `[all]` No secrets, tokens, or credentials in source or diagnostics output (2026-05-17) — grep clean. No network calls in src/. Diagnostics write filenames + numerics only.
- [x] `[all]` No telemetry by default (2026-05-17) — zero runtime deps that phone home (only `ajv`); zero analytics/tracking imports anywhere in src/. README states this explicitly.

### Default safety posture

- [x] `[cli]` SKIP: Dangerous-action flag pattern N/A — backprop-trace is a read-only verifier + canonical emitter; no kill / delete / restart / network operations exist. Output writes are user-named via `--out <file>` only.
- [x] `[cli]` File operations constrained to known directories (2026-05-17) — Reads: user-supplied paths or stdin (`-`). Writes: only via `--out <file>` (user-named). No implicit writes outside CWD; no temp-file leakage.
- [ ] `[mcp]` SKIP: not an MCP server.
- [ ] `[mcp]` SKIP: not an MCP server.

## B. Error Handling

- [x] `[all]` Errors follow the Structured Error Shape (2026-05-17) — `exitWithUsageError` extended to emit Tier-1 envelope `{ok:false, error:{code, message, hint?, cause?, retryable?}}` under `--json`. ENOENT / EACCES / EISDIR / BP_JSONL_PARSE_ERROR / INVALID_JSON / IO_ERROR callers migrated to structured `hint` / `retryable` fields as proof. Legacy callers (embed-Hint-in-message style) continue to work; incremental migration is a v0.7.x task and does not block this gate. New test plate `test/cli.error-envelope.test.ts` asserts the Tier-1 contract.
- [x] `[cli]` Exit codes documented (2026-05-17) — 0 ok · 1 verification failure / import differential disagreement · 2 usage or I/O error · 3 invalid CLI argument · 4 reserved (framework adapter declared but not implemented). Documented in bp.ts header, README, and `bp --help`. Semantic deviation from the canonical shipcheck spec (exit 1 = verification failure here, not user error) is justified for a verifier tool where exit 1 = "the math doesn't add up" is the primary domain signal CI consumers tune against.
- [x] `[cli]` No raw stack traces without `--debug` (2026-05-17) — `exitWithUsageError` and `exitOnReadError` translate Node ErrnoException codes to clean human messages. `--debug` flag itself is not yet implemented (deferred to v0.7.x); no current path leaks raw stacks regardless.
- [ ] `[mcp]` SKIP: not an MCP server.
- [ ] `[mcp]` SKIP: not an MCP server.
- [ ] `[desktop]` SKIP: not a desktop app.
- [ ] `[vscode]` SKIP: not a VS Code extension.

## C. Operator Docs

- [x] `[all]` README is current (2026-05-17) — v0.7.0 rewrite landed. Surface accurate: 16 rules (not 10), 16+ subcommands (not 13), softmax+CE / external trace ingestion / observer-mode receipts / PyTorch+JAX+TensorFlow import all documented. Full subpath import list updated. Explicit Threat model section. Honest "What's not in this version (yet)" section names the v1.0 product-completeness gaps in plain English.
- [x] `[all]` CHANGELOG.md (Keep a Changelog format) (2026-05-17) — header references Keep-a-Changelog 1.1.0 + SemVer 2.0.0. [0.7.0] entry added with Added / Changed / Tests / Migration-notes headings; all releases v0.1.0 → v0.7.0 documented.
- [x] `[all]` LICENSE file present and repo states support status (2026-05-17) — MIT, Copyright 2026 mcp-tool-shop. Supported-versions table in SECURITY.md refreshed (0.5.x best-effort, 0.6.x previous, 0.7.x current; < 0.5 no).
- [x] `[cli]` `--help` output accurate (2026-05-17) — top-level `bp --help`, `bp reconcile receipt --help`, `bp verify general --help`, `bp validate --help`, `bp import {pytorch,jax,tensorflow} --help`, `bp import --help` all refreshed for the v0.7.0 surface. Per-verb (no-subnoun) helps (`bp reconcile --help`, etc.) still fall through to "unknown subcommand" message that suggests the correct form — not ideal UX but not a hard-gate blocker. Tracked for v0.7.x polish.
- [ ] `[cli]` PARTIAL: Logging levels defined: silent / normal / verbose / debug — secrets redacted at all levels — `--verbose` / `-V` shipped; `--quiet` / `--debug` formal flags NOT shipped (deferred to v0.7.x). Redaction is N/A — no secrets ever logged (no secrets exist in the system). Closing this fully is a soft gain, not a hard-gate blocker.
- [ ] `[mcp]` SKIP: not an MCP server.
- [ ] `[complex]` SKIP: not a complex/operational product — stateless deterministic verifier, no daemons, no state files, no operational modes.

## D. Shipping Hygiene

- [x] `[all]` `verify` script exists (2026-05-17) — added to `package.json scripts`: `"verify": "pnpm typecheck && pnpm test && pnpm build"`. Single command for contributors.
- [ ] `[all]` Version in manifest matches git tag — N/A pre-tag. Current HEAD is untagged (standing user constraint: no tags through v0.7.x). Becomes PASS only when a tag is created on a HEAD whose package.json version field matches.
- [x] `[all]` Dependency scanning runs in CI (2026-05-17) — `.github/workflows/ci.yml` now includes a separate `audit` job running `pnpm audit --audit-level=moderate` alongside the test + byte-equal matrix. CodeQL (separate workflow) covers SAST. Dependabot (`.github/dependabot.yml`) handles updates.
- [x] `[all]` Automated dependency update mechanism exists (2026-05-17) — `.github/dependabot.yml` configures weekly npm + github-actions updates with `dev-dependencies` grouping; 5 PR limit on npm, 3 PR limit on actions.
- [x] `[npm]` `npm pack --dry-run` includes: dist/, README.md, CHANGELOG.md, LICENSE (2026-05-17) — verified at v0.6.1; v0.7.0 additions (`./import-tensorflow` subpath, TF fixtures) included via the existing `files[]` globs (`dist/**`, `schemas/**`, `fixtures/**`, `docs/**`).
- [x] `[npm]` **Distribution integrity (pack/install smoke) runs in CI** (2026-05-18, v0.10.2) — `scripts/pack-install-smoke.mjs` + `.github/workflows/pack-smoke.yml` run on every push/PR across `ubuntu-latest + macos-latest + windows-latest`. Six-step gate: (1) `pnpm pack`, (2) tarball size ceiling (10 MB), (3) tarball content listing asserts every load-bearing file (helper, examples, schemas v0.6.0+v0.7.0+receipt v0.7.0, three helper-emitted goldens, Mazur golden, adversarial fixtures) is present, (4) cold install of the `.tgz` into a fresh `mkdtemp` dir via `npm install <abs-tarball-path>`, (5) CLI smoke matrix on the installed `bp` binary (`--help`, `--version`, `examples pytorch`, `examples pytorch --print` with `HELPER_VERSION` lockstep check, `verify mazur`, `import pytorch <installed sidecar>`), (6) pipe smoke (`import | verify multi -` via stdin + file roundtrip). Caught two real distribution-integrity bugs during v0.10.2 development: helper `HELPER_VERSION` drifted from `package.json` version, and `bp verify mazur`/`generate xor/iris` used cwd-relative bundled-fixture paths that broke in any installed package. Both fixed; smoke now enforces.
- [x] `[npm]` `engines.node` set (2026-05-17) — `"node": "22.x"` pinned (load-bearing for V8 fdlibm `Math.exp` determinism per `docs/computation-order.md`).
- [x] `[npm]` Lockfile committed (2026-05-17) — `pnpm-lock.yaml` present; pnpm version pinned via `"packageManager": "pnpm@10.28.2"` in package.json.
- [ ] `[vsix]` SKIP: not a VS Code extension.
- [ ] `[desktop]` SKIP: not a desktop app.

## E. Identity (soft gate — does not block ship)

- [x] `[all]` Logo in README header (2026-05-17) — hosted at `https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/backprop-trace/readme.png`, 400px wide, centered.
- [x] `[all]` Translations (polyglot-mcp, 8 languages) (2026-05-17) — README.{ja,zh,es,fr,hi,it,pt-BR}.md re-generated via TranslateGemma 12B after README rewrite settled. Source-of-truth navigation bar in README.md header.
- [x] `[org]` Landing page (@mcptoolshop/site-theme) (2026-05-18, v0.10.3) — `site/` scaffolded via `npx @mcptoolshop/site-theme init`; `site-config.ts` written for the v0.10 surface (hero with 3 preview cards including live PyTorch helper, 6 features sections, 5 code cards, Mid-v0 badge, no npm badge until publishing). Deploys to https://mcp-tool-shop-org.github.io/backprop-trace/ via `.github/workflows/pages.yml`. Handbook (Starlight, blue accent) scaffolded via `npx @mcptoolshop/site-theme handbook --accent blue`; 6 pages replace the 3 starter pages (index, getting-started, usage, reference, architecture, security). Pagefind search index built. Site renders 7 pages clean in 7.8s.
- [x] `[all]` GitHub repo metadata: description, homepage, topics (2026-05-17) — description rewritten for the v0.7 surface ("16 rules", external trace ingestion, mid-v0 disclosure); 8 new topics added (softmax, cross-entropy, pytorch-import, jax-import, tensorflow-import, external-trace-ingestion, observer-mode-receipts, attestor); `proof-of-learning` dropped (technically misleading per the Fang 2023 PoL forgeability caveat the README now cites).

---

## Hard-gate summary

**A (Security):** 6 PASS · 2 SKIP-MCP · 1 SKIP-N/A (cli safety flag) = ✅ CLOSED
**B (Errors):** 3 PASS · 4 SKIP-MCP/desktop/vscode = ✅ CLOSED
**C (Docs):** 4 PASS · 1 PARTIAL (silent/debug flag deferred — soft gain) · 2 SKIP = ✅ CLOSED for v0.7.0
**D (Hygiene):** 6 PASS · 1 N/A pre-tag (becomes PASS at tag) · 2 SKIP = ✅ CLOSED
**E (Identity, soft):** 3 PASS · 1 DEFERRED (landing page) = soft gate, no block

Hard gates A–D pass for v0.7.0 within the explicit v0.x scope. **This does NOT imply v1.0.0 promotion** — see below.

---

## Product-completeness gaps blocking v1.0.0

These are NOT shipcheck items. Shipcheck is about *artifact hygiene* (does the package look professional, does it have docs, does it test, does the error envelope conform to spec). These are about *whether the product is what its v1.0.0 promise would imply*.

backprop-trace v0.7.0 is a **strong proof-of-concept for a structural-trace verifier in the deterministic-CPU corner**. The framework-trace.v0.1.0 pattern is real and durable (proven across three adapters: PyTorch, JAX, TensorFlow). The Csmith/CompCert anti-circularity ratchet is real and load-bearing. The byte-equal-vs-golden discipline is real. But the product surface is mid-v0, and shipping it as v1.0.0 would be overclaiming.

The following gaps must close before any v1.0.0 promotion:

| Gap | Why it blocks v1.0.0 | Targeted next |
|---|---|---|
| **Multi-step observer-mode receipts.** External ingestion is single-step today. Engine-authored receipts support `trace_id` + `step_index` overlays via `bp verify multi`; observer-mode imports do not. | Real ML training is thousands of steps. A v1.0 "verify your training trace" tool that can only ingest a single step from external sources is a tell that it's not for real workloads. | v0.8 |
| ~~Optimizers beyond vanilla SGD.~~ ~~No Adam, AdamW, momentum, or weight decay.~~ | ~~Real ML training in 2026 is overwhelmingly Adam by default. SGD-only verifiers won't get used for anything past coursework. Minimum bar: Adam or AdamW; momentum + weight decay an acceptable subset for "we don't have full Adam yet but the optimizer surface is real."~~ | **MOSTLY CLOSED in v0.9.3** — v0.9.1 shipped Adam + AdamW; v0.9.2 shipped classical PyTorch-style SGD momentum; v0.9.3 widens to Nesterov accelerated gradient + dampening via receipt.v0.7.0 + framework-trace.v0.6.0 forced bump (`nesterov: const false → boolean`; `dampening: const 0 → number ∈ [0, 1)`) + Rule 21 splits to 21a/21b/21c. PyTorch combo rejection (`nesterov=true && dampening>0`) enforced at both schema (allOf if/then with `required: ["nesterov"]` to avoid vacuous matching) and engine boundary. Sutskever et al. 2013 ICML / Polyak 1964 / PyTorch `torch.optim.SGD` convention preserved (`lr` outside the buffer; Rule 26 excludes `learning_rate` from constancy so LR schedules stay legitimate). v0.9.3 closes the SGD momentum branch cleanly. Remaining: SGD coupled L2 weight decay deferred to v0.10 (Rules 6/7 third branch). |
| ~~Momentum SGD.~~ ~~Production ResNet-family training still uses SGD+momentum (Wilson et al. 2017 arXiv:1705.08292).~~ | ~~A v1.0 verifier covering "optimizers used in 2026 production ML" must cover momentum SGD alongside Adam.~~ | **CLOSED in v0.9.2** — classical PyTorch-style SGD momentum shipped. Nesterov widened in v0.9.3. |
| ~~**Nesterov accelerated gradient + dampening (SGD momentum variants).**~~ ~~v0.9.2 ships classical PyTorch-style momentum; Nesterov (lookahead form) reserved for v0.9.3. timm uses SGD+Nesterov as standard option for vision (Wilson et al. 2017 arXiv:1705.08292 §5 documents the generalization advantage).~~ | ~~A v1.0 verifier covering production vision training (ResNet/EfficientNet via timm) needs Nesterov.~~ | **CLOSED in v0.9.3** — `receipt.v0.7.0` + `framework-trace.v0.6.0` widens `nesterov` to boolean and `dampening` to `number ∈ [0, 1)`. Engine uses PyTorch's `torch.optim.SGD` recurrence (`buffer_t = mu * buffer_{t-1} + (1 - tau) * gradient`; `effective = gradient + mu * buffer_t` if nesterov else `buffer_t`; `update = lr * effective`). PyTorch's `nesterov=true && dampening>0` ValueError mirrored at schema + engine. `effective` is derived per-rule-application, never stored. 7 new fixtures (3 good single/multi-step + 4 bad covering formula mismatch, flag mismatch, dampening ignored, flag inconstancy). v0.9.2 classical fixtures byte-identical under the v0.9.3 engine. |
| ~~Batch dimension.~~ | ~~Single-sample only. No batched forward / backward.~~ | **CLOSED in v0.9.0** — batched observer-mode ingestion shipped via framework-trace.v0.3.0 + receipt.v0.4.0 additive batch block + per_sample block + Rules 18 (batch reduction consistency) and 19 (sample-set coherence). v0.9.0 ships reduced gradients only; per-sample gradients are v0.9.x / v0.10. |
| **Per-sample gradients in batched receipts.** v0.9.0 ships REDUCED gradients only — the gradient the optimizer actually applied is a single scalar per parameter. Per-sample gradient decomposition (the full `N × \|params\|` matrix) is useful for influence audits and sample-poisoning detection but was deferred. | A v1.0 batched verifier should optionally expose per-sample gradients so users can audit individual sample contributions. v0.9.0 establishes the batch axis; v0.9.x adds the per-sample gradient layer GATED on opt-in. | v0.9.x / v0.10 |
| ~~**Live framework helpers.** The framework-trace sidecar is hand-authored today.~~ ~~The path from "I have a PyTorch training step" to "I have a verified receipt" is: read schema → set up Python → write extractor by hand → match canonical-numeric format → emit JSONL.~~ | ~~Almost nobody will do this. Without a live helper, external ingestion is a docs-grade workflow, not a real one.~~ | **PyTorch CORE OPTIMIZER MATRIX CLOSED in v0.10.1** — `scripts/extract/pytorch.py` covers the full PyTorch optimizer surface the verifier supports: **SGD + Adam + AdamW + sgd_momentum (classical + Nesterov + dampening)**, with the load-bearing `momentum_buffer` sign-flip at the extraction boundary (PyTorch ascent → backprop-trace descent; per PyTorch issue #1099). CPU-first; single-step + multi-step. Workflow: `bp examples pytorch --print > pytorch_trace_helper.py` then `from pytorch_trace_helper import TraceDumper`. The helper is OBSERVER-ONLY: emits `framework-trace.v0.7.0` sidecars with a FORENSIC `helper` block (forensic, not credential); Rule 14 (engine-recompute differential) remains the authority. NO pip package by design — flip-signal contract (≥3 non-team-user requests + non-trivial dependency need) documented in `docs/live-helpers.md`. SGD coupled-L2 / AMP / GPU / AMSGrad / NAdam / RAdam / Lion / LBFGS REJECTED at boundary. 9 adversarial fixtures under `fixtures/bad/pytorch-helper.bad-*` exercise verifier rejection of simulated helper bugs including bad-momentum-buffer-not-sign-flipped (Rule 14) and bad-adamw-as-coupled-l2 (Rule 6). Anti-circularity preserved across all fixtures. v0.11+: JAX (adopter-pull); TF (gated on JAX clean shipment). |
| **Real-world fixture.** The hero is the Mazur 2-2-2 pedagogical example. No CNN, no transformer block, no recognizable production architecture. | A v1.0 verifier should have at least one recognizable architecture (small CNN forward+backward, a single transformer block, a single LayerNorm + attention head) as a built-in fixture so cold reviewers see "yes, this is real ML." | v0.11 |
| **Adopter validation.** No external researcher case study, no course adopting backprop-trace for pedagogy, no compliance engineer who used it for an audit bundle. | v1.0.0 = "we think this is ready" without proof points isn't enough. Other repos in the mcp-tool-shop-org (vocal-synth-engine, ollama-intern-mcp, research-os, role-os) have substantive feature surfaces backing their v1+ status. backprop-trace must demonstrate at least one external (or substantive internal) use case before v1.0. | v0.12 — before any v1.0 promotion |
| **package.json description.** v0.6.1 carried an internal release-engineering paragraph ("v0.6.1 adds JAX adapter — v0.6.0 path; v0.5 softmax+CE — v0.4 authoring spine — v0.3 generalized topology"). Cold readers parsed it as "early-stage internal tool." | A v1.0 npm package description should sell what the product does, not narrate its release history. Rewriting this is in scope for v0.7.0. | DONE in v0.7.0 |
| **GPU determinism.** Currently CPU-only by design. Out of scope for v0.x and likely to remain so. | Documented as scope, not a gap — cuDNN ConvolutionBackwardFilter atomics defeat bit-exactness across runs even on identical hardware (CMU SEI). The product position is "deterministic CPU corner." Communicating this clearly is enough; expanding to GPU is a separate product, not a backprop-trace v2. | OUT OF SCOPE (permanent) |

This list is the same as the README's [What's not in this version (yet)](./README.md#whats-not-in-this-version-yet) section, expanded with v1.0 promotion blockage rationale.

---

## What v0.7.0 does

- Closes shipcheck hard gates A–D within the explicit v0.x scope
- Refreshes the README from the v0.4 frozen mental model to the v0.7 product truth (honest about mid-v0 status)
- Ships the third framework adapter (TensorFlow) — empirical proof the v0.6 framework-trace pattern generalizes beyond two
- Hardens the CLI error envelope to Tier-1 structured shape
- Refreshes operator documentation, supported-versions table, contributor guide, and GitHub metadata
- Rewrites the npm package description out of internal release-engineering copy

## What v0.7.0 does NOT do

- Does **not** promote to v1.0.0
- Does **not** add multi-step observer-mode receipts (single-step external ingestion remains)
- Does **not** add optimizers beyond SGD
- Does **not** add batch dimension
- Does **not** ship live framework helpers (sidecar remains hand-authored)
- Does **not** add a real-world fixture
- Does **not** add adopter validation
- Does **not** add a landing page or Starlight handbook
- Does **not** tag, publish to npm, or create a GitHub release

---

## Gate Rules (reference)

**Hard gate (A–D):** Must pass before any version is tagged or published.
If a section doesn't apply, mark `SKIP:` with justification.

**Soft gate (E):** Should be done. Product ships without it, but isn't "whole."

**Checking off:** `- [x] [tag] item (YYYY-MM-DD)`

**Skipping:** `- [ ] [tag] SKIP: justification`
