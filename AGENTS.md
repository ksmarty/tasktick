# AGENTS.md

Working notes for anyone — human or agent — changing TaskTick. The audience is
whoever is about to edit a file and would otherwise rediscover something
expensive. It is deliberately blunt about mistakes that have already been made
here, because most of them were made more than once.

Read `GODUI-CONVENTIONS.md` too: it governs the UI layer specifically (tokens,
the spacing scale, how vendored components are treated). This file covers
everything else.

---

## 1. What this is

A self-hosted TickTick clone. Next.js App Router, TypeScript, Drizzle → SQLite by
default and Postgres optionally, better-auth for accounts, Tailwind v4 with a
vendored GodUI/shadcn component layer. Mobile-first; the phone layout is the real
one and desktop is the adaptation. Ships as a single Docker image from
`ghcr.io/ksmarty/tasktick`, multi-arch, published by CI on tag.

Four tabs: **Tasks, Calendar, Habits, Settings**.

---

## 2. The rules that are enforced, not requested

These have mechanical checks. Breaking them fails a build, so know them before
you write code rather than after.

| Rule | Enforced by | Notes |
|---|---|---|
| No arbitrary spacing values; no static spacing in an inline `style` | `node scripts/check-spacing.mjs` | Four layout tokens: `p-card`, `px-gutter`, `gap-stack`, `px-row`. Computed values — a colour, SVG geometry, a measured px — are fine. |
| SQLite and Postgres schemas stay identical | `tests/schema-parity.test.ts` | Add a table to **both** `schema.sqlite.ts` and `schema.pg.ts`, plus a migration for each dialect and the meta snapshot. |
| Sub-agents must not commit, tag or push | `scripts/git-hooks/reference-transaction` + `pre-commit` | Gated on `.git/AGENT-LOCK` existing. See §7. |
| `public/sw.js` `VERSION` bumps when its behaviour changes | Convention | Currently `tasktick-v10`. |

`src/components/ui/**` (shadcn) and `src/components/godui/**` (vendored) are
**exempt** from the spacing checker. Everything you write is not.

---

## 3. Environment

The container this runs in is not a typical dev box. These are not preferences.

- **`python3` is gone.** Use `node -e`, the `edit` tool, or `sed`. Several edits
  in this project's history half-applied because a script assumed Python.
- **`git` is installed but was once missing** and had to be `apt-get install`ed.
  If it is absent, that is why.
- **Helper scripts live in `/tmp/tools/`** and **`/tmp` has been wiped mid-project
  at least once.** If they are gone:
  - `/tmp/tools/build.sh` — `BUILD_STANDALONE=1 npx next build`, serialised behind
    `/tmp/.tasktick-build-lock` so parallel agents queue instead of corrupting
    `.next`.
  - `/tmp/tools/deploy.sh <port> [dbPath]` — copies the standalone output and runs
    it on a port.
  - `/tmp/tools/shoot.mjs` — `BASE=… OUT=… ROUTES=/tasks,/calendar node shoot.mjs`
    from `/tmp/tools`. Screenshots.
- **Demo login:** `demo@tasktick.local` / `tasktick-demo-1234`. Migrated, seeded
  DBs under `/tmp/uidata/` — `/tmp/uidata/v.db` is the usual one. Seed defaults
  are `SEED_EMAIL` / `SEED_PASSWORD` in `scripts/seed.ts`.
- **Playwright needs system libraries:** `npx playwright install-deps chromium`.
- **There is no `curl`.** Use `node -e` with `fetch`, or Playwright's
  `request` context when you need a session cookie.

### `deploy.sh` kills every server on the box

It matches `next-server` in `/proc/<pid>/cmdline` and kills **all** of them, not
just the port it is about to use. Two consequences:

- **A long-running probe will die mid-run** when another agent deploys. Re-deploy
  and re-run rather than concluding your change broke something.
- Do not use `pkill -f "node server.js"`. Node rewrites `process.title`, so it
  matches nothing. Match `next-server` in `/proc`.

### Parallel agents

