'use client';

/**
 * CSV import and export for the period history.
 *
 * ## Two steps, and the preview really writes nothing
 *
 * The file is parsed locally on the server and returned as a *preview* before
 * anything is written; the commit re-uploads the same bytes (`mode: 'commit'`), so
 * the endpoint stays stateless and the user confirms exactly the file they chose.
 * That mirrors the TickTick importer, which is this app's established shape for
 * "bring history in from elsewhere".
 *
 * ## A partial import must never be silent
 *
 * The importer skips rows it cannot place — an unknown method, a duplicate date within
 * the file, a value outside the vocabulary — and reports them as
 * {@link PeriodImportIssue}s with the row number, the column and the offending
 * value. Those are rendered *always*, not behind a disclosure and not trimmed to a
 * count: "12 rows imported" that quietly dropped 3 is the failure this screen
 * exists to prevent. The list is capped for layout, and the cap says how many more
 * there are.
 *
 * ## Why `fetch` here and not `@/lib/api-client`
 *
 * `api-client` JSON-encodes every body and the offline queue understands JSON
 * writes only. A file upload is neither, so this is the one place in the period UI
 * that speaks HTTP directly — and it unwraps the same `{ ok, data }` envelope by
 * hand, so the error handling still matches the rest of the app.
 *
 * ## Two shapes of the same control
 *
 * `ImportCard` is the settings row, where a user goes deliberately. `ImportEmptyState`
 * is the one a **new** user sees first: with nothing recorded, the first job is to
 * get their history in, and a settings row three taps away is not where that job
 * belongs. The two share this file's `useCsvImport` hook and its `ResultRow`, so
 * the preview-is-not-a-write rule and the "never silently skip a row" rule are
 * implemented once — a second copy is how one of them would drift.
 */
import { useRef, useState } from 'react';
import { DownloadIcon } from '@svg-animated-icons/react/download';
import { ExclamationCircledIcon } from '@svg-animated-icons/react/exclamation-circled';
import { UploadIcon } from '@svg-animated-icons/react/upload';
import { useToast } from '@/components/app/Toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { invalidate } from '@/lib/store';
import type { PeriodImportResult } from '@/lib/period-types';
import { PERIOD_PREFIX } from './data';
import { SettingsGroup, SettingsRow, SETTINGS_ROW_CLASS } from '@/components/settings';
import { cn } from '@/lib/utils';

/** How many row problems are listed before the list says "and N more". */
const MAX_ISSUES_SHOWN = 20;

/** `POST /api/period/csv/import`, unwrapping the app's `{ ok, data }` envelope. */
async function uploadCsv(chosen: File, mode: 'preview' | 'commit'): Promise<PeriodImportResult> {
  const form = new FormData();
  form.append('file', chosen);
  form.append('mode', mode);

  const response = await fetch('/api/period/csv/import', {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
  });
  const body = (await response.json().catch(() => null)) as
    | { ok?: boolean; data?: PeriodImportResult; error?: string }
    | null;

  if (!response.ok || body?.ok === false || !body?.data) {
    throw new Error(body?.error ?? `The import failed (${response.status}).`);
  }
  return body.data;
}

/**
 * The upload state machine, shared by both shapes of the control.
 *
 * `preview` runs on file selection and writes nothing; `commit` re-uploads the
 * same bytes after the user has seen the summary. The file is kept in state for
 * exactly that reason — the commit must be the *same* file that was previewed.
 */
