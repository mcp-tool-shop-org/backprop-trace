import type { SiteConfig } from '@mcptoolshop/site-theme';

export const config: SiteConfig = {
  title: '@mcptoolshop/backprop-trace',
  description:
    'Deterministic 26-rule verifier for neural-network training steps. Re-derives gradients + optimizer state from named factors; emits canonical JSONL. PyTorch helper + sidecar import. Mid-v0; CPU-only.',
  logoBadge: 'BT',
  brandName: 'backprop-trace',
  repoUrl: 'https://github.com/mcp-tool-shop-org/backprop-trace',
  npmUrl: 'https://www.npmjs.com/package/@mcptoolshop/backprop-trace',
  footerText:
    'MIT Licensed — built by <a href="https://github.com/mcp-tool-shop-org" style="color:var(--color-muted);text-decoration:underline">mcp-tool-shop-org</a>',

  hero: {
    badge: 'v0.11.0 · Mid-v0 · CPU-only',
    headline: 'backprop-trace',
    headlineAccent: 'verifies one training step.',
    description:
      'Hand it a receipt naming every factor that contributed to one gradient update. The reconciler re-derives every claim from those factors and rejects on disagreement. In the Csmith/CompCert lineage: the oracle must not consult the artifact it judges.',
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
        '26 rules. Per-step structural consistency. Adversarial corpora prove the verifier — every rule ships with a paired bad fixture.',
      features: [
        {
          title: '26-rule reconciler',
          desc:
            'Re-derives gradients, error signals, parameter updates, Adam/AdamW moment state, and PyTorch-style SGD momentum buffer (classical + Nesterov + dampening) from named factors. Within hybrid tolerance (atol + rtol).',
        },
        {
          title: 'Bad-receipts-precede-good',
          desc:
            'Every rule has a paired bad fixture under fixtures/bad/ that the verifier must reject before reading any fixture_status metadata. Csmith/CompCert anti-circularity ratchet.',
        },
        {
          title: 'Live PyTorch helper (observer-only)',
          desc:
            'scripts/extract/pytorch.py extracts SGD/Adam/AdamW/sgd_momentum (with the momentum_buffer ascent→descent sign-flip). Single auditable file. No pip package. Rule 14 (engine-recompute) remains the authority.',
        },
        {
          title: 'Canonical JSONL receipts',
          desc:
            'Decimal strings, schema-defined key order, hybrid float tolerance. 9-sig-fig byte-equal on Node 22.x. in-toto v1 attestation seam — wrap a receipt as a DSSE subject.',
        },
        {
          title: 'Sidecar ingestion',
          desc:
            'bp import pytorch | jax | tensorflow — single-step, multi-step (Rules 9/10), batched (Rules 18/19), Adam moments (22-24), SGD momentum (20/21/25/26). Per-step engine-recompute differential (Rule 14) is mandatory.',
        },
        {
          title: 'Distribution integrity',
          desc:
            'pack-install smoke runs on every push across ubuntu + macos + windows. Tarball contents, cold install, CLI verb behavior, HELPER_VERSION lockstep, stdin pipe semantics — all CI-gated.',
        },
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
