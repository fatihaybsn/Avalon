from dataclasses import replace
from types import SimpleNamespace

from typesafe_computer_use.config import SITES
from typesafe_computer_use.decide import (
    Decision,
    base_state,
    can_type_focused_field,
    decide,
    item_criteria,
    kind_criteria,
    offscreen_criteria,
    site_criteria,
)
from typesafe_computer_use.models import AxNode, Field, Item


def answer(choice, confidence, probabilities=None):
    return SimpleNamespace(choice=choice, confidence=confidence, probabilities=probabilities or {choice: confidence})


def test_decision_click_uses_item_and_min_confidence():
    d = Decision(kind=answer("click_item", 0.9), item=answer("12", 0.6), site=answer("none", 1.0))
    assert d.clicking and d.chosen == "12" and d.confidence == 0.6 and not d.stops


def test_decision_fixed_action_ignores_item():
    d = Decision(kind=answer("use_browser", 0.8), item=answer("3", 0.1), site=answer("github", 0.9))
    assert not d.clicking and d.chosen == "use_browser" and d.confidence == 0.8


def test_decision_use_browser_ignores_a_split_site_answer():
    d = Decision(kind=answer("use_browser", 0.88), item=None, site=answer("other", 0.45))
    assert d.chosen == "use_browser" and d.confidence == 0.88


def test_decision_stops_on_done_or_none():
    assert Decision(kind=answer("done", 0.9), item=None, site=answer("none", 1)).stops
    assert Decision(kind=answer("none", 0.9), item=None, site=answer("none", 1)).stops


def test_decision_press_offscreen_uses_the_offscreen_answer_and_min_confidence():
    d = Decision(kind=answer("press_offscreen", 0.9), item=answer("3", 0.9), site=answer("none", 1.0), offscreen=answer("7", 0.5))
    assert d.pressing_offscreen and not d.clicking and d.chosen == "offscreen:7" and d.confidence == 0.5


def test_decision_ignores_an_offscreen_answer_for_any_other_kind():
    d = Decision(kind=answer("click_item", 0.9), item=answer("3", 0.8), site=answer("none", 1.0), offscreen=answer("7", 0.1))
    assert not d.pressing_offscreen and d.chosen == "3" and d.confidence == 0.8


def test_kind_criteria_offers_press_offscreen_only_when_there_are_offscreen_controls():
    assert "press_offscreen" not in kind_criteria("Google Chrome", None)
    assert "press_offscreen" in kind_criteria("Google Chrome", None, offscreen=True)


def test_offscreen_criteria_and_state_name_the_role_and_say_it_is_not_visible(screen, make_item):
    nodes = [
        AxNode(role="AXLink", label="Register Now", x=0.0, y=-4200.0, w=120.0, h=32.0, pressable=True),
        AxNode(role="AXRow", label="Note 900", x=0.0, y=42718.0, w=280.0, h=68.0, pressable=True),
    ]
    assert offscreen_criteria(nodes) == {
        "0": "link 'Register Now' (not visible)",
        "1": "cell 'Note 900' (not visible)",
    }
    live = replace(screen, offscreen=nodes)
    state = base_state("buy the thing", live, [make_item(0, "Buy")], [])
    assert state["offscreen_controls"] == [
        {"k": 0, "role": "link", "label": "Register Now"},
        {"k": 1, "role": "cell", "label": "Note 900"},
    ]
    assert "offscreen_controls" not in base_state("buy the thing", screen, [make_item(0, "Buy")], [])


def test_refused_offscreen_control_is_not_offered_again_and_keeps_original_keys(screen, make_item):
    nodes = [
        AxNode(role="AXRow", label="Record 40", x=0.0, y=4000.0, w=120.0, h=32.0, pressable=True),
        AxNode(role="AXRow", label="Record 41", x=0.0, y=4100.0, w=120.0, h=32.0, pressable=True),
    ]
    history = ["press_offscreen refused: 'Record 41' did not accept the press"]
    assert offscreen_criteria(nodes, history) == {"0": "cell 'Record 40' (not visible)"}
    live = replace(screen, offscreen=nodes)
    state = base_state("select Record 40", live, [make_item(0, "Confirm")], history)
    assert state["offscreen_controls"] == [{"k": 0, "role": "cell", "label": "Record 40"}]
    assert "offscreen_controls" not in base_state("select Record 41", live, [make_item(0, "Confirm")], history)


