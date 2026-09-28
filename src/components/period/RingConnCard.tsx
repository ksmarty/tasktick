'use client';

/**
 * Wearable / RingConn data card.
 *
 * ## What this card is, and what it deliberately is not
 *
 * It is **not** a connect button, because there is nothing to connect to: RingConn
 * publishes no developer API — no developer portal, no API documentation, no OAuth
 * flow, no SDK (see the long note at the top of `@/lib/ringconn`, which cites the
 * vendor's own sitemap and the hosts that do not resolve). A "Connect RingConn"
 * button here would be a lie with a spinner on it.
 *
 * It is an **export-and-import**, and it says so in one sentence, because a user
 * who believes their ring is syncing when it is not is worse off than one who
 * knows they have to export. The `sources` block in the result is the part that
 * earns its keep: RingConn's app and its Health Connect integration both omit skin
 * temperature (the vendor's own data-type list and its exported CSVs — see the
 * library note), so the honest answer to "is my ring's temperature coming through?"
 * is *what each app actually wrote into the export*. That is reported per source,
 * including the sources that wrote data and no temperature.
 *
 * ## Brevity
 *
 * The period settings are already text-heavy and that has been complained about,
 * so this card carries exactly one explanatory sentence, one control, and the
 * result of the last file. Everything else lives in the library where a reader who
 * wants it can find it.
 *
 * ## Where it is mounted
 *
 * `PeriodSettings.tsx` renders the settings cards for the period interface; this
 * belongs directly after `ImportCard` there. This file is the only one it changes.
 */
import { useRef, useState } from 'react';
import { ExclamationCircledIcon } from '@svg-animated-icons/react/exclamation-circled';
import { UploadIcon } from '@svg-animated-icons/react/upload';
import { useToast } from '@/components/app/Toast';
import { SettingsGroup, SETTINGS_ROW_CLASS, SettingsRow } from '@/components/settings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { invalidate } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { WearableImportResult } from '@/lib/ringconn';
import { PERIOD_PREFIX } from './data';

/** How many row problems are listed before the list says how many more there are. */
const MAX_ISSUES_SHOWN = 10;

