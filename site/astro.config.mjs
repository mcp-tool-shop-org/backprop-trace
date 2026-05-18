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
      description: 'Deterministic 26-rule verifier for neural-network training steps. Re-derives gradients + optimizer state from named factors; emits canonical JSONL. PyTorch helper + sidecar import. Mid-v0; CPU-only.',
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