def test_completed_offscreen_control_is_not_offered_again():
    nodes = [
        AxNode(role="AXMenuItem", label="Validate", x=0, y=-100, w=80, h=30, pressable=True),
        AxNode(role="AXMenuItem", label="Archive preview", x=0, y=-100, w=80, h=30, pressable=True),
    ]
    history = ["clicked 'Validate' (accessibility press did not take)"]
    assert offscreen_criteria(nodes, history) == {"1": "other 'Archive preview' (not visible)"}


def test_refused_hidden_goal_target_blocks_later_submit_until_visible(screen):
    hidden = AxNode(role="AXRow", label="Record 50 — LST-811", x=0, y=4000, w=120, h=32, pressable=True)
    confirm = Item(0, "Confirm selection", 1.0, 10, 10, 110, 40, role="button", source="ax")
    live = replace(screen, offscreen=[hidden])
    history = ["press_offscreen refused: 'Record 50 — LST-811' did not accept the press"]
    goal = "Select Record 50 — LST-811 and click Confirm selection"
    assert item_criteria(live, [confirm], goal, history) == {}


def test_refused_offscreen_target_stays_unfinished_when_it_becomes_visible(screen):
    target = Item(0, "Record 50 — LST-811", 1.0, 10, 10, 210, 40, role="row", source="ax")
    confirm = Item(1, "Confirm selection", 1.0, 240, 10, 390, 40, role="button", source="ax")
    history = ["press_offscreen refused: 'Record 50 — LST-811' did not accept the press"]
    goal = "Select Record 50 — LST-811 and click Confirm selection"
    assert set(item_criteria(screen, [target, confirm], goal, history)) == {"0"}


def test_kind_criteria_offers_one_browser_action():
    crit = kind_criteria("Google Chrome", None)
    assert "use_browser" in crit
    assert "switch_to_browser" not in crit and "open_site" not in crit
    assert "Google Chrome" in crit["use_browser"] and "address bar" in crit["use_browser"]


def test_site_criteria_covers_the_catalog_a_site_outside_it_and_no_site():
    crit = site_criteria()
    assert crit["github"] == SITES["github"]
    assert "not one of the sites named in this list" in crit["other"]
    assert "already open" in crit["none"]


def test_kind_criteria_offers_email_only_when_set():
    assert "type_email" not in kind_criteria("Google Chrome", None)
    assert "type_email" in kind_criteria("Google Chrome", "user@example.com")
    assert "click_item" in kind_criteria("Google Chrome", None)


def test_item_criteria_and_state_carry_region_and_dates(screen, make_item):
    items = [make_item(0, "Sale ends Oct 1, 2099", y1=100, y2=130), make_item(1, "Buy", y1=140, y2=170)]
    crit = item_criteria(screen, items)
    assert crit["0"].startswith("'Sale ends Oct 1, 2099' (top-left; dated 2099-10-01")
    assert "near a line dated 2099-10-01" in crit["1"]
    state = base_state("buy the thing", screen, items, ["opened https://example.com/"])
    assert state["goal"] == "buy the thing"
    assert state["previous_actions"] == ["opened https://example.com/"]
    assert state["screen_items_in_reading_order"][1]["when"].startswith("near a line dated")
    assert "today" in state["now"]


def test_item_criteria_and_state_expose_control_state(screen):
    item = Item(0, "Priority", 1.0, 100, 100, 300, 140, role="field", source="ax", state=("expanded",))
    assert "state=expanded" in item_criteria(screen, [item])["0"]
    assert base_state("choose Low", screen, [item], [])["screen_items_in_reading_order"][0]["state"] == ["expanded"]


def test_item_criteria_omits_selected_and_expanded_controls_when_progress_choices_exist(screen):
    items = [
        Item(0, "Priority", 1.0, 10, 10, 110, 40, role="field", source="ax", state=("expanded",)),
        Item(1, "Low", 1.0, 10, 50, 110, 80, role="row", source="ax"),
        Item(2, "Mavi", 1.0, 10, 90, 110, 120, role="row", source="ax", state=("selected",)),
    ]
    assert set(item_criteria(screen, items)) == {"1"}


def test_item_criteria_explains_unselected_required_control(screen):
    normal = Item(0, "Normal", 1.0, 10, 10, 110, 40, role="radio", source="ax", state=("unselected",))
    assert "choose it before submitting" in item_criteria(screen, [normal])["0"]


