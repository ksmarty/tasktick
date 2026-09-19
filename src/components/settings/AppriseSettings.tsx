'use client';

/**
 * Apprise: an alternative (and additive) notification transport.
 *
 * Web Push in an installed iOS PWA is unreliable once the app is closed. Apprise
 * is a self-hosted gateway that accepts one HTTP POST and fans it out to ~100
 * services, so it is a better fit for a self-hosted app whose user already runs
 * one. Delivery is **additive**: a user with both Web Push and Apprise gets both,
 * and a user with only Apprise gets Apprise.
 *
 * Two rules shape this screen:
 *
 *   1. Saving never fetches the gateway. A self-hosted gateway may be
 *      unreachable from the server at that moment, and a save must not fail for
 *      it — only the URL *shape* is validated.
 *   2. The key is write-only. The server never returns it, so the field starts
 *      empty and leaving it blank keeps the stored key. That mirrors the CalDAV
 *      password, and it means an export cannot leak it.
 *
 * "Send test notification" is the only way to see whether the gateway is wired
 * up, because a misconfigured gateway is otherwise invisible until a reminder is
 * due.
 */
import { useEffect, useState } from 'react';
import { EnvelopeClosedIcon } from '@svg-animated-icons/react/envelope-closed';
import { Link1Icon } from '@svg-animated-icons/react/link-1';
import { PaperPlaneIcon } from '@svg-animated-icons/react/paper-plane';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/app/Toast';
import { api, errorMessage } from '@/lib/api-client';
import { useMutation } from '@/lib/store';
import type { UserSettings } from '@/lib/types';
import type { SettingsPayload } from '@/lib/view-types';
import { SettingsGroup, SettingsRow } from './SettingsGroup';

export interface AppriseSettingsProps {
  payload: SettingsPayload;
  /** Called after a successful write so the payload (and key state) refreshes. */
  onChanged?: () => void;
}

interface TestResult {
  configured: boolean;
  delivered: boolean;
  status?: number;
  error?: string;
}

/** The sentence shown for a failed test, keyed by the transport's error code. */
function testFailureMessage(result: TestResult): string {
  if (!result.configured || result.error === 'not-configured') {
    return 'Set an Apprise endpoint URL and key first.';
  }
  if (result.error === 'invalid-url') return 'That endpoint URL is not a valid http(s) address.';
  return result.error ?? 'The gateway did not accept the notification.';
}

export function AppriseSettings({ payload, onChanged }: AppriseSettingsProps) {
  const { toast } = useToast();
  const saved = payload.settings;

  const [url, setUrl] = useState(saved.appriseUrl ?? '');
  const [key, setKey] = useState('');
  const [tags, setTags] = useState((saved.appriseTags ?? []).join(', '));
  const [testing, setTesting] = useState(false);

  // Adopt server values when they change (a save, or a load on another device).
  // The key is deliberately not reset: the server never returns it.
  useEffect(() => {
    setUrl(saved.appriseUrl ?? '');
    setTags((saved.appriseTags ?? []).join(', '));
  }, [saved.appriseUrl, saved.appriseTags]);

  const save = useMutation(
    async (patch: { appriseUrl?: string | null; appriseKey?: string | null; appriseTags?: string[] | null }) =>
      api.patch<UserSettings>('/api/settings', patch),
    {
      invalidates: ['/api/settings', '/api/bootstrap'],
      onSuccess: () => {
        setKey('');
        onChanged?.();
        toast({ title: 'Apprise settings saved', variant: 'success' });
      },
      onError: (message) => toast({ title: 'Could not save Apprise settings', description: message, variant: 'error' }),
    },
  );

  function saveAll() {
    const cleanTags = tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    void save.run({
      appriseUrl: url.trim() === '' ? null : url.trim(),
      // `null` means "leave the stored key alone"; the field is write-only.
      appriseKey: key === '' ? null : key,
      appriseTags: cleanTags.length > 0 ? cleanTags : null,
    });
  }

  function clearKey() {
    void save.run({ appriseKey: '' });
  }

  async function test() {
    setTesting(true);
    try {
      const result = await api.post<TestResult>('/api/settings/apprise/test');
      if (result.delivered) {
        toast({
          title: 'Test notification sent',
          description: 'Apprise accepted the request. It should reach the services you have configured there.',
          variant: 'success',
        });
      } else {
        toast({ title: 'Apprise did not accept it', description: testFailureMessage(result), variant: 'error' });
      }
    } catch (error) {
      toast({ title: 'Could not reach Apprise', description: errorMessage(error), variant: 'error' });
    } finally {
      setTesting(false);
    }
  }

  return (
    <SettingsGroup
      title="Apprise"
      footer="Apprise is a self-hosted notification gateway that can fan out to about a hundred services. It is delivered in addition to push, so a device with both configured receives both."
    >
      <SettingsRow stacked>
        <Label htmlFor="apprise-url" className="flex items-center gap-2">
          <Link1Icon className="text-muted-foreground" />
          Endpoint URL
        </Label>
        <Input
          id="apprise-url"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://apprise.example.com"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          The base address of your Apprise API. TaskTick posts to <span className="font-mono">/notify/&lt;key&gt;</span>{' '}
          on this address.
        </p>
      </SettingsRow>

      <SettingsRow stacked>
        <Label htmlFor="apprise-key" className="flex items-center gap-2">
          <EnvelopeClosedIcon className="text-muted-foreground" />
          API key
        </Label>
        <Input
          id="apprise-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={saved.appriseKeyConfigured ? 'Saved — leave blank to keep it' : 'Your Apprise key'}
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {saved.appriseKeyConfigured
            ? 'A key is saved. It is never sent back to this page, so leave this blank to keep it.'
            : 'The key from your Apprise API configuration.'}
        </p>
      </SettingsRow>

      <SettingsRow stacked>
        <Label htmlFor="apprise-tags">Tags (optional)</Label>
        <Input
          id="apprise-tags"
          autoComplete="off"
          spellCheck={false}
          placeholder="e.g. tasktick, reminders"
          value={tags}
          onChange={(event) => setTags(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Comma-separated. Only the Apprise entries tagged with these are notified; leave blank for all of them.
        </p>
      </SettingsRow>

      <SettingsRow stacked>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={save.isPending} onClick={saveAll}>
            Save Apprise settings
          </Button>
          <Button variant="outline" disabled={testing || !saved.appriseKeyConfigured} onClick={() => void test()}>
            <PaperPlaneIcon />
            Send test notification
          </Button>
          {saved.appriseKeyConfigured ? (
            <Button variant="ghost" disabled={save.isPending} onClick={clearKey}>
              Clear key
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          The test posts to the address above; it is never sent on save, so an unreachable gateway cannot stop you
          saving.
        </p>
      </SettingsRow>
    </SettingsGroup>
  );
}
