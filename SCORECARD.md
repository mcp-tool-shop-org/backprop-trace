# Scorecard — backprop-trace

**Repo:** mcp-tool-shop-org/backprop-trace
**Date:** 2026-05-17
**HEAD:** `1b8855c` (v0.6.1)
**Type tags:** `[all]` `[npm]` `[cli]`
**Pre-remediation audit gate result:** HARD GATE FAIL — v1.0.0 promotion blocked

## Pre-Remediation Assessment

| Category | Score | Notes |
|----------|-------|-------|
| A. Security | 8/10 | SECURITY.md content-rich; threat model implicit in README (not explicit header); supported-versions table stale (lists 0.1.x only). Zero telemetry, zero network calls, zero secret-handling. |
| B. Error Handling | 7/10 | Exit codes documented (4-bucket); structured JSON envelope partial (`{ok:false, error:{code, message}}`); missing `hint` as separate field, no `cause?`/`retryable?`. Reconciler failures use `{rule, field_path, message}` schema, not Tier-1 shape. |
| C. Operator Docs | 4/10 | CHANGELOG + LICENSE pass. README **FROZEN AT v0.4** — claims 10 rules (now 16), 13 subcommands (now 15+), softmax+CE "reserved for v0.5+" (shipped v0.5.0). v0.5 + v0.6 + v0.6.1 entirely invisible. --help per-subcommand spot-audit needed. |
| D. Shipping Hygiene | 6/10 | Tarball clean (dist/, README, CHANGELOG, LICENSE, schemas/, fixtures/, docs/, SECURITY); pnpm-lock + engines.node + dependabot all pass. Missing: `verify` script, `pnpm audit` step in CI. D2 N/A pre-tag. |
| E. Identity (soft) | 6/10 | Logo + 7 translations present. GitHub description/topics stale (mentions "10 mathematical rules"). No landing page. |
| **Overall** | **31/50** | Hard-gate fail. v1.0.0 blocked on C1 (README rewrite, load-bearing) + D1 (verify script, trivial). |

## Key Gaps

1. **C1 — README rewrite (HARD GATE FAIL).** Frozen at v0.4 mental model. Doesn't mention softmax+CE, external trace ingestion, observer-mode receipts, PyTorch/JAX import, Rules 11-16. The product as documented is materially smaller than the product as shipped. Single largest remediation deliverable.

2. **D1 — `verify` script missing (HARD GATE FAIL).** Trivial fix: add `"verify": "pnpm typecheck && pnpm test && pnpm build"` to package.json scripts.

3. **B1 — Structured Error Shape partial.** Envelope has `code` + `message` only. Tier-1 spec calls for `hint`, optional `cause?` + `retryable?`. Currently hints are concatenated into message strings — harder for CI consumers to parse. Moderate refactor.

4. **D3 — CI dep scanning missing.** CodeQL runs SAST but no `pnpm audit` step. Trivial fix: add as a CI job.

5. **Staleness sweep.** SECURITY.md supported-versions table, CONTRIBUTING.md "eight reconciler rules" line, bp.ts docstring "v0.3 surface" / "10 rules wired as of v0.3", GitHub repo description + topics, README threat-model paragraph (implicit → explicit header).

## Remediation Priority

| Priority | Item | Estimated effort |
|----------|------|-----------------|
| 1 | README full rewrite for v0.6.1 surface (incl. softmax+CE, external trace ingestion, PyTorch/JAX import, 16 rules, 15+ subcommands, full subpath import list, dedicated "Threat model" section) | 2-3 hours |
| 2 | Add `verify` script to package.json + `pnpm audit` step to ci.yml | 15 min |
| 3 | Refactor `exitWithUsageError` to emit Tier-1 envelope (`{ok:false, error:{code, message, hint, cause?, retryable?}}`); migrate concatenated hints to separate field; document in docs/cli.md | 60-90 min |
| 4 | Staleness sweep: SECURITY.md versions table, CONTRIBUTING.md, bp.ts docstring, GH description + topics | 30 min |
| 5 | --help spot-audit on all 15+ subcommands; fix any drift | 30 min |
| 6 | Translation re-run via TranslateGemma 12B AFTER README is locked, BEFORE v1.0.0 tag | 5 min hands-on + 5-15 min compute |
| 7 | (Optional) Add `--quiet` / `--debug` formal flags; defer to v1.0.x if scope cap exceeded | 60 min |
| 8 | (Soft / Phase 3) Starlight handbook + landing page via @mcptoolshop/site-theme | Separate workstream |

## Post-Remediation Targets

| Category | Before | Target After |
|----------|--------|--------------|
| A. Security | 8/10 | 10/10 (add explicit README threat-model header + refresh SECURITY.md versions table) |
| B. Error Handling | 7/10 | 9/10 (Tier-1 envelope with hint; defer --debug for 10/10) |
| C. Operator Docs | 4/10 | 9/10 (README rewrite; --help spot-audit pass; defer --quiet for 10/10) |
| D. Shipping Hygiene | 6/10 | 10/10 (verify script + pnpm audit + v1.0.0 tag matches manifest) |
| E. Identity (soft) | 6/10 | 8/10 (refresh GH description + topics; defer landing page for 10/10 — Phase 3 of full-treatment) |
| **Overall** | **31/50** | **46/50** (47/50 if --quiet/--debug land in scope; 50/50 once Phase 3 handbook + landing page ship) |

## Decisions to Lock Before Remediation

1. **v1.0.0 promotion** — shipcheck doctrine says v0.x → promote, never patch-bump. Confirms backprop-trace bumps to v1.0.0 once hard gates close.
2. **TensorFlow timing** — defer to v1.0.x patch series post-release (per user's bias). Two adapters substantiate the "pattern generalizes" claim.
3. **Landing page (E3)** — defer to Phase 3 of full-treatment after v1.0.0 ships. Doesn't block hard gate.
4. **README hero example** — what's the single command that demonstrates value? Candidates: `bp generate mazur | bp reconcile receipt -` (pure backprop story) OR `bp import pytorch fixtures/external/pytorch.softmax-ce.sidecar.jsonl` (external-ingestion story). Study-swarm question.
5. **Audience statement** — who is this for? ML practitioners debugging training? Security/audit folks verifying AI provenance? Reproducibility researchers? Determines README structure and elevator pitch. Study-swarm question.
6. **Optional --quiet/--debug flags** — in scope for v1.0.0 or defer to v1.0.x? Recommend defer (Tier-1 envelope is the load-bearing gain; flags are cosmetic).
