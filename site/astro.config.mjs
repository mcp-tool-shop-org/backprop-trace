// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://mcp-tool-shop-org.github.io',
  base: '/backprop-trace',
  integrations: [
    starlight({
      title: 'backprop-trace',
      description: 'Deterministic 26-rule verifier for neural-network training steps. Re-derives gradients + optimizer state from named factors; emits canonical JSONL. v1.0.0: SGD/Adam/AdamW/SGD-momentum + coupled-L2 weight decay; live PyTorch and JAX helpers; sidecar import; compliance bundle. CPU-only; deterministic.',
      disable404Route: true,
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/mcp-tool-shop-org/backprop-trace' },
      ],
      sidebar: [
        {
          label: 'Handbook',
          autogenerate: { directory: 'handbook' },
        },
      ],
      customCss: ['./src/styles/starlight-custom.css'],
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