export function RingConnCard() {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<WearableImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(chosen: File, mode: 'preview' | 'commit') {
    /*
     * The file itself is the request body rather than a multipart field: an Apple
     * Health export is routinely hundreds of megabytes, and `FormData` would buffer
     * all of it. Everything else about the envelope is the app's usual `{ ok, data }`.
     */
    const url = `/api/period/ringconn/import?mode=${mode}&fileName=${encodeURIComponent(chosen.name)}`;
    const response = await fetch(url, {
      method: 'POST',
      body: chosen,
      credentials: 'same-origin',
      headers: { 'content-type': chosen.type || 'application/octet-stream' },
    });
    const body = (await response.json().catch(() => null)) as
      | { ok?: boolean; data?: WearableImportResult; error?: string }
      | null;

    if (!response.ok || body?.ok === false || !body?.data) {
      throw new Error(body?.error ?? `The import failed (${response.status}).`);
    }
    return body.data;
  }

  async function run(chosen: File, mode: 'preview' | 'commit') {
    setBusy(true);
    setError(null);
    try {
      const next = await upload(chosen, mode);
      setResult(next);
      if (mode === 'commit') {
        await invalidate(PERIOD_PREFIX);
        toast({ title: 'Import complete', variant: 'success' });
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The import failed.';
      setError(message);
      if (mode === 'commit') toast({ title: 'Import failed', description: message, variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsGroup
      title="Ring & wearable data"
    >
      <SettingsRow stacked>
        <div className="flex flex-col gap-2">
          <Label htmlFor="period-ringconn-file">Import a wearable export</Label>
          <p className="text-xs text-muted-foreground">
            RingConn has no API to connect to, so data arrives as a file: export from Apple Health (profile → Export All
            Health Data), unzip it, and choose <span className="font-medium">export.xml</span> here.
          </p>
          <Input
            id="period-ringconn-file"
            ref={inputRef}
            type="file"
            accept=".xml,.csv,text/xml,application/xml,text/csv"
            disabled={busy}
            onChange={(event) => {
              const chosen = event.target.files?.[0] ?? null;
              setFile(chosen);
              setResult(null);
              setError(null);
              if (chosen) void run(chosen, 'preview');
            }}
          />

          <div className="flex flex-wrap gap-2">
            {/* Nothing chosen is nothing to import, so the action stays disabled. */}
            <Button
              type="button"
              size="sm"
              className="h-9 gap-1.5"
              disabled={!file || busy}
              onClick={() => {
                if (file) void run(file, 'commit');
              }}
            >
              <UploadIcon className="size-4 text-base" />
              {result?.mode === 'preview' ? `Import ${result.preview.daysWithTemperature} days` : 'Import'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9"
              disabled={busy}
              onClick={() => {
                setFile(null);
                setResult(null);
                setError(null);
                if (inputRef.current) inputRef.current.value = '';
              }}
            >
              Clear
            </Button>
          </div>

          {busy ? (
            <p aria-live="polite" className="text-xs text-muted-foreground">
              Reading the file…
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </SettingsRow>

      {result ? <ResultBlock result={result} /> : null}
    </SettingsGroup>
  );
}

/**
 * What the last file contained.
 *
 * Three things, in the order they matter: whose data it was, what would be written,
 * and what could not be read. The source table is the first because it is the only
 * part that answers a question the vendor app cannot.
 */
function ResultBlock({ result }: { result: WearableImportResult }) {
  const preview = result.preview;
  const summary = result.summary;
  const issues = summary?.issues ?? preview.issues;
  const issueCount = summary?.issueCount ?? preview.issueCount;
  const shown = issues.slice(0, MAX_ISSUES_SHOWN);
  const notes = summary?.notes ?? preview.notes;

  const filled = summary ? summary.temperatureFilled : preview.daysWithTemperature;
  const kept = summary ? summary.temperatureKept : 0;

  return (
    <div className={cn(SETTINGS_ROW_CLASS, 'flex flex-col gap-3')} aria-live="polite">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">
          {result.mode === 'preview' ? `Read ${preview.formatLabel}` : `Imported from ${preview.formatLabel}`}
        </p>
        <p className="text-xs text-muted-foreground">
          {preview.counts.recordsRead.toLocaleString()} records
          {preview.dateRange ? `, ${preview.dateRange.from} to ${preview.dateRange.to}` : ''} ·{' '}
          {preview.counts.temperature.toLocaleString()} temperature · {preview.counts.weight.toLocaleString()} weight
          {preview.counts.sleep ? ` · ${preview.counts.sleep.toLocaleString()} sleep` : ''}
          {preview.counts.restingHeartRate ? ` · ${preview.counts.restingHeartRate.toLocaleString()} resting HR` : ''}
        </p>
      </div>

      {preview.sources.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-md border border-border p-2">
          <p className="text-xs font-medium">Where the data came from</p>
          <ul className="flex flex-col gap-0.5">
            {preview.sources.slice(0, 6).map((source) => (
              <li key={source.name} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="min-w-0 truncate text-muted-foreground">{source.name}</span>
                <span className="shrink-0 tabular-nums">
                  {source.temperature} temp / {source.records.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
          {preview.counts.temperature === 0 ? (
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <ExclamationCircledIcon className="size-4 text-base" />
              No app wrote a temperature into this export.
            </p>
          ) : null}
        </div>
      ) : null}

      {preview.examples.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium">{result.mode === 'preview' ? 'Would write' : 'Wrote'}</p>
          <ul className="flex flex-col gap-0.5">
            {preview.examples.map((example) => (
              <li key={example.date} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="min-w-0 truncate text-muted-foreground">
                  {example.date} · {example.origin}
                  {example.source ? ` (${example.source})` : ''}
                </span>
                <span className="shrink-0 tabular-nums">{example.temperatureC.toFixed(2)} °C</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {filled} {filled === 1 ? 'day' : 'days'} {result.mode === 'preview' ? 'would be filled' : 'filled'}
            {kept > 0 ? `, ${kept} left as you recorded ${kept === 1 ? 'it' : 'them'}` : ''}.
          </p>
        </div>
      ) : null}

      {notes.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {notes.map((note) => (
            <li key={note} className="text-xs text-muted-foreground">
              {note}
            </li>
          ))}
        </ul>
      ) : null}

      {shown.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-md border border-border p-2">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <ExclamationCircledIcon className="size-4 text-base" />
            {issueCount} {issueCount === 1 ? 'record could not be read' : 'records could not be read'}
          </p>
          <ul className="flex flex-col gap-1">
            {shown.map((issue) => (
              <li key={`${issue.row}-${issue.column ?? ''}-${issue.message}`} className="text-xs text-muted-foreground">
                Record {issue.row}
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
