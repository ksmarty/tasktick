"""Pure helpers for the TaskTick integration.

Stdlib only, so every function here can be unit tested without a Home Assistant
runtime — which is the same reason the server-side modules in this repository are
framework-free. The matching helpers exist because speech recognition mangles the
odd word: an exact comparison would fail to find "pack a work sweater" when the
user said "sludder".
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
import re
from datetime import date, datetime, time as dtime, timedelta
from typing import Any

_SLUG_RE = re.compile(r"[^a-z0-9]+")

# 12 hour clock, e.g. "8pm", "8 pm", "8:30pm", "08:30 PM"
_ABS_TIME_12H = re.compile(
    r"^(?P<hour>\d{1,2})(?::(?P<minute>\d{2}))?\s*(?P<ampm>am|pm)$",
    re.IGNORECASE,
)
# 24 hour clock, e.g. "20:00", "8:00"
_ABS_TIME_24H = re.compile(r"^(?P<hour>\d{1,2}):(?P<minute>\d{2})$")

_NUMBER_WORDS = {
    "zero": 0,
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "thirteen": 13,
    "fourteen": 14,
    "fifteen": 15,
    "sixteen": 16,
    "seventeen": 17,
    "eighteen": 18,
    "nineteen": 19,
    "twenty": 20,
}

_ORDINAL_WORDS = {
    "first": 1,
    "second": 2,
    "third": 3,
    "fourth": 4,
    "fifth": 5,
    "sixth": 6,
    "seventh": 7,
    "eighth": 8,
    "ninth": 9,
    "tenth": 10,
}

#: Jaccard overlap between two titles above which they are treated as the same
#: task. "buy milk" vs "buy milk and bread" scores 0.67; two genuinely different
#: tasks sharing one word score far lower.
SIMILAR_TITLE_THRESHOLD = 0.6


def slugify(value: str) -> str:
    """Lowercase ASCII slug suitable for building entity ids."""
    slug = _SLUG_RE.sub("_", str(value).lower()).strip("_")
    return slug or "task"


def normalize_word(value: str) -> str:
    """Normalize text for fuzzy comparisons (casefold, trim, collapse spaces)."""
    return " ".join(str(value).casefold().replace("_", " ").split())


def title_key(title: str) -> str:
    """Reduce a title to a comparable key: lowercase, no punctuation, one-spaced."""
    return " ".join("".join(c if c.isalnum() else " " for c in title.lower()).split())


def title_tokens(title: str) -> set[str]:
    return set(title_key(title).split())


def find_similar(items: Iterable[Any], title: str, *, name_attr: str = "name") -> Any | None:
    """Return the item whose name looks like ``title``, if any.

    Only *similar* names count. Two different things that happen to share a word
    ("buy milk" / "buy bread") are not the same, so a match needs either
    identical keys or a clear overlap.
    """
    key = title_key(title)
    if not key:
        return None
    wanted = title_tokens(title)

    best = None
    best_score = 0.0
    for item in items:
        existing_key = title_key(getattr(item, name_attr, None) or item.get(name_attr, "") or "")
        if not existing_key:
            continue
        if existing_key == key:
            return item
        existing = title_tokens(existing_key)
        if not wanted or not existing:
            continue
        score = len(wanted & existing) / len(wanted | existing)
        if score >= SIMILAR_TITLE_THRESHOLD and score > best_score:
            best, best_score = item, score
    return best


def parse_spoken_number(value: Any) -> int | None:
    """Parse a spoken or numeric value (`two`, `second`, `3`, 30.0) into an int.

    Slot lists backed by a numeric `range:` deliver real numbers (e.g. 30.0)
    rather than strings, so both shapes must be accepted.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value) if value >= 0 else None

    text = str(value or "").strip().lower()
    if not text:
        return None
    try:
        number = int(float(text))
    except ValueError:
        pass
    else:
        return number if number >= 0 else None
    if text in _NUMBER_WORDS:
        return _NUMBER_WORDS[text]
    if text in _ORDINAL_WORDS:
        return _ORDINAL_WORDS[text]
    return None


def parse_time_text(value: str) -> dtime | None:
    """Parse a free-form time string (`8pm`, `8:30 am`, `20:00`) into a time."""
    text = str(value or "").strip()
    if not text:
        return None

    if match := _ABS_TIME_12H.match(text):
        hour = int(match.group("hour"))
        minute = int(match.group("minute") or 0)
        ampm = match.group("ampm").lower()
        if hour < 1 or hour > 12 or minute > 59:
            return None
        if ampm == "pm" and hour != 12:
            hour += 12
        elif ampm == "am" and hour == 12:
            hour = 0
        return dtime(hour, minute)

    if match := _ABS_TIME_24H.match(text):
        hour = int(match.group("hour"))
        minute = int(match.group("minute"))
        if hour > 23 or minute > 59:
            return None
        return dtime(hour, minute)

    return None