Several agents share one working tree and one `.next`. `build.sh` serialises
builds, but a plain (non-standalone) build can still overwrite
`.next/standalone` out from under a deploy. **Build and deploy in one chained
command**, and use a unique port per agent.

---

## 4. Traps that have cost real time

Each of these produced a bug that was then debugged from scratch. They are
grouped by the kind of mistake.

### Reading a file and matching on what you saw

**The single most expensive habit in this project's history.** Six failed edits,
one of which destroyed most of `AppShell.tsx`.

`sed 's/^/  /'`, `grep -A3`, and similar are how you *read* a file. The
indentation they print is **not the file's indentation**. Copying old text out of
that output and into an `edit` call fails, because `oldText` must match byte for
byte.

- **Never hard-code leading whitespace.** Locate the line by its distinguishing
  *content* and reuse the indentation you find:

  ```js
  const idx = lines.findIndex((l) => l.includes('anchorPx}px'));
  const indent = lines[idx].match(/^\s*/)[0];
  ```

- **Never search for a delimiter to find your block.** A script that looked
  backwards for `/*` and forwards for `*/` matched across twelve comment blocks
  and replaced lines 280–572 of `AppShell.tsx`. An anchor that is "unique enough"
  is not the same as one that is unique.
- **Prefer the `edit` tool** for anything you can express as a unique string, and
  a `node` script with an **explicit assertion** (`if (!s.includes(from)) throw`)
  when you cannot. A silent no-op edit is worse than a failed one.
- **Backticks in a `node -e` one-liner are interpreted by the shell.** Write the
  script to a file instead.

### Rendering and CSS

- **A fenced comment inside a `className` string silently kills those tokens.**
  `'flex /* note */ py-2'` means `flex` and `py-2` never apply. This shipped once
  as "the text isn't vertically centred" and survived several fix attempts
  because the class string *looked* right.
- **`calc()` in an inline `style` string needs spaces around `+`.**
  `calc(1rem+2px)` is invalid; `calc(1rem + 2px)` is not.
- **A `transform` on a route wrapper makes it the containing block for
  `position: fixed`.** Descendants then position against the wrapper, not the
  viewport. This is why the page-enter animation is opacity-only.
- **Computed `rounded-full` is a large px value, not `50%`.** A probe filtering on
  `borderRadius.includes('50%')` finds nothing.
- **A left `border` follows its element's rounded corner** and its inner edge
  curves with it. A 4px "colour strip" that must be flush, straight-edged and
  inside a rounded card is a `border-l-4`, not a separate element — three attempts
  went the other way before that was settled.

### Data shapes

- **API responses are wrapped: `{ ok: true, data: … }`.** Reading `body.items`
  yields `undefined` and looks like an empty response. This has caused at least
  four false "it returned nothing" conclusions.
- **`user.createdAt` is an ISO string**, not a number. better-auth owns the `user`
  table and declares its timestamps with Drizzle's `{ mode: 'timestamp_ms' }`, so
  the driver returns a `Date` and JSON makes it a string. Every table this app
  owns uses a plain integer and returns a number. The type said `number` once,
  `tsc` was happy, and the admin page threw a client-side exception at runtime.
- **`doneToday` on a habit means "the target is met"**, not "there is an entry".
  A check-in of `count: 1` on a habit needing 8 correctly leaves it `false`.

### Offline and the service worker

- **Offline probes must cold-start**: `ctx.setOffline(true)` **plus a brand-new
  page**. Reloading an existing page takes a different path through the worker and
  has passed while the real case failed.
- **The worker cannot read `navigator.onLine`.** A service worker has no network
  state; the page tells it (`trackConnectivity()` → a `connectivity` message →
  `networkOnline`). Anything that assumes the flag is current will be wrong for a
  window after a connection drops.
- **Never `await cache.put(...)` before returning a response.** It streams the
  whole body into the cache, and awaiting it holds the page's own HTML back. Use
  `event.waitUntil`. This was shipped once as "online tab switches feel slow".
- **Caching is per session**, in a cache named by an opaque hash of `session.id`,
  deleted on sign-out, with a document valid only at its own URL. Deliberate.
