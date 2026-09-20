'use client';

/**
 * API: the account's token for the public GraphQL endpoint.
 *
 * Sits in the Advanced group beside Data, because it is the same kind of thing —
 * a way to get your data out of the app and into something else — and it is
 * where someone looking for an API would look. The settings shell (pinned
 * navigation plus scroll pane) is rendered by the section layout, so this page
 * is just the content column, like every other section.
 */
import { ApiTokenCard } from '@/components/settings/ApiTokenCard';

export default function ApiSettingsPage() {
  return (
    <div className="flex flex-col gap-stack px-gutter pt-4 pb-6">
      <ApiTokenCard />
    </div>
  );
}
