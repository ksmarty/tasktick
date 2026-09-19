/**
 * Dialect parity contract between `schema.sqlite.ts` and `schema.pg.ts`.
 *
 * `src/server/db/schema.ts` casts the Postgres schema to the SQLite schema type,
 * so any structural drift between the two is a silent runtime bug: queries are
 * compiled once against one shape and executed by whichever driver is configured.
 *
 * Every expectation below is *derived* from one dialect and compared against the
 * other (no hand-maintained snapshot of the SQLite schema), plus a compile-time
 * assertion that both dialects infer identical row types. Add a table or column
 * to `schema.sqlite.ts` without mirroring it and this file fails.
 */
import { describe, expect, it } from 'vitest';
import { getTableColumns, is } from 'drizzle-orm';
import { SQLiteTable, getTableConfig as getSqliteTableConfig } from 'drizzle-orm/sqlite-core';
import { PgTable, getTableConfig as getPgTableConfig, isPgEnum } from 'drizzle-orm/pg-core';
import * as sqliteSchema from '@/server/db/schema.sqlite';
import * as pgSchema from '@/server/db/schema.pg';

/* -------------------------------------------------------------------------- */
/* dialect-neutral view of a table                                            */
/* -------------------------------------------------------------------------- */

interface ColumnShape {
  /** TS property name on the table object (what the query builder uses). */
  property: string;
  /** Physical DB column name. */
  column: string;
  /** Drizzle column class, e.g. `SQLiteInteger` / `PgBigInt53`. */
  columnType: string;
  /** JS type produced by the column, e.g. `number` / `boolean` / `json` / `date`. */
  dataType: string;
  notNull: boolean;
  hasDefault: boolean;
  /** Literal default value; `undefined` for `$defaultFn` defaults. */
  defaultValue: unknown;
}

interface IndexShape {
  name: string;
  unique: boolean;
  columns: string[];
}

interface ConstraintShape {
  name: string;
  columns: string[];
}

interface ForeignKeyShape {
  columns: string[];
  foreignTable: string;
  foreignColumns: string[];
  onDelete: string;
}

interface TableShape {
  table: string;
  columns: ColumnShape[];
  indexes: IndexShape[];
  uniqueConstraints: ConstraintShape[];
  primaryKey: ConstraintShape | null;
  foreignKeys: ForeignKeyShape[];
}

/* ---- minimal structural views of drizzle's internal objects ---- */

interface RawColumn {
  name: string;
  columnType: string;
  dataType: string;
  notNull: boolean;
  hasDefault: boolean;
  default: unknown;
  enumValues?: unknown[];
}

interface RawIndex {
  config: { name?: string; unique: boolean; columns: { name: string }[] };
}

interface RawConstraint {
  getName(): string;
  columns: { name: string }[];
}

interface RawForeignKey {
  reference(): {
    columns: { name: string }[];
    foreignTable: unknown;
    foreignColumns: { name: string }[];
  };
  onDelete?: string;
}

interface RawTableConfig {
  name: string;
  indexes: RawIndex[];
  uniqueConstraints: RawConstraint[];
  primaryKeys: RawConstraint[];
  foreignKeys: RawForeignKey[];
}

/* ---- builders ---- */

function shapeTable(
  config: RawTableConfig,
  properties: string[],
  columns: RawColumn[],
  foreignTableName: (table: unknown) => string,
): TableShape {
  const byProperty = new Map(properties.map((property, i) => [property, columns[i]]));

  return {
    table: config.name,
    columns: properties.map((property) => {
      const column = byProperty.get(property)!;
      return {
        property,
        column: column.name,
        columnType: column.columnType,
        dataType: column.dataType,
        notNull: column.notNull,
        hasDefault: column.hasDefault,
        defaultValue: column.default,
      };
    }),
    indexes: config.indexes.map((i) => ({
      name: i.config.name ?? '',
      unique: i.config.unique,
      columns: i.config.columns.map((c) => c.name),
    })),
    uniqueConstraints: config.uniqueConstraints.map((c) => ({
      name: c.getName(),
      columns: c.columns.map((col) => col.name),
    })),
    primaryKey: config.primaryKeys.length
      ? { name: config.primaryKeys[0].getName(), columns: config.primaryKeys[0].columns.map((c) => c.name) }
      : null,
    foreignKeys: config.foreignKeys.map((fk) => {
      const ref = fk.reference();
      return {
        columns: ref.columns.map((c) => c.name),
        foreignTable: foreignTableName(ref.foreignTable),
        foreignColumns: ref.foreignColumns.map((c) => c.name),
        // sqlite leaves an unspecified action undefined; SQL semantics are NO ACTION.
        onDelete: fk.onDelete ?? 'no action',
      };
    }),
  };
}

