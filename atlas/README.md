# backprop-trace: how it works

Mapped at 2026-09-23 from commit 26eeaa3.

## What this is

10 parts, mostly TypeScript (148 files). Work enters through 5 doors; the busiest is ci, which reaches 3 parts. It publishes to npm.

## What changed since the last map

This is the first map.

## What comes in

1. **ci.** On a pull request; on a push to main; or by hand. Runs test/import-jax-helper.jax-e2e.test.ts and test/import-pytorch-helper.torch-e2e.test.ts; checks fixtures/mazur.golden.jsonl.
2. **Deploy site to GitHub Pages.** On a push to main touching 2 paths; or by hand. Runs site/astro.config.mjs and site/src/.
3. **Release.** When a tag matching `v*` is pushed; or by hand. Runs no file this map can see.
4. **codeql.** On a pull request; on a push to main; on a schedule (`0 6 * * 1`), Monday at 06:00 UTC. Runs no file this map can see.
5. **pack-smoke.** On a pull request; on a push to main. Runs no file this map can see.

## What happens through ci

1. The workflow runs test/import-jax-helper.jax-e2e.test.ts and test/import-pytorch-helper.torch-e2e.test.ts in test; it checks fixtures/mazur.golden.jsonl in fixtures.
2. That reaches src (15 files).

## Who reads the results

ci writes nothing this map can see.

## The other doors

**Deploy site to GitHub Pages** runs site/astro.config.mjs and site/src/, and deploys the site.

**Release** runs no file this map can see, publishes to npm, and creates a GitHub release.

**codeql** runs no file this map can see.

**pack-smoke** runs no file this map can see.

## What breaks what