#: Weekday words, `date.weekday()` order. A recogniser returns the short forms
#: just as often as the long ones, so both are accepted.
_WEEKDAYS = {
    "monday": 0,
    "mon": 0,
    "tuesday": 1,
    "tue": 1,
    "tues": 1,
    "wednesday": 2,
    "wed": 2,
    "thursday": 3,
    "thu": 3,
    "thur": 3,
    "thurs": 3,
    "friday": 4,
    "fri": 4,
    "saturday": 5,
    "sat": 5,
    "sunday": 6,
    "sun": 6,
}

_MONTHS = {
    "january": 1,
    "jan": 1,
    "february": 2,
    "feb": 2,
    "march": 3,
    "mar": 3,
    "april": 4,
    "apr": 4,
    "may": 5,
    "june": 6,
    "jun": 6,
    "july": 7,
    "jul": 7,
    "august": 8,
    "aug": 8,
    "september": 9,
    "sep": 9,
    "sept": 9,
    "october": 10,
    "oct": 10,
    "november": 11,
    "nov": 11,
    "december": 12,
    "dec": 12,
}

#: `2026-10-25` and `2026/10/25`: the shape an LLM writes when the user gave a
#: full date, and the one a recogniser never produces on its own.
_ISO_DAY_RE = re.compile(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$")

#: `21`, `21st`, `3rd`. The suffix is optional because a model drops it.
_DAY_NUMBER_RE = re.compile(r"^(\d{1,2})(?:st|nd|rd|th)?$")

#: Words that carry the sentence rather than the date.
_DAY_NOISE = frozenset({"the", "of", "on", "a", "an"})

#: How far ahead "in N days/weeks" may reach. Beyond this the spoken number is
#: more likely a misrecognition than an intention.
_MAX_DAYS_AHEAD = 400


def _days_in_month(year: int, month: int) -> int:
    """Length of a month, without importing `calendar` for one subtraction."""
    following = date(year + (1 if month == 12 else 0), month % 12 + 1, 1)
    return (following - date(year, month, 1)).days


def _clamp_day(year: int, month: int, day: int) -> date:
    """A date in that month, with the day pulled back to the month's last one."""
    return date(year, month, min(day, _days_in_month(year, month)))


def _next_month(year: int, month: int) -> tuple[int, int]:
    """The month after the given one, rolling the year over."""
    return (year + 1, 1) if month == 12 else (year, month + 1)


def _resolve_month_day(day_number: int, month_number: int | None, today: date) -> date | None:
    """The next calendar day matching a day-of-month, rolling forward.

    A day that has already passed this year means next year: "the 21st of
    October" said in November is a future booking, never a retroactive one. A
    bare day number rolls to the next month, and a month that has no such day
    (the 31st of September) is skipped rather than clamped — the user named a
    day, not a compromise.
    """
    if month_number is not None:
        year = today.year
        for _ in range(2):
            if day_number <= _days_in_month(year, month_number):
                candidate = date(year, month_number, day_number)
                if candidate >= today:
                    return candidate
            year += 1
        return None

    year, month = today.year, today.month
    for _ in range(13):
        if day_number <= _days_in_month(year, month):
            candidate = date(year, month, day_number)
            if candidate >= today:
                return candidate
        year, month = _next_month(year, month)
    return None


def parse_day_text(value: str, *, today: date) -> date | None:
    """Resolve a spoken or written day against today.

    The sentence templates pass `day` through as a wildcard, so this is the only
    thing between "add a haircut on friday" and a wrong answer. It accepts, in
    order: ``today``/``tomorrow``/``yesterday`` and the day after tomorrow; a
    weekday (``friday``, ``fri``), optionally preceded by ``next``; a relative
    span (``in 3 days``, ``in two weeks``, ``next week``, ``next month``); an ISO
    date (``2026-10-25``); and a day with or without a month (``21 october``,
    ``october 21``, ``the 21st of october``, ``the 21st``).

    Ambiguity always resolves forward — the next occurrence, never the past —
    because a day that has already gone is not what someone scheduling something
    means. Anything else returns ``None`` so the caller can say it did not
    understand rather than booking the wrong day.
    """
    text = normalize_word(value)
    if not text:
        return None

    if text in {"today", "this day", "now"}:
        return today
    if text in {"tomorrow", "tomorow", "next day"}:
        return today + timedelta(days=1)
    if text in {"the day after tomorrow", "day after tomorrow"}:
        return today + timedelta(days=2)
    if text in {"yesterday", "todays ago"}:
        return today - timedelta(days=1)
    if text == "day before yesterday":
        return today - timedelta(days=2)

    words = text.split()

    # A weekday, with or without a qualifier in front of it. "friday" today is
    # today; "next friday" is the one a week later.
    if len(words) == 1 and words[0] in _WEEKDAYS:
        return today + timedelta(days=(_WEEKDAYS[words[0]] - today.weekday()) % 7)
    if len(words) == 2 and words[1] in _WEEKDAYS and words[0] in {"next", "this", "coming"}:
        ahead = (_WEEKDAYS[words[1]] - today.weekday()) % 7
        return today + timedelta(days=ahead + (7 if words[0] == "next" else 0))

    # Fixed relative words.
    if text in {"next week", "in a week", "in one week"}:
        return today + timedelta(days=7)
    if text in {"next month", "in a month", "in one month"}:
        year, month = _next_month(today.year, today.month)
        return _clamp_day(year, month, today.day)
    if text in {"in a fortnight", "in two weeks"}:
        return today + timedelta(days=14)

    # "in three days" / "in 2 weeks": the number is shared with the minutes slot.
    if len(words) == 3 and words[0] == "in" and words[2] in {"day", "days", "week", "weeks"}:
        count = parse_spoken_number(words[1])
        if count and count > 0:
            days = count * (7 if words[2].startswith("week") else 1)
            if days <= _MAX_DAYS_AHEAD:
                return today + timedelta(days=days)

    # An ISO date is what a model produces when the user gave a full date.
    if match := _ISO_DAY_RE.match(text):
        try:
            return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
        except ValueError:
            return None

    # A day number, optionally with a month name in either order.
    day_number: int | None = None
    month_number: int | None = None
    for word in words:
        if word in _DAY_NOISE:
            continue
        if word in _MONTHS:
            month_number = _MONTHS[word]
            continue
        if match := _DAY_NUMBER_RE.match(word):
            day_number = int(match.group(1))

    if day_number is not None and 1 <= day_number <= 31:
        return _resolve_month_day(day_number, month_number, today)
    if month_number is not None:
        # "in october" with no day: the first of the month is the only honest
        # reading, and it is easy to correct out loud.
        return _resolve_month_day(1, month_number, today)
    return None


def as_list(value: Any, cast: type = str) -> list:
    """Coerce a value (list, tuple, set, comma string, single item) to a list."""
    if value is None:
        return []
    if isinstance(value, str):
        parts = [part.strip() for part in value.split(",") if part.strip()]
        return [cast(part) for part in parts]
    if isinstance(value, (list, tuple, set)):
        return [cast(item) for item in value]
    return [cast(value)]


def slot_value(slots: Mapping[str, Any], name: str) -> Any:
    """Return a slot's spoken value.

    Home Assistant wraps every slot as ``{"value": ..., "text": ...}`` (see
    `IntentHandler._slot_schema`), so handlers must not assume plain strings.
    """
    slot = slots.get(name)
    if isinstance(slot, Mapping):
        slot = slot.get("value", slot.get("text"))
    return slot


def slot_text(slots: Mapping[str, Any], name: str) -> str:
    """Return a slot's value as trimmed text ("" when absent)."""
    value = slot_value(slots, name)
    return "" if value is None else str(value).strip()


def local_now() -> datetime:
    """Local wall-clock time as a naive datetime.

    Imported locally so this module stays stdlib-only; callers that already have
    `dt_util` should pass their own value instead.
    """
    from homeassistant.util import dt as dt_util  # noqa: PLC0415

    return dt_util.now().replace(tzinfo=None)


def default_calendar_id(
    calendars: Iterable[Mapping[str, Any]], configured: str | None = None
) -> str | None:
    """The calendar an event goes to when the user named none.

    The order is the order a person can express the choice in: the calendar
    chosen in the integration's options, then the one TaskTick itself marks
    default, then the first calendar that will take a write.

    Read-only calendars are skipped at every step rather than only reported:
    a configured calendar that was later deleted, or turned into a subscribed
    feed, would otherwise fail at the server with a message about nothing the
    user can see.
    """
    writable = [calendar for calendar in calendars if not calendar.get("readOnly")]
    if configured:
        for calendar in writable:
            if calendar.get("id") == configured:
                return configured
    for calendar in writable:
        if calendar.get("isDefault"):
            return str(calendar["id"])
    return str(writable[0]["id"]) if writable else None
