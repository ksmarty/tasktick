'use client';

/**
 * Import from TickTick.
 *
 * TickTick's only export is the CSV produced by Settings → Backup → Generate
 * Backup, so this takes one CSV file and does it in two steps that are visible to
 * the user: **preview** (nothing is written, the endpoint only parses) and then
 * **confirm** (the write, in a single transaction). The confirm button names the
 * exact number of tasks, so "yes" is a decision about real numbers rather than a
 * vague "import?" prompt.
 *
 * The preview is also where unmapped data is surfaced. The CSV column set is not
 * an official contract — two third-party importers agree on it, but TickTick can
 * add a column whenever it likes — so anything this importer does not consume is
 * listed under "Kept in the file but not imported" instead of vanishing.
 *
 * `role="status"` / `aria-live="polite"` is the one place the screen reports
 * progress, and the file input is a real `<input type="file">` labelled by its
 * `<Label>` so the keyboard path is the browser's own.
 */
import { useRef, useState } from 'react';
import { CheckIcon } from '@svg-animated-icons/react/check';
import { ExclamationCircledIcon } from '@svg-animated-icons/react/exclamation-circled';
import { InfoCircledIcon } from '@svg-animated-icons/react/info-circled';
import { UploadIcon } from '@svg-animated-icons/react/upload';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/app/Toast';
import { invalidate } from '@/lib/store';
import { SettingsGroup, SettingsRow } from './SettingsGroup';
import type { TickTickPreview } from '@/lib/ticktick-import';

interface TickTickSummary {
  listsCreated: number;
  listsReused: number;
  tasksCreated: number;
  subtasksCreated: number;
  remindersCreated: number;
  skippedExisting: number;
}

interface ImportResponse {
  mode: 'preview' | 'commit';
  preview: TickTickPreview;
  summary?: TickTickSummary;
}

