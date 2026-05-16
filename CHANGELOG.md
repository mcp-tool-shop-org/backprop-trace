# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Note: the `schema_version` field inside receipts (`"0.1.0"`) is the receipt-format
version, which is versioned independently of this npm package version. A receipt
written today against schema 0.1.0 will still validate against schema 0.1.0 in
v0.5 of the package.

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
