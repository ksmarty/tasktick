'use client';

/**
 * The fold a whole section card performs when it leaves the list.
 *
 * ## Why a card needs one at all
 *
 * Completing the *last* row of a group empties that group, and the grouping
 * throws an empty group away rather than rendering a bare header (see
 * `buildListSections`/`buildTodaySections`). The card is therefore removed from
 * the tree in the very commit that removes its row — which cancels the row's own
 * exit (`TaskRow`), because the whole subtree unmounts at once. Measured before
 * this existed: with two rows in the Tomorrow group, completing one folded the
 * card 126px → 82px over ~240ms; completing the *last* one made the card vanish
 * in a single frame (82px → gone between one frame and the next).
 *
 * So the card gets the same fold the row gets, one level up: its height animates
 * to zero and it fades, and `AnimatePresence` keeps it on screen for that long.
 * The row inside it is *not* separately animated in this case — the card's own
 * collapse carries it, which is the honest reading: the group went, and the row
 * went with it.
 *
 * ## The clip is on only while exiting
 *
 * A collapsing box has to clip its contents or the card would keep painting at
 * full height over the cards below it. `overflow-hidden` here is therefore
 * required — but it also clips the card's own drop shadow, so it is applied only
 * while this section is *leaving*, via `useIsPresent()`. A section that is
 * present keeps its shadow exactly as it had it, and the exit's ~200ms of clipped
 * shadow is invisible because the card is on its way out anyway.
 *
 * ## What it deliberately does not do
 *
 * There is no entrance. A card appearing is the *result* of something the user
 * did — a filter change, a completion landing in another group, an Undo bringing
 * a group back — and expanding a card in from zero height would make the list
 * below it move for a reason the user did not ask for. A card leaving is the
 * thing they just did. So the fold is one-directional on purpose, and `initial`
 * is left unset (framer's default is to mount at the `animate` values, i.e.
 * nothing animates in), with `AnimatePresence initial={false}` on top of it so
 * the first paint of a list is never a cascade.
 *
 * The gap between cards comes from the page's `gap-stack`, so when the collapsed
 * card is finally removed the flex gap closes with it — one 12px step at the end
 * of the fold rather than the whole card's height. Stating it here because it is
 * the one seam of this animation, and it is a twentieth of the jump it replaced.
 */
import type { ReactNode } from 'react';
import { motion, useIsPresent } from 'framer-motion';
import { useReducedMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

/** How long a section takes to fold away, in seconds — the swipe settle curve. */
const FOLD_SECONDS = 0.2;
/** The same ease the rows and the swipe settle use. */
const FOLD_EASE = [0.32, 0.72, 0, 1] as const;

export interface SectionFoldProps {
  children: ReactNode;
  className?: string;
}

export function SectionFold({ children, className }: SectionFoldProps) {
  const reduceMotion = useReducedMotion();
  const present = useIsPresent();

  return (
    <motion.div
      className={cn(!present && 'overflow-hidden', className)}
      /*
       * Under the app's motion preference the card is simply gone: no collapse,
       * no fade, the same instant removal the list had before any of this.
       */
      exit={
        reduceMotion
          ? { opacity: 0, transition: { duration: 0 } }
          : {
              opacity: 0,
              height: 0,
              transition: {
                height: { duration: FOLD_SECONDS, ease: FOLD_EASE },
                opacity: { duration: FOLD_SECONDS * 0.7, ease: 'easeIn' },
              },
            }
      }
    >
      {children}
    </motion.div>
  );
}
