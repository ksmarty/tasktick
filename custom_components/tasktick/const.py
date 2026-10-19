"""Constants shared by every module in the TaskTick integration.

Pure stdlib, like the other pure modules here: it must import without Home
Assistant so the constants can be asserted in a test that runs anywhere.
"""

from __future__ import annotations

from datetime import timedelta

DOMAIN = "tasktick"
MANUFACTURER = "TaskTick"

#: The DNS-SD name the TaskTick server advertises, published by
#: `src/server/mdns.ts`. The server-side test `tests/mdns.test.ts` reads this
#: integration's `manifest.json` and asserts the two agree, because a
#: mismatch here means the advertisement is published and never matched.
ZEROCONF_TYPE = "_tasktick._tcp.local."

# TXT keys carried by the advertisement. `TXT_URL` is the one that matters: it is
# the address the user browses to, which behind a reverse proxy is *not* the host
# the SRV record points at.
TXT_URL = "url"
TXT_PATH = "path"
TXT_VERSION = "version"
TXT_HOST = "host"

CONF_URL = "url"
CONF_TOKEN = "token"
CONF_VERIFY_SSL = "verify_ssl"

DEFAULT_GRAPHQL_PATH = "/api/graphql"

#: One minute. The server expands recurrence and pushes reminders itself, so
#: there is nothing here that needs to be fresher than that — and an instance
#: with a handful of lists is a handful of rows.
DEFAULT_SCAN_INTERVAL = timedelta(seconds=60)

#: How far ahead and behind the calendar platform asks for items. A month back
#: covers "what did I miss", a year forward covers a birthday feed; both are one
#: request because the server expands recurrence for the whole window at once.
CALENDAR_PAST_DAYS = 30
CALENDAR_FUTURE_DAYS = 365

#: The window the coordinator keeps warm for the calendar entities' synchronous
#: `event` property. Small on purpose: it only has to answer "what is next".
UPCOMING_DAYS = 14

#: Maps TaskTick priorities onto the todo platform's vocabulary. Home Assistant
#: has no priority concept, so this is only used to sort items into the order the
#: TaskTick UI shows them and to round-trip a value the user set elsewhere.
PRIORITY_ORDER = {"high": 0, "medium": 1, "low": 2, "none": 3}
