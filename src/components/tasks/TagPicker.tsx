'use client';

/**
 * Tag picker with inline creation.
 *
 * Creating a tag here is the same `POST /api/tags` the settings screen uses, so a
 * tag invented mid-edit is immediately a real tag everywhere else.
 */
import { useState } from 'react';
import { Check, Plus, Tag as TagIcon } from 'lucide-react';
import { Button, IconButton, Sheet, TextField } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { Tag } from '@/lib/types';

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
    <Sheet open={open} onOpenChange={onOpenChange} title={title} dismissible>
      <div className="pb-2">
        {tags.length ? (
          <div className="grouped mb-4">
            {tags.map((tag, index) => {
              const selected = value.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  role="checkbox"
                  aria-checked={selected}
                  onClick={() => toggle(tag.id)}
                  className={cn(
                    'flex min-h-11 w-full items-center gap-3 px-4 text-body pressable-row',
                    index > 0 && 'hairline-t',
                  )}
                >
                  <TagIcon className="size-5 shrink-0 text-secondary" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-left text-label">{tag.name}</span>
                  {selected ? <Check className="size-5 shrink-0 text-tint" aria-hidden /> : null}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="px-1 pb-4 text-footnote text-secondary">No tags yet — create the first one below.</p>
        )}

        {onCreate ? (
          <div className="flex items-end gap-2">
            <TextField
              label="New tag"
              value={draft}
              placeholder="Name"
              disabled={disabled || creating}
              leading={<TagIcon className="size-4" />}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void create();
                }
              }}
              className="flex-1"
            />
            <IconButton
              aria-label="Create tag"
              icon={Plus}
              variant="tinted"
              size="md"
              loading={creating}
              disabled={disabled || !draft.trim()}
              onClick={() => void create()}
            />
          </div>
        ) : null}

        <div className="pt-4">
          <Button variant="tinted" fullWidth onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
