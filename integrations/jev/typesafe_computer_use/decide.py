"""The TypeSafe side: state, criteria, and the one multi-Choice request."""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass

from typesafe_sdk import Choice, ChoiceAnswer, Noul, TypeSafeClient

from .config import SITES
from .dates import date_hints, now_context
from .models import AxNode, Field, Item, Screen

STOP_KINDS = ("done", "none")
OFFSCREEN_PREFIX = "offscreen:"
PRESS_OFFSCREEN = (
    "Activate a labelled control that the app exposes but that is not currently visible on screen "
    "(chosen in the offscreen question). Use when the needed control is known to exist but is "
    "scrolled out of view or not yet shown."
)


def fixed_actions(browser: str, email: str | None, can_type_text: bool = True) -> dict[str, str]:
    """Deterministic actions offered alongside click_item. Keep them mutually exclusive."""
    actions = {
        "use_browser": (
            f"Work in {browser}: bring it to the front, and open a website there if one is needed. The "
            "site question says which website, or says that the page already open there is the one to "
            "continue with. This is the only way to reach a website: never click the address bar, a URL, "
            "or a search box to get there. Works from any app, including this one."
        ),
        "press_enter": "Press Return to submit the focused form or field.",
        "press_escape": "Press Escape to dismiss a dialog, menu, or popup.",
        "scroll_down": "Scroll down to reveal more of the page.",
        "scroll_up": "Scroll up.",
        "wait": "Nothing to do yet; the screen is still loading or changing.",
        "done": "The goal is already achieved.",
        "none": "Nothing on screen or in this list helps with the goal.",
    }
    if sys.platform == "win32":
        actions["press_save"] = (
            "Use Ctrl+S to save the current document or open its Save As dialog; prefer this when the goal requires saving a document."
        )
    if can_type_text:
        actions["type_text"] = (
            "Type free text into the focused text field. A writing model composes the text from the "
            "goal and the field's label. Only valid when a text field is focused and needs content."
        )
    if email:
        actions["type_email"] = (
            "Type the user's email address into the focused text field. Use this, not type_text, "
            "whenever the field wants an email or username."
        )
    return actions


def kind_criteria(browser: str, email: str | None, offscreen: bool = False, can_type_text: bool = True) -> dict[str, str]:
    clicks = {"click_item": "Click one of the on-screen text items (chosen in the item question)."}
    if offscreen:
        clicks["press_offscreen"] = PRESS_OFFSCREEN
    return {**clicks, **fixed_actions(browser, email, can_type_text)}


def can_type_focused_field(screen: Screen, history: list[str]) -> bool:
    """Do not ask the writer to refill a field whose last successful action filled it."""
    field = screen.field
    if not field or not field.is_text:
        return False
    if not field.value or not history:
        return True
    last = history[-1]
    return not (last.startswith(("typed ", "typed email")) and "verification failed" not in last)


def _goal_label(item: Item) -> str:
    text = item.text.strip()
    if item.role in {"checkbox", "radio"}:
        text = re.sub(r"^[oO0xX✓✔☐☑●○]\s+", "", text)
    if item.role == "button":
        # Grid action buttons commonly say "Select Kestane" while the goal
        # says "select the row named Kestane". Match the entity name so this
        # required row is sequenced before Priority and Save.
        text = re.sub(r"^select\s+", "", text, flags=re.IGNORECASE)
    return " ".join(text.casefold().split())


