'use client';

/**
 * The day log: every observation a day can carry, in one form.
 *
 * Used twice — inline on the Today screen, and inside a sheet when a day is
 * tapped on the cycle month — so the two can never offer different fields. The
 * form is controlled: it renders `value` and reports partial writes through
 * `onChange`, and the Today screen's draft (`useDayLogDraft`) makes each write
 * visible before it lands.
 *
 * ## Ordering is the whole design
 *
 * The screen this exists for is one-handed and takes seconds, so the fields are
 * ordered by how often they are set, not by how the schema stores them:
 *
 *   1. **Flow** — the single most-recorded observation, and the one the cycle
 *      maths is built on.
 *   2. **Birth control** — the user asked specifically for it, on and off days
 *      alike, and it is a one-tap answer.
 *   3. **Symptoms and mood** — chips, so several can be set in one gesture.
 *   4. **Weight** — one number, rarely set, and not a cycle observation.
 *   5. **Body signs** — basal temperature, cervical mucus, an LH test, ovulation
 *      pain. Real observations that most people never record.
 *   6. **Sex** — protected or unprotected, which is the one intimacy fact that
 *      changes what a prediction means.
 *   7. **Notes** — free text, last, because a keyboard is the slowest thing on
 *      the screen.
 *
 * Everything is a chip except the numeric fields and the note, which is what
 * makes the common case (flow + a symptom + taken my pill) three taps.
 *
 * ## The user decides which of those sections exist
 *
 * Every section above can be switched off in period settings, and body signs are
 * off by default — see `today-categories.ts` for the defaults and why the body
 * signs are the one group that has to be asked for. `settings` arrives as the
 * stored switches; the form renders the sections it says are on, in the order
 * above, whatever order the user switched them in.
 *
 * Turning a section off hides its *inputs* and never its data: the day's recorded
 * values stay on the row, stay on the calendar and stay in the export, and the
 * section comes back the way it was. When every section is off the form says so
 * instead of rendering an empty column, and offers the one tap that brings the
 * ordinary sections back — a blank screen with no way out is worse than a switch
 * the user cannot find again.
 *
 * ## Unknown values are preserved, not offered
 *
 * Symptoms and mood are stored as free-form `string[]` — the contract says so —
 * and a user may have imported a word we do not know (`PERIOD_SYMPTOMS` is only a
 * suggestion list). Those values are rendered as chips in their own "Your own"
 * group rather than dropped, so opening a day never silently discards something
 * the user recorded.
 */
import { useEffect, useState } from 'react';
import { PlusIcon } from '@svg-animated-icons/react/plus';
import { TrashIcon } from '@svg-animated-icons/react/trash';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { hasDayPlan, isDailyMethod } from '@/lib/period-math';
import {
  INTIMACY_PROTECTION,
  type ContraceptionDayStatus,
  type ContraceptionMethodRecord,
  type ContraceptionScheduleDay,
  type IntimacyProtection,
} from '@/lib/period-types';
import type { DateOnly } from '@/lib/types';
import { ChipMultiRow, ChipRow } from './chips';
import type { DayLogDraft, DayLogValue } from './data';
import {
  isTodayCategoryVisible,
  visibleTodayCategories,
  type TodayLogSettings,
} from './today-categories';
import {
  DAY_STATUS_LABEL,
  FLOW_CHIP_LABEL,
  FLOW_OPTIONS,
  LH_LABEL,
  LH_OPTIONS,
  METHOD_LABEL,
  MOOD_OPTIONS,
  MUCUS_LABEL,
  MUCUS_OPTIONS,
  SYMPTOM_GROUPS,
  SYMPTOM_LABELS,
  MOOD_LABELS,
  humanise,
  longDate,
} from './labels';

/**
 * The contraception context for one day.
 *
 * Assembled by the screen from the overview the API already returned: the method
 * active that day, the generated schedule row (which carries both the expected
 * on/off state and whatever the user logged), and the write itself.
 */
export interface DayContraception {
  method: ContraceptionMethodRecord;
  schedule: ContraceptionScheduleDay | null;
  onStatus: (status: ContraceptionDayStatus | null) => void;
}