function useCsvImport() {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<PeriodImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(chosen: File, mode: 'preview' | 'commit') {
    setBusy(true);
    setError(null);
    try {
      const next = await uploadCsv(chosen, mode);
      setResult(next);
      if (mode === 'commit') {
        await invalidate(PERIOD_PREFIX);
        toast({ title: 'Import complete', variant: 'success' });
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The import failed.';
      setError(message);
      toast({ title: 'Import failed', description: message, variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return {
    inputRef,
    file,
    result,
    busy,
    error,
    choose(chosen: File | null) {
      setFile(chosen);
      setResult(null);
      setError(null);
      if (chosen) void run(chosen, 'preview');
    },
    commit() {
      if (file) void run(file, 'commit');
    },
    reset() {
      setFile(null);
      setResult(null);
      setError(null);
      if (inputRef.current) inputRef.current.value = '';
    },
  };
}

/* -------------------------------------------------------------------------- */
/* the settings row                                                           */
/* -------------------------------------------------------------------------- */

export function ImportCard() {
  const csv = useCsvImport();

  return (
    <SettingsGroup
      title="Import & export"
      footer="The exported file has exactly the columns the importer reads, so you can export, edit it in a spreadsheet and import it back."
    >
      <SettingsRow stacked>
        <div className="flex flex-col gap-2">
          <Label htmlFor="period-csv-template">Start from the template</Label>
          <p className="text-xs text-muted-foreground">
            One row per thing: a period, a day’s observations, a contraception method, or a logged contraception day.
            The first column says which.
          </p>
          <TemplateLinks />
        </div>
      </SettingsRow>

      <ImportFileRow csv={csv} id="period-csv-file" />

      {csv.result ? <ResultRow result={csv.result} /> : null}
    </SettingsGroup>
  );
}

/* -------------------------------------------------------------------------- */
/* the empty state                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The import, as the most prominent thing on a screen with no data.
 *
 * Shown on the Today screen and on Insights when nothing has been recorded yet,
 * because the first thing a user with an empty history needs is a way to fill it
 * — and the second thing they need is to know they do not have to. So the card
 * leads with the file and its template, and says in one line that starting from
 * scratch is a perfectly good answer; a user who was already tracking elsewhere
 * should not have to discover this inside the settings.
 */
export function ImportEmptyState({ className }: { className?: string }) {
  const csv = useCsvImport();

  return (
    <section
      data-empty-state="import"
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-border bg-card p-card text-card-foreground shadow-xs',
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Bring your history in</h2>
        <p className="text-sm text-muted-foreground">
          Nothing has been recorded yet. If you have been tracking somewhere else — an app, a spreadsheet, a paper
          diary — you can bring it across in one file and the prediction starts from your real cycles instead of
          waiting three months for them.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" className="h-9 gap-1.5">
            <a href="/api/period/csv/template" download>
              <DownloadIcon className="size-4 text-base" />
              Download the template
            </a>
          </Button>
          <Button asChild variant="outline" size="sm" className="h-9 gap-1.5">
            <a href="/api/period/csv/export" download>
              <DownloadIcon className="size-4 text-base" />
              Export what is here
            </a>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          The template has a row per thing — a period, a day’s observations, a method, a logged method day — and you
          only need the rows you have.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="period-csv-file-empty">Or import a file now</Label>
        <Input
          id="period-csv-file-empty"
          ref={csv.inputRef}
          type="file"
          accept=".csv,text/csv"
          disabled={csv.busy}
          onChange={(event) => csv.choose(event.target.files?.[0] ?? null)}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" className="h-9 gap-1.5" disabled={!csv.file || csv.busy} onClick={csv.commit}>
            <UploadIcon className="size-4 text-base" />
            {csv.result?.mode === 'preview' ? `Import ${dataRowCount(csv.result)} rows` : 'Import'}
          </Button>
          {csv.file ? (
            <Button type="button" variant="ghost" size="sm" className="h-9" disabled={csv.busy} onClick={csv.reset}>
              Clear
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Nothing is written until you confirm, and rows the importer cannot place are listed with their row number
          rather than dropped.
        </p>
        {csv.busy ? (
          <p aria-live="polite" className="text-xs text-muted-foreground">
            Reading the file…
          </p>
        ) : null}
        {csv.error ? (
          <p role="alert" className="text-xs text-destructive">
            {csv.error}
          </p>
        ) : null}
      </div>

      {csv.result ? <ResultRow result={csv.result} /> : null}

      <p className="text-xs text-muted-foreground">
        No file to import? Start with today — one tap below is a complete record, and the prediction only needs two
        period starts to have something to say.
      </p>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* pieces                                                                     */
/* -------------------------------------------------------------------------- */

/** The template and the export, together wherever the import is offered. */
function TemplateLinks() {
  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline" size="sm" className="h-9 gap-1.5">
        <a href="/api/period/csv/template" download>
          <DownloadIcon className="size-4 text-base" />
          Download template
        </a>
      </Button>
      <Button asChild variant="outline" size="sm" className="h-9 gap-1.5">
        <a href="/api/period/csv/export" download>
          <DownloadIcon className="size-4 text-base" />
          Export my data
        </a>
      </Button>
    </div>
  );
}

/** The file field, its confirm button and the two live lines under it. */
function ImportFileRow({ csv, id }: { csv: ReturnType<typeof useCsvImport>; id: string }) {
  return (
    <SettingsRow stacked>
      <div className="flex flex-col gap-2">
        <Label htmlFor={id}>Import a CSV</Label>
        <Input
          id={id}
          ref={csv.inputRef}
          type="file"
          accept=".csv,text/csv"
          disabled={csv.busy}
          onChange={(event) => csv.choose(event.target.files?.[0] ?? null)}
        />
        <p className="text-xs text-muted-foreground">
          Nothing is written until you confirm. Rows that cannot be placed are listed with their row number rather
          than dropped.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" className="h-9 gap-1.5" disabled={!csv.file || csv.busy} onClick={csv.commit}>
            <UploadIcon className="size-4 text-base" />
            {csv.result?.mode === 'preview' ? `Import ${dataRowCount(csv.result)} rows` : 'Import'}
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-9" disabled={csv.busy} onClick={csv.reset}>
            Clear
          </Button>
        </div>

        {csv.busy ? (
          <p aria-live="polite" className="text-xs text-muted-foreground">
            Reading the file…
          </p>
        ) : null}
        {csv.error ? (
          <p role="alert" className="text-xs text-destructive">
            {csv.error}
          </p>
        ) : null}
      </div>
    </SettingsRow>
  );
}

/** How many records the file describes, as one number, for the confirm button. */
function dataRowCount(result: PeriodImportResult): number {
  const p = result.preview;
  return p.cycles + p.days + p.methods + p.contraceptionDays;
}

/**
 * The result of the last upload: what it will do (preview) or what it did
 * (commit), plus every row it could not place.
 */
function ResultRow({ result }: { result: PeriodImportResult }) {
  const preview = result.preview;
  const summary = result.summary;
  const issues = summary?.issues ?? preview.issues;
  const issueCount = summary?.issueCount ?? preview.issueCount;
  const shown = issues.slice(0, MAX_ISSUES_SHOWN);

  /*
   * Two different numbers, summed into the one the user cares about.
   *
   * The parser reports *row problems* (`issueCount`: a bad date, a value outside
   * the vocabulary) and the writer reports *skipped rows* (`summary.skipped`: a
   * plan entry it could not place, such as an unknown method). Both mean "this row
   * is not in your data", and showing only one of them produced the exact
   * contradiction this line removes: "Rows skipped 0" directly above "1 row was
   * not imported".
   */
  const skipped = summary?.skipped ?? 0;
  const notImported = issueCount + skipped;

  return (
    <div className={cn(SETTINGS_ROW_CLASS, 'flex flex-col gap-2')} aria-live="polite">
      <p className="text-sm font-medium">
        {result.mode === 'preview' ? 'Ready to import' : 'Imported'}
      </p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {summary ? (
          <>
            <Count label="Periods added" value={summary.cyclesCreated} />
            <Count label="Periods updated" value={summary.cyclesUpdated} />
            <Count label="Days added" value={summary.daysCreated} />
            <Count label="Days updated" value={summary.daysUpdated} />
            <Count label="Methods added" value={summary.methodsCreated} />
            <Count label="Methods updated" value={summary.methodsUpdated} />
            <Count label="Birth control days added" value={summary.contraceptionDaysCreated} />
            <Count label="Birth control days updated" value={summary.contraceptionDaysUpdated} />
          </>
        ) : (
          <>
            <Count label="Periods" value={preview.cycles} />
            <Count label="Days" value={preview.days} />
            <Count label="Methods" value={preview.methods} />
            <Count label="Birth control days" value={preview.contraceptionDays} />
          </>
        )}
        <Count label={`Rows not imported${result.mode === 'preview' ? ' (yet)' : ''}`} value={notImported} />
      </dl>

      <p className="text-xs text-muted-foreground">
        {preview.dataRows} data {preview.dataRows === 1 ? 'row' : 'rows'} read from {preview.fileName}.
      </p>

      {preview.notes.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {preview.notes.map((note) => (
            <li key={note} className="text-xs text-muted-foreground">
              {note}
            </li>
          ))}
        </ul>
      ) : null}

      {skipped > 0 ? (
        <p className="text-xs text-muted-foreground">
          {skipped} {skipped === 1 ? 'row could' : 'rows could'} not be placed — an unknown method, or a date that
          appears twice in the file.
        </p>
      ) : null}

      {/*
        Always rendered when there is anything to say, and never collapsed: a
        partial import the user cannot inspect is the bug this screen exists to
        prevent.
      */}
      {shown.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-md border border-border p-2">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <ExclamationCircledIcon className="size-4 text-base" />
            {issueCount} {issueCount === 1 ? 'row could not be read and was' : 'rows could not be read and were'} left
            out{result.mode === 'preview' ? ' if you import it' : ''}.
          </p>
          <ul className="flex flex-col gap-1">
            {shown.map((issue) => (
              <li key={`${issue.row}-${issue.column ?? ''}-${issue.message}`} className="text-xs text-muted-foreground">
                Row {issue.row}
                {issue.column ? `, ${issue.column}` : ''}
                {issue.value ? ` (“${issue.value}”)` : ''}: {issue.message}
              </li>
            ))}
          </ul>
          {issueCount > shown.length ? (
            <p className="text-xs text-muted-foreground">…and {issueCount - shown.length} more.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="min-w-0 truncate text-muted-foreground">{label}</dt>
      <dd className="shrink-0 tabular-nums">{value}</dd>
    </div>
  );
}
