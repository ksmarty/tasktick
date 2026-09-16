import { Suspense } from 'react';
import { TasksView } from '@/components/tasks';

/**
 * `/tasks` — the list screen.
 *
 * `TasksView` reads the URL with `useSearchParams`, so it sits inside a Suspense
 * boundary: that keeps the filter state a URL concern while the rest of the page
 * can still render immediately.
 */
export default function TasksPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-bg" aria-hidden />}>
      <TasksView />
    </Suspense>
  );
}