export interface DayLogFormProps {
  date: DateOnly;
  value: DayLogValue;
  onChange: (patch: DayLogDraft) => void;
  /** The day's contraception, or null when no method covers it. */
  contraception: DayContraception | null;
  /**
   * The section switches. `undefined` while the settings read is in flight, which
   * reads as "the form as it has always been" — see `today-categories.ts`.
   */
  settings?: TodayLogSettings;
  /**
   * Brings every ordinary section back, from the all-hidden state. Supplied by
   * the screens because they own the settings mutation.
   */
  onShowAllSections?: () => void;
  /** Hidden on the Today screen? No: every field is available on every screen. */
  className?: string;
}

export function DayLogForm({
  date,
  value,
  onChange,
  contraception,
  settings,
  onShowAllSections,
  className,
}: DayLogFormProps) {
  const symptoms = value.symptoms ?? [];
  const mood = value.mood ?? [];

  const shows = (category: Parameters<typeof isTodayCategoryVisible>[1]) =>
    isTodayCategoryVisible(settings, category);
  const visible = visibleTodayCategories(settings);

  /* Values the contract's vocabulary does not contain, so they are not lost. */
  const customSymptoms = symptoms.filter((symptom) => !ALL_KNOWN_SYMPTOMS.includes(symptom));
  const customMoods = mood.filter((entry) => !MOOD_OPTIONS.includes(entry as (typeof MOOD_OPTIONS)[number]));

  function toggle(list: string[], entry: string): string[] {
    return list.includes(entry) ? list.filter((item) => item !== entry) : [...list, entry];
  }

  return (
    <div className={cn('flex flex-col gap-stack', className)}>
      {/* Nothing switched on: the form says so and offers the way back, rather
          than rendering an empty column under a screen the user came here to
          use. The recorded days are untouched and the copy says so. */}
      {visible.length === 0 ? (
        <FormCard title="Nothing is switched on">
          <p className="text-sm text-muted-foreground">
            Every section of this log is switched off in period settings. Nothing you have already recorded has
            been removed — it is still on the calendar and in the export.
          </p>
          {onShowAllSections ? (
            <Button type="button" size="sm" className="h-9 w-fit" onClick={onShowAllSections}>
              Show my sections again
            </Button>
          ) : null}
          <Button asChild variant="outline" size="sm" className="h-9 w-fit">
            <a href="/period/settings/sections">Choose sections</a>
          </Button>
        </FormCard>
      ) : null}

      {/* 1 — Flow. The one observation the cycle maths is built on. */}
      {shows('flow') ? (
        <FormCard title="Flow" hint={longDate(date)}>
          <ChipRow
            label="Flow intensity"
            options={FLOW_OPTIONS}
            labels={FLOW_CHIP_LABEL}
            value={value.flow ?? null}
            onChange={(next) => onChange({ flow: next as DayLogDraft['flow'] })}
          />
          <p className="text-xs text-muted-foreground">
            {value.flow === null || value.flow === 'none'
              ? 'Nothing logged. Tap a level, or leave it blank if there is nothing to record.'
              : 'Spotting is kept separate from light flow: it often means something else.'}
          </p>
        </FormCard>
      ) : null}

      {/* 2 — Birth control, for today, on and off days alike. */}
      {shows('contraception') ? <ContraceptionRow contraception={contraception} /> : null}

      {/* 3 — Symptoms and mood. */}
      {shows('symptoms') ? (
        <FormCard title="Symptoms" hint={symptoms.length > 0 ? `${symptoms.length} logged` : undefined}>
          {SYMPTOM_GROUPS.map((group) => (
            <ChipMultiRow
              key={group.title}
              label={`${group.title} symptoms`}
              options={group.values}
              labels={SYMPTOM_LABELS}
              values={symptoms}
              onToggle={(entry) => onChange({ symptoms: toggle(symptoms, entry) })}
            />
          ))}
          {customSymptoms.length > 0 ? (
            <ChipMultiRow
              label="Your own symptoms"
              options={customSymptoms}
              labels={Object.fromEntries(customSymptoms.map((entry) => [entry, humanise(entry)]))}
              values={symptoms}
              onToggle={(entry) => onChange({ symptoms: toggle(symptoms, entry) })}
            />
          ) : null}
          <AddValueRow
            label="Add another symptom"
            placeholder="e.g. migraine"
            onAdd={(entry) => onChange({ symptoms: [...symptoms, entry] })}
          />
        </FormCard>
      ) : null}

      {shows('mood') ? (
        <FormCard title="Mood" hint={mood.length > 0 ? `${mood.length} logged` : undefined}>
          <ChipMultiRow
            label="Mood"
            options={MOOD_OPTIONS}
            labels={MOOD_LABELS}
            values={mood}
            onToggle={(entry) => onChange({ mood: toggle(mood, entry) })}
          />
          {customMoods.length > 0 ? (
            <ChipMultiRow
              label="Your own moods"
              options={customMoods}
              labels={Object.fromEntries(customMoods.map((entry) => [entry, humanise(entry)]))}
              values={mood}
              onToggle={(entry) => onChange({ mood: toggle(mood, entry) })}
            />
          ) : null}
          <AddValueRow
            label="Add another mood"
            placeholder="e.g. numb"
            onAdd={(entry) => onChange({ mood: [...mood, entry] })}
          />
        </FormCard>
      ) : null}

      {/* 4 — Weight: one number, and not a cycle observation. */}
      {shows('weight') ? (
        <FormCard title="Weight">
          {/* The card already says "Weight"; the field's own label says which
              day's, so the two do not read as a repeated heading. */}
          <Field label="Today" hint="kg">
            <NumberField
              id={`period-weight-${date}`}
              value={value.weightKg ?? null}
              step={0.1}
              placeholder="—"
              onCommit={(next) => onChange({ weightKg: next })}
            />
          </Field>
        </FormCard>
      ) : null}

      {/*
        5 — Body signs: the fertility-awareness observations, off by default. The
        four of them are the user's own list: basal temperature, cervical mucus,
        an LH test, ovulation pain. They share one card because they are one
        kind of thing — tracked together, by the same person, for the same
        reason — and because hiding them together is what "off" means.
      */}
      {shows('bodySigns') ? (
        <FormCard title="Body signs" hint="Fertility tracking">
          <Field label="LH test">
            <ChipRow
              label="LH test result"
              options={LH_OPTIONS}
              labels={LH_LABEL}
              value={value.lhTest ?? null}
              onChange={(next) => onChange({ lhTest: next as DayLogDraft['lhTest'] })}
            />
          </Field>

          <Field label="Cervical mucus">
            <ChipRow
              label="Cervical mucus"
              options={MUCUS_OPTIONS}
              labels={MUCUS_LABEL}
              value={value.mucus ?? null}
              onChange={(next) => onChange({ mucus: next as DayLogDraft['mucus'] })}
            />
          </Field>

          <Field label="Basal temperature" hint="°C, two decimals">
            <NumberField
              id={`period-temperature-${date}`}
              value={value.temperatureC ?? null}
              step={0.01}
              placeholder="36.55"
              onCommit={(next) => onChange({ temperatureC: next })}
            />
          </Field>

          <SwitchRow
            id={`period-ovulation-pain-${date}`}
            label="Ovulation pain"
            hint="Mittelschmerz — a one-sided twinge around ovulation."
            checked={value.ovulationPain ?? false}
            onChange={(next) => onChange({ ovulationPain: next })}
          />

          <p className="text-xs text-muted-foreground">
            These are the observations fertility-awareness methods use. None of them is required, and turning them
            off in period settings hides all four without touching anything already recorded.
          </p>
        </FormCard>
      ) : null}

      {/*
        6 — Sex. Two chips rather than a switch, because the useful fact is
        *which* — an unprotected day in the fertile window is a different
        observation from a protected one, and a boolean cannot say it.
      */}
      {shows('intimacy') ? (
        <FormCard title="Sex">
          <ChipRow
            label="Sex today"
            options={INTIMACY_PROTECTION}
            labels={INTIMACY_PROTECTION_LABEL}
            value={value.intimacyProtection ?? null}
            onChange={(next) =>
              onChange(
                next === null
                  ? { intimacy: false, intimacyProtection: null }
                  : { intimacy: true, intimacyProtection: next as IntimacyProtection },
              )
            }
          />
          <p className="text-xs text-muted-foreground">
            {value.intimacy === true && (value.intimacyProtection ?? null) === null
              ? 'This day is recorded as sex from before the app asked which kind. Nothing is lost — choose protected or unprotected above to fill it in, or tap again to clear the day.'
              : 'Both are recorded as your own observation. Protected and unprotected are kept apart because an unprotected day inside the fertile window is a different fact from a protected one.'}
          </p>
        </FormCard>
      ) : null}

      {/* 7 — Notes. Last, because the keyboard is the slowest control here. */}
      {shows('notes') ? (
        <FormCard title="Notes">
          <Textarea
            aria-label={`Notes for ${longDate(date)}`}
            value={value.notes ?? ''}
            rows={3}
            placeholder="Anything worth remembering about today"
            onChange={(event) => onChange({ notes: event.target.value === '' ? null : event.target.value })}
          />
        </FormCard>
      ) : null}
    </div>
  );
}

