"""All-day and timed event payloads, checked without Home Assistant running.

The bug these pin: a single-day event was sent with the same day as both its
start and its end. TaskTick stores the RFC 5545 *exclusive* end, so that pair is
a zero-length span — the app displayed it as an event that ended the day before
it started, and the calendar server received `DTEND == DTSTART`.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest

from ha_version import require_supported_ha

require_supported_ha()

from homeassistant.util import dt as dt_util  # noqa: E402

from custom_components.tasktick.calendar import to_event_input  # noqa: E402
from custom_components.tasktick.services import _parse_event_times  # noqa: E402


def test_a_single_day_event_ends_the_day_after_it_starts() -> None:
    """One day is a one-day span, not an empty one."""
    payload = _parse_event_times({"start": date(2026, 11, 1), "all_day": True})

    assert payload["startDate"] == "2026-11-01"
    assert payload["endDate"] == "2026-11-02"
    assert payload["isAllDay"] is True
    assert "startMs" not in payload and "endMs" not in payload


def test_a_multi_day_event_keeps_every_day_it_covers() -> None:
    """`end` names the last day covered, so the exclusive end is one past it."""
    payload = _parse_event_times(
        {"start": date(2026, 11, 1), "end": date(2026, 11, 3), "all_day": True}
    )

    assert payload["startDate"] == "2026-11-01"
    # The 1st, 2nd and 3rd — not the 1st and 2nd.
    assert payload["endDate"] == "2026-11-04"


def test_a_date_start_alone_is_an_all_day_event() -> None:
    """A date with no `all_day` flag still means a day, not a midnight instant."""
    payload = _parse_event_times({"start": date(2026, 11, 1)})

    assert payload["isAllDay"] is True
    assert payload["endDate"] == "2026-11-02"


def test_a_timed_event_keeps_its_times() -> None:
    start = dt_util.parse_datetime("2026-11-01 09:00:00")
    end = dt_util.parse_datetime("2026-11-01 10:30:00")
    payload = _parse_event_times({"start": start, "end": end})

    assert payload["startMs"] == start.timestamp() * 1000
    assert payload["endMs"] == end.timestamp() * 1000


def test_a_timed_event_without_an_end_is_a_minute_long() -> None:
    """A zero-length instant has nothing to draw and no valid DTEND."""
    start = dt_util.parse_datetime("2026-11-01 09:00:00")
    payload = _parse_event_times({"start": start})

    assert payload["endMs"] - payload["startMs"] == 60 * 1000


def test_a_datetime_is_read_as_the_day_it_falls_on() -> None:
    """A datetime in the all-day branch is still a day, not a timestamp."""
    moment = dt_util.parse_datetime("2026-11-01 23:30:00")
    payload = _parse_event_times({"start": moment, "all_day": True})

    assert payload["startDate"] == "2026-11-01"
    assert payload["endDate"] == "2026-11-02"
    assert "startMs" not in payload


def test_an_unreadable_day_is_refused() -> None:
    with pytest.raises(Exception):
        _parse_event_times({"start": "not a day", "all_day": True})


def test_home_assistant_all_day_dtend_is_already_exclusive() -> None:
    """Home Assistant hands over `dtstart` + 1 day, so it is passed through."""
    payload = to_event_input({"dtstart": date(2026, 11, 1), "dtend": date(2026, 11, 2)})

    assert payload["startDate"] == "2026-11-01"
    assert payload["endDate"] == "2026-11-02"
    assert payload["isAllDay"] is True


def test_a_single_day_dtend_becomes_a_one_day_span() -> None:
    """A caller that repeats the start day still gets a whole day."""
    payload = to_event_input({"dtstart": date(2026, 11, 1), "dtend": date(2026, 11, 1)})

    assert payload["endDate"] == "2026-11-02"


def test_a_missing_dtend_becomes_a_one_day_span() -> None:
    payload = to_event_input({"dtstart": date(2026, 11, 1)})

    assert payload["endDate"] == "2026-11-02"


def test_a_datetime_dtend_is_not_written_as_a_day() -> None:
    """`datetime` is a `date`, so the all-day branch has to exclude it."""
    payload = to_event_input(
        {"dtstart": date(2026, 11, 1), "dtend": datetime(2026, 11, 3, 9, 0)}
    )

    assert payload["endDate"] == "2026-11-02"


def test_a_timed_dtstart_without_dtend_is_an_hour() -> None:
    payload = to_event_input({"dtstart": dt_util.parse_datetime("2026-11-01 09:00:00")})

    assert payload["endMs"] - payload["startMs"] == 3_600_000


def test_the_two_mappers_agree_on_one_day() -> None:
    """Both entry points produce the same shape for the same day."""
    day = date(2026, 11, 1)
    from_service = _parse_event_times({"start": day, "all_day": True})
    from_calendar = to_event_input({"dtstart": day, "dtend": day + timedelta(days=1)})

    assert from_service["startDate"] == from_calendar["startDate"] == "2026-11-01"
    assert from_service["endDate"] == from_calendar["endDate"] == "2026-11-02"
    assert from_service["isAllDay"] is from_calendar["isAllDay"] is True
