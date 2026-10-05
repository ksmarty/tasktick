import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    /*
     * Pin the mode. Without this the suite inherits whatever `NODE_ENV` the
     * invoking shell happens to have, and `src/lib/env.ts` throws in production
     * unless `BETTER_AUTH_SECRET` is set — which takes out 22 files at import
     * time (`npm run test` in a production-shaped shell, not `npm run build`).
     * Tests are not a production runtime; say so here rather than relying on the
     * ambient value being unset.
     */
    env: { NODE_ENV: 'test' },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
