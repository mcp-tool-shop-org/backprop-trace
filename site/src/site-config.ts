import type { SiteConfig } from '@mcptoolshop/site-theme';

export const config: SiteConfig = {
  title: '@mcptoolshop/backprop-trace',
  description:
    'Deterministic 26-rule verifier for neural-network training steps. Re-derives gradients + optimizer state from named factors; emits canonical JSONL. v0.12.0 soundness-hardening release: verifier-owned tolerance ceilings, marker-gated Rule 14, resource caps. PyTorch helper + sidecar import. Mid-v0; CPU-only.',
  logoBadge: 'BT',
  brandName: 'backprop-trace',
  repoUrl: 'https://github.com/mcp-tool-shop-org/backprop-trace',
  npmUrl: 'https://www.npmjs.com/package/@mcptoolshop/backprop-trace',
  footerText:
    'MIT Licensed — built by <a href="https://github.com/mcp-tool-shop-org" style="color:var(--color-muted);text-decoration:underline">mcp-tool-shop-org</a>',

  hero: {
    badge: 'v0.12.0 · Soundness-hardened · Mid-v0 · CPU-only',
    headline: 'backprop-trace',
    headlineAccent: 'verifies one training step.',
    description:
      'Hand it a receipt naming every factor that contributed to one gradient update. The reconciler re-derives every claim from those factors and rejects on disagreement. In the Csmith/CompCert lineage: the oracle must not consult the artifact it judges. v0.12.0 closes five false-PASS holes found in an adversarial audit — a receipt can no longer widen its own tolerance, relabel its way past Rule 14, or skip the math gate.',
    primaryCta: { href: '#usage', label: 'Quick start' },
    secondaryCta: { href: 'handbook/', label: 'Read the Handbook' },
    previews: [
      {
        label: 'Verify',
        code: 'npx bp verify mazur\n# exit 0 — schema + reconcile + engine-reproduce + byte-equal-vs-golden',
      },
      {
        label: 'Reject',
        code:
          'npx bp reconcile receipt fixtures/bad/mazur.bad-gradient.jsonl\n# exit 1 — Rule 4: update.gradient mismatch on w5',
      },
      {
        label: 'Live PyTorch',
        code:
          'npx bp examples pytorch --print > pytorch_trace_helper.py\n# from pytorch_trace_helper import TraceDumper\n# with dumper.step(...): loss.backward(); opt.step()\n# python my_train.py | npx bp import pytorch - | npx bp verify multi -',
      },
    ],
  },

  sections: [
    {
      kind: 'features',
      id: 'features',
      title: 'What it does',
      subtitle:
        '26 rules. Per-step structural consistency. Adversarial corpora prove the verifier — every rule ships with a paired bad fixture. v0.12.0 hardens the refusals.',
      features: [
        {
          title: '26-rule reconciler',
          desc:
            'Re-derives gradients, error signals, parameter updates, Adam/AdamW moment state, and PyTorch-style SGD momentum buffer (classical + Nesterov + dampening) from named factors. Within hybrid tolerance (atol + rtol) — now clamped to a verifier-owned ceiling before any rule runs.',
        },
        {
          title: 'Verifier-owned tolerance ceilings (v0.12.0)',
          desc:
            'A receipt can no longer name a giant tolerance to wave its own errors through. The verifier clamps to fixed ceilings before any rule runs — engine {atol 1e-8, rtol 1e-6}, observer {atol 1e-5, rtol 1e-3}, differential {atol 1e-5, rtol 1e-3} — with schema maximums as defense-in-depth. A receipt can tighten but never loosen.',
        },
        {
          title: 'Marker-gated Rule 14 (v0.12.0)',
          desc:
            'Rule 14 (engine-recompute differential) is the only math gate on imported framework traces. It now triggers on observer-marker presence (source_framework / import_provenance), so a sidecar cannot dodge re-derivation by stripping or relabeling its authoring-state field. It also asserts completeness — every engine-updated parameter is covered.',
        },
        {
          title: 'Bad-receipts-precede-good',
          desc:
            'Every rule has a paired bad fixture under fixtures/bad/ that the verifier must reject before reading any fixture_status metadata. Csmith/CompCert anti-circularity ratchet. Unknown optimizer names are now a Rule 0 structural reject, not a silent skip.',
        },
        {
          title: 'Live PyTorch helper (observer-only)',
          desc:
            'scripts/extract/pytorch.py extracts SGD/Adam/AdamW/sgd_momentum (with the momentum_buffer ascent→descent sign-flip) and per-neuron biases, torch-validated end-to-end. Single auditable file. No pip package. Rule 14 (engine-recompute) remains the authority.',
        },
        {
          title: 'Resource caps + graceful failure (v0.12.0)',
          desc:
            'Verifier-owned caps (MAX_BATCH_SAMPLES, TOPOLOGY_SIZE_CEILING) turn OOM-or-hang inputs into an actionable "limit exceeded" message. Oversized files return a structured INPUT_TOO_LARGE error, never a raw stack. reconcileReceipt always returns a structured result — it never throws.',
        },
        {
          title: 'Sidecar ingestion',
          desc:
            'bp import pytorch | jax | tensorflow — single-step, multi-step (Rules 9/10), batched (Rules 18/19), Adam moments (22-24), SGD momentum (20/21/25/26). Per-step engine-recompute differential (Rule 14) is mandatory; multi-step self-declared skips are now NON-PASS. float32 observer receipts no longer false-FAIL.',
        },
        {
          title: 'Canonical JSONL + distribution integrity',
          desc:
            'Decimal strings, schema-defined key order, 9-sig-fig byte-equal on Node 22.x, in-toto v1 attestation seam. pack-install smoke runs on every push across ubuntu + macos + windows — tarball contents, cold install, CLI behavior, stdin pipe semantics, all CI-gated.',
        },
      ],
    },
    {
      kind: 'data-table',
      id: 'soundness',
      title: 'v0.12.0 — soundness hardening',
      subtitle:
        'A comprehensive adversarial audit found five classes of false-PASS — the worst defect a verifier can have, where it ACCEPTS a receipt it must reject. All five are closed. A verifier earns trust by what it refuses.',
      columns: ['Hole closed', 'How it slipped past', 'The fix'],
      rows: [
        [
          'Receipt-controlled tolerance',
          'A receipt named its own comparison tolerance and widened it until every numeric rule passed.',
          'Tolerance is now verifier-owned and clamped before any rule runs (engine / observer / differential ceilings), with schema maximums as defense-in-depth. A receipt can tighten but never loosen.',
        ],
        [
          'Rule 14 bypass by relabeling',
          'Rule 14 (the only math gate on imports) could be skipped by stripping or renaming the authoring-state field.',
          'Rule 14 now triggers on observer-marker presence (source_framework / import_provenance) — an imported sidecar cannot dodge re-derivation.',
        ],
        [
          'Multi-step self-skip',
          'bp verify multi accepted a trace that announced its own math gate had been skipped.',
          'A self-declared skip is now a NON-PASS on every path.',
        ],
        [
          'Rule 14 agreement without completeness',
          'Rule 14 confirmed the fields a sidecar presented were correct, but not that it covered every updated parameter.',
          'Rule 14 now asserts the update set covers every engine-updated parameter and parameters_after matches the declared topology — no passing by omission.',
        ],
        [
          'Unknown optimizer silently skipped',
          'An unrecognized optimizer name slipped past the update-equation rules entirely.',
          'An unrecognized optimizer.name is now a Rule 0 structural rejection.',
        ],
        [
          'Proactive: resource caps + graceful failure',
          'Oversized batches / topologies / files hit OOM, hung, or dumped raw stacks.',
          'Verifier-owned caps (MAX_BATCH_SAMPLES, TOPOLOGY_SIZE_CEILING) emit "limit exceeded"; oversized files return a structured INPUT_TOO_LARGE error; reconcileReceipt never throws.',
        ],
      ],
    },
    {
      kind: 'code-cards',
      id: 'usage',
      title: 'Quick start',
      cards: [
        {
          title: 'Install',
          code: 'pnpm add @mcptoolshop/backprop-trace\n# or: npm install @mcptoolshop/backprop-trace',
        },
        {
          title: 'Accept a good receipt',
          code:
            'npx bp verify mazur\n# exit 0 — Mazur 2-2-2 backprop walkthrough (Matt Mazur 2015)\n# every number derivable by hand',
        },
        {
          title: 'Reject a broken one',
          code:
            'npx bp reconcile receipt \\\n  node_modules/@mcptoolshop/backprop-trace/fixtures/bad/mazur.bad-gradient.jsonl\n# exit 1 — Rule 4: update.gradient mismatch on w5\n# (rejected BEFORE the verifier reads fixture_status)',
        },
        {
          title: 'Verify your own PyTorch training step',
          code:
            'npx bp examples pytorch --print > pytorch_trace_helper.py\n\n# in your training loop:\nfrom pytorch_trace_helper import TraceDumper\ndumper = TraceDumper(model, optimizer, loss_fn, out="trace.jsonl")\nfor x, y in loader:\n    with dumper.step(inputs={...}, targets={...}):\n        optimizer.zero_grad()\n        loss_fn(model(x), y).backward()\n        optimizer.step()\n\n# verify:\nnpx bp import pytorch trace.jsonl | npx bp verify multi -',
        },
        {
          title: 'Hash for an attestation envelope',
          code:
            'npx bp generate mazur | sha256sum\n# 9-sig-fig canonical bytes (V8/Node 22.x)\n# wrap as in-toto v1 DSSE subject',
        },
      ],
    },
  ],
};
