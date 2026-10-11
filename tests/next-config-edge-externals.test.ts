import { describe, expect, it } from 'vitest';

import nextConfig from '../next.config.mjs';

/**
 * `next dev` compiles src/instrumentation.ts for the edge runtime as well as
 * for the node server (entries.js `runDependingOnPageType` calls both
 * `onServer()` and `onEdgeServer()` for the instrumentation hook), and the
 * edge compiler does not externalise node builtins — only the handful Next
 * polyfills. The hook's import graph is node-only, so that second compilation
 * fails with "Can't resolve 'http'" and every route 500s in dev. `next build`
 * is unaffected because it drops the lone edge instrumentation entry.
 *
 * The hook below is what keeps dev working, so pin it: dropping it silently
 * brings the 500s back, and widening it to the node compiler would hide real
 * resolution errors.
 */

type EdgeHook = (
  config: { externals?: unknown[] },
  options: { nextRuntime?: string },
) => { externals?: unknown[] };

const { webpack } = nextConfig as unknown as { webpack: EdgeHook };

const NODE_ONLY_BOOT_MODULES = [
  '@/server/services/reminder-scheduler',
  '@/server/services/scheduler',
  '@/server/mdns',
];

describe('next.config.mjs edge compiler', () => {
  it('stubs the node-only boot modules for the edge compilation', () => {
    const edge = webpack({ externals: [] }, { nextRuntime: 'edge' });

    expect(edge.externals).toEqual([
      Object.fromEntries(NODE_ONLY_BOOT_MODULES.map((module) => [module, '{}'])),
    ]);
  });

  it('keeps existing externals when it stubs them', () => {
    const existing = { sharp: '{}' };
    const edge = webpack({ externals: [existing] }, { nextRuntime: 'edge' });

    expect(edge.externals).toEqual([
      existing,
      Object.fromEntries(NODE_ONLY_BOOT_MODULES.map((module) => [module, '{}'])),
    ]);
  });

  it('leaves the node and client compilations untouched', () => {
    for (const nextRuntime of ['nodejs', undefined]) {
      const config = webpack({ externals: [] }, { nextRuntime });

      expect(config.externals).toEqual([]);
    }
  });
});