def test_item_criteria_hides_completed_launcher_when_later_goal_controls_appear(screen):
    items = [
        Item(0, "Start safe update", 1.0, 10, 10, 110, 40, role="button", source="ax"),
        Item(1, "Current package C", 1.0, 10, 50, 110, 80, role="button", source="ax"),
        Item(2, "Finish current update", 1.0, 10, 90, 110, 120, role="button", source="ax"),
    ]
    history = ["clicked 'Start safe update' (accessibility press did not take)"]
    goal = "Click Start safe update, select Current package C, and click Finish current update."
    assert set(item_criteria(screen, items, goal, history)) == {"1"}


def test_item_criteria_keeps_a_repeated_control_when_no_later_named_control_exists(screen):
    next_button = Item(0, "Next", 1.0, 10, 10, 110, 40, role="button", source="ax")
    history = ["clicked 'Next' (accessibility press did not take)"]
    assert set(item_criteria(screen, [next_button], "Click Next twice", history)) == {"0"}


def test_item_criteria_prefers_accessibility_control_over_duplicate_ocr_label(screen):
    items = [
        Item(0, "Department", 1.0, 10, 10, 110, 40, source="ocr"),
        Item(1, "Department", 1.0, 10, 50, 110, 80, role="field", source="ax", state=("collapsed",)),
    ]
    assert set(item_criteria(screen, items)) == {"1"}


def test_item_criteria_exposes_only_earliest_named_control_after_progress(screen):
    items = [
        Item(0, "Department", 1.0, 10, 10, 110, 40, role="field", source="ax", state=("collapsed",)),
        Item(1, "Normal", 1.0, 10, 50, 110, 80, role="radio", source="ax", state=("unselected",)),
        Item(2, "o Verify details", 1.0, 10, 90, 110, 120, role="checkbox", source="ax", state=("unchecked",)),
        Item(3, "Complete order", 1.0, 10, 130, 110, 160, role="button", source="ax"),
    ]
    goal = "Enter order code FRM-318, choose Department Finance, select Normal, check Verify details, and click Complete order."
    history = ["typed 'FRM-318' into 'Order code' via accessibility (verified 0.98)"]
    assert set(item_criteria(screen, items, goal, history)) == {"0"}


def test_item_criteria_exposes_only_earliest_named_control_at_start(screen):
    items = [
        Item(0, "Operations", 1.0, 10, 10, 110, 40, role="menu", source="ax"),
        Item(1, "Details", 1.0, 10, 50, 110, 80, role="tab", source="ax"),
        Item(2, "Apply workspace action", 1.0, 10, 90, 210, 120, role="button", source="ax"),
    ]
    goal = "Open the Operations menu. Then switch to Details and click Apply workspace action."
    assert set(item_criteria(screen, items, goal, [])) == {"0"}


def test_item_criteria_matches_select_button_by_goal_entity_name(screen):
    items = [
        Item(0, "Select Kestane", 1.0, 10, 10, 160, 40, role="button", source="ax"),
        Item(1, "Priority", 1.0, 10, 50, 160, 80, role="field", source="ax", state=("collapsed",)),
        Item(2, "Save selected row", 1.0, 10, 90, 200, 120, role="button", source="ax"),
    ]
    goal = "In the record table select the row named Kestane, set Priority to High, and click Save selected row."
    assert set(item_criteria(screen, items, goal, [])) == {"0"}


def test_type_text_is_suppressed_after_the_same_focused_field_was_filled(screen):
    filled = Field("AXTextField", "Visual code", "", "V67683", 10, 10, 200, 30)
    live = replace(screen, field=filled)
    history = ["typed 'V67683' into 'Visual code' via accessibility (verified 0.85)"]
    assert not can_type_focused_field(live, history)
    assert "type_text" not in kind_criteria("Google Chrome", None, can_type_text=False)


def test_nonempty_prefilled_field_can_still_be_changed_when_this_run_did_not_fill_it(screen):
    filled = Field("AXTextField", "Title", "", "draft", 10, 10, 200, 30)
    assert can_type_focused_field(replace(screen, field=filled), [])