- **src** is imported by 1 part (scripts), and by 1 more only from tests; it sits on the path of 1 door.
- **the repository root** is imported by 1 part (src) and sits on the path of no door.
- **fixtures/bad/** is written by scripts and read by scripts; a hand edit reaches every reader.

## What tends to change together

- **scripts/build-pytorch-helper-fixtures.mjs** and **test/import-pytorch-helper.test.ts** changed together in 6 of 6 commits, though neither part imports the other.
- **src/schema-loader.ts** and **src/validate.ts** changed together in 9 of 11 commits, inside the src part.
- **src/general-engine.ts** and **src/schema-loader.ts** changed together in 9 of 13 commits, inside the src part.
- **src/general-engine.ts** and **src/validate.ts** changed together in 9 of 13 commits, inside the src part.
- **scripts/build-pytorch-helper-fixtures.mjs** and **scripts/extract/pytorch.py** changed together in 6 of 9 commits, inside the scripts part.

1 file changed together with its own test, as expected.

Confidence is low: fewer than 20 source files reach 10 revisions in the window.

Window: 180 days; a pair counts from 3 shared commits, since 8 source files reach 10 revisions; the floor rises to 10 when 25 do.

## What no test touches

- **examples** is imported by no test.
- **scripts** is imported by no test.

## Written but never read

- **fixtures/bad/jax.bad-pytree-flatten-order.jsonl** is written by scripts/generate-jax-bad-fixtures.ts and read by nothing else in this repository.
- **fixtures/bad/tensorflow.bad-variable-list-order.jsonl** is written by scripts/generate-tensorflow-bad-fixtures.ts and read by nothing else in this repository.
- **fixtures/external/adam.reddi-2018-pathology.note.json** is written by scripts/generate-pytorch-adam-fixtures.ts and read by nothing else in this repository.
- **fixtures/external/jax.softmax-ce.sidecar.jsonl** is written by scripts/generate-jax-softmax-ce-fixtures.ts and read by nothing else in this repository.
- **fixtures/external/pytorch.adam.multi-step.sidecar.jsonl** is written by scripts/generate-pytorch-adam-fixtures.ts and read by nothing else in this repository.
- **fixtures/external/pytorch.adam.sidecar.jsonl** is written by scripts/generate-pytorch-adam-fixtures.ts and read by nothing else in this repository.
- **fixtures/external/pytorch.adamw.sidecar.jsonl** is written by scripts/generate-pytorch-adam-fixtures.ts and read by nothing else in this repository.
- **fixtures/external/pytorch.sgd-coupled-l2.golden.jsonl** is written by scripts/emit-coupled-l2-observer-golden.mjs and read by nothing else in this repository.

And 17 more places.

## Helpers that look duplicated

No two parts export a helper that looks alike.

## Generated, never hand-edited

- **fixtures/bad/** is written by scripts (7 files).
- **fixtures/bad/jax.bad-pytree-flatten-order.jsonl** is written by scripts/generate-jax-bad-fixtures.ts.
- **fixtures/bad/tensorflow.bad-variable-list-order.jsonl** is written by scripts/generate-tensorflow-bad-fixtures.ts.
- **fixtures/external/adam.reddi-2018-pathology.note.json** is written by scripts/generate-pytorch-adam-fixtures.ts.
- **fixtures/external/jax.softmax-ce.golden.jsonl** is written by scripts/generate-jax-softmax-ce-fixtures.ts.
- **fixtures/external/jax.softmax-ce.sidecar.jsonl** is written by scripts/generate-jax-softmax-ce-fixtures.ts.
- **fixtures/external/pytorch.adam.golden.jsonl** is written by scripts/generate-pytorch-adam-fixtures.ts.
- **fixtures/external/pytorch.adam.multi-step.golden.jsonl** is written by scripts/generate-pytorch-adam-fixtures.ts.
- **fixtures/external/pytorch.adam.multi-step.sidecar.jsonl** is written by scripts/generate-pytorch-adam-fixtures.ts.
- **fixtures/external/pytorch.adam.sidecar.jsonl** is written by scripts/generate-pytorch-adam-fixtures.ts.
- **fixtures/external/pytorch.adamw.golden.jsonl** is written by scripts/generate-pytorch-adam-fixtures.ts.
- **fixtures/external/pytorch.adamw.sidecar.jsonl** is written by scripts/generate-pytorch-adam-fixtures.ts.
- **fixtures/external/pytorch.helper-emitted.sgd-coupled-l2.sidecar.jsonl** is written by scripts/generate-pytorch-coupled-l2-helper-goldens.py.
- **fixtures/external/pytorch.sgd-coupled-l2.golden.jsonl** is written by scripts/emit-coupled-l2-observer-golden.mjs.
- **fixtures/external/pytorch.sgd-momentum.dampening.golden.jsonl** is written by scripts/generate-pytorch-momentum-fixtures.ts.
- **fixtures/external/pytorch.sgd-momentum.dampening.sidecar.jsonl** is written by scripts/generate-pytorch-momentum-fixtures.ts.
- **fixtures/external/pytorch.sgd-momentum.golden.jsonl** is written by scripts/generate-pytorch-momentum-fixtures.ts.
- **fixtures/external/pytorch.sgd-momentum.multi-step.golden.jsonl** is written by scripts/generate-pytorch-momentum-fixtures.ts.
- **fixtures/external/pytorch.sgd-momentum.multi-step.sidecar.jsonl** is written by scripts/generate-pytorch-momentum-fixtures.ts.
- **fixtures/external/pytorch.sgd-momentum.nesterov.golden.jsonl** is written by scripts/generate-pytorch-momentum-fixtures.ts.
- **fixtures/external/pytorch.sgd-momentum.nesterov.multi-step.golden.jsonl** is written by scripts/generate-pytorch-momentum-fixtures.ts.
- **fixtures/external/pytorch.sgd-momentum.nesterov.multi-step.sidecar.jsonl** is written by scripts/generate-pytorch-momentum-fixtures.ts.
- **fixtures/external/pytorch.sgd-momentum.nesterov.sidecar.jsonl** is written by scripts/generate-pytorch-momentum-fixtures.ts.
- **fixtures/external/pytorch.sgd-momentum.sidecar.jsonl** is written by scripts/generate-pytorch-momentum-fixtures.ts.
- **fixtures/external/pytorch.softmax-ce.batched.golden.jsonl** is written by scripts/generate-pytorch-batched-softmax-ce-fixtures.ts.
- **fixtures/external/pytorch.softmax-ce.batched.sidecar.jsonl** is written by scripts/generate-pytorch-batched-softmax-ce-fixtures.ts.
- **fixtures/external/pytorch.softmax-ce.golden.jsonl** is written by scripts/generate-pytorch-softmax-ce-fixtures.ts.
- **fixtures/external/pytorch.softmax-ce.multi-step-batched.golden.jsonl** is written by scripts/generate-pytorch-batched-softmax-ce-fixtures.ts.
- **fixtures/external/pytorch.softmax-ce.multi-step-batched.sidecar.jsonl** is written by scripts/generate-pytorch-batched-softmax-ce-fixtures.ts.
- **fixtures/external/pytorch.softmax-ce.multi-step.golden.jsonl** is written by scripts/generate-pytorch-multi-step-softmax-ce-fixtures.ts.
- **fixtures/external/pytorch.softmax-ce.multi-step.sidecar.jsonl** is written by scripts/generate-pytorch-multi-step-softmax-ce-fixtures.ts.
- **fixtures/external/pytorch.softmax-ce.sidecar.jsonl** is written by scripts/generate-pytorch-softmax-ce-fixtures.ts.
- **fixtures/external/tensorflow.softmax-ce.golden.jsonl** is written by scripts/generate-tensorflow-softmax-ce-fixtures.ts.
- **fixtures/external/tensorflow.softmax-ce.sidecar.jsonl** is written by scripts/generate-tensorflow-softmax-ce-fixtures.ts.
- **fixtures/hero-classifier.golden.jsonl** is written by scripts/generate-hero-classifier-fixtures.ts.
- **fixtures/hero-classifier.multi-step.jsonl** is written by scripts/generate-hero-classifier-fixtures.ts.
- **fixtures/sgd-coupled-l2.golden.jsonl** is written by scripts/generate-sgd-coupled-l2-fixtures.ts.
- **fixtures/sgd-momentum-coupled-l2.golden.jsonl** is written by scripts/generate-sgd-coupled-l2-fixtures.ts.
- **fixtures/sgd-momentum-coupled-l2.multi-step.jsonl** is written by scripts/generate-sgd-coupled-l2-fixtures.ts.
- **fixtures/xor.multi-step.jsonl** is written by scripts/generate-xor-multi-step-golden.ts.

## Hand-authored

People write .github/, docs/, the repository root, schemas/ and site/; 20 writes with paths built at run time may land here.

## Where to start

.github/workflows/ci.yml → test/import-jax-helper.jax-e2e.test.ts → src/import-jax.ts

Read those in order to follow one pull request end to end.

## What this map cannot see

- 2 import sites name a declared dependency that shares its name with a local module (jax); they are read as the dependency, which is not in this repository.
- 4 import sites could not be resolved.
- 1 file uses syntax the parser cannot read, so what it imports is not known: a NUL character inside a string (1).
- 20 writes and 16 reads use paths built at run time and are not named here.
- 38 commands are built at run time and not followed, 35 of them in tests.
- Statistics confidence is low: fewer than 20 source files reach 10 revisions in the window.

Regenerate with `npx --yes @dogfood-lab/atlas map`.
