/**
 * RFC 4180 CSV reader.
 *
 * Written by hand rather than pulled in, because the naive alternative — a
 * `split(',')` — corrupts every field that contains a comma, and an import that
 * silently mangles a task title is worse than one that refuses the file.
 *
 * The reader is deliberately tolerant in two places, because real exports are
 * not always well-formed:
 *
 *  - A byte-order mark at the start of the buffer is stripped. Excel writes one,
 *    and it would otherwise become part of the first header cell (`﻿"Title"`),
 *    which then fails to match any known column.
 *  - A quote that appears in the middle of an unquoted field is kept literally
 *    instead of throwing. TickTick's own export is quoted, but a hand-edited
 *    file is a realistic input and dropping the character would lose data.
 *
 * What it does *not* do is guess: a file that ends inside an open quoted field is
 * reported through `unclosedQuote` so the caller can refuse it rather than
 * import a truncated last row.
 */

export interface CsvParseResult {
  /** Records, one array per row. Fully blank rows are not dropped here. */
  rows: string[][];
  /**
   * True when the input ended while still inside a quoted field, which is the
   * signature of a truncated download. Also true when the text had zero rows.
   */
  unclosedQuote: boolean;
  /** Counts the records emitted, ignoring a trailing newline. */
  rowCount: number;
}

/** Splits CSV text into records and fields. Never throws. */
export function parseCsv(text: string, delimiter = ','): CsvParseResult {
  // Strip a UTF-8 BOM so the first header cell matches by name.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  /** Whether the current record has any content, so a trailing newline is ignored. */
  let rowTouched = false;

  const endRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = '';
    rowTouched = false;
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          // An escaped quote inside a quoted field.
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        // Inside quotes everything else, including newlines, is literal.
        field += char;
      }
      continue;
    }

    if (char === '"') {
      if (field === '') {
        inQuotes = true;
      } else {
        // Mid-field quote in an unquoted cell: keep it rather than lose data.
        field += '"';
      }
      rowTouched = true;
      continue;
    }

    if (char === delimiter) {
      row.push(field);
      field = '';
      rowTouched = true;
      continue;
    }

    if (char === '\r' || char === '\n') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      endRow();
      continue;
    }

    field += char;
    rowTouched = true;
  }

  // A file that ends with a newline has already flushed its last record; only
  // emit a final record when there is something pending.
  if (rowTouched || field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return { rows, unclosedQuote: inQuotes, rowCount: rows.length };
}
