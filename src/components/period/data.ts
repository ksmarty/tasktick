'use client';

/**
 * The period interface's data layer.
 *
 * One module, so every screen reads the same keys and every write invalidates the
 * same prefix. The reads are all `{ ok, data }` envelopes handled by
 * `@/lib/api-client`; nothing here parses a response by hand.
 *
 * ## One overview per window, not one request per card
 *
 * `GET /api/period` returns settings, cycles, day logs, contraception records,
 * the generated schedule for the window *and* the prediction, so the Today screen
 * and the cycle month each make a single request and cannot show two halves of the
 * same state from different moments. The window is the one thing that varies, and
 * it is part of the cache key.
 *
 * ## Writes are shown before they land
 *
 * A log write's response is the whole updated row, but the store only refetches
 * after the request returns. A chip that stayed unfilled for a round trip would
 * make the fastest screen in the app feel like the slowest, so the log form keeps
 * a local draft (`useDayLogDraft`) and the request follows the tap. See that hook
 * for why a draft can never permanently disagree with the server.
 *
 * ## Validation lives on the server
 *
 * These hooks send the contract's `*Input` shapes and let the API reject them.
 * The UI's only job is not to *offer* a value the contract cannot represent
 * (the chip rows are built from the contract's own arrays).
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { useMutation, useResource } from '@/lib/store';
import { activeMethodOn } from '@/lib/period-math';
import type { DateOnly } from '@/lib/types';
import type {
  ContraceptionDayLogInput,
  ContraceptionMethodInput,
  ContraceptionMethodRecord,
  ContraceptionMethodUpdate,
  ContraceptionScheduleDay,
  PeriodCycle,
  PeriodCycleInput,
  PeriodCycleUpdate,
  PeriodDayLog,
  PeriodDayLogInput,
  PeriodOverview,
  PeriodPrediction,
  PeriodSettings,
  PeriodSettingsUpdate,
  PeriodStats,
} from '@/lib/period-types';

/** `GET /api/period` — the whole screen's data for a window. */
export const PERIOD_OVERVIEW_KEY = '/api/period';
/** `GET /api/period/settings`. */
export const PERIOD_SETTINGS_KEY = '/api/period/settings';
/** `GET /api/period/stats` and `GET /api/period/prediction` live under here too. */
export const PERIOD_STATS_KEY = '/api/period/stats';
export const PERIOD_PREDICTION_KEY = '/api/period/prediction';

/**
 * The prefix every period write invalidates.
 *
 * Deliberately the whole feature: a day log changes the prediction, a cycle
 * changes the stats, and a setting changes all three, so a narrower list would be
 * wrong most of the time and silently stale the rest.
 */
export const PERIOD_PREFIX = '/api/period';

/* -------------------------------------------------------------------------- */
/* reads                                                                      */
/* -------------------------------------------------------------------------- */

export function usePeriodOverview(from: DateOnly, to: DateOnly) {
  return useResource<PeriodOverview>(PERIOD_OVERVIEW_KEY, { from, to });
}

export function usePeriodSettings() {
  return useResource<PeriodSettings>(PERIOD_SETTINGS_KEY);
}

export function usePeriodStats() {
  return useResource<PeriodStats>(PERIOD_STATS_KEY);
}

/**
 * `GET /api/period/prediction`.
 *
 * `asOf` is omitted by the screens: the server's own "today" in the user's zone
 * is the honest answer for a live prediction, and passing a client date would
 * make the same screen disagree with the API on a device with a wrong clock.
 */
export function usePeriodPrediction() {
  return useResource<PeriodPrediction>(PERIOD_PREDICTION_KEY);
}

export function useContraceptionMethods() {
  return useResource<ContraceptionMethodRecord[]>('/api/period/contraception');
}

/* -------------------------------------------------------------------------- */
/* the day log draft                                                          */
/* -------------------------------------------------------------------------- */

/** The fields a draft may hold. Everything the form can set. */
export type DayLogDraft = Partial<Omit<PeriodDayLogInput, 'date'>>;

/** What the form renders: the server's row with the local draft laid over it. */
export interface DayLogValue extends DayLogDraft {
  date: DateOnly;
}

