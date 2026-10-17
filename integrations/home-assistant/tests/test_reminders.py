"""Tests for the payload handed to HA Reminders.

No Home Assistant: `reminders.py` is stdlib-only on purpose, so these run
anywhere Python does. What is worth pinning here is the agreement with the app —
the deep link TaskTick's own push notifications use, the icon that distinguishes
one of these, and the acknowledge action that calls TaskTick's own services back.
"""

from __future__ import annotations

from datetime import date, time

import pytest

from custom_components.tasktick.reminders import (
    ACKNOWLEDGE_TITLES,
    CHECK_IN_HABIT,
    COMPLETE_TASK,
    DEFAULT_ICON,
    acknowledge_actions,
    app_link,
    as_list,
    pick_target,
    reminder_payload,
    schedule_fields,
    validate_trigger,
)

ORIGIN = "https://tasks.example.com"


class TestAppLink:
    def test_task_opens_its_sheet(self) -> None:
        assert app_link(ORIGIN, "task", "t1") == "https://tasks.example.com/tasks?task=t1"

    def test_habit_opens_its_sheet(self) -> None:
        assert app_link(ORIGIN, "habit", "h1") == "https://tasks.example.com/habits?habit=h1"

    def test_event_opens_the_day_with_its_card(self) -> None:
        assert (
            app_link(ORIGIN, "event", "e1", "2026-05-12")
            == "https://tasks.example.com/calendar?date=2026-05-12&event=e1"
        )

    def test_event_without_a_day_opens_the_calendar(self) -> None:
        # The wrong date is worse than no date: the card would be off-screen and
        # the tap would look broken.
        assert app_link(ORIGIN, "event", "e1") == ORIGIN

    def test_a_trailing_slash_does_not_double_up(self) -> None:
        assert app_link(f"{ORIGIN}/", "task", "t1") == (
            "https://tasks.example.com/tasks?task=t1"
        )

    def test_an_id_with_a_slash_is_escaped(self) -> None:
        # Ids come from the app and are opaque; escaping keeps one inside its own
        # query parameter rather than inventing a path.
        link = app_link(ORIGIN, "task", "a/b c")
        assert link == "https://tasks.example.com/tasks?task=a%2Fb%20c"


class TestAcknowledgeActions:
    def test_a_task_is_completed_by_id(self) -> None:
        assert acknowledge_actions("task", "t1") == [
            {"service": COMPLETE_TASK, "data": {"task_id": "t1"}}
        ]

    def test_a_habit_is_checked_in_for_the_reminder_s_day(self) -> None:
        assert acknowledge_actions("habit", "h1", "2026-05-11") == [
            {
                "service": CHECK_IN_HABIT,
                "data": {"habit": "h1", "date": "2026-05-11"},
            }
        ]

    def test_a_habit_without_a_day_checks_in_today(self) -> None:
        assert acknowledge_actions("habit", "h1") == [
            {"service": CHECK_IN_HABIT, "data": {"habit": "h1"}}
        ]

    def test_an_event_has_nothing_to_complete(self) -> None:
        # Its button only clears the notification, which is what HA Reminders'
        # own acknowledge already does.
        assert acknowledge_actions("event", "e1", "2026-05-12") == []


class TestAsList:
    def test_one_value_becomes_a_list_of_one(self) -> None:
        assert as_list("zone.home") == ["zone.home"]

    def test_wrapping_is_not_coercion(self) -> None:
        # `list("3")` is `["3"]` only by accident; a longer value would be torn
        # into its characters.
        assert as_list("3") == ["3"]
        assert as_list("12") == ["12"]

    def test_a_list_is_left_alone(self) -> None:
        assert as_list(["a", "b"]) == ["a", "b"]


class TestPickTarget:
    FIELDS = {
        "task": "task_id",
        "habit": "habit",
        "event": "event_id",
        "date_key": "date",
    }

    def test_a_task_with_no_date(self) -> None:
        assert pick_target({"task_id": "t1"}, **self.FIELDS) == ("task", "t1", "")

    def test_a_habit_with_a_date_object(self) -> None:
        # A date selector hands over a `date`, and only the string is useful.
        assert pick_target({"habit": "h1", "date": date(2026, 5, 11)}, **self.FIELDS) == (
            "habit",
            "h1",
            "2026-05-11",
        )

    def test_an_event_needs_its_day(self) -> None:
        with pytest.raises(ValueError, match="date"):
            pick_target({"event_id": "e1"}, **self.FIELDS)

    def test_no_target_is_refused(self) -> None:
        with pytest.raises(ValueError, match="exactly one"):
            pick_target({}, **self.FIELDS)

    def test_two_targets_are_refused(self) -> None:
        # A reminder cannot complete two things from one button.
        with pytest.raises(ValueError, match="exactly one"):
            pick_target({"task_id": "t1", "habit": "h1"}, **self.FIELDS)


