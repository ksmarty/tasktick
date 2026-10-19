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


def parse_day_text(value: str, *, today: date) -> date | None:
    """Resolve a spoken day word against today.

    Deliberately tiny: the sentence lists offer "today" and "tomorrow", so
    anything else is a misrecognition and returning ``None`` lets the caller say
    so rather than silently scheduling for the wrong day.
    """
    text = normalize_word(value)
    if text in {"today", "this day"}:
        return today
    if text in {"tomorrow", "tomorow", "next day"}:
        return today + timedelta(days=1)
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