function fromServer(log: PeriodDayLog | null | undefined, date: DateOnly): DayLogValue {
  return {
    date,
    flow: log?.flow ?? null,
    symptoms: log?.symptoms ?? [],
    mood: log?.mood ?? [],
    temperatureC: log?.temperatureC ?? null,
    lhTest: log?.lhTest ?? null,
    mucus: log?.mucus ?? null,
    intimacy: log?.intimacy ?? false,
    /*
     * Mapped even though `intimacy` already says "it happened": the level is the
     * half of the fact that changes what a prediction means, and because
     * `DayLogValue`'s fields are all optional, forgetting this line does not fail
     * to compile — it silently renders every day as "not stated".
     */
    intimacyProtection: log?.intimacyProtection ?? null,
    ovulationPain: log?.ovulationPain ?? false,
    weightKg: log?.weightKg ?? null,
    notes: log?.notes ?? null,
  };
}

export interface DayLogForm {
  /** The row as the form should render it right now. */
  value: DayLogValue;
  /** Writes one field: updates the screen immediately, then the server. */
  set: (patch: DayLogDraft) => void;
  /** True while a write for this day is in flight. */
  isSaving: boolean;
  /** The last write's error, if it failed. */
  error: string | null;
}

/**
 * The one editable row for a day.
 *
 * The server's row is the base and the draft is an overlay, so a tap is visible
 * before the request returns while the values the user has *not* touched keep
 * tracking the server — including fields this screen does not render.
 *
 * The draft is intentionally not cleared when the refetch lands. The server's
 * answer for a field the user just changed is the same value, so keeping the
 * draft costs nothing; clearing it on every response would race the next tap
 * (drop a keystroke in the temperature field) for no gain. It is dropped when the
 * day changes, which is the one case where an overlay would be wrong.
 *
 * `error` is reset per write rather than accumulated: the form's question is "did
 * the last thing I did save", not "has anything ever failed".
 */
export function useDayLogDraft(date: DateOnly, log: PeriodDayLog | null | undefined): DayLogForm {
  const [draft, setDraft] = useState<DayLogDraft>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft({});
    setError(null);
  }, [date]);

  const save = useMutation(
    (patch: DayLogDraft) => api.patch<PeriodDayLog>(`/api/period/days/${date}`, patch),
    {
      invalidates: [PERIOD_PREFIX],
      onError: (message) => setError(message),
    },
  );

  const value: DayLogValue = { ...fromServer(log, date), ...draft };

  return {
    value,
    set: (patch) => {
      setError(null);
      setDraft((current) => ({ ...current, ...patch }));
      void save.run(patch);
    },
    isSaving: save.isPending,
    error,
  };
}

/* -------------------------------------------------------------------------- */
/* writes                                                                     */
/* -------------------------------------------------------------------------- */

export interface MutationHooks {
  /** A human message for a failed write; the screens pass their toast. */
  onError?: (message: string) => void;
  onSuccess?: () => void;
}

/** `DELETE /api/period/days/[date]` — clear a day entirely. */
export function useDeleteDayLog({ onError, onSuccess }: MutationHooks = {}) {
  return useMutation(
    (date: DateOnly) => api.delete<{ deleted: boolean }>(`/api/period/days/${date}`),
    { invalidates: [PERIOD_PREFIX], onError, onSuccess: () => onSuccess?.() },
  );
}

/** `POST /api/period/cycles` — a period started. */
export function useCreateCycle({ onError, onSuccess }: MutationHooks = {}) {
  return useMutation((input: PeriodCycleInput) => api.post<PeriodCycle>('/api/period/cycles', input), {
    invalidates: [PERIOD_PREFIX],
    onError,
    onSuccess: () => onSuccess?.(),
  });
}

/** `PATCH /api/period/cycles/[id]` — correct a start or add an end. */
export function useUpdateCycle({ onError, onSuccess }: MutationHooks = {}) {
  return useMutation(
    (id: string, patch: PeriodCycleUpdate) => api.patch<PeriodCycle>(`/api/period/cycles/${id}`, patch),
    { invalidates: [PERIOD_PREFIX], onError, onSuccess: () => onSuccess?.() },
  );
}

/** `DELETE /api/period/cycles/[id]`. */
export function useDeleteCycle({ onError, onSuccess }: MutationHooks = {}) {
  return useMutation((id: string) => api.delete<{ deleted: boolean }>(`/api/period/cycles/${id}`), {
    invalidates: [PERIOD_PREFIX],
    onError,
    onSuccess: () => onSuccess?.(),
  });
}

