# `bp` CLI reference

The `bp` binary is the user-facing entry point for `@mcptoolshop/backprop-trace`.
It exposes four subcommands that compose the library's primitives into the
common verification flows: reconcile, verify (full gate), generate, validate.

The CLI is dependency-free (no commander / yargs / citty); the argv dispatch
is hand-rolled at `src/bin/bp.ts` per the study-swarm CLI-ergonomics finding
(`commander` and `citty` don't add value at the v0.2 surface size).

```
bp <verb> <noun> [args]
```

Run `bp --help` for the at-a-glance summary, `bp <subcommand> --help` for
the subcommand-specific text.

## Subcommands at a glance

| Command | Purpose | Typical exit |
|---|---|---|
| `bp reconcile receipt <file>` | Run the 8 reconciliation rules against a receipt | 0 / 1 |
| `bp verify mazur [<file>]` | Full gate (schema + reconcile + engine-reproduce + byte-equal + drift) | 0 / 1 |
| `bp generate mazur [--out F] [--check]` | Re-run the Mazur engine, emit canonical JSONL | 0 / 1 |
| `bp validate <file>` | Schema-only validation against the bundled JSON Schema | 0 / 1 |

All subcommands accept `-` as the file argument to read from stdin
(except `generate mazur`, which writes rather than reads).

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

### Exit codes

| Code | Meaning |
|---|---|
| 0 | All implemented rules pass within `numeric_policy.tolerance`. |
| 1 | At least one reconciliation rule failed. Details on stderr (or stdout under `--json`). |
| 2 | Usage error, I/O error, malformed JSON, or `>1` record in a `.jsonl` file. |
| 3 | Invalid CLI argument (e.g. unknown flag). |

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

## Subcommand: `bp validate`

```
bp validate <file> [--json] [--verbose] [--color=...]
```

Schema-only validation. Runs the receipt against the bundled
`schemas/receipt.v0.1.0.json` via Ajv (2020-12 draft) and reports
the first validation error (fail-fast; full-list support is reserved
for v0.3+).

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

## Where the rules live

The 8 reconciliation rules `bp reconcile receipt` and `bp verify mazur`
check are documented at:

- Rule 1: [`docs/reconciliation.md#rule-1-output-error-signal-consistency`](./reconciliation.md#rule-1-output-error-signal-consistency)
- Rule 2: [`docs/reconciliation.md#rule-2-downstream-contribution-and-backpropagated-sum`](./reconciliation.md#rule-2-downstream-contribution-and-backpropagated-sum)
- Rule 3: [`docs/reconciliation.md#rule-3-hidden-error-signal-consistency`](./reconciliation.md#rule-3-hidden-error-signal-consistency)
- Rule 4: [`docs/reconciliation.md#rule-4-update-gradient-consistency`](./reconciliation.md#rule-4-update-gradient-consistency)
- Rule 5: [`docs/reconciliation.md#rule-5-update-value-consistency`](./reconciliation.md#rule-5-update-value-consistency)
- Rule 6: [`docs/reconciliation.md#rule-6-weight-progression`](./reconciliation.md#rule-6-weight-progression)
- Rule 7: [`docs/reconciliation.md#rule-7-final-state-consistency`](./reconciliation.md#rule-7-final-state-consistency)
- Rule 8: [`docs/reconciliation.md#rule-8-provenance-reference-consistency`](./reconciliation.md#rule-8-provenance-reference-consistency)

Each rule ships with a `fixtures/bad/mazur.bad-<kind>.jsonl` fixture per
the Csmith doctrine — bad receipts precede good receipts. The fixtures
exercise the rule by mutating exactly one field; the sibling `.meta.json`
documents the mutation, the targeted invariant, expected cascades, and
the expected `bp` output.
