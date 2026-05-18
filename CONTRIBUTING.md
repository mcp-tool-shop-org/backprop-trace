# Contributing to backprop-trace

## Prerequisites

- Node 22.x (pinned in `engines`)
- pnpm (the repo ships a `pnpm-lock.yaml`)

## Setup

```
pnpm install
```

## Common scripts

```
pnpm test        # vitest-free node --test runner over test/**/*.test.ts
pnpm typecheck   # tsc --noEmit
pnpm build       # produces dist/ via tsconfig.build.json
```

## The law stack

backprop-trace is governed by an explicit precedence order (`docs/canonical-emission.md`):

> Contract precedes engine. Formatter policy precedes runtime formatting. Bad receipts precede good receipts. Runtime formatting precedes Mazur. Mazur precedes diagnostics.

Read it. Every PR is judged against it.

## Rule for new reconciler rules

Each of the **sixteen** reconciler rules (as of v0.6+ — see `docs/reconciliation.md` for the full list, including Rules 11/12/13 for softmax+CE in v0.5 and Rules 14/15/16 for observer-mode imports in v0.6) must ship with a **deliberately-broken fixture** demonstrating rejection *before* the rule code lands. This is the Csmith pattern (Yang, Chen, Eide, Regehr — PLDI 2011, https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf): adversarial corpora prove a verifier; passing tests do not.

**The anti-circularity ratchet:** the reconciler MUST detect the rule violation BEFORE consulting `fixture_status` metadata. A receipt cannot self-declare "I am broken — please trust me." The verifier's reading order is part of the contract.

**The doctrine ratchet is enforced by `test/reconcile.doctrine.test.ts`** — it scans `src/reconcile.ts` for every emitted `rule: <n>` and refuses to merge if any rule lacks a paired `fixtures/bad/*.jsonl` fixture.

Concretely, for each new rule N (where N != 4):

1. Add `fixtures/bad/<prefix>.bad-<kind>.jsonl` with a mutation on a value that ONLY Rule N can catch. Use the matching naming convention so the doctrine ratchet's FILENAME_KIND_TO_RULE map (or the sibling `.meta.json` file's `reconciliation_check_targeted_first` field) resolves to N.
2. Add a test that runs the reconciler on the broken fixture and asserts Rule N is named in the failure.
3. Add a second test that mutates the broken fixture's `fixture_status` to `expected_to_fail_reconciliation` and reasserts Rule N is still named (anti-circularity).
4. **Then** wire Rule N in `src/reconcile.ts`.

## Schema-version policy

Any addition of a required field to `schemas/receipt.v0.1.0.json` is a **breaking change**. Procedure:

1. Bump `schema_version` (e.g., `"0.2.0"`).
2. Copy `schemas/receipt.v0.1.0.json` to `schemas/receipt.v0.2.0.json`; never edit a frozen schema in place.
3. Add the field to the new schema.
4. Update the engine to emit the new field.
5. Add a migration note to `CHANGELOG.md` under the next version's `### Changed` heading.
6. Bump the package version per semver (a schema break is a breaking change for the npm consumer).

Adding an *optional* field is non-breaking and can land within the same `schema_version` if and only if existing receipts remain valid against the updated schema.

## Voice

Terse. Technical. No emoji. Factual. Match the existing docs.
