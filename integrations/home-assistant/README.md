# TaskTick for Home Assistant

Brings a self-hosted [TaskTick](https://github.com/ksmarty/tasktick) instance into
Home Assistant: your lists and calendars as entities, your tasks and habits as
services, each due reminder delivered as a notification through HA Reminders, and
the whole thing reachable by voice through Assist.

TaskTick is the source of truth. This integration is a client — it holds no state
of its own, and everything it shows comes from the TaskTick API.

---

## Install

### HACS (recommended)

1. HACS → **Integrations** → the three-dot menu → **Custom repositories**.
2. Repository: `ksmarty/tasktick` — Category: **Integration**.
3. Search for **TaskTick** in HACS and install it.
4. Restart Home Assistant.

Home Assistant **2024.11.0** or newer is required, which HACS enforces from
`hacs.json` at the root of that repository.

HACS installs the integration from `tasktick.zip`, which is attached to every
TaskTick release and built by CI. Inside the TaskTick repository the integration's
source is `custom_components/tasktick/` at the repository root — the layout HACS
requires — while this directory holds its tests, the archive builder and this
document. The archive carries those files at *its* root, because HACS unpacks a
release archive straight into `config/custom_components/tasktick/` without
stripping a prefix.

### Manual

Copy `custom_components/tasktick/` into your Home Assistant
`config/custom_components/` directory and restart — or download `tasktick.zip`
from a release and unpack it into `config/custom_components/tasktick/`.

---

## Setup

**Settings → Devices & Services → Add Integration → TaskTick.**

| Field | What it is |
|---|---|
| URL | Where TaskTick is reachable *from Home Assistant*, e.g. `http://192.168.1.10:3000`. Not necessarily the URL you use in a browser. |
| API token | A token from TaskTick → **Settings → API tokens**. |

TaskTick is usually found on its own if it is on the same network — see below.
When it is found, you are asked for the token only.

### Auto-discovery

TaskTick advertises itself over mDNS as `_tasktick._tcp.local.`, so a Home
Assistant on the same LAN offers to set it up without you typing a URL. The
advertisement carries the scheme, host, port and API path, so the URL field is
prefilled.

Discovery finds the *service*, never the credentials. The API token is always
entered by hand — the TXT record contains no secret.

If TaskTick is behind a reverse proxy, on another VLAN, or in Docker with
host networking disabled, discovery will not see it and you should add the
integration by URL. Multicast does not cross most Docker bridge networks.

---

## What you get

### Entities

| Entity | What it is |
|---|---|
| `todo.*` | One list per TaskTick list. Supports add, update, complete and delete, so the built-in To-do card and any `todo.*` service work. |
| `calendar.*` | One calendar per TaskTick calendar, including subscribed and CalDAV ones. |
| `sensor.*` | Counts and status — tasks due today, overdue tasks, per-habit streaks. |
| `binary_sensor.*` | Whether a habit is still due today. |
| `button.*` | Refresh a calendar, or force a sync. |

The `todo` entities are the important ones: because they implement the standard
to-do platform, they work with the To-do list card, `todo.add_item`,
`todo.update_item`, and — most usefully — **Assist can manage your tasks with no
custom intent at all**.

### Services

| Service | Does |
|---|---|
| `tasktick.create_task` | Create a task, optionally into a named list, with a due date, priority, tags and a note. |
| `tasktick.complete_task` | Complete by title (partial match) or by id. Repeating tasks move to their next occurrence. |
| `tasktick.delete_task` | Delete by title or id. |
| `tasktick.check_in_habit` | Check a habit in, optionally with a count. |
| `tasktick.create_reminder` | Hand *one* reminder about a task, a habit or an event to HA Reminders, for it to schedule itself — the escape hatch for a trigger TaskTick cannot express (see Reminders). |
| `tasktick.sync` | Ask TaskTick to sync its CalDAV and subscribed calendars now. |

### Voice (Assist)

Every TaskTick intent is registered with Home Assistant's intent system, which is
what Assist builds its tools from — so these work with the built-in conversation
agent, any LLM-backed agent, and the Assist app, with no extra configuration.

| Say | Intent |
|---|---|
| "Add buy milk to my shopping list" | `TaskTickAddTask` |
| "What's on my task list" / "What's due today" | `TaskTickListTasks` |
| "Complete buy milk" | `TaskTickCompleteTask` |
| "Delete buy milk" | `TaskTickDeleteTask` |
| "Check in my reading habit" | `TaskTickCheckInHabit` |
| "What's my streak on reading" | `TaskTickHabitStatus` |

Dates are understood the way Assist understands them — "tomorrow", "on Friday",
"at 5pm" — and named lists are matched against your real TaskTick lists, so a
list you have not created is reported rather than silently ignored.

Assist replies with the day it resolved, not the word you said: "add pay rent
tomorrow" answers *"Added Pay rent to Inbox for Thursday, 5 March."*

Because the `todo.*` entities also exist, both paths work — use whichever suits
your automation.

### Reminders

TaskTick can push a reminder to your phone itself (Web Push, from the app's own
settings). This integration is the other path — the one that goes through Home
Assistant — and it needs no automation at all: **each due reminder is delivered
as a notification through [HA Reminders](https://github.com/ksmarty/ha-reminders).**

The integration holds nothing and stores nothing. On setup it registers a webhook
with Home Assistant and hands that URL to TaskTick as the address to post
reminders to; every poll (60 seconds) it offers the address again, which is what
keeps the registration fresh. When a reminder comes due, TaskTick posts it — the
title, the body, the link a tap opens, the button — and the integration sends it
as a single one-off notification.

**No entries are created.** HA Reminders is used as a notification service here,
not as a second schedule: nothing about your TaskTick reminders appears on its
panel or as its sensors, and there is nothing to reconcile when a task moves, is
completed in the app, or is deleted. The schedule stays TaskTick's, because
TaskTick already knows when a reminder is due and exactly once.

There is nothing to configure. The one thing HA Reminders needs is a **default
notify service** (its own setting), because that is the one thing nobody else can
know: TaskTick has no idea what your phone is called in Home Assistant.

**All-day events are skipped**, deliberately. With no start time there is no
instant to count a reminder offset back from, and inventing one would put a
notification at an hour nobody chose. A timed event is delivered like anything
else.

Home Assistant is never the only way a reminder arrives. Remove or disable the
integration, leave Home Assistant quiet for more than fifteen minutes, or run
without HA Reminders (or with a version older than its one-off `notify` service)
— and TaskTick sends that reminder itself, exactly as it did before. A failed
call falls back the same way, so a delivery that cannot happen costs a slower
notification rather than a lost one, and there is no switch to remember.

Upgrading from a release that mirrored the schedule: the reminders that mirror
created are deleted from HA Reminders on the first setup after the update, and
the list it kept of them is removed with them, so nothing is left firing for a
schedule TaskTick no longer maintains.

What a delivered reminder does:

- Tapping it opens TaskTick at that task, that habit, or that day with the event's
  card already showing.
- Its acknowledge button says **Complete** on a task and **Check in** on a habit,
  and it calls `tasktick.complete_task` / `tasktick.check_in_habit` back, so a
  repeating task rolls forward and a habit is credited to the day the reminder was
  for — not the day you happened to tap. An event gets **Dismiss** and nothing to
  run: there is nothing to finish.
- Snoozing it sends the same notification again after the delay you picked.
- It carries TaskTick's own icon, `mdi:check-circle-outline`.

Every reminder is delivered once, at the moment TaskTick says it is due: a habit
that repeats on Monday, Wednesday and Friday fires on exactly those days, and a
task's own reminder offsets are honoured one by one.

#### A reminder HA Reminders schedules itself

`tasktick.create_reminder` points the other way: it hands HA Reminders a reminder
for HA Reminders to hold and fire, for a trigger TaskTick has no concept of — a
zone trigger, a time window, extra snooze buttons, your own message, a repeat
count. Unlike the automatic path above, this one *is* stored: it appears on HA
Reminders' panel with the rest of that integration's reminders.

```yaml
action: tasktick.create_reminder
data:
  task_id: "{{ id }}"
  trigger_type: zone_enter
  zone_entity_id: zone.home
  person_entity_ids: [person.kyle]
  notify_service: notify.mobile_app_phone
```

Give `task_id`, `habit` (an id or a name) or `event_id` — exactly one of the
three, plus `date` for an event. Everything else HA Reminders understands — a
zone trigger, a time window, `every_x_days`, `exclude_days_of_week`, extra
`snooze_delays`, a `notification_group`, `one_shot`, the resend count — is passed
straight through unchanged; its README documents the whole set.

A reminder made this way is *yours*: nothing removes it but you, and it is a
second reminder about that item — TaskTick's own delivery knows nothing about it,
so an item that already has a reminder in TaskTick gives you both. Calling the
service without HA Reminders installed fails with a message that says so.

TaskTick decides *what* a reminder is about, when it is due, and where it opens;
HA Reminders decides how it reaches your phone and what its buttons do.

---

## Troubleshooting

**"Cannot connect" when adding the integration.** The URL must be reachable from
Home Assistant, not from your laptop. From the Home Assistant host:

```bash
curl -H "Authorization: Bearer tt_yourtoken" http://TASKTICK:3000/api/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ me { email } }"}'
```

A `401` means the URL is right and the token is not. A connection error means the
URL is wrong, or a firewall is in the way.

**The integration disappeared after a TaskTick upgrade.** The API token was
probably revoked. Add a new one and use **Reconfigure** on the integration.

**Entities are stale.** Calendars and lists refresh on a timer. Use the
`button.*` refresh entity, or `tasktick.sync`, to force it.

---

## Development

The integration's source is `custom_components/tasktick/` at the root of the
TaskTick repository, because that is the only layout HACS accepts; its tests, the
archive builder and this document live in `integrations/home-assistant/`. Tests
need no Home Assistant installation of their own — they use lightweight stand-ins
— but they do import `homeassistant`, so run them in a virtualenv that has it:

```bash
cd integrations/home-assistant
python -m pytest tests/ -q
```

`hacs.json` declares the oldest supported Home Assistant, and the tests read that
same value: on anything older, the Home Assistant-dependent modules skip rather
than error with a `TypeError` that looks like an integration bug. CI installs the
newest release, so they always run there.

Two Home Assistant internals are worth knowing before changing anything:

- **Assist gets its tools from the registered intents.** There is deliberately no
  `llm.py` platform here. Home Assistant's `AssistAPI` walks the intent registry
  and turns each intent into a tool, so registering a handler in `intents.py` is
  the whole of the voice-assistant integration. A separate tool list would be a
  second place to forget, and a tool the model never sees fails silently.
- **`DataUpdateCoordinator` gained its `config_entry` keyword in 2024.11.0.**
  That is why the minimum is not lower.
