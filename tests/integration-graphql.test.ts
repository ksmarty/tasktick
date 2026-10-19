/**
 * The GraphQL documents the Home Assistant integration sends, checked against
 * the schema that has to answer them.
 *
 * The integration keeps its operations as string constants in
 * `custom_components/tasktick/api.py` — a tree with a Python suite of its own
 * that cannot see this schema — and the endpoint here validates every document
 * before it executes it. The two can therefore disagree without either suite
 * noticing, until an instance fails to set up. They did: the snapshot asked for
 * `stats { completedByDay }` while `completedByDay` is `[DayCount!]!`, an object
 * field, so the first poll answered
 * `Failed setup, will retry: TaskTick rejected the query: Field "completedByDay"
 * of type "[DayCount!]!" must have a selection of subfields.`
 *
 * Validating here rather than in Python keeps one schema rather than two: the
 * document is checked against `getSchema()`, the same schema the endpoint builds.
 */
import { readFileSync } from 'node:fs';
import { Kind, parse, validate } from 'graphql';
import { describe, expect, it } from 'vitest';
import { getSchema } from '@/server/graphql/execute';

const API = new URL('../custom_components/tasktick/api.py', import.meta.url);
const source = readFileSync(API, 'utf8');

/** `NAME = """\n…\n"""` — the shape every operation is kept in. */
const DECLARED = /^([A-Z][A-Z0-9_]*)\s*=\s*"""\n([\s\S]*?)\n"""/gm;

const documents = [...source.matchAll(DECLARED)].map(([, name, body]) => ({
  name,
  body: body.trim(),
}));

describe("the Home Assistant integration's GraphQL documents", () => {
  it('reads every operation out of api.py', () => {
    // A constant that stops looking like this would be *silently* absent from
    // the validation below — the only thing standing between the two trees and
    // the next "Failed setup".
    const declared = source.match(/^[A-Z][A-Z0-9_]*\s*=\s*"""/gm) ?? [];

    expect(documents.length).toBeGreaterThanOrEqual(12);
    expect(declared).toHaveLength(documents.length);
    expect(documents.map(({ name }) => name)).toContain('SNAPSHOT_QUERY');
    expect(
      documents.filter(({ body }) => !/(?:^|\n)\s*(query|mutation)\b/.test(body)),
    ).toEqual([]);
  });

  it.each(documents)('$name is valid', ({ body }) => {
    const document = parse(body);
    const operations = document.definitions.filter(
      (definition) => definition.kind === Kind.OPERATION_DEFINITION,
    );

    expect(operations).toHaveLength(1);
    expect(validate(getSchema(), document).map((error) => error.message)).toEqual([]);
  });
});