async function upload(file: File, mode: 'preview' | 'commit'): Promise<ImportResponse> {
  const body = new FormData();
  body.append('file', file);
  body.append('mode', mode);

  let response: Response;
  try {
    response = await fetch('/api/import/ticktick', {
      method: 'POST',
      body,
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }

  const payload = (await response.json().catch(() => null)) as
    | { ok: true; data: ImportResponse }
    | { ok: false; error?: string }
    | null;

  if (!response.ok || !payload || payload.ok !== true) {
    throw new Error((payload && 'error' in payload && payload.error) || 'The import failed.');
  }
  return payload.data;
}

/** One `label  value` line in the preview. */
function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}

export function TickTickImportCard() {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<TickTickPreview | null>(null);
  const [summary, setSummary] = useState<TickTickSummary | null>(null);
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Clears the derived state without touching the file input's own value. */
  function clearDerivedState() {
    setPreview(null);
    setSummary(null);
    setError(null);
  }

  function reset() {
    clearDerivedState();
    setFile(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function choose(next: File | null) {
    // Do not call `reset()` here: clearing the input's value would make the
    // native control render "No file chosen" the moment a file was picked.
    clearDerivedState();
    if (!next) {
      setFile(null);
      return;
    }
    setFile(next);
    setBusy('preview');
    try {
      const result = await upload(next, 'preview');
      setPreview(result.preview);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The file could not be read.');
    } finally {
      setBusy(null);
    }
  }

  async function confirmImport() {
    if (!file) return;
    setBusy('commit');
    setError(null);
    try {
      const result = await upload(file, 'commit');
      setSummary(result.summary ?? null);
      setPreview(result.preview);
      invalidate('/api/tasks');
      invalidate('/api/lists');
      invalidate('/api/bootstrap');
      toast({
        title: 'Import complete',
        description: `Added ${result.summary?.tasksCreated ?? 0} tasks, ${result.summary?.subtasksCreated ?? 0} subtasks and ${result.summary?.remindersCreated ?? 0} reminders.`,
        variant: 'success',
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The import failed.');
      toast({
        title: 'Import failed',
        description: cause instanceof Error ? cause.message : undefined,
        variant: 'error',
      });
    } finally {
      setBusy(null);
    }
  }

  const unmapped = preview?.unmappedColumns ?? [];

  return (
    <SettingsGroup
      title="Import from TickTick"
      footer="TickTick exports a CSV from Settings → Backup → Generate Backup. Nothing is written until you confirm, and the whole import is one transaction — if it fails, the database is untouched. Importing the same file twice does nothing."
    >
      <SettingsRow stacked>
        <Label htmlFor="ticktick-import-file">TickTick backup file (.csv)</Label>
        <Input
          ref={inputRef}
          id="ticktick-import-file"
          type="file"
          accept=".csv,text/csv"
          aria-label="TickTick backup CSV file"
          disabled={busy !== null}
          onChange={(event) => void choose(event.target.files?.[0] ?? null)}
        />
        <p className="text-xs text-muted-foreground">
          Files are limited to 5 MB and 10,000 tasks. Rows without a title are reported and skipped.
        </p>
      </SettingsRow>

      <SettingsRow>
        <div className="flex min-w-0 flex-1 items-center gap-3" role="status" aria-live="polite">
          {busy === 'preview' ? (
            <>
              <InfoCircledIcon className="shrink-0 text-muted-foreground" />
              <span className="text-sm">Reading {file?.name ?? 'the file'}…</span>
            </>
          ) : busy === 'commit' ? (
            <>
              <InfoCircledIcon className="shrink-0 text-muted-foreground" />
              <span className="text-sm">Importing…</span>
            </>
          ) : error ? (
            <>
              <ExclamationCircledIcon className="shrink-0 text-destructive" />
              <span className="text-sm text-destructive">{error}</span>
            </>
          ) : summary ? (
            <>
              <CheckIcon className="shrink-0 text-primary" />
              <span className="text-sm">
                Imported {summary.tasksCreated} tasks and {summary.subtasksCreated} subtasks into{' '}
                {summary.listsCreated + summary.listsReused}{' '}
                {summary.listsCreated + summary.listsReused === 1 ? 'list' : 'lists'}
                {summary.skippedExisting > 0 ? `; ${summary.skippedExisting} already imported and skipped` : ''}.
              </span>
            </>
          ) : preview ? (
            <>
              <InfoCircledIcon className="shrink-0 text-muted-foreground" />
              <span className="text-sm">
                {preview.fileName} is ready to import. Nothing has been written yet.
              </span>
            </>
          ) : (
            <>
              <UploadIcon className="shrink-0 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Choose a backup to see what would be created.</span>
            </>
          )}
        </div>
      </SettingsRow>

      {preview ? (
        <SettingsRow stacked>
          <div className="flex flex-col gap-2">
            <Stat label="Lists" value={preview.lists.length} />
            <Stat label="Tasks" value={preview.tasks} />
            <Stat label="Subtasks" value={preview.subtasks} />
            <Stat label="Tags" value={preview.tags.length} />
            <Stat label="Reminders" value={preview.reminders} />
            <Stat label="Completed" value={preview.completed} />
            <Stat label="Repeating" value={preview.recurring} />
            {preview.wontDo > 0 ? <Stat label="Won't do" value={preview.wontDo} /> : null}
            {preview.skippedRows > 0 ? <Stat label="Rows skipped (no title)" value={preview.skippedRows} /> : null}
          </div>

          {preview.lists.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {preview.lists.map((list) => (
                <li key={`${list.folder ?? ''}/${list.name}`} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm">
                    {list.name}
                    {list.folder ? <span className="text-muted-foreground"> · {list.folder}</span> : null}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">{list.tasks} tasks</span>
                </li>
              ))}
            </ul>
          ) : null}
        </SettingsRow>
      ) : null}

      {preview && (unmapped.length > 0 || preview.issueCount > 0) ? (
        <SettingsRow stacked>
          <div className="flex items-start gap-3">
            <ExclamationCircledIcon className="mt-0.5 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-col gap-2">
              <span className="text-sm">Some data cannot be mapped</span>
              {unmapped.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {unmapped.map((column) => (
                    <Badge key={column} variant="secondary">
                      {column}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {preview.issueCount > 0 ? (
                <ul className="flex flex-col gap-1">
                  {preview.issues.slice(0, 5).map((issue) => (
                    <li key={`${issue.row}-${issue.column ?? ''}`} className="text-xs text-muted-foreground">
                      Row {issue.row}
                      {issue.column ? ` · ${issue.column}` : ''}: {issue.message}
                    </li>
                  ))}
                  {preview.issueCount > preview.issues.length ? (
                    <li className="text-xs text-muted-foreground">
                      …and {preview.issueCount - preview.issues.length} more.
                    </li>
                  ) : null}
                </ul>
              ) : null}
              <span className="text-xs text-muted-foreground">
                These columns are read but not imported, because TaskTick has no matching field. The rest of each row
                is imported normally.
              </span>
            </div>
          </div>
        </SettingsRow>
      ) : null}

      {preview && !summary ? (
        <SettingsRow className="justify-end">
          <Button variant="ghost" onClick={reset} disabled={busy !== null}>
            Cancel
          </Button>
          <Button
            onClick={() => void confirmImport()}
            disabled={busy !== null}
            aria-busy={busy === 'commit'}
          >
            <CheckIcon />
            Import {preview.tasks} tasks
          </Button>
        </SettingsRow>
      ) : null}

      {summary ? (
        <SettingsRow className="justify-end">
          <Button variant="outline" onClick={reset}>
            Import another file
          </Button>
        </SettingsRow>
      ) : null}
    </SettingsGroup>
  );
}