def item_criteria(
    screen: Screen,
    items: list[Item],
    goal: str = "",
    history: list[str] | None = None,
) -> dict[str, str]:
    """Each item as one line. A role prefix marks the ones the app itself declared."""
    hints = date_hints(items, screen)

    # Re-selecting an already selected row or reopening an expanded selector
    # cannot advance the task. Keep those controls in the screen state given to
    # the model, but remove them from the actionable choice set while another
    # visible choice exists (for example, a popup option or a next-step button).
    progress_items = [it for it in items if not ({"selected", "expanded"} & set(it.state))]
    if progress_items:
        items = progress_items

    # A workflow's launch/refresh button often stays enabled after it reveals
    # the next panel. TypeSafe otherwise tends to restart the first clause of
    # the goal. Hide a control already acted on only when a different, still
    # unacted control explicitly named in the same goal is now visible. This
    # preserves legitimate repeated controls such as a lone Next button.
    history = history or []
    # A refused off-screen press records the target label in history, but it did
    # not complete that step. When scrolling later reveals the same target, it
    # must remain actionable and must still precede a later submit button.
    completed_history = [action for action in history if not action.startswith("press_offscreen refused:")]
    acted = {it.index for it in items if any(repr(it.text) in action for action in completed_history)}
    goal_folded = goal.casefold()

    # If a goal-named off-screen control refused its direct accessibility
    # action, later submit controls must wait until scrolling makes that target
    # visible. Otherwise a visible Confirm/Save button can win merely because
    # the earlier required row is temporarily absent from the viewport.
    refused_positions = [
        goal_folded.find(node.label.casefold())
        for node in screen.offscreen
        if _offscreen_refused(node, history) and node.label.casefold() in goal_folded
    ]
    if refused_positions:
        blocker = min(refused_positions)
        visible_blocker = any(
            item.from_ax and _goal_label(item) and goal_folded.find(_goal_label(item)) == blocker for item in items
        )
        if not visible_blocker:
            items = [
                item
                for item in items
                if not (item.from_ax and _goal_label(item) and goal_folded.find(_goal_label(item)) > blocker)
            ]
    later_goal_controls = [
        it
        for it in items
        if it.index not in acted and len(it.text.strip()) > 2 and it.text.casefold() in goal_folded and it.from_ax
    ]
    if acted and later_goal_controls:
        items = [it for it in items if it.index not in acted]

    # OCR commonly contributes a second copy of a labelled accessibility
    # control (for example a plain ``Department`` beside the real combo box).
    # Giving both copies to a probability splitter dilutes an otherwise clear
    # target and can make a safe action fall below the execution threshold.
    # Prefer the accessibility-backed copy because it has a reliable action.
    ax_labels = {_goal_label(it) for it in items if it.from_ax and _goal_label(it)}
    items = [it for it in items if it.from_ax or _goal_label(it) not in ax_labels]

    # Once a workflow has made progress, expose only the earliest remaining
    # accessibility control whose label is quoted by the goal. This is a
    # deterministic sequencing constraint, not a confidence override: Jev
    # still chooses the action kind and target, but it no longer has to split
    # probability across later submit buttons that are not valid yet.
    named: list[tuple[int, Item]] = []
    for item in items:
        label = _goal_label(item)
        if not item.from_ax or not label or item.index in acted:
            continue
        position = goal_folded.find(label)
        if position >= 0:
            named.append((position, item))
    if named:
        first_position = min(position for position, _ in named)
        first = [item for position, item in named if position == first_position]
        if len(first) == 1:
            items = first

    def state_hint(item: Item) -> str:
        if "expanded" in item.state:
            return "expanded; choose a visible option instead of reopening"
        if "selected" in item.state:
            return "selected; already active"
        if "unselected" in item.state:
            return "unselected; choose it before submitting when the goal requires it"
        if "checked" in item.state:
            return "checked; already on"
        return ",".join(item.state)

    return {
        str(it.index): (
            f"{it.role + ' ' if it.from_ax and it.role else ''}{it.text!r} "
            f"({screen.region(it)}{'; ' + hints[it.index] if it.index in hints else ''}"
            f"{'; state=' + state_hint(it) if it.state else ''})"
        )
        for it in items
    }


def _offscreen_refused(node: AxNode, history: list[str]) -> bool:
    return any(action.startswith("press_offscreen refused:") and repr(node.label) in action for action in history)


def _offscreen_completed(node: AxNode, history: list[str]) -> bool:
    return any(action.startswith(("clicked ", "pressed ")) and repr(node.label) in action for action in history)


def _goal_offscreen_refused(nodes: list[AxNode], goal: str, history: list[str]) -> bool:
    goal_folded = goal.casefold()
    return any(_offscreen_refused(node, history) and node.label.casefold() in goal_folded for node in nodes)


def offscreen_criteria(nodes: list[AxNode], history: list[str] | None = None) -> dict[str, str]:
    """Each off-screen control as one line, keyed by its position in `screen.offscreen`."""
    history = history or []
    return {
        str(i): f"{node.role_word} {node.label!r} (not visible{'; state=' + ','.join(node.state) if node.state else ''})"
        for i, node in enumerate(nodes)
        if not _offscreen_refused(node, history) and not _offscreen_completed(node, history)
    }