- **`/` is a redirect route and redirects are never cached** — so an offline cold
  start of the installed app (whose `start_url` is `/`) has no document to serve.
  The worker maps `/` to the landing route to keep the exact-URL rule intact.

---

## 5. How to verify something

The project's most-repeated failure is not broken code. It is **a confident claim
that was never checked**, and **a probe that was wrong in a way that looked like a
pass**.

- **Read the screenshot.** Take one, then read the PNG with the `read` tool and
  describe what you see. A server-side render is not proof; neither is a passing
  selector.
- **Measure computed values, not source strings.** `getBoundingClientRect()`,
  `getComputedStyle()`, a DOM node count. Reading a class name tells you what you
  wrote, which is the thing in question.
- **Check *why* a probe might fail before believing it.** A probe that reports
  "0 items" is at least as likely to have a bad selector or the wrong response
  envelope as to have found a real bug. Every one of these has happened here: a
  regex matching `"Show Feed"` inside `"Edit Feed"`, a button labelled `"Save
  calendar"` searched for as `"Save"`, `{ok,data}` read as the raw object, a node
  selector matching circles from *other* rows.
- **A test that cannot fail is not evidence.** New tests were added that asserted
  a source file contained the expression `padTop + line / 2` — all of which would
  still pass if the padding constant changed and the anchor silently drifted 2px.
  Pin the **resolved value**, then **prove the pin bites**: change the thing,
  watch it fail, revert it.
- **Distinguish "the agent's work is broken" from "my probe is broken".** Several
  of the loudest false alarms in this project were the second kind.
- **For a fix in a hard-to-reach environment, say what you actually proved.**
  The Low Power Mode detection is an iOS behaviour; Chromium on Linux cannot
  reproduce it. What is proven is that a `NotAllowedError` maps to low power and
  an unrelated rejection answers nothing. What is *not* proven is that iOS refuses
  autoplay the way the referenced answer describes. Say that, rather than
  implying the feature was seen working.

---

## 6. Architecture

```
src/lib/       framework-free: types, dates (Luxon), nlp, rrule, fractional,
               store, events, motion, colors, linkify, offline-*
src/server/    db (schema + dialect), repos, caldav, sync, services, graphql
src/components/{ui,godui,app,tasks,calendar,habits,settings,pwa,auth}
src/app/       App Router routes
```

Decisions worth knowing before you "improve" something:

- **Recurrence expands only server-side** (`src/server/recurrence.ts`,
  `src/server/caldav/ical.ts`). A client must never re-derive date maths.
- **Screens import MUI/shadcn/GodUI directly — there is no wrapper layer.** MUI
  was tried and fully reverted; the whole 32-primitive MUI-era `ui` kit was
  deleted rather than kept around.
- **The design system is `src/theme.ts` + the tokens in `globals.css`.** The
  palette is GodUI "Celestial Sapphire" — monochrome, OKLCH. An accent
  *preference* re-points `--primary`; its default is neutral, so enabling it
  changes nothing until a colour is chosen.
- **A public GraphQL API lives at `/api/graphql`**, authenticated by a bearer
  token (`Authorization: Bearer tt_…`), one per account (`api_tokens.user_id` is
  the primary key), stored only as a keyed HMAC. Queries are depth-capped at 12
  because this endpoint expands recurring events server-side.
