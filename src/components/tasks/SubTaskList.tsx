'use client';

/**
 * The subtask list inside the editor sheet.
 *
 * Renaming is a bare input committed on blur or Enter (so a half-typed name is
 * never sent), and adding is a row that becomes an input on tap — the same
 * gesture as the inline quick-add.
 *
 * ## The inset
 *
 * `pl-3`/`px-3` are the editor's own row axis (the same 12px inner padding the
 * shadcn `Input`/`Button` use), and each row/button carries a 1px *transparent*
 * border on top of them: the bordered fields above draw their 1px frame inside
 * the box, so a borderless row needs the same frame to put its content on the
 * same content axis (29.0px from the panel's 16px gutter). They used to be 8px
 * and 16px, which put the checkbox 4px left of that line and the add row 4px
 * right of it.
 */
import { useState } from 'react';
import { PlusIcon } from '@svg-animated-icons/react/plus';
import { TrashIcon } from '@svg-animated-icons/react/trash';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import type { SubTask } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface SubTaskListProps {
  subtasks: readonly SubTask[];
  onToggle: (subtask: SubTask) => void;
  onRename: (subtask: SubTask, title: string) => void;
  onDelete: (subtask: SubTask) => void;
  onAdd: (title: string) => void | Promise<void>;
  disabled?: boolean;
}

/**
 * The shadcn `Input`'s chrome, removed.
 *
 * A rename field is a line of text in a row, not a boxed control: the border, the
 * shadow, the focus ring and the horizontal padding all go, so the row — not the
 * field — owns the look.
 */
const BARE_INPUT_CLASS =
  'h-auto min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0';

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
    <div className="flex flex-col">
      {subtasks.length ? (
        <ul className="overflow-hidden rounded-xl bg-card text-card-foreground">
          {subtasks.map((subtask) => {
            const completed = subtask.status === 'completed';
            return (
              <li key={subtask.id} className="flex min-h-11 items-center gap-2 pr-1 pl-3 border border-transparent">
                <Checkbox
                  checked={completed}
                  disabled={disabled}
                  onCheckedChange={() => onToggle(subtask)}
                  aria-label={completed ? `Mark ${subtask.title} incomplete` : `Complete ${subtask.title}`}
                  aria-checked={completed}
                />

                <Input
                  defaultValue={subtask.title}
                  disabled={disabled}
                  aria-label={`Rename ${subtask.title}`}
                  className={cn(BARE_INPUT_CLASS, completed && 'text-muted-foreground line-through')}
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
                />

                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete subtask ${subtask.title}`}
                  disabled={disabled}
                  onClick={() => onDelete(subtask)}
                  className="text-destructive"
                >
                  <span aria-hidden>
                    <TrashIcon className="size-5" />
                  </span>
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {adding ? (
        <div className="mt-2 flex min-h-11 items-center gap-2 px-3 border border-transparent">
          <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground" aria-hidden>
            <PlusIcon className="size-5" />
          </span>
          <Input
            autoFocus
            value={draft}
            disabled={disabled}
            placeholder="Subtask"
            aria-label="New subtask"
            className={BARE_INPUT_CLASS}
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
          />
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          onClick={() => setAdding(true)}
          className={cn(
            'min-h-11 w-full justify-start gap-2 rounded-lg px-3 text-primary hover:text-primary border border-transparent',
            subtasks.length ? 'mt-2' : null,
          )}
        >
          <span aria-hidden>
            <PlusIcon className="size-5" />
          </span>
          Add subtask
          {subtasks.length ? (
            <span className="ml-auto text-xs text-muted-foreground">
              {done}/{subtasks.length} done
            </span>
          ) : null}
        </Button>
      )}
    </div>
  );
}