def offscreen_records(nodes: list[AxNode], history: list[str] | None = None) -> list[dict]:
    """The same controls as state, with the key the offscreen question answers with."""
    history = history or []
    return [
        {"k": i, "role": node.role_word, "label": node.label, **({"state": list(node.state)} if node.state else {})}
        for i, node in enumerate(nodes)
        if not _offscreen_refused(node, history) and not _offscreen_completed(node, history)
    ]


def site_criteria() -> dict[str, str]:
    """Which website use_browser opens. The catalog, plus one key for anything else and one for nothing."""
    return {
        **SITES,
        "other": "A website is needed to progress the goal, but it is not one of the sites named in this list.",
        "none": "No website needs to be opened: the page already open in the browser is the one to continue with.",
    }


def base_state(goal: str, screen: Screen, items: list[Item], history: list[str]) -> dict:
    hints = date_hints(items, screen)
    offscreen = [] if _goal_offscreen_refused(screen.offscreen, goal, history) else offscreen_records(screen.offscreen, history)
    return {
        "goal": goal,
        "now": now_context(),
        "frontmost_app": screen.app,
        "browser_active_tab_url": screen.url,
        "focused_field": screen.field.summary() if screen.field else None,
        "previous_actions": history[-8:],
        "screen_items_in_reading_order": [
            {
                "i": it.index,
                "text": it.text,
                "where": screen.region(it),
                **({"role": it.role} if it.role else {}),
                **({"state": list(it.state)} if it.state else {}),
                **({"when": hints[it.index]} if it.index in hints else {}),
            }
            for it in items
        ],
        **({"offscreen_controls": offscreen} if offscreen else {}),
    }


@dataclass(frozen=True)
class Decision:
    kind: ChoiceAnswer
    item: ChoiceAnswer | None
    site: ChoiceAnswer
    offscreen: ChoiceAnswer | None = None

    @property
    def clicking(self) -> bool:
        return self.kind.choice == "click_item" and self.item is not None

    @property
    def pressing_offscreen(self) -> bool:
        return self.kind.choice == "press_offscreen" and self.offscreen is not None

    @property
    def chosen(self) -> str:
        if self.clicking:
            return self.item.choice
        if self.pressing_offscreen:
            return f"{OFFSCREEN_PREFIX}{self.offscreen.choice}"
        return self.kind.choice

    @property
    def confidence(self) -> float:
        # Only the answers that name a target lower the confidence: a click or a press lands
        # somewhere, and the wrong somewhere is not undone. use_browser reads the site answer too,
        # but every outcome of it is a page the next step can leave, so a split there must not
        # stop the run.
        if self.clicking:
            return min(self.kind.confidence, self.item.confidence)
        if self.pressing_offscreen:
            return min(self.kind.confidence, self.offscreen.confidence)
        return self.kind.confidence

    @property
    def stops(self) -> bool:
        return self.kind.choice in STOP_KINDS