/** `PATCH /api/period/settings` — the mode switch and the model knobs. */
export function useUpdatePeriodSettings({ onError, onSuccess }: MutationHooks = {}) {
  return useMutation((patch: PeriodSettingsUpdate) => api.patch<PeriodSettings>(PERIOD_SETTINGS_KEY, patch), {
    invalidates: [PERIOD_PREFIX],
    onError,
    onSuccess: () => onSuccess?.(),
  });
}

/** `POST /api/period/contraception/log` — upsert one method-day. */
export function useLogContraception({ onError, onSuccess }: MutationHooks = {}) {
  return useMutation(
    (input: ContraceptionDayLogInput) => api.post<ContraceptionDayLogInput>('/api/period/contraception/log', input),
    { invalidates: [PERIOD_PREFIX], onError, onSuccess: () => onSuccess?.() },
  );
}

/** `DELETE /api/period/contraception/log/[date]?methodId=…` — clear one method-day. */
export function useClearContraceptionLog({ onError, onSuccess }: MutationHooks = {}) {
  return useMutation(
    (date: DateOnly, methodId: string) =>
      api.delete<{ deleted: boolean }>(`/api/period/contraception/log/${date}`, { methodId }),
    { invalidates: [PERIOD_PREFIX], onError, onSuccess: () => onSuccess?.() },
  );
}

/** `POST /api/period/contraception` — start using a method. */
export function useCreateMethod({ onError, onSuccess }: MutationHooks = {}) {
  return useMutation(
    (input: ContraceptionMethodInput) => api.post<ContraceptionMethodRecord>('/api/period/contraception', input),
    { invalidates: [PERIOD_PREFIX], onError, onSuccess: () => onSuccess?.() },
  );
}

/** `PATCH /api/period/contraception/[id]` — correct or end a method. */
export function useUpdateMethod({ onError, onSuccess }: MutationHooks = {}) {
  return useMutation(
    (id: string, patch: ContraceptionMethodUpdate) =>
      api.patch<ContraceptionMethodRecord>(`/api/period/contraception/${id}`, patch),
    { invalidates: [PERIOD_PREFIX], onError, onSuccess: () => onSuccess?.() },
  );
}

/** `DELETE /api/period/contraception/[id]`. */
export function useDeleteMethod({ onError, onSuccess }: MutationHooks = {}) {
  return useMutation((id: string) => api.delete<{ deleted: boolean }>(`/api/period/contraception/${id}`), {
    invalidates: [PERIOD_PREFIX],
    onError,
    onSuccess: () => onSuccess?.(),
  });
}

/* -------------------------------------------------------------------------- */
/* derived reads                                                              */
/* -------------------------------------------------------------------------- */

/** The stored row for a day, or null. */
export function dayLogFor(overview: PeriodOverview | undefined, date: DateOnly): PeriodDayLog | null {
  return overview?.dayLogs.find((log) => log.date === date) ?? null;
}

/**
 * The method in effect on a date, with its display fields.
 *
 * The *rule* — an open-ended method covers everything after its start, a closed one
 * covers its own range, and on an overlap the most recently started wins — is the
 * server's, in `activeMethodOn` (`@/lib/period-math`), which is also the rule the
 * prediction used to decide whether a fertility estimate is meaningful. Re-deriving
 * it here would let the screen and the prediction disagree about which method is in
 * use, and this whole feature's honesty rests on those not disagreeing.
 *
 * So this is a lookup, not a copy: the shared function decides, and the full record
 * (label, schedule — which the day-form needs) is fetched by id.
 */
export function activeMethodFor(
  overview: PeriodOverview | undefined,
  date: DateOnly,
): ContraceptionMethodRecord | null {
  const records = overview?.contraception ?? [];
  const active = activeMethodOn(records, date);
  if (!active) return null;
  return records.find((record) => record.id === active.id) ?? null;
}

/** The generated schedule row for one method on one day, or null. */
export function scheduleDayFor(
  overview: PeriodOverview | undefined,
  date: DateOnly,
  methodId: string | null,
): ContraceptionScheduleDay | null {
  if (!methodId) return null;
  return overview?.schedule.find((row) => row.date === date && row.methodId === methodId) ?? null;
}
