import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The Home Assistant manifest's `version` is what HACS reads off an installed
 * copy, and what the integration page shows. It sat at 0.42.1 for dozens of
 * releases — the file moved to the repository root and nothing kept bumping it —
 * so every install claimed a version two minor lines old, and "which release am
 * I actually running" had no answer that could be trusted.
 *
 * `scripts/build_zip.py` stamps the archive from `package.json`, which is why
 * updates still worked; this is the file a reader looks at, so it has to agree.
 */

const root = new URL('..', import.meta.url);

function read(path: string): string {
  return readFileSync(new URL(path, root), 'utf8');
}

describe('the packaged integration names the release it came from', () => {
  it('carries the same version as package.json', () => {
    const app = JSON.parse(read('package.json')) as { version: string };
    const manifest = JSON.parse(read('custom_components/tasktick/manifest.json')) as {
      version: string;
      domain: string;
    };

    expect(manifest.domain).toBe('tasktick');
    expect(manifest.version).toBe(app.version);
  });

  it('is bumped by the release workflow, not by hand', () => {
    // A hand bump drifts on the next release: this asserts the workflow that
    // writes package.json writes the manifest in the same commit.
    const workflow = read('.github/workflows/auto-increment.yml');

    expect(workflow).toContain('custom_components/tasktick/manifest.json');
    expect(workflow).toContain(
      'git add package.json package-lock.json custom_components/tasktick/manifest.json',
    );
  });
});
