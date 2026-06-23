import type { SiteConfig } from '@mcptoolshop/site-theme';

export const config: SiteConfig = {
  title: '@mcptoolshop/backprop-trace',
  description:
    'Deterministic 26-rule verifier for neural-network training steps. Re-derives gradients + optimizer state from named factors; emits canonical JSONL. v1.0.0: SGD/Adam/AdamW/SGD-momentum + SGD coupled-L2 weight decay; live PyTorch and JAX helpers; a recognizable hero classifier fixture; rule-coverage observability; a worked EU AI Act compliance bundle. 940 tests; CPU-only; deterministic.',
  logoBadge: 'BT',
  brandName: 'backprop-trace',
  repoUrl: 'https://github.com/mcp-tool-shop-org/backprop-trace',
  npmUrl: 'https://www.npmjs.com/package/@mcptoolshop/backprop-trace',
  footerText:
    'MIT Licensed — built by <a href="https://github.com/mcp-tool-shop-org" style="color:var(--color-muted);text-decoration:underline">mcp-tool-shop-org</a>',

  hero: {
    badge: 'v1.0.0 · CPU-only · Deterministic · 26 rules · 940 tests',
    headline: 'backprop-trace',
    headlineAccent: 'verifies one training step.',
    description:
      'Hand it a receipt naming every factor that contributed to one gradient update. The reconciler re-derives every claim from those factors and rejects on disagreement. In the Csmith/CompCert lineage: the oracle must not consult the artifact it judges. v1.0.0 covers the deterministic-CPU corner end to end — SGD/Adam/AdamW/SGD-momentum plus SGD coupled-L2 weight decay, live PyTorch and JAX helpers, a recognizable hero classifier fixture, rule-coverage observability, and a worked EU AI Act compliance bundle.<br><a href="https://www.npmjs.com/package/@mcptoolshop/backprop-trace" style="display:inline-block;margin-top:1rem"><img alt="npm version" src="https://img.shields.io/npm/v/@mcptoolshop/backprop-trace.svg?color=2563eb" style="height:20px"></a>',
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
        label: 'Auditable PASS',
        code:
          'npx bp verify general fixtures/hero-classifier.golden.jsonl --json\n# exit 0 — 9-pixel -> 16-ReLU -> 4-class softmax glyph classifier\n# --json carries rules_evaluated / gated_off: WHICH rules the PASS exercised',
      },
    ],
  },

  sections: [
    {
      kind: 'features',
      id: 'features',
      title: 'What it does',
      subtitle:
        '26 rules. Per-step structural consistency. Adversarial corpora prove the verifier — every rule ships with a paired bad fixture. v1.0.0 covers the deterministic-CPU corner end to end.',
      features: [
        {
          title: '26-rule reconciler',
          desc:
            'Re-derives gradients, error signals, parameter updates, Adam/AdamW moment state, and PyTorch-style SGD momentum buffer (classical + Nesterov + dampening) from named factors. Within hybrid tolerance (atol + rtol) — clamped to a verifier-owned ceiling before any rule runs. A receipt can tighten its pass band, never loosen it.',
        },
        {
          title: 'SGD coupled-L2 weight decay (v1.0.0)',
          desc:
            'Rule 7’s third branch covers plain SGD and SGD-momentum with weight_decay > 0. Coupled, not decoupled — the decay folds into the gradient and enters the momentum buffer, the deliberate opposite of AdamW. Cross-family-verified math, validated against real PyTorch. New additive schemas receipt.v0.8.0 + framework-trace.v0.8.0.',
        },
        {
          title: 'Live PyTorch and JAX helpers (observer-only)',
          desc:
            'Single auditable Python files. scripts/extract/pytorch.py covers SGD/Adam/AdamW/sgd_momentum (with the momentum_buffer ascent→descent sign-flip). scripts/extract/jax.py adds a stronger trust boundary — it folds a jax.make_jaxpr(jax.grad(loss)) digest into the forensic block (the inspectable gradient graph PyTorch eager lacks) and refuses to run without jax_enable_x64 + CPU. Rule 14 (engine-recompute) is the authority on every imported sidecar.',
        },
        {
          title: 'Recognizable hero fixture (v1.0.0)',
          desc:
            'fixtures/hero-classifier.golden.jsonl — a 9-pixel → 16-ReLU → 4-class softmax glyph classifier, single and multi-step, byte-reproducible on CPU. A receipt a reader can picture, not just a 2-2-2 toy. The v1.0 gate fixture, now shipped.',
        },
        {
          title: 'Rule-coverage observability (v1.0.0)',
          desc:
            'bp verify --json / --verbose now reports which of the 26 rules a PASS actually exercised (rules_evaluated) and which were applicable-but-gated-off because a feature block was absent (gated_off). A green PASS becomes auditable — you can see the 9 substantive rules that ran, not just trust that 26 might have.',
        },
        {
          title: 'Compliance audit bundle (v1.0.0)',
          desc:
            'A worked mapping of a receipt to EU AI Act Annex IV §2(g)/§2(b) test-log records and Article 15 robustness controls — honestly NOT Article 10 (data governance is out of scope). A receipt is the numerical-consistency leaf of a compliance tree; it composes below SLSA-for-ML / Sigstore, it does not replace them. See docs/compliance.md.',
        },
        {
          title: 'Sidecar ingestion',
          desc:
            'bp import pytorch | jax | tensorflow — single-step, multi-step (Rules 9/10), batched (Rules 18/19), Adam moments (22-24), SGD momentum (20/21/25/26). Per-step engine-recompute differential (Rule 14) is mandatory and marker-gated; multi-step self-declared skips are NON-PASS. float32 observer receipts pass within the observer tolerance band.',
        },
        {
          title: 'Canonical JSONL + distribution integrity',
          desc:
            'Decimal strings, schema-defined key order, 9-sig-fig byte-equal on Node 22.x, in-toto v1 attestation seam. pack-install smoke runs on every push across ubuntu + macos + windows — tarball contents, cold install, CLI behavior, stdin pipe semantics, all CI-gated. A dedicated jax-e2e job validates the JAX helper against real JAX.',
        },
      ],
    },
    {
      kind: 'data-table',
      id: 'surface',
      title: 'v1.0.0 — the sober promotion',
      subtitle:
        'A comprehensive dogfood swarm took backprop-trace from honest mid-v0 to a v1.0.0 that meets the product’s own gate criteria — without overclaiming. Tests 792 → 940. CPU-only, deterministic. Conv / GPU stay out of the deterministic corner by design.',
      columns: ['v1.0.0 surface', 'What ships', 'Honest scope'],
      rows: [
        [
          'Optimizers',
          'SGD, Adam, AdamW, SGD-momentum (classical / Nesterov / dampening), and SGD coupled-L2 weight decay (Rule 7 third branch).',
          'Coupled L2 folds decay into the gradient + momentum buffer — the deliberate opposite of AdamW decoupled decay. An unrecognized optimizer name is a Rule 0 structural reject, never a silent skip.',
        ],
        [
          'Live helpers',
          'PyTorch (scripts/extract/pytorch.py) and JAX (scripts/extract/jax.py) — single auditable files, copy-and-read, no pip package.',
          'Observer-only. Rule 14 (engine-recompute differential) is the authority on every sidecar. The JAX helper enforces jax_enable_x64 + CPU and records a make_jaxpr(grad) digest as a forensic — not credential — trust signal.',
        ],
        [
          'Hero fixture',
          'fixtures/hero-classifier.golden.jsonl — a 9-pixel → 16-ReLU → 4-class softmax glyph classifier, single + multi-step.',
          'A recognizable dense ReLU→softmax classifier, byte-reproducible on CPU. The v1.0 gate fixture. Conv / multi-hidden-layer topologies remain out — they fight bit-determinism.',
        ],
        [
          'Auditable PASS',
          'bp verify --json / --verbose reports rules_evaluated and gated_off.',
          'A green PASS records which substantive rules actually fired vs which were gated off because a feature block was absent — so an auditor sees the coverage, not just the verdict.',
        ],
        [
          'Compliance bundle',
          'docs/compliance.md — a receipt mapped to EU AI Act Annex IV §2(g)/§2(b) + Article 15, wrapped in an in-toto v1 statement.',
          'A receipt attests math, not data governance. It is the numerical-consistency leaf below model-signing — honestly NOT Article 10. Compose, don’t conflate.',
        ],
        [
          'Determinism boundary',
          'Byte-equal on Node 22.x across ubuntu + macos + windows. A Math.exp(-0.5) canary fires on every CI cell.',
          'GPU / fused-kernel bit-determinism is permanently out of scope (FP non-associativity, arXiv:2408.05148). The product is the deterministic CPU corner.',
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
          title: 'Verify the hero classifier (auditable PASS)',
          code:
            'npx bp verify general \\\n  node_modules/@mcptoolshop/backprop-trace/fixtures/hero-classifier.golden.jsonl --json\n# exit 0 — 9-pixel -> 16-ReLU -> 4-class softmax glyph classifier\n# --json carries rules_evaluated / gated_off:\n# {"overall":"PASS","rules_evaluated":[1,2,3,4,5,6,7,8,11,12,13],"gated_off":[...]}',
        },
        {
          title: 'Verify your own PyTorch training step',
          code:
            'npx bp examples pytorch --print > pytorch_trace_helper.py\n\n# in your training loop:\nfrom pytorch_trace_helper import TraceDumper\ndumper = TraceDumper(model, optimizer, loss_fn, out="trace.jsonl")\nfor x, y in loader:\n    with dumper.step(inputs={...}, targets={...}):\n        optimizer.zero_grad()\n        loss_fn(model(x), y).backward()\n        optimizer.step()\n\n# verify:\nnpx bp import pytorch trace.jsonl | npx bp verify multi -',
        },
        {
          title: 'Verify a JAX training step',
          code:
            '# copy the single auditable file, read it, run it:\ncp node_modules/@mcptoolshop/backprop-trace/scripts/extract/jax.py jax_trace_helper.py\n\n# requires jax_enable_x64 + CPU (the helper refuses otherwise)\n# from jax_trace_helper import TraceDumper\n# with dumper.step(inputs=x, targets=y) as ctx: params = ctx.run(params)\n\nnpx bp import jax trace.jsonl | npx bp verify multi -',
        },
      ],
    },
  ],
};
