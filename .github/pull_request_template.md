<!--
Thanks for contributing to backprop-trace.

Before opening, please read CONTRIBUTING.md and confirm the change
respects the law stack:

>   Contract precedes engine. Formatter policy precedes runtime formatting.
>   Bad receipts precede good receipts. Runtime formatting precedes Mazur.
>   Mazur precedes diagnostics.
-->

## Change summary

<!-- One sentence: what does this PR do? -->

## Motivation

<!-- Why is this change needed? Link the issue if one exists. -->

## Scope and non-goals

<!-- What's in this PR. What's deliberately out of scope. -->

## Tests added

<!-- Name the new test files / cases. If this PR adds a reconciler rule,
the deliberately-broken bad-* fixture must land in this same PR per
CONTRIBUTING.md "Rule for new reconciler rules". -->

## Documentation updates

<!-- README, docs/, CHANGELOG.md entries. -->

## Anti-circularity check (if applicable)

<!-- If this PR wires a new reconciler rule:
- [ ] A `fixtures/bad/mazur.bad-rule-<N>.jsonl` fixture exists
- [ ] A test asserts the rule is named when run on the broken fixture
- [ ] A second test mutates `fixture_status.verification_state` to
      `expected_to_fail_reconciliation` and asserts the rule is STILL
      named (the reconciler must not consult lifecycle metadata before
      running the rule)
-->

## Checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] `pnpm build` produces `dist/` without errors
- [ ] `fixtures/mazur.golden.jsonl` byte-equal preserved (or, if
      intentionally changed: CHANGELOG entry + reason explained above)
- [ ] CHANGELOG.md updated under `## [Unreleased]`
- [ ] No new dependencies added without justification (engine + reconciler
      are zero-dependency by policy)