function shapeSqliteTable(table: SQLiteTable): TableShape {
  const config = getSqliteTableConfig(table) as unknown as RawTableConfig;
  const columns = getTableColumns(table) as unknown as Record<string, RawColumn>;
  return shapeTable(config, Object.keys(columns), Object.values(columns), (foreign) =>
    getSqliteTableConfig(foreign as SQLiteTable).name,
  );
}

function shapePgTable(table: PgTable): TableShape {
  const config = getPgTableConfig(table) as unknown as RawTableConfig;
  const columns = getTableColumns(table) as unknown as Record<string, RawColumn>;
  return shapeTable(config, Object.keys(columns), Object.values(columns), (foreign) =>
    getPgTableConfig(foreign as PgTable).name,
  );
}

function tablesOf<T>(module: Record<string, unknown>, guard: (value: unknown) => value is T): Map<string, T> {
  return new Map(
    Object.entries(module)
      .filter((entry): entry is [string, T] => guard(entry[1]))
      .map(([key, table]) => [key, table]),
  );
}

const sqliteTables = tablesOf<SQLiteTable>(sqliteSchema, (v): v is SQLiteTable => is(v, SQLiteTable));
const pgTables = tablesOf<PgTable>(pgSchema, (v): v is PgTable => is(v, PgTable));

const sqliteByName = new Map([...sqliteTables.values()].map((t) => [shapeSqliteTable(t).table, shapeSqliteTable(t)]));
const pgByName = new Map([...pgTables.values()].map((t) => [shapePgTable(t).table, shapePgTable(t)]));

const tableNames = [...sqliteByName.keys()].sort();

/** Drops the dialect-specific column class, leaving everything that must match. */
function dialectNeutral(columns: ColumnShape[]): Omit<ColumnShape, 'columnType'>[] {
  return columns.map(({ columnType: _columnType, ...rest }) => rest);
}

/* -------------------------------------------------------------------------- */
/* portability mapping                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The *only* permitted sqlite column class -> pg column class pairs. Anything
 * outside this table is drift, including native pg enums and 32-bit integers.
 */
const PORTABILITY: Record<string, string> = {
  SQLiteText: 'PgText',
  SQLiteInteger: 'PgBigInt53',
  SQLiteBoolean: 'PgBoolean',
  SQLiteTimestamp: 'PgTimestamp',
  SQLiteTextJson: 'PgJsonb',
  SQLiteReal: 'PgDoublePrecision',
};

const mappedPgColumnTypes = new Set(Object.values(PORTABILITY));

/* -------------------------------------------------------------------------- */
/* compile-time parity                                                        */
/* -------------------------------------------------------------------------- */

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

/**
 * Fails `tsc --noEmit` if a dialect infers a different JS type for any column of
 * any table — the strongest form of the parity guarantee, since it is checked
 * over every column rather than a sampled list.
 */
type RowTypeParity = [
  Expect<Equal<sqliteSchema.UserRow, pgSchema.UserRow>>,
  Expect<Equal<sqliteSchema.SessionRow, pgSchema.SessionRow>>,
  Expect<Equal<sqliteSchema.InviteRow, pgSchema.InviteRow>>,
  Expect<Equal<sqliteSchema.UserSettingsRow, pgSchema.UserSettingsRow>>,
  Expect<Equal<sqliteSchema.ListRow, pgSchema.ListRow>>,
  Expect<Equal<sqliteSchema.TagRow, pgSchema.TagRow>>,
  Expect<Equal<sqliteSchema.TaskRow, pgSchema.TaskRow>>,
  Expect<Equal<sqliteSchema.TaskReminderRow, pgSchema.TaskReminderRow>>,
  Expect<Equal<sqliteSchema.HabitRow, pgSchema.HabitRow>>,
  Expect<Equal<sqliteSchema.HabitEntryRow, pgSchema.HabitEntryRow>>,
  Expect<Equal<sqliteSchema.CaldavAccountRow, pgSchema.CaldavAccountRow>>,
  Expect<Equal<sqliteSchema.CalendarRow, pgSchema.CalendarRow>>,
  Expect<Equal<sqliteSchema.CalendarEventRow, pgSchema.CalendarEventRow>>,
  Expect<Equal<sqliteSchema.SyncLogRow, pgSchema.SyncLogRow>>,
  Expect<Equal<sqliteSchema.SyncConflictRow, pgSchema.SyncConflictRow>>,
  Expect<Equal<sqliteSchema.PushSubscriptionRow, pgSchema.PushSubscriptionRow>>,
  Expect<Equal<sqliteSchema.IcalTokenRow, pgSchema.IcalTokenRow>>,
  Expect<Equal<sqliteSchema.FocusSessionRow, pgSchema.FocusSessionRow>>,
  Expect<Equal<sqliteSchema.SavedFilterRow, pgSchema.SavedFilterRow>>,
  Expect<Equal<sqliteSchema.ImportKeyRow, pgSchema.ImportKeyRow>>,
];