class TestReminderPayload:
    def test_a_task_reminder_carries_the_icon_the_link_and_the_button(self) -> None:
        payload = reminder_payload(
            origin=ORIGIN, target="task", target_id="t1", title="Take out the trash"
        )
        assert payload["title"] == "Take out the trash"
        assert payload["icon"] == DEFAULT_ICON
        assert payload["click_url"] == "https://tasks.example.com/tasks?task=t1"
        assert payload["acknowledge_actions"] == [
            {"service": COMPLETE_TASK, "data": {"task_id": "t1"}}
        ]
        assert payload["acknowledge_action_title"] == "Complete"

    def test_a_habit_is_checked_in_rather_than_finished(self) -> None:
        payload = reminder_payload(
            origin=ORIGIN, target="habit", target_id="h1", day="2026-05-11"
        )
        assert payload["acknowledge_action_title"] == "Check in"
        assert payload["click_url"] == "https://tasks.example.com/habits?habit=h1"
        assert payload["acknowledge_actions"][0]["data"]["date"] == "2026-05-11"

    def test_an_event_has_no_button_but_still_opens_its_card(self) -> None:
        payload = reminder_payload(
            origin=ORIGIN, target="event", target_id="e1", day="2026-05-12"
        )
        assert "acknowledge_actions" not in payload
        assert payload["acknowledge_action_title"] == "Dismiss"
        assert payload["click_url"] == (
            "https://tasks.example.com/calendar?date=2026-05-12&event=e1"
        )

    def test_complete_false_leaves_the_notification_with_no_button_at_all(self) -> None:
        payload = reminder_payload(
            origin=ORIGIN, target="task", target_id="t1", complete=False
        )
        assert "acknowledge_actions" not in payload
        assert "acknowledge_action_title" not in payload

    def test_an_explicit_button_title_wins(self) -> None:
        payload = reminder_payload(
            origin=ORIGIN,
            target="task",
            target_id="t1",
            acknowledge_title="All done",
        )
        assert payload["acknowledge_action_title"] == "All done"

    def test_an_explicit_icon_wins(self) -> None:
        payload = reminder_payload(
            origin=ORIGIN, target="task", target_id="t1", icon="mdi:bell"
        )
        assert payload["icon"] == "mdi:bell"

    def test_a_bare_reminder_sends_only_what_it_has(self) -> None:
        # HA Reminders drops empty strings itself; not sending them keeps an
        # absent key from looking like a deliberate blank.
        payload = reminder_payload(origin=ORIGIN, target="task", target_id="t1")
        assert "message" not in payload
        assert "notify_service" not in payload
        assert "user_name" not in payload

    def test_the_chosen_service_and_person_are_carried(self) -> None:
        payload = reminder_payload(
            origin=ORIGIN,
            target="task",
            target_id="t1",
            message="The bins go out tonight",
            notify_service="notify.mobile_app_phone",
            user_name="Kyle",
        )
        assert payload["message"] == "The bins go out tonight"
        assert payload["notify_service"] == "notify.mobile_app_phone"
        assert payload["user_name"] == "Kyle"

    def test_every_kind_of_target_has_a_button_title(self) -> None:
        for target in ("task", "habit", "event"):
            assert target in ACKNOWLEDGE_TITLES


class TestScheduleFields:
    def test_a_time_object_becomes_an_iso_string(self) -> None:
        # ha_reminders parses these as strings, and a selector hands over objects.
        fields = schedule_fields({"trigger_type": "time", "time": time(8, 30)})
        assert fields == {"trigger_type": "time", "time": "08:30:00"}

    def test_a_date_object_becomes_an_iso_string(self) -> None:
        fields = schedule_fields({"start_date": date(2026, 5, 11)})
        assert fields == {"start_date": "2026-05-11"}

    def test_a_list_field_wraps_a_single_value(self) -> None:
        fields = schedule_fields({"snooze_delays": 15})
        assert fields == {"snooze_delays": [15]}

    def test_absent_fields_are_not_sent(self) -> None:
        assert schedule_fields({}) == {}

    def test_an_unknown_key_is_not_passed_through(self) -> None:
        # The passthrough list is the whole contract; anything else this service
        # derives itself.
        assert schedule_fields({"reminder_id": "r1", "title": "nope"}) == {}

    def test_a_zero_is_kept(self) -> None:
        # `if not value` would drop a real 0; only None means "not given".
        assert schedule_fields({"every_x_days": 0}) == {"every_x_days": 0}


class TestValidateTrigger:
    def test_a_time_trigger_with_a_time_is_fine(self) -> None:
        validate_trigger({"trigger_type": "time", "time": "08:30:00"})

    def test_a_time_trigger_defaults_to_time(self) -> None:
        validate_trigger({"time": "08:30:00"})

    def test_a_time_trigger_without_a_time_is_refused(self) -> None:
        with pytest.raises(ValueError, match="needs a time"):
            validate_trigger({"trigger_type": "time"})

    def test_a_zone_trigger_needs_a_zone(self) -> None:
        with pytest.raises(ValueError, match="zone_entity_id"):
            validate_trigger({"trigger_type": "zone_enter"})

    def test_a_zone_trigger_needs_people_to_watch(self) -> None:
        with pytest.raises(ValueError, match="person_entity_ids"):
            validate_trigger({"trigger_type": "zone_enter", "zone_entity_id": "zone.home"})

    def test_a_complete_zone_trigger_is_fine(self) -> None:
        validate_trigger(
            {
                "trigger_type": "zone_leave",
                "zone_entity_id": "zone.home",
                "person_entity_ids": ["person.kyle"],
            }
        )
