/**
 * The hand-written RFC 4180 reader.
 *
 * A naive `split(',')` corrupts any task whose title contains a comma, so every
 * case here is one that would silently destroy data with the shortcut.
 */
import { describe, expect, it } from 'vitest';
import { parseCsv } from '@/lib/csv';

describe('parseCsv', () => {
  it('splits plain records', () => {
    const { rows } = parseCsv('a,b,c\n1,2,3');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps a comma inside a quoted field', () => {
    const { rows } = parseCsv('title,notes\n"Buy milk, bread","a, b, c"');
    expect(rows[1]).toEqual(['Buy milk, bread', 'a, b, c']);
  });

  it('keeps a newline inside a quoted field', () => {
    const { rows } = parseCsv('title,notes\n"Two lines","first\nsecond"');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(['Two lines', 'first\nsecond']);
  });

  it('unescapes doubled quotes', () => {
    const { rows } = parseCsv('"He said ""hi""","x"');
    expect(rows[0]).toEqual(['He said "hi"', 'x']);
  });

  it('handles CRLF line endings', () => {
    const { rows } = parseCsv('a,b\r\n"c,d",e\r\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['c,d', 'e'],
    ]);
  });

  it('ignores a single trailing newline but not a trailing empty row', () => {
    expect(parseCsv('a,b\n1,2\n').rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a,b\n1,2\n\n').rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
      [''],
    ]);
  });

  it('strips a byte-order mark from the first cell', () => {
    const { rows } = parseCsv('\ufeffTitle,List Name\nx,y');
    expect(rows[0]).toEqual(['Title', 'List Name']);
  });

  it('preserves empty fields, including between commas', () => {
    const { rows } = parseCsv('a,,c\n,,\n');
    expect(rows).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
    ]);
  });

  it('reports an unclosed quoted field instead of truncating silently', () => {
    const result = parseCsv('a,b\n"never closed,2');
    expect(result.unclosedQuote).toBe(true);
    expect(result.rows[1]).toEqual(['never closed,2']);
  });

  it('keeps a stray quote inside an unquoted field', () => {
    const { rows } = parseCsv('a,b\nsay "hi",2');
    expect(rows[1]).toEqual(['say "hi"', '2']);
  });

  it('returns no rows for an empty file', () => {
    const result = parseCsv('');
    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(0);
  });

  it('supports a custom delimiter', () => {
    const { rows } = parseCsv('a;b\n"x;y";z', ';');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x;y', 'z'],
    ]);
  });

  it('does not split an embedded quoted comma across records', () => {
    const { rows } = parseCsv('"a,b"\n"c,d,e"\n');
    expect(rows).toEqual([['a,b'], ['c,d,e']]);
  });
});
