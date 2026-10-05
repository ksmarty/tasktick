# TaskTick for Home Assistant

Brings a self-hosted [TaskTick](https://github.com/ksmarty/tasktick) instance into
Home Assistant: your lists and calendars as entities, your tasks and habits as
services, and the whole thing reachable by voice through Assist.

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
TaskTick release and built by CI from `integrations/home-assistant/`. If you are
reading this inside the TaskTick repository rather than a release asset, that
directory *is* the integration.

### Manual

Copy `custom_components/tasktick/` into your Home Assistant
`config/custom_components/` directory and restart.

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

`blueprints/automation/tasktick/reminder_notification.yaml` forwards a TaskTick
reminder to a `notify` service. Import it through
**Settings → Automations → Blueprints**, then point it at a `notify.*` target.

TaskTick decides *when* a reminder is due and pushes it to Home Assistant; the
blueprint only delivers it. Home Assistant does not poll for reminders.

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

The integration lives in `integrations/home-assistant/` inside the TaskTick
repository. Tests need no Home Assistant installation of their own — they use
lightweight stand-ins — but they do import `homeassistant`, so run them in a
virtualenv that has it:

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