- **`useShellPane({ fullHeight: true })`** is how a screen takes over scrolling
  from the shell's pane, so that exactly one element scrolls. Tasks, Calendar,
  Habits and Settings use it (and `HabitList` re-declares it for its own pane).
  Scroll-edge fading is `tw-fade` — the `fade-y` utility — applied to that
  scroller: `TasksView`, `CalendarScreen`, `SettingsScroll` (and the settings
  tabs' inner rail). It must go on the element that actually scrolls, because the
  mask is gated on that element's own scroll position.

### Deleted rather than kept

The project prefers deleting dead code to leaving it unreachable. Things that were
removed once their replacement landed: the MUI `ui` kit, 268 design tokens,
`tailwind-merge`/`clsx`/`lucide-react` (briefly), `src/lib/cn.ts`, the habit
heatmap, and — most recently — the frame-delta Low Power Mode inference with its
options type and its tests.

---

## 7. Releasing

**Sub-agents must not commit, tag or push.** The guard is `.git/AGENT-LOCK`:

```sh
touch .git/AGENT-LOCK      # before delegating
rm -f .git/AGENT-LOCK      # only to release, or when no agent is running
```

The lock is what makes the rule real — an instruction in a brief is not
enforcement. Two process failures are recorded in this project's history because
the lock was dropped:

- A sub-agent **released a version itself**, because I had removed the lock and
  the hook therefore allowed it.
- **A tag was cut onto the wrong commit**, because the lock also refused *my*
  commit and the `git tag` that followed in the same `&&` chain ran against an
  unchanged `HEAD`. **The lock does not distinguish the main agent from a
  sub-agent.**

Release steps:

1. `npx tsc --noEmit` → 0 errors. `npx vitest run` → green. `node
   scripts/check-spacing.mjs` → clean.
2. Build, deploy, probe. **Read the screenshots.**
3. Bump `package.json`, commit with a message that explains *why*, tag `vX.Y.Z`,
   push `main` and the tag.
4. Watch both workflows (`Release`, `Publish image`) until green.
5. Re-engage the lock if you are about to delegate again.

A patch release should still contain something. If the only change is that a
release's claims were verified by hand, **turn that verification into a pinned
test** and ship the test — an unverified claim in a commit message cannot fail a
build.

---

## 8. Known gaps

Real, known, and not bugs in whatever you are working on. Do not "fix" them
incidentally, and do not build UI that implies they work.

- **Nothing dispatches reminders.** `web-push` is installed but unused and
  `deliverUserNotification` is never called from a scheduler. Event and habit
  reminders are stored and displayed and **never fire**.
- **Admin endpoints are not in the GraphQL API**, deliberately: behind a bearer
  token, one account's token could ban or manage other accounts. They stay
  session-only. Export and TickTick import are file transfers and also stay REST.
- **The Low Power Mode probe is unverified on real iOS** — see §5.
- **Short `maps.app.goo.gl` links cannot be parsed client-side** without a
  server-side fetch, which would need an SSRF guard. Long
  `google.com/maps/place/...` links parse locally.
- **Desktop is the adaptation, not a target.** Do not spend effort there that
  costs the phone layout.

---

## 9. Delegating to sub-agents

Useful, and used heavily here. What works:

- **One deliverable per agent**, with an explicit file scope — name the files it
  owns *and* the ones other agents are in. Overlap produces conflicting edits in
  one tree.
- **Give it the diagnosis you already have.** An agent re-deriving something you
  already measured wastes the run. Include the numbers, the failed attempts, and
  the reason a previous approach was rejected.
- **Ask it to decide and justify, not to guess.** Where a requirement is
  ambiguous, have it state the reading it took and why.
- **Tell it that "I found nothing wrong, here is the evidence" is an acceptable
  answer.** Otherwise you get a speculative change.
- **Require measurement, and require reverting what does not measure.** "If a
  change is worth <3%, revert it and say so."
- **A brief with a specific experiment beats a brief with a task.** "Compare the
  offline switch with the flag settled against immediately after the drop" found
  the cause; "fix the offline lag" would not have.
- **Agent reports have been lost mid-session.** If a result does not arrive,
  verify the work from `git status` and the diffs — the work is usually there.
  Do not assume an agent did nothing without checking; the opposite mistake was
  made once (two agents were reported as idle when both had worked).

---

## 10. The short version

1. Find text by **content**, never by assumed indentation or a delimiter.
2. Measure **computed** values; read the **screenshot**.
3. If a probe says something surprising, suspect the probe.
4. A test that cannot fail is not evidence.
5. Do not claim verified without evidence — and say plainly what you could not
   check.
6. Delete dead code rather than leaving it unreachable.
7. `touch .git/AGENT-LOCK` before delegating; `rm` it only to release.