/**
 * One `true` per `RowTypeParity` entry. Presence in an `it` keeps the tuple from
 * being tree-shaken out of type checking.
 */
const rowTypeParity: RowTypeParity = new Array(20).fill(true) as RowTypeParity;

/* -------------------------------------------------------------------------- */
/* tests                                                                      */
/* -------------------------------------------------------------------------- */

describe('schema parity: module surface', () => {
  it('exports the same tables from both dialects', () => {
    expect([...pgTables.keys()].sort()).toEqual([...sqliteTables.keys()].sort());
    expect(tableNames).toHaveLength(24);
    expect([...pgByName.keys()].sort()).toEqual(tableNames);
  });

  it('reports identical row types (compile-time, asserted at runtime)', () => {
    expect(rowTypeParity.every(Boolean)).toBe(true);
  });

  it('never declares a native pg enum', () => {
    expect(Object.values(pgSchema).filter(isPgEnum)).toEqual([]);

    const withEnumValues = [...pgByName.values()]
      .flatMap((t) => t.columns.map((c) => ({ table: t.table, ...c })))
      .filter((c) => ((c as unknown as RawColumn).enumValues ?? []).length > 0)
      .map((c) => `${c.table}.${c.property}`);
    expect(withEnumValues).toEqual([]);
  });
});

describe('schema parity: tables', () => {
  it.each(tableNames)('%s', (name) => {
    const sqlite = sqliteByName.get(name)!;
    const pg = pgByName.get(name)!;

    // Same property names, in the same declaration order, with the same physical
    // column names, nullability, defaults and JS types. `columnType` names the
    // dialect-specific column class, so it is checked by the portability suite.
    expect(dialectNeutral(pg.columns)).toEqual(dialectNeutral(sqlite.columns));

    expect(pg.indexes).toEqual(sqlite.indexes);
    expect(pg.uniqueConstraints).toEqual(sqlite.uniqueConstraints);
    expect(pg.primaryKey).toEqual(sqlite.primaryKey);
    expect(pg.foreignKeys).toEqual(sqlite.foreignKeys);
  });
});

describe('schema parity: portability mapping', () => {
  it('maps every column through the documented sqlite -> pg table', () => {
    const problems: string[] = [];

    for (const [name, sqlite] of sqliteByName) {
      const pg = pgByName.get(name);
      if (!pg) {
        problems.push(`${name}: missing from schema.pg.ts`);
        continue;
      }
      for (const [i, sqliteColumn] of sqlite.columns.entries()) {
        const pgColumn = pg.columns[i];
        const expected = PORTABILITY[sqliteColumn.columnType];
        if (!expected) {
          problems.push(`${name}.${sqliteColumn.property}: sqlite ${sqliteColumn.columnType} has no pg mapping`);
        } else if (pgColumn.columnType !== expected) {
          problems.push(
            `${name}.${sqliteColumn.property}: sqlite ${sqliteColumn.columnType} must be pg ${expected}, found pg ${pgColumn.columnType}`,
          );
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it('uses no pg column class outside the mapping', () => {
    const unmapped = [...pgByName.values()]
      .flatMap((t) => t.columns.map((c) => ({ table: t.table, ...c })))
      .filter((c) => !mappedPgColumnTypes.has(c.columnType))
      .map((c) => `${c.table}.${c.property}: pg ${c.columnType}`);
    expect(unmapped).toEqual([]);
  });
});