def test_decision_prompt_advances_after_a_completed_step(screen, make_item):
    captured = {}

    class Client:
        def system_one(self, *, state, questions):
            captured["state"] = state
            captured["questions"] = questions
            return SimpleNamespace(
                answers={
                    "kind": answer("click_item", 0.9),
                    "item": answer("1", 0.9),
                    "site": answer("none", 1.0),
                }
            )

    history = ["clicked 'Start safe update' (accessibility press did not take)"]
    items = [make_item(0, "Start safe update"), make_item(1, "Current package C")]
    decide(Client(), "Start, then select Current package C", screen, items, history, "Google Chrome", None)
    assert captured["state"]["previous_actions"] == history
    assert "continue forward" in captured["questions"]["kind"].instructions
    assert "prefer the later required control" in captured["questions"]["item"].instructions


def test_named_button_removes_ambiguous_enter_alternative(screen, make_item):
    captured = {}

    class Client:
        def system_one(self, *, state, questions):
            captured["questions"] = questions
            return SimpleNamespace(
                answers={
                    "kind": answer("click_item", 0.9),
                    "item": answer("0", 0.9),
                    "site": answer("none", 1.0),
                }
            )

    confirm = replace(make_item(0, "Confirm selection"), role="button", source="ax")
    decide(Client(), "Select the row and click Confirm selection", screen, [confirm], [], "Google Chrome", None)
    assert "press_enter" not in captured["questions"]["kind"].criteria


def test_only_remaining_named_control_removes_unrelated_action_kinds(screen, make_item):
    captured = {}

    class Client:
        def system_one(self, *, state, questions):
            captured["questions"] = questions
            return SimpleNamespace(
                answers={
                    "kind": answer("click_item", 1.0),
                    "item": answer("0", 1.0),
                    "site": answer("none", 1.0),
                }
            )

    priority = replace(make_item(0, "Priority"), role="field", source="ax", state=("collapsed",))
    decide(
        Client(),
        "Select Mavi, set Priority to High, and Save",
        screen,
        [priority],
        ["clicked 'Select Mavi'"],
        "Google Chrome",
        None,
    )
    assert set(captured["questions"]["kind"].criteria) == {"click_item"}


def test_focused_goal_named_text_field_offers_typing_instead_of_reclick(screen, make_item):
    captured = {}

    class Client:
        def system_one(self, *, state, questions):
            captured["questions"] = questions
            return SimpleNamespace(
                answers={
                    "kind": answer("type_text", 1.0),
                    "item": answer("0", 1.0),
                    "site": answer("none", 1.0),
                }
            )

    field = Field("AXTextField", "Order code", "", "", 10, 10, 200, 30)
    live = replace(screen, field=field)
    order_code = replace(make_item(0, "Order code"), role="field", source="ax")
    decide(Client(), "Enter order code FRM-668, then click Complete order", live, [order_code], [], "Google Chrome", None)
    assert set(captured["questions"]["kind"].criteria) == {"type_text"}


def test_visible_launcher_precedes_hidden_goal_command(screen, make_item):
    captured = {}

    class Client:
        def system_one(self, *, state, questions):
            captured["questions"] = questions
            return SimpleNamespace(
                answers={
                    "kind": answer("click_item", 0.9),
                    "item": answer("0", 0.9),
                    "site": answer("none", 1.0),
                }
            )

    operations = replace(make_item(0, "Operations"), role="menu", source="ax")
    hidden = [AxNode(role="AXMenuItem", label="Validate", x=0, y=-100, w=80, h=30, pressable=True)]
    live = replace(screen, offscreen=hidden)
    decide(Client(), "Open Operations and choose Validate", live, [operations], [], "Google Chrome", None)
    assert "press_offscreen" not in captured["questions"]["kind"].criteria


def test_hidden_goal_target_precedes_visible_submit(screen, make_item):
    captured = {}

    class Client:
        def system_one(self, *, state, questions):
            captured["questions"] = questions
            return SimpleNamespace(
                answers={
                    "kind": answer("press_offscreen", 0.9),
                    "offscreen": answer("0", 0.9),
                    "site": answer("none", 1.0),
                }
            )

    confirm = replace(make_item(0, "Confirm selection"), role="button", source="ax")
    hidden = [AxNode(role="AXRow", label="Record 44 — LST-326", x=0, y=4000, w=180, h=30, pressable=True)]
    live = replace(screen, offscreen=hidden)
    decision = decide(
        Client(),
        "Select Record 44 — LST-326 and click Confirm selection",
        live,
        [confirm],
        [],
        "Google Chrome",
        None,
    )
    assert "click_item" not in captured["questions"]["kind"].criteria
    assert decision.pressing_offscreen
