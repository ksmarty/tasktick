'use client';

/**
 * Tag picker with inline creation.
 *
 * Creating a tag here is the same `POST /api/tags` the settings screen uses, so a
 * tag invented mid-edit is immediately a real tag everywhere else.
 *
 * The overlay is the GodUI `Drawer`, matching the other pickers: content-height
 * panel, swipe-down to dismiss.
 */
import { useState } from 'react';
import { CheckIcon } from '@svg-animated-icons/react/check';
import { PlusIcon } from '@svg-animated-icons/react/plus';
import { Tag as TagIcon } from 'lucide-react';
import { Drawer } from '@/components/godui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Tag } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface TagPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tags: readonly Tag[];
  /** Selected tag ids. */
  value: readonly string[];
  onChange: (tagIds: string[]) => void;
  /** Creates a tag and resolves to it, so the new one can be selected at once. */
  onCreate?: (name: string) => Promise<Tag | undefined>;
  disabled?: boolean;
  /** Heading; the bulk bar labels it "Add tag to N tasks". */
  title?: string;
}

export function TagPicker({
  open,
  onOpenChange,
  tags,
  value,
  onChange,
  onCreate,
  disabled = false,
  title = 'Tags',
}: TagPickerProps) {
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);

  function toggle(tagId: string) {
    const next = value.includes(tagId) ? value.filter((id) => id !== tagId) : [...value, tagId];
    onChange(next);
  }

  async function create() {
    const name = draft.trim();
    if (!name || !onCreate || creating) return;
    setCreating(true);
    try {
      const created = await onCreate(name);
      if (created) onChange([...new Set([...value, created.id])]);
      setDraft('');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      side="bottom"
      title={title}
      className="max-h-[70dvh] p-0 px-card pt-2 pb-[max(0.25rem,env(safe-area-inset-bottom,0px))]"
    >
      <div className="flex flex-col gap-stack">
        {tags.length ? (
          <div>
            {tags.map((tag) => {
              const selected = value.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  role="checkbox"
                  aria-checked={selected}
                  onClick={() => toggle(tag.id)}
                  className={cn(
                    'flex min-h-11 w-full items-center gap-3 rounded-lg px-row py-2 text-left',
                    selected ? 'text-primary' : 'text-foreground',
                  )}
                >
                  <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
                    <TagIcon className="size-5 text-muted-foreground" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                  {selected ? (
                    <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
                      <CheckIcon className="size-5" />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No tags yet — create the first one below.</p>
        )}

        {onCreate ? (
          <div className="flex items-end gap-2">
            <Input
              aria-label="New tag"
              value={draft}
              placeholder="Name"
              disabled={disabled || creating}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void create();
                }
              }}
              className="flex-1"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Create tag"
              disabled={disabled || creating || !draft.trim()}
              onClick={() => void create()}
              className="text-primary hover:text-primary"
            >
              <span aria-hidden>
                <PlusIcon className="size-5" />
              </span>
            </Button>
          </div>
        ) : null}

        <Button type="button" className="w-full" onClick={() => onOpenChange(false)}>
          Done
        </Button>
      </div>
    </Drawer>
  );
}
