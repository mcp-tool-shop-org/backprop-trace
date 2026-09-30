# backprop-trace: how it works

Mapped at 2026-09-30 from commit aa93d58 by Atlas 1.24.0.

## What this is

10 parts, mostly JSON data (242 files); code in TypeScript (148), Python (5), JavaScript (4), CSS (2) and Astro (1). Work enters through 7 doors; ci and Release each reach 3 parts, and ci is followed because a pull request goes through it. It publishes to npm. It deploys a site to GitHub Pages. People run bp. People import @mcptoolshop/backprop-trace.

## What changed since 2026-09-24 (5611f68)

- examples now imports scripts.
- fixtures/bad/*.jsonl is now written by scripts/build-pytorch-helper-fixtures.mjs.
- fixtures/bad/*.meta.json is now written by scripts/build-pytorch-helper-fixtures.mjs.
- fixtures/external/pytorch.helper-emitted.adamw.sidecar.jsonl is now written by scripts/generate-pytorch-helper-goldens.py.
- And 10 more new writers and readers of places.
- 1 file added and 2 changed content, across 2 parts.

## What comes in

1. **ci.** On a pull request to main; on a push to main; or by hand. Runs test/import-jax-helper.jax-e2e.test.ts, test/import-pytorch-helper.torch-e2e.test.ts, test/activations.test.ts and 102 more; builds src/; checks fixtures/mazur.golden.jsonl and test/.
2. **Release.** When a tag matching `v*` is pushed; or by hand. Runs scripts/pack-install-smoke.mjs, test/activations.test.ts, test/bp.cli.help-version.test.ts and 103 more; builds src/; checks test/.
3. **pack-smoke.** On a pull request to main; on a push to main. Runs scripts/pack-install-smoke.mjs; builds src/.
4. **Deploy site to GitHub Pages.** On a push to main touching 2 paths; or by hand. Runs site/astro.config.mjs and site/src/.
5. **codeql.** On a pull request to main; on a push to main; on a schedule (`0 6 * * 1`), Monday at 06:00 UTC. Runs no file this map can see.
6. **@mcptoolshop/backprop-trace** (the package people import). Loads src/index.ts, src/activations.ts, src/emit.ts and 35 more.
7. **bp** (a command people run). Runs src/bin/bp.ts.

## What happens through ci

1. The workflow runs 105 files in test; it builds src/ in src; it checks fixtures/mazur.golden.jsonl in fixtures and test/ in test.
2. It uploads coverage to Codecov.

## Who reads the results

ci writes nothing this map can see.

## The other doors

**Release** runs scripts/pack-install-smoke.mjs, test/activations.test.ts, test/bp.cli.help-version.test.ts and 103 more, builds src/, checks test/, publishes to npm, and creates a GitHub release.

**pack-smoke** runs scripts/pack-install-smoke.mjs and builds src/.

**Deploy site to GitHub Pages** runs site/astro.config.mjs and site/src/, and deploys the site.

**codeql** runs no file this map can see and scans code with CodeQL.

**@mcptoolshop/backprop-trace** (the package people import) loads src/index.ts, src/activations.ts, src/emit.ts and 35 more.

**bp** (a command people run) runs src/bin/bp.ts.

## What breaks what

- **src** is imported by 1 part (scripts), and by 1 more only from tests; it sits on the path of 5 doors.
- **scripts** is imported by 1 part (examples) and sits on the path of 2 doors.
- **test** is imported by no other part and sits on the path of 2 doors.
- **fixtures/bad/** is written by scripts and read by scripts, and by 27 tests; a hand edit reaches every reader.
- **fixtures/external/pytorch.helper-emitted.adamw.sidecar.jsonl** is written by scripts and read by scripts, and by 3 tests; a hand edit reaches every reader.

## What tends to change together

- **scripts/build-pytorch-helper-fixtures.mjs** and **test/import-pytorch-helper.test.ts** changed together in 6 of 6 commits, though neither part imports the other.
- **src/schema-loader.ts** and **src/validate.ts** changed together in 9 of 11 commits, inside the src part.
- **src/general-engine.ts** and **src/schema-loader.ts** changed together in 9 of 13 commits, inside the src part.
- **src/general-engine.ts** and **src/validate.ts** changed together in 9 of 13 commits, inside the src part.
- **scripts/build-pytorch-helper-fixtures.mjs** and **scripts/extract/pytorch.py** changed together in 6 of 9 commits, inside the scripts part.

1 file changed together with its own test, as expected.

Confidence is low: fewer than 25 source files reach 10 revisions in the window.

Window: 180 days; a pair counts from 3 shared commits, since 8 source files reach 10 revisions; the floor rises to 10 when 25 do.

## What no test touches

- **examples** is imported by no test.
- **scripts** is imported by no test.

## Written but never read

- **fixtures/bad/*.jsonl** is written by scripts/build-pytorch-helper-fixtures.mjs and read by nothing else in this repository.
- **fixtures/bad/*.meta.json** is written by scripts/build-pytorch-helper-fixtures.mjs and read by nothing else in this repository.
- **fixtures/external/adam.reddi-2018-pathology.note.json** is written by scripts/generate-pytorch-adam-fixtures.ts and read by nothing else in this repository.
- **fixtures/external/pytorch.adamw.sidecar.jsonl** is written by scripts/generate-pytorch-adam-fixtures.ts and read by nothing else in this repository.
- **fixtures/external/pytorch.sgd-momentum.nesterov.multi-step.sidecar.jsonl** is written by scripts/generate-pytorch-momentum-fixtures.ts and read by nothing else in this repository.
- **fixtures/external/pytorch.sgd-momentum.nesterov.sidecar.jsonl** is written by scripts/generate-pytorch-momentum-fixtures.ts and read by nothing else in this repository.
- **fixtures/sgd-coupled-l2.golden.jsonl** is written by scripts/generate-sgd-coupled-l2-fixtures.ts and read by nothing else in this repository.
- **fixtures/sgd-momentum-coupled-l2.multi-step.jsonl** is written by scripts/generate-sgd-coupled-l2-fixtures.ts and read by nothing else in this repository.

## Helpers that look duplicated

No two parts export a helper that looks alike.

## Generated, never hand-edited

- **fixtures/bad/** is written by scripts (7 files).
- **fixtures/bad/*.jsonl** is written by scripts/build-pytorch-helper-fixtures.mjs.
- **fixtures/bad/*.meta.json** is written by scripts/build-pytorch-helper-fixtures.mjs.
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
- **fixtures/external/pytorch.helper-emitted.adamw.sidecar.jsonl** is written by scripts/generate-pytorch-helper-goldens.py.
- **fixtures/external/pytorch.helper-emitted.sgd-coupled-l2.sidecar.jsonl** is written by scripts/generate-pytorch-coupled-l2-helper-goldens.py.
- **fixtures/external/pytorch.helper-emitted.sgd-momentum.sidecar.jsonl** is written by scripts/generate-pytorch-helper-goldens.py.
- **fixtures/external/pytorch.helper-emitted.sgd.softmax-ce.sidecar.jsonl** is written by scripts/generate-pytorch-helper-goldens.py.
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

People write .github/, docs/, the repository root, schemas/ and site/; 15 writes with paths built at run time may land here.

## Where to start

.github/workflows/ci.yml → src/index.ts → src/reconcile.ts → src/general-engine.ts → src/emit.ts → src/hash.ts

Read those in order to follow one pull request end to end.

## What this map cannot see

- 1 import site names a declared dependency that shares its name with a local module (jax); it is read as the dependency, which is not in this repository.
- 15 writes and 11 reads use paths built at run time and are not named here.
- 13 reads go to a path their caller passes, not to this repository.
- 10 reads go to the directory the command is run in (fixtures/ and scripts/), not to this repository.
- 2 writes and 3 reads go to a temporary directory, not to this repository.
- 21 commands are built at run time and not followed, 20 of them in tests.
- Statistics confidence is low: fewer than 25 source files reach 10 revisions in the window.

Regenerate with `npx --yes @dogfood-lab/atlas map`.
