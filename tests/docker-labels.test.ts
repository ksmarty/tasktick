import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The image answers "which release is this?" from its own config.
 *
 * A container that only carries a mutable `latest` tag cannot say what it is
 * running: the tag moves, the deployment does not. OCI labels are the standard
 * place for that answer, and the version has to come from the build, because
 * nothing inside a built image knows which release it became.
 */
const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), 'utf8');

describe('the published image says which release it is', () => {
  const dockerfile = read('Dockerfile');
  const workflow = read('.github/workflows/docker-publish.yml');

  it('labels the image with the OCI properties', () => {
    expect(dockerfile).toContain('org.opencontainers.image.version="${VERSION}"');
    expect(dockerfile).toContain('org.opencontainers.image.revision="${REVISION}"');
    expect(dockerfile).toContain('org.opencontainers.image.created="${CREATED}"');
    expect(dockerfile).toContain('org.opencontainers.image.source="${SOURCE_URL}"');
    expect(dockerfile).toContain('org.opencontainers.image.licenses="AGPL-3.0-or-later"');
  });

  it('takes the version from the build, and says so when there is none', () => {
    // `dev`/`local` are visibly not a release; a fabricated `0.0.0` would look
    // like one.
    expect(dockerfile).toContain('ARG VERSION=dev');
    expect(dockerfile).toContain('ARG REVISION=local');
    expect(dockerfile).toContain('ARG SOURCE_URL=https://github.com/ksmarty/tasktick');
  });

  it('feeds the dispatched or checked-out version to both the labels and the build args', () => {
    expect(workflow).toContain('id: version');
    expect(workflow).toContain('INPUT_VERSION: ${{ inputs.version }}');
    expect(workflow).toContain(
      'VERSION="${INPUT_VERSION:-$(node -p "require(\'./package.json\').version")}"',
    );
    // `${VERSION#v}`: a dispatched `v0.42.53` and a tag-derived `0.42.53` have
    // to end up as the same label.
    expect(workflow).toContain('echo "version=${VERSION#v}" >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain(
      'org.opencontainers.image.version=${{ steps.version.outputs.version }}',
    );
    expect(workflow).toContain('org.opencontainers.image.revision=${{ github.sha }}');
    expect(workflow).toContain('VERSION=${{ steps.version.outputs.version }}');
    expect(workflow).toContain('REVISION=${{ github.sha }}');
  });
});