def decide(
    client: TypeSafeClient, goal: str, screen: Screen, items: list[Item], history: list[str], browser: str, email: str | None
) -> Decision:
    item_choices = item_criteria(screen, items, goal, history) if items else {}
    offscreen = {} if _goal_offscreen_refused(screen.offscreen, goal, history) else offscreen_criteria(screen.offscreen, history)
    goal_folded = goal.casefold()
    visible_positions = [
        goal_folded.find(_goal_label(item))
        for item in items
        if str(item.index) in item_choices and item.from_ax and _goal_label(item) in goal_folded
    ]
    offscreen_positions = [
        goal_folded.find(node.label.casefold())
        for index, node in enumerate(screen.offscreen)
        if str(index) in offscreen and node.label.casefold() in goal_folded
    ]
    if visible_positions and offscreen_positions and min(visible_positions) < min(offscreen_positions):
        # A hidden submenu command can be present in UIA before its visible
        # launcher is opened. Preserve the natural goal order: activate the
        # earlier visible control first, then reconsider the revealed command.
        offscreen = {}
    elif visible_positions and offscreen_positions and min(offscreen_positions) < min(visible_positions):
        # The next goal control is known to UIA but is below the viewport, while
        # a later submit control is already visible. Do not submit early. Try
        # the hidden control first; if that press is refused, the next capture
        # will remove it and scrolling becomes the available forward action.
        item_choices = {}
    kind_choices = kind_criteria(
        browser,
        email,
        bool(offscreen),
        can_type_text=can_type_focused_field(screen, history),
    )
    if not item_choices:
        kind_choices.pop("click_item", None)
    if len(item_choices) == 1:
        only_key = next(iter(item_choices))
        only_item = next((item for item in items if str(item.index) == only_key), None)
        focused_text_target = (
            only_item is not None
            and screen.field is not None
            and screen.field.is_text
            and can_type_focused_field(screen, history)
            and _goal_label(only_item) == " ".join(screen.field.label.casefold().split())
            and "type_text" in kind_choices
        )
        if focused_text_target:
            # The field already has focus, so clicking it again cannot advance
            # the workflow. Ask the host writer for the goal-provided value.
            kind_choices = {"type_text": kind_choices["type_text"]}
        elif (
            only_item is not None
            and only_item.from_ax
            and _goal_label(only_item)
            and _goal_label(only_item) in goal_folded
            and not ({"selected", "checked", "expanded"} & set(only_item.state))
        ):
            # The sequencing filter has reduced the screen to one explicit,
            # unfinished goal control. Competing fixed actions only dilute the
            # operation confidence even though none can advance this step.
            kind_choices = {"click_item": kind_choices["click_item"]}
    named_button = any(
        str(item.index) in item_choices and item.role == "button" and _goal_label(item) and _goal_label(item) in goal_folded
        for item in items
    )
    if named_button:
        kind_choices.pop("press_enter", None)
    questions = {
        "kind": Choice(
            instructions=(
                "You are driving this computer one action at a time. Which kind of action "
                "makes the most progress toward the goal right now? Do not repeat an action "
                "that was just taken unless the screen changed. Follow multi-step goals in order. "
                "When an earlier action has revealed controls named by a later part of the goal, "
                "treat that earlier action as complete and continue forward; never restart the "
                "workflow merely because its first control remains visible."
            ),
            criteria=kind_choices,
        ),
        "site": Choice(
            instructions=(
                "If the browser is used this step, which website should it show? Name a site from the "
                "list when the goal calls for that one, 'other' when the goal calls for a site the list "
                "does not name, and 'none' to stay on the page that is already open in the browser."
            ),
            criteria=site_criteria(),
        ),
    }
    if item_choices:
        questions["item"] = Choice(
            instructions=(
                "If clicking an on-screen item is the right move, which item? Items marked with a "
                "role come from the app's accessibility tree and are real controls; plain items are "
                "text read from the screen. Before choosing a complete, save, confirm, apply, verify, "
                "or other submission control, compare every visible control explicitly named in the "
                "goal with its current state and satisfy any unselected, unchecked, or empty one. A "
                "validation failure means choose the remaining requirement, not the same submission. "
                "Use previous_actions as completed steps: if a clicked control revealed later goal "
                "controls, prefer the later required control and do not click the earlier control again."
            ),
            criteria=item_choices,
        )
    if offscreen:
        questions["offscreen"] = Choice(
            instructions=(
                "If activating a control that is not on screen is the right move, which control? "
                "These are real controls of the app, reachable without the mouse, but nothing on "
                "the capture points at them."
            ),
            criteria=offscreen,
        )
    answers = client.system_one(state=base_state(goal, screen, items, history), questions=questions).answers
    return Decision(kind=answers["kind"], item=answers.get("item"), site=answers["site"], offscreen=answers.get("offscreen"))


def verify_typed(client: TypeSafeClient, goal: str, field_before: Field, typed: str, field_after: Field | None) -> float:
    """Probability that the field now holds a sensible value for its purpose."""
    state = {
        "goal": goal,
        "field": field_before.summary(),
        "text_typed": typed,
        "field_value_now": field_after.value[:300] if field_after else None,
        "field_still_focused": bool(
            field_after and field_after.role == field_before.role and field_after.label == field_before.label
        ),
    }
    question = Noul(
        instructions=(
            "Did the typing succeed: does the field now contain the typed text, and is that "
            "text a sensible value for what this field asks for, given the goal?"
        )
    )
    return client.system_one(state=state, questions={"ok": question}).answers["ok"].noul
