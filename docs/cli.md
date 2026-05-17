# `bp` CLI reference

The `bp` binary is the user-facing entry point for `@mcptoolshop/backprop-trace`.
It exposes eight subcommands that compose the library's primitives into the
common verification flows: reconcile, verify (full gate; Mazur / general /
multi-step), generate (Mazur / XOR / iris), validate.

The CLI is dependency-free (no commander / yargs / citty); the argv dispatch
is hand-rolled at `src/bin/bp.ts` per the study-swarm CLI-ergonomics finding
(`commander` and `citty` don't add value at the v0.3 surface size).

```
bp <verb> <noun> [args]
```

Run `bp --help` for the at-a-glance summary, `bp <subcommand> --help` for
the subcommand-specific text.

## Subcommands at a glance

| Command | Purpose | Typical exit |
|---|---|---|
| `bp reconcile receipt <file>` | Run the 8 per-record reconciliation rules against a receipt | 0 / 1 |
| `bp verify mazur [<file>]` | Full gate (Mazur): schema + reconcile + engine-reproduce + byte-equal + drift | 0 / 1 |
| `bp verify general <file>` | Generalized verify gate for any v0.2.0-schema receipt | 0 / 1 |
| `bp verify multi <file.jsonl>` | Multi-record verify: Rules 9 + 10 + per-record Rules 1-8 (v0.3+) | 0 / 1 |
| `bp generate mazur [--out F] [--check]` | Re-run the Mazur engine, emit canonical JSONL | 0 / 1 |
| `bp generate xor [--out F]` | Re-run the XOR engine, emit canonical JSONL (v0.3+) | 0 / 1 |
| `bp generate iris [--out F]` | Re-run the iris engine, emit canonical JSONL (v0.3+) | 0 / 1 |
| `bp validate <file>` | Schema-only validation; auto-detects v0.1.0 vs v0.2.0 | 0 / 1 |

All subcommands accept `-` as the file argument to read from stdin
(except `generate mazur / xor / iris`, which write rather than read).

## Subcommand: `bp reconcile receipt`

```
bp reconcile receipt <file> [--json] [--verbose] [--color=auto|never|always]
```

Reconcile a single-record receipt against the 8 reconciliation rules
documented in [`docs/reconciliation.md`](./reconciliation.md).

- **Math only.** This subcommand does not check byte equality vs a golden, does
  not consult `fixture_status`, does not validate against the JSON Schema
  (schema validity is an upstream pass — see `bp validate`), and does not
  reach out to the published-anchor ledger. For the full gate, use
  `bp verify mazur`.

- **Single record.** v0.1 + v0.2 accept exactly one record per `.jsonl` file
  or one whole-file `.json` document. Multi-record JSONL is reserved for
  the `bp verify` and `bp diff` v0.3+ surfaces.

### File arguments and stdin

| Form | Behavior |
|---|---|
| `bp reconcile receipt foo.json` | Parse the whole file as one JSON document. |
| `bp reconcile receipt foo.jsonl` | Strict JSONL: each non-empty line is a record. v0.1 limit: 1 record. |
| `bp reconcile receipt foo.jsonl` (pretty-printed) | Fallback: parse the whole file as one JSON document. |
| `bp reconcile receipt -` | Read from stdin. The content is parsed identically to `.json`. |

### Exit codes (this subcommand)

| Code | Meaning |
|---|---|
| 0 | All 8 per-record rules pass within `numeric_policy.tolerance`. |
| 1 | At least one reconciliation rule failed. Details on stderr (or stdout under `--json`). |
| 2 | Usage error, I/O error, malformed JSON, or `>1` record in a `.jsonl` file. |
| 3 | Invalid CLI argument (e.g. unknown flag). |

Rules 9 + 10 do NOT fire from `bp reconcile receipt` — multi-step
verification lives in `bp verify multi` (see below).

### Output

Default (text): a `reconciliation failed` marker on stderr, then one block
per failure with the canonical quartet (`stored`, `recomputed`, `delta`,
`tolerance`) plus factor decomposition where available. Matches the
example in [`docs/reconciliation.md`](./reconciliation.md#reporting-format).

`--json`: a discriminated-union envelope on stdout:

```json
{ "ok": true }
```

or

```json
{
  "ok": false,
  "failures": [
    { "rule": 4, "parameter_id": "w5", "field_path": "updates[4].gradient",
      "stored": -0.082166041, "recomputed": -0.082167041,
      "delta": 1.0e-6, "tolerance": 1.0e-9 }
  ]
}
```

### Examples

```bash
# Happy path — exit 0, no output.
bp reconcile receipt fixtures/mazur.golden.jsonl

# Anti-circularity demo — exit 1, Rule 4 failure on w5.
bp reconcile receipt fixtures/bad/mazur.bad-gradient.jsonl

# Pipe from another tool.
cat receipt.json | bp reconcile receipt -

# JSON output for CI consumers.
bp reconcile receipt receipt.json --json
```

## Subcommand: `bp verify mazur`

```
bp verify mazur [<file>] [--json] [--verbose] [--warn-as-fail] [--strict] [--color=...]
```

The **full gate** advertised at [`docs/reconciliation.md`](./reconciliation.md#command-surface).
Composes the library primitives in a fixed-order short-circuit pipeline
(sigstore-go pattern; study-swarm verifier-composition finding):

1. **Schema validation** against `schemas/receipt.v0.1.0.json` (via Ajv 2020-12).
2. **Reconciliation** against the 8 rules — see `bp reconcile receipt` above.
3. **Engine reproduction** — re-run the engine with the receipt's inputs and
   confirm the produced receipt is byte-equal to the supplied one.
4. **Byte equality** against `fixtures/mazur.golden.jsonl` (the canonical
   golden file shipped in the package).
5. **`fixture_status` enum checks** — refuse to certify any receipt whose
   `fixture_status.canonical: true` while `verification_state` is not yet
   `engine_reproduced_byte_equal`.
6. **Published-anchor drift** against `fixtures/mazur.published.json`. Claims
   with `hard_gate: true` fail the build; `hard_gate: false` claims emit
   a WARN line but do not fail unless `--warn-as-fail`.

The file argument is optional: the default is `fixtures/mazur.golden.jsonl`.

### Gating knobs

| Flag | Effect |
|---|---|
| (none) | Default. Hard-gate failures => exit 1; WARN findings do not affect exit code. |
| `--warn-as-fail` | WARN findings (e.g. soft drift) escalate to FAIL. |
| `--strict` | Any non-PASS finding (WARN, SKIP) escalates to FAIL. |

These match the 4-bucket convention from the study-swarm verifier-composition
finding: 0 pass, 1 fail, 2 warn-only-when-gated, 3 input/config error.

### Output

Default:

```
verification passed

  [PASS] schema
  [PASS] reconcile
  [PASS] engine-reproduce
  [PASS] byte-equal-vs-golden
  [PASS] fixture-status
  [PASS] published-anchor-drift
```

`--json` emits a `VerifyReport` envelope with `{ overall, checks: [...] }`.

### Examples

```bash
# Verify the bundled golden.
bp verify mazur

# Verify a candidate receipt.
bp verify mazur tmp/my-receipt.jsonl

# Fail on soft drift (useful in CI).
bp verify mazur --warn-as-fail --json
```

## Subcommand: `bp generate mazur`

```
bp generate mazur [--out <file>] [--check] [--json] [--color=...]
```

Re-runs the Mazur 2-2-2 engine with the canonical `MAZUR_INPUT`
(see [`src/mazur.ts`](../src/mazur.ts)) and emits a canonical JSONL
receipt.

| Mode | Behavior |
|---|---|
| (none) | Write the canonical bytes to stdout. |
| `--out F` | Write the canonical bytes to file `F` (truncating). |
| `--check` | Re-run the engine and compare against `fixtures/mazur.golden.jsonl`; exit 1 on any byte drift. Useful in CI. |

This is the inverse of `bp verify mazur`'s engine-reproduction check: rather
than verifying that a supplied receipt matches the engine, it writes the
engine's output directly. The two together close the loop — `generate`
emits, `verify` confirms.

### Examples

```bash
# Print canonical bytes (e.g. for piping into a hasher).
bp generate mazur | sha256sum

# Update the golden after an authorized engine change.
bp generate mazur --out fixtures/mazur.golden.jsonl

# CI byte-equality gate against the committed golden.
bp generate mazur --check
```

## Subcommand: `bp verify general` (v0.3+)

```
bp verify general <file> [--json] [--verbose] [--warn-as-fail] [--strict] [--color=...]
```

Generalized verify gate. Equivalent to `bp verify mazur` but for any
v0.2.0-schema receipt (XOR, iris, or a custom-topology receipt emitted
by `runGeneralStep`). Composes the same fixed-order short-circuit
pipeline (sigstore-go pattern):

1. **Schema validation** against `schemas/receipt.v0.2.0.json`.
2. **Reconciliation** against Rules 1-8 (Rules 9, 10 only fire on the
   multi-record path).
3. **Engine reproduction** — re-runs `runGeneralStep` with the receipt's
   declared topology + inputs and confirms byte-equality.
4. **Byte equality** against the bundled fixture corresponding to the
   receipt's `fixture` id (e.g. `fixtures/xor.golden.jsonl` for
   `fixture: "xor-sigmoid-engine-first-run"`) when one is known.
5. **`fixture_status` enum checks** (same enums as v0.2 plus
   `engine_generated_general` for non-Mazur receipts).

The file argument is REQUIRED — unlike `bp verify mazur`, there is no
single canonical default subject.

### Examples

```bash
# Verify the bundled iris fixture.
bp verify general node_modules/@mcptoolshop/backprop-trace/fixtures/iris.golden.jsonl

# Verify a fresh XOR receipt piped from generate.
bp generate xor | bp verify general -

# JSON output for CI.
bp verify general fixtures/xor.golden.jsonl --json
```

## Subcommand: `bp verify multi` (v0.3+)

```
bp verify multi <file.jsonl> [--json] [--verbose] [--warn-as-fail] [--strict] [--color=...]
```

Multi-record verify gate. The file argument MUST be a JSONL file
containing two or more v0.2.0-schema receipts in `step_index` order.

The gate runs in two phases (see
[`reconciliation.md` "Multi-step receipts"](./reconciliation.md#multi-step-receipts)):

1. **Per-record pass.** Each receipt runs through the same 8-rule
   reconciliation as `bp verify general`. Any per-record failure
   surfaces immediately.
2. **Cross-record pass.** Rule 10 (trace identity) fires first — a
   mismatched `trace_id` set or non-dense `step_index` sequence
   short-circuits before Rule 9. Then Rule 9 (parameter chain) fires
   across adjacent receipts.

Single-record JSONL files are rejected with exit 2 (use `bp verify
general` for those).

### Examples

```bash
# Verify a training-run JSONL.
bp verify multi training-run.jsonl

# JSON output for CI; warn-as-fail to catch soft drift.
bp verify multi training-run.jsonl --json --warn-as-fail
```

## Subcommand: `bp generate xor` (v0.3+)

```
bp generate xor [--out <file>] [--check] [--json] [--color=...]
```

Re-runs the XOR-sigmoid 2-2-1 engine with the canonical `XOR_INPUT`
(see [`src/mazur.ts`](../src/mazur.ts)) and emits a canonical JSONL
receipt. Same mode matrix as `bp generate mazur`: default writes to
stdout; `--out F` writes to file; `--check` compares against
`fixtures/xor.golden.jsonl`.

### Examples

```bash
# Print canonical XOR bytes.
bp generate xor

# CI byte-equality gate against the committed golden.
bp generate xor --check

# Pipe into a hash.
bp generate xor | sha256sum
```

## Subcommand: `bp generate iris` (v0.3+)

```
bp generate iris [--out <file>] [--check] [--json] [--color=...]
```

Re-runs the iris 4-3-3 sigmoid engine with the canonical `IRIS_INPUT`
(first iris flower `(5.1, 3.5, 1.4, 0.2)` targeting one-hot setosa
`[1, 0, 0]`). Same mode matrix as `bp generate mazur`. The output
canonical-byte sha256 is the in-toto attestation seam for an iris
training trace.

### Examples

```bash
bp generate iris --out fixtures/iris.golden.jsonl
bp generate iris --check
```

## Subcommand: `bp validate`

```
bp validate <file> [--json] [--verbose] [--color=...]
```

Schema-only validation. The validator auto-detects the receipt's
`schema_version` and dispatches against either
`schemas/receipt.v0.1.0.json` (Mazur receipts) or
`schemas/receipt.v0.2.0.json` (v0.3 generalized + multi-step receipts)
via Ajv (2020-12 draft). Reports the first validation error (fail-fast;
full-list `--all` support is reserved for v0.4+).

| Code | Meaning |
|---|---|
| 0 | Receipt conforms to the schema. |
| 1 | Receipt does not conform; the first error block is on stderr. |
| 2 | I/O error or malformed JSON. |
| 3 | Invalid CLI argument. |

### Examples

```bash
bp validate fixtures/mazur.golden.jsonl   # exit 0
bp validate broken.json                    # exit 1
cat receipt.json | bp validate -           # stdin
```

## Common options

These apply to every subcommand (subcommand-help notes where they don't):

| Option | Description |
|---|---|
| `--json` | Machine-readable JSON to stdout instead of human text on stderr. |
| `--verbose`, `-V` | Diagnostic stderr lines before the run (file path, schema_version, fixture id). |
| `--color=auto\|never\|always` | Color output policy. `auto` checks `process.stdout.isTTY` and honors `NO_COLOR`. |
| `--version`, `-v` | Print the npm package version and exit 0. |
| `--help`, `-h` | Print usage and exit 0. |

`NO_COLOR=1` in the environment disables color regardless of `--color`. This
matches the [no-color.org](https://no-color.org/) convention.

## Stdin support

`reconcile receipt`, `validate`, and `verify mazur` accept `-` as the file
argument to read from stdin:

```bash
cat mazur.golden.jsonl | bp reconcile receipt -
some-other-tool | bp validate -
```

`generate mazur` does not accept stdin; it has no input to consume.

## Exit-code conventions

All subcommands follow a 4-bucket convention loosely modeled on
shellcheck:

| Code | Meaning |
|---|---|
| 0 | Success / pass |
| 1 | Verification or reconciliation failure (the receipt is bad, not the tool) |
| 2 | I/O error, malformed JSON, or unexpected file shape |
| 3 | Invalid CLI argument or unsupported flag combination |

Distinguishing these matters for CI: `set -e` shells stop on any nonzero,
but a pipeline that retries on transient I/O errors (`2`) should not retry
on a deliberate verification failure (`1`).

## Exit codes

Every subcommand follows the same 4-bucket convention:

| Code | Meaning |
|---|---|
| 0 | Success / pass |
| 1 | Verification or reconciliation failure (the receipt is bad, not the tool) |
| 2 | I/O error, malformed JSON, unexpected file shape, or missing required argument |
| 3 | Invalid CLI argument or unsupported flag combination |

`bp verify multi <file.jsonl>` additionally returns exit 2 when the
input contains fewer than 2 records (use `bp verify general` for single-
record JSONL). `bp generate xor / iris --check` returns exit 1 on byte
drift, exit 2 on golden-file read errors.

## Where the rules live

The 10 reconciliation rules `bp reconcile receipt`, `bp verify mazur`,
`bp verify general`, and `bp verify multi` check are documented at:

- Rule 1: [`docs/reconciliation.md#rule-1-output-error-signal-consistency`](./reconciliation.md#rule-1-output-error-signal-consistency)
- Rule 2: [`docs/reconciliation.md#rule-2-downstream-contribution-and-backpropagated-sum`](./reconciliation.md#rule-2-downstream-contribution-and-backpropagated-sum)
- Rule 3: [`docs/reconciliation.md#rule-3-hidden-error-signal-consistency`](./reconciliation.md#rule-3-hidden-error-signal-consistency)
- Rule 4: [`docs/reconciliation.md#rule-4-update-gradient-consistency`](./reconciliation.md#rule-4-update-gradient-consistency)
- Rule 5: [`docs/reconciliation.md#rule-5-update-value-consistency`](./reconciliation.md#rule-5-update-value-consistency)
- Rule 6: [`docs/reconciliation.md#rule-6-weight-progression`](./reconciliation.md#rule-6-weight-progression)
- Rule 7: [`docs/reconciliation.md#rule-7-final-state-consistency`](./reconciliation.md#rule-7-final-state-consistency)
- Rule 8: [`docs/reconciliation.md#rule-8-provenance-reference-consistency`](./reconciliation.md#rule-8-provenance-reference-consistency)
- Rule 9: [`docs/reconciliation.md#rule-9-multi-step-parameter-chain`](./reconciliation.md#rule-9-multi-step-parameter-chain) (v0.3+; fires only under `bp verify multi`)
- Rule 10: [`docs/reconciliation.md#rule-10-multi-step-trace-identity`](./reconciliation.md#rule-10-multi-step-trace-identity) (v0.3+; fires only under `bp verify multi`)

Each rule ships with a deliberately-broken bad-* fixture per the Csmith
doctrine — bad receipts precede good receipts. Rules 1-8 use
`fixtures/bad/mazur.bad-<kind>.jsonl`; Rules 9, 10 use
`fixtures/bad/multi-step.bad-{chain,trace-id}.jsonl`. The sibling
`.meta.json` documents the mutation, the targeted invariant, expected
cascades, and the expected `bp` output.
