'use client';

/**
 * Internal plumbing shared by the interactive primitives in this folder.
 *
 * Nothing in here is part of the public kit API — it is deliberately *not*
 * re-exported from `./index.ts`. Everything that touches the DOM (portals,
 * scroll locking, focus traps) lives here so each component stays a thin
 * wrapper around its own markup.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * Stacking order for the kit's overlays. Centralised so a sheet never ends up
 * behind a nav bar by accident, and so callers do not invent their own z-index.
 */
export const Z = {
  /** Anchored popovers / tooltips. */
  popover: 30,
  /** Nav bar and tab bar. */
  chrome: 40,
  /** Bottom sheets and action sheets (plus their backdrop). */
  sheet: 50,
  /** Centred alert dialogs — above a sheet, because an alert can be raised from one. */
  dialog: 55,
  /** Toasts sit above everything. */
  toast: 60,
} as const;

/**
 * `useLayoutEffect` on the client, `useEffect` on the server. Used for the
 * measure-and-resize effects (auto-growing textareas) where a frame of the
 * wrong height would be visible.
 */
export const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Merges several refs (ours plus a caller-supplied one) into one callback ref. */
export function composeRefs<T>(...refs: (Ref<T> | undefined)[]): (node: T | null) => void {
  return (node) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === 'function') ref(node);
      else (ref as MutableRefObject<T | null>).current = node;
    }
  };
}

/**
 * Renders its children into `document.body`. Returns `null` during SSR and on
 * the very first client render, so hydration always matches.
 */
export function Portal({ children }: { children: ReactNode }): ReactNode {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.body);
  }, []);

  if (!host) return null;
  return createPortal(children, host);
}

/** How many overlays currently want the body frozen. */
let scrollLockCount = 0;
let restoreOverflow = '';
let restorePaddingRight = '';

/**
 * Freezes the document while an overlay is open. Reference-counted, so a sheet
 * opened from another sheet does not unfreeze the page when the inner one closes.
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    if (scrollLockCount === 0) {
      const { body } = document;
      restoreOverflow = body.style.overflow;
      restorePaddingRight = body.style.paddingRight;
      body.style.overflow = 'hidden';
      // Compensate for the disappearing scrollbar so the layout does not jump.
      const gutter = window.innerWidth - document.documentElement.clientWidth;
      if (gutter > 0) body.style.paddingRight = `${gutter}px`;
    }
    scrollLockCount += 1;

    return () => {
      scrollLockCount -= 1;
      if (scrollLockCount === 0) {
        document.body.style.overflow = restoreOverflow;
        document.body.style.paddingRight = restorePaddingRight;
      }
    };
  }, [active]);
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableWithin(node: HTMLElement): HTMLElement[] {
  return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  );
}

/**
 * Traps Tab inside `ref` while `active`, focuses the first focusable element on
 * open, and returns focus to whatever was focused before on close. The target
 * element needs `tabIndex={-1}` so it can hold focus when it has no children.
 */
export function useFocusTrap<T extends HTMLElement>(ref: RefObject<T | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const frame = window.requestAnimationFrame(() => {
      const [first] = focusableWithin(node);
      (first ?? node).focus({ preventScroll: true });
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusableWithin(node);
      if (items.length === 0) {
        event.preventDefault();
        node.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;

      if (event.shiftKey && (current === first || !node.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    node.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      node.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [active, ref]);
}

/**
 * Escape handlers, innermost last. Only the topmost overlay reacts, which is
 * what iOS does when an alert sits on top of a sheet, and what a user expects
 * from a single Escape press.
 */
const escapeStack: (() => void)[] = [];

function onDocumentEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  const topmost = escapeStack[escapeStack.length - 1];
  if (!topmost) return;
  event.stopPropagation();
  topmost();
}

/** Calls `onKey` whenever Escape is pressed while `active`. */
export function useEscapeKey(active: boolean, onKey: () => void): void {
  const handler = useRef(onKey);
  handler.current = onKey;

  useEffect(() => {
    if (!active) return;
    const entry = () => handler.current();
    if (escapeStack.length === 0) document.addEventListener('keydown', onDocumentEscape, true);
    escapeStack.push(entry);

    return () => {
      const index = escapeStack.lastIndexOf(entry);
      if (index >= 0) escapeStack.splice(index, 1);
      if (escapeStack.length === 0) document.removeEventListener('keydown', onDocumentEscape, true);
    };
  }, [active]);
}

/** Closes on any pointer press outside `ref`. */
export function useOutsidePointerDown(ref: RefObject<HTMLElement | null>, active: boolean, onOutside: () => void): void {
  const handler = useRef(onOutside);
  handler.current = onOutside;

  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent) => {
      const node = ref.current;
      if (!node) return;
      if (event.target instanceof Node && node.contains(event.target)) return;
      handler.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [active, ref]);
}

/** `matchMedia` as a hook. Always false during SSR / the first client render. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);

  return matches;
}

/**
 * True on devices whose primary input is touch (iPhone, iPad, Android). Used to
 * swap the native control for the iOS-feeling one instead of guessing from the
 * user agent.
 */
export function useIsTouch(): boolean {
  return useMediaQuery('(hover: none) and (pointer: coarse)');
}

/**
 * Scroll offset of whichever element actually scrolls the page.
 *
 * The app shell owns its scroll container, so `window.scrollY` is not always
 * the answer. `scroll` events do not bubble but they *do* capture, so one
 * capturing listener on `document` sees every scroller; we then ignore
 * elements too short to be the page scroller (a horizontal carousel, a scroll
 * area inside a sheet) by comparing their height with the viewport.
 */
export function usePageScrollOffset(): number {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const update = (target: EventTarget | null) => {
      if (target instanceof HTMLElement && target.clientHeight > window.innerHeight * 0.6) {
        setOffset(target.scrollTop);
        return;
      }
      setOffset(window.scrollY);
    };

    const onScroll = (event: Event) => update(event.target);
    update(null);
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  }, []);

  return offset;
}

/** True once the component has mounted on the client. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
