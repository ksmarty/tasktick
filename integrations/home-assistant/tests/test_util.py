"""Tests for the pure helpers.

No Home Assistant: `util.py` is stdlib-only on purpose, so these run anywhere
Python does. `local_now` is the one exception and is not exercised here.
"""

from __future__ import annotations

from datetime import date, time

from custom_components.tasktick.util import (
    find_similar,
    normalize_word,
    parse_day_text,
    parse_spoken_number,
    parse_time_text,
    slot_text,
    slot_value,
    title_key,
)


class TestParseTimeText:
    def test_twelve_hour(self) -> None:
        assert parse_time_text("8pm") == time(20, 0)
        assert parse_time_text("8 pm") == time(20, 0)
        assert parse_time_text("8:30pm") == time(20, 30)
        assert parse_time_text("08:30 PM") == time(20, 30)

    def test_twelve_hour_edge_cases(self) -> None:
        # Midnight is 12am and noon is 12pm; the naive `hour + 12` gets both wrong.
        assert parse_time_text("12am") == time(0, 0)
        assert parse_time_text("12pm") == time(12, 0)

    def test_twenty_four_hour(self) -> None:
        assert parse_time_text("20:00") == time(20, 0)
        assert parse_time_text("8:00") == time(8, 0)

    def test_rejects_nonsense(self) -> None:
        for text in ("", "half past eight", "13pm", "25:00", "8:75", "tomorrow"):
            assert parse_time_text(text) is None


class TestParseDayText:
    def test_today_and_tomorrow(self) -> None:
        today = date(2026, 3, 4)
        assert parse_day_text("today", today=today) == today
        assert parse_day_text("Tomorrow", today=today) == date(2026, 3, 5)

    def test_common_misrecognition(self) -> None:
        # "tomorow" is what a recogniser plausibly returns, and rejecting it
        # would make the user repeat themselves for no reason.
        assert parse_day_text("tomorow", today=date(2026, 3, 4)) == date(2026, 3, 5)

    def test_rejects_anything_else(self) -> None:
        # Deliberately tiny: a wrong day is worse than asking again.
        assert parse_day_text("next tuesday", today=date(2026, 3, 4)) is None


class TestParseSpokenNumber:
    def test_numeric_slot_values(self) -> None:
        # A `range:` slot list delivers real numbers, not strings.
        assert parse_spoken_number(30.0) == 30
        assert parse_spoken_number("30") == 30
        assert parse_spoken_number(0) == 0

    def test_words(self) -> None:
        assert parse_spoken_number("two") == 2
        assert parse_spoken_number("second") == 2

    def test_rejects_nonsense(self) -> None:
        assert parse_spoken_number("soon") is None
        assert parse_spoken_number("") is None
        assert parse_spoken_number(-1) is None
        # `True` is an int in Python; a boolean slot must not read as 1.
        assert parse_spoken_number(True) is None


class TestSlotHelpers:
    def test_unwraps_the_value_wrapper(self) -> None:
        # Home Assistant wraps every slot as {"value": ..., "text": ...}; reading
        # it as a plain string is the bug this guards.
        slots = {"title": {"value": "buy milk", "text": "buy milk"}}
        assert slot_value(slots, "title") == "buy milk"
        assert slot_text(slots, "title") == "buy milk"

    def test_falls_back_to_text(self) -> None:
        assert slot_value({"title": {"text": "buy milk"}}, "title") == "buy milk"

    def test_missing_slot(self) -> None:
        assert slot_value({}, "title") is None
        assert slot_text({}, "title") == ""


class TestFindSimilar:
    ITEMS = [
        {"name": "take out the trash"},
        {"name": "buy milk"},
        {"name": "go for a run"},
    ]

    def test_exact(self) -> None:
        assert find_similar(self.ITEMS, "buy milk") == self.ITEMS[1]

    def test_misrecognised_word_still_matches(self) -> None:
        # The whole reason this exists: "sludder" for "sweater".
        items = [{"name": "pack a work sweater"}]
        assert find_similar(items, "pack a work sludder") == items[0]

    def test_unrelated_does_not_match(self) -> None:
        # "buy bread" shares one word with "buy milk"; that is not the same task.
        assert find_similar(self.ITEMS, "buy bread") is None

    def test_name_attr_is_configurable(self) -> None:
        tasks = [{"title": "call the dentist"}]
        assert find_similar(tasks, "call the dentist", name_attr="title") == tasks[0]


class TestNormalisation:
    def test_normalize_word(self) -> None:
        assert normalize_word("  Buy   Milk ") == "buy milk"
        assert normalize_word("Work_Stuff") == "work stuff"

    def test_title_key_strips_punctuation(self) -> None:
        assert title_key("Buy milk!") == "buy milk"
        assert title_key("Buy-milk") == "buy milk"
