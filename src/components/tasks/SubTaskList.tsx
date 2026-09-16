'use client';

/**
 * The subtask list inside the editor sheet.
 *
 * Renaming is a bare input committed on blur or Enter (so a half-typed name is
 * never sent), and adding is a row that becomes an input on tap — the same
 * gesture as the inline quick-add.
 */
import { useState } from 'react';
import { Check, Plus, Trash } from 'lucide-react';
import { IconButton } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { SubTask } from '@/lib/types';

export interface SubTaskListProps {
  subtasks: readonly SubTask[];
  onToggle: (subtask: SubTask) => void;
  onRename: (subtask: SubTask, title: string) => void;
  onDelete: (subtask: SubTask) => void;
  onAdd: (title: string) => void | Promise<void>;
  disabled?: boolean;
}

export function SubTaskList({
  subtasks,
  onToggle,
  onRename,
  onDelete,
  onAdd,
  disabled = false,
}: SubTaskListProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const done = subtasks.filter((subtask) => subtask.status === 'completed').length;

  async function commitNew() {
    const title = draft.trim();
    if (!title) {
      setAdding(false);
      return;
    }
    setDraft('');
    await onAdd(title);
  }

  return (
    <div>
      {subtasks.length ? (
        <ul className="rounded-ios-md bg-elevated">
          {subtasks.map((subtask, index) => {
            const completed = subtask.status === 'completed';
            return (
              <li
                key={subtask.id}
                className={cn(
                  'relative flex min-h-11 items-center gap-2 pr-1 pl-4',
                  index === 0 && 'rounded-t-ios-md',
                  index === subtasks.length - 1 && 'rounded-b-ios-md',
                  index < subtasks.length - 1 &&
                    'after:pointer-events-none after:absolute after:bottom-0 after:right-0 after:left-13 after:h-px after:bg-separator',
                )}
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={completed}
                  aria-label={completed ? `Mark ${subtask.title} incomplete` : `Complete ${subtask.title}`}
                  disabled={disabled}
                  onClick={() => onToggle(subtask)}
                  className="-ml-2.5 flex size-11 shrink-0 items-center justify-center disabled:opacity-40"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'flex size-6 items-center justify-center rounded-full border-[1.5px] transition-colors duration-150 ease-ios',
                      completed ? 'border-tint bg-tint text-on-tint' : 'border-separator-opaque',
                    )}
                  >
                    {completed ? <Check className="size-4 stroke-[3]" aria-hidden /> : null}
                  </span>
                </button>

                <input
                  type="text"
                  defaultValue={subtask.title}
                  disabled={disabled}
                  aria-label={`Rename ${subtask.title}`}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                  onBlur={(event) => {
                    const next = event.target.value.trim();
                    if (next && next !== subtask.title) onRename(subtask, next);
                    else event.target.value = subtask.title;
                  }}
                  className={cn(
                    'min-h-11 min-w-0 flex-1 bg-transparent py-2 text-body outline-none',
                    completed ? 'text-secondary line-through' : 'text-label',
                    disabled && 'opacity-40',
                  )}
                />

                <IconButton
                  aria-label={`Delete subtask ${subtask.title}`}
                  icon={Trash}
                  size="sm"
                  disabled={disabled}
                  onClick={() => onDelete(subtask)}
                  className="text-danger"
                />
              </li>
            );
          })}
        </ul>
      ) : null}

      {adding ? (
        <div className="mt-1 flex min-h-11 items-center gap-2 rounded-ios-md bg-elevated px-4">
          <Plus className="size-4 shrink-0 text-tertiary" aria-hidden />
          <input
            type="text"
            autoFocus
            value={draft}
            disabled={disabled}
            aria-label="New subtask"
            placeholder="Subtask"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void commitNew();
              }
              if (event.key === 'Escape') {
                setDraft('');
                setAdding(false);
              }
            }}
            onBlur={() => void commitNew()}
            className="min-h-11 min-w-0 flex-1 bg-transparent py-2 text-body text-label outline-none placeholder:text-tertiary"
          />
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setAdding(true)}
          className={cn(
            'flex min-h-11 w-full items-center gap-2 rounded-ios-md px-4 text-body text-tint pressable-row',
            subtasks.length ? 'mt-1' : '',
            disabled && 'opacity-40',
          )}
        >
          <Plus className="size-5 shrink-0" aria-hidden />
          Add subtask
          {subtasks.length ? (
            <span className="tnum ml-auto text-footnote text-secondary">
              {done}/{subtasks.length} done
            </span>
          ) : null}
        </button>
      )}
    </div>
  );
}
