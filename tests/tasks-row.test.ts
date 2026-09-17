/**
 * Shape and structure guards for `TaskRow`.
 *
 * The row is a client component that binds pointer and drag handlers and reads
 * DOM APIs on mount, and this suite runs in node with no DOM, so it cannot be
 * rendered here. What regresses silently is the class contract the design leans
 * on — a checkbox that drifts back to a circle, or the row separator creeping
 * back in — so this pins the source instead of a render.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(new URL('../src/components/tasks/TaskRow.tsx', import.meta.url), 'utf8');

describe('TaskRow — checkbox shape', () => {
  it('draws both the row and the selection checkboxes as rounded squares', () => {
    // Exactly two: the row checkbox and the selection-mode checkbox, and they
    // must match each other.
    expect(SOURCE.match(/rounded-\[6px\]/g) ?? []).toHaveLength(2);
    // No circular checkbox is left in the row.
    expect(SOURCE).not.toMatch(/rounded-full/);
  });

  it('keeps the checked, wont-do and unchecked treatments readable at that radius', () => {
    // Filled tint with a light glyph when done, dashed border when "won't do",
    // plain ring when open.
    expect(SOURCE).toContain("completed && 'border-tint bg-tint text-on-tint'");
    expect(SOURCE).toContain("wontDo && 'border-dashed border-separator-opaque text-tertiary'");
    expect(SOURCE).toContain("selected ? 'border-tint bg-tint text-on-tint' : 'border-separator-opaque'");
  });
});

describe('TaskRow — no row divider', () => {
  it('does not draw the hairline pseudo-element between rows', () => {
    expect(SOURCE).not.toContain('after:bg-separator');
    expect(SOURCE).not.toContain('after:left-13');
  });

  it('still uses the last prop for the card corner', () => {
    // `last` survived the separator removal because it rounds the bottom corner.
    expect(SOURCE).toContain("last && 'rounded-b-ios-md'");
    expect(SOURCE).toContain("first && 'rounded-t-ios-md'");
    // Its doc comment describes the corner, not the dropped separator.
    expect(SOURCE).not.toMatch(/Drops the separator/i);
  });
});