/** The two protection values, spelled out for a chip. */
const INTIMACY_PROTECTION_LABEL: Record<IntimacyProtection, string> = {
  protected: 'Protected',
  unprotected: 'Unprotected',
};

/** Every value the chip rows already offer, so "your own" means exactly that. */
const ALL_KNOWN_SYMPTOMS: string[] = SYMPTOM_GROUPS.flatMap((group) => [...group.values]);

/* -------------------------------------------------------------------------- */
/* pieces                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A titled card.
 *
 * Not `SettingsGroup`: this is a form, and its sections are steps rather than
 * settings, so the caption is a heading inside the card instead of a band above
 * it. The surface, radius and padding still come from the same tokens, so the two
 * families look like one app.
 */
function FormCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-card text-card-foreground shadow-xs">
      <div className="flex items-baseline gap-2">
        <h2 className="min-w-0 flex-1 text-sm font-semibold">{title}</h2>
        {hint ? <span className="shrink-0 text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** A labelled sub-field inside a card. */
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">{label}</span>
        {hint ? <span className="shrink-0 text-xs text-muted-foreground/70">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function SwitchRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className="block">
          {label}
        </Label>
        {hint ? <p className="pt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

/**
 * A number field that commits when the user is done with it.
 *
 * Deliberately not per keystroke: typing `36.55` is five characters, and a write
 * per character would send `3`, `36`, `36.`, `36.5`, `36.55` — four of them
 * values the user never meant to record, each one triggering a prediction
 * recomputation. Committing on blur (and on Enter) is one write for one intention.
 *
 * The text is local state so a trailing `.` or a half-typed number is not
 * rewritten underneath the caret; it is re-seeded from `value` only when the
 * value actually changes, which is after a commit or a refetch.
 */
function NumberField({
  id,
  value,
  step,
  placeholder,
  onCommit,
}: {
  id: string;
  value: number | null;
  step: number;
  placeholder?: string;
  onCommit: (next: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));

  useEffect(() => {
    setText(value === null ? '' : String(value));
  }, [value]);

  function commit() {
    const trimmed = text.trim();
    if (trimmed === '') {
      onCommit(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setText(value === null ? '' : String(value));
      return;
    }
    onCommit(parsed);
  }

  return (
    <Input
      id={id}
      type="number"
      inputMode="decimal"
      step={step}
      placeholder={placeholder}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
      }}
      className="max-w-32"
    />
  );
}

/**
 * "Add your own" — one word, appended to an open-ended list.
 *
 * Both lists are free-form in the contract, and the chip vocabulary is a
 * suggestion. A user with a symptom we did not think of has no way to record it
 * otherwise, and "the app does not have my symptom" is the kind of gap that stops
 * people logging at all.
 */
function AddValueRow({
  label,
  placeholder,
  onAdd,
}: {
  label: string;
  placeholder: string;
  onAdd: (value: string) => void;
}) {
  const [text, setText] = useState('');

  function add() {
    const value = text.trim().replace(/\s+/g, '_').toLowerCase();
    if (value === '') return;
    onAdd(value);
    setText('');
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        aria-label={label}
        value={text}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            add();
          }
        }}
        className="h-9 min-w-0 flex-1"
      />
      <Button type="button" variant="outline" size="sm" onClick={add} className="h-9 shrink-0 gap-1">
        <PlusIcon className="size-4 text-base" />
        Add
      </Button>
    </div>
  );
}

/**
 * Today's contraception, and what is expected of it.
 *
 * ## Why the expected state is stated in words
 *
 * A ring's 21/7 rhythm is the reason this row exists: on day 22 there is nothing
 * to take, and a UI that shows the same four chips every day would invite a user
 * to "miss" a day the schedule never asked for. So the generated schedule row
 * (from the API, never recomputed here) names the day and its expected state, and
 * the chips that follow are the ones that make sense for *this* method's shape.
 *
 * ## The three families
 *
 *  · **A day plan** (ring, patch, a cyclic pack) — `on` / `off` / `placebo` /
 *    `removed`, because those are the states a scheduled product has.
 *  · **A daily method** (the pill) — `taken` / `late` / `missed`, because the
 *    question is whether it was taken rather than whether it was scheduled.
 *  · **Anything else** (IUD, implant, condom, …) — nothing to log daily, and the
 *    row says so instead of offering chips that mean nothing.
 *
 * `hasDayPlan` and `isDailyMethod` come from `@/lib/period-math`, which is the
 * same rule the server uses to generate the schedule — so the chips and the
 * expected state cannot disagree.
 */
function ContraceptionRow({ contraception }: { contraception: DayContraception | null }) {
  if (!contraception) {
    return (
      <FormCard title="Birth control">
        <p className="text-sm text-muted-foreground">
          No method recorded for this day. Add one in period settings and its on/off days will appear here.
        </p>
      </FormCard>
    );
  }

  const { method, schedule, onStatus } = contraception;
  const statusOptions = statusChoicesFor(method);
  const logged = schedule?.logged ?? null;
  const expected = schedule?.expected ?? null;

  return (
    <FormCard
      title="Birth control"
      hint={schedule ? `Day ${schedule.cycleDay}` : undefined}
    >
      <p className="text-sm">
        <span className="font-medium">{METHOD_LABEL[method.method]}</span>
        {method.label ? <span className="text-muted-foreground"> · {method.label}</span> : null}
      </p>

      {expected ? (
        <p className="text-xs text-muted-foreground">
          {expected === 'on'
            ? 'Today is an on day on this schedule.'
            : 'Today is an off day — a scheduled break, not a missed one.'}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {isDailyMethod(method.method)
            ? 'A daily method: log whether today’s dose was taken.'
            : 'This method has no daily on/off rhythm, so there is nothing to log here.'}
        </p>
      )}

      {statusOptions.length > 0 ? (
        <ChipRow
          label="Today's birth control"
          options={statusOptions}
          labels={DAY_STATUS_LABEL}
          value={logged}
          onChange={(next) => onStatus(next as ContraceptionDayStatus | null)}
        />
      ) : null}

      {logged ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 w-fit gap-1.5 px-2 text-muted-foreground"
          onClick={() => onStatus(null)}
        >
          <TrashIcon className="size-4 text-base" />
          Clear today’s record
        </Button>
      ) : null}
    </FormCard>
  );
}

/**
 * The statuses that mean something for one method's shape.
 *
 * The order is the order they are tapped in practice: the scheduled state first
 * for a cyclic method, the confirmation first for a daily one.
 */
function statusChoicesFor(method: ContraceptionMethodRecord): ContraceptionDayStatus[] {
  if (hasDayPlan(method)) return ['on', 'off', 'placebo', 'removed'];
  if (isDailyMethod(method.method)) return ['taken', 'late', 'missed'];
  return [];
}
