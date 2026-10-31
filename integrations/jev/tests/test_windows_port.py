import sys

import pytest

from typesafe_computer_use.host_writer import validate_reply


def test_host_reply_rejects_missing_fields_and_wrong_types():
    props = {"fill": {"type": "boolean"}, "text": {"type": "string"}}
    validate_reply({"fill": True, "text": "hello"}, props)
    for reply in ({"fill": True}, {"fill": "yes", "text": "hello"}, {"fill": True, "text": "x", "extra": 1}):
        with pytest.raises(ValueError):
            validate_reply(reply, props)


@pytest.mark.skipif(sys.platform != "win32", reason="Windows adapter")
def test_generated_text_cannot_be_interpreted_as_keyboard_shortcuts():
    from typesafe_computer_use.windows import escape_literal

    assert escape_literal("{Ctrl}a{Delete}") == "{{}Ctrl{}}a{{}Delete{}}"


@pytest.mark.skipif(sys.platform != "win32", reason="Windows adapter")
def test_focus_change_blocks_input(monkeypatch):
    from typesafe_computer_use import windows
    from typesafe_computer_use.models import Abort

    monkeypatch.setattr(windows, "check_abort", lambda: None)
    monkeypatch.setattr(windows, "_observed_hwnd", 1)
    monkeypatch.setattr(windows, "_foreground", lambda: 2)
    with pytest.raises(Abort, match="foreground"):
        windows._guard()


@pytest.mark.skipif(sys.platform != "win32", reason="Windows adapter")
def test_focus_window_does_not_restore_an_already_visible_window(monkeypatch):
    from typesafe_computer_use import windows

    calls = []

    class FakeUser32:
        foreground = 10

        def GetForegroundWindow(self):
            return self.foreground

        def IsIconic(self, hwnd):
            return False

        def ShowWindowAsync(self, hwnd, command):
            calls.append(("restore", hwnd, command))

        def GetWindowThreadProcessId(self, hwnd, _pid):
            return {10: 110, 20: 120}[hwnd]

        def AttachThreadInput(self, current, target, attach):
            calls.append(("attach", current, target, bool(attach)))
            return True

        def BringWindowToTop(self, hwnd):
            calls.append(("top", hwnd))

        def SetForegroundWindow(self, hwnd):
            calls.append(("foreground", hwnd))
            self.foreground = hwnd

        def SetFocus(self, hwnd):
            calls.append(("focus", hwnd))

        def keybd_event(self, *_args):
            raise AssertionError("Alt fallback should not run after successful activation")

    fake = FakeUser32()
    monkeypatch.setattr(windows, "user32", fake)
    monkeypatch.setattr(windows.kernel32, "GetCurrentThreadId", lambda: 100)

    assert windows._focus_window(20, timeout=0) is True
    assert not any(call[0] == "restore" for call in calls)
    assert ("attach", 100, 110, True) in calls
    assert ("attach", 100, 120, True) in calls
    assert ("attach", 100, 110, False) in calls
    assert ("attach", 100, 120, False) in calls


@pytest.mark.skipif(sys.platform != "win32", reason="Windows adapter")
def test_focus_window_restores_a_minimized_window(monkeypatch):
    from typesafe_computer_use import windows

    calls = []

    class FakeUser32:
        foreground = 20

        def GetForegroundWindow(self):
            return 10

        def IsIconic(self, hwnd):
            return True

        def ShowWindowAsync(self, hwnd, command):
            calls.append(("restore", hwnd, command))

        def GetWindowThreadProcessId(self, hwnd, _pid):
            return {10: 110, 20: 120}[hwnd]

        def AttachThreadInput(self, *_args):
            return False

        def BringWindowToTop(self, _hwnd):
            return None

        def SetForegroundWindow(self, _hwnd):
            return None

        def SetFocus(self, _hwnd):
            return None

        def keybd_event(self, *_args):
            return None

    monkeypatch.setattr(windows, "user32", FakeUser32())
    monkeypatch.setattr(windows.kernel32, "GetCurrentThreadId", lambda: 100)

    assert windows._focus_window(20, timeout=0) is False
    assert calls == [("restore", 20, 9)]


@pytest.mark.skipif(sys.platform != "win32", reason="Windows adapter")
def test_mcp_stop_file_and_mouse_corner_both_abort(monkeypatch, tmp_path):
    from typesafe_computer_use import windows
    from typesafe_computer_use.models import Abort

    stop = tmp_path / "STOP"
    monkeypatch.setenv("CLICKER_STOP_FILE", str(stop))
    monkeypatch.setattr(windows, "mouse_location", lambda: (0, 0))
    with pytest.raises(Abort, match="stop requested"):
        windows.check_abort()
    monkeypatch.setattr(windows, "mouse_location", lambda: (100, 100))
    windows.check_abort()
    stop.write_text("stop")
    with pytest.raises(Abort, match="stop requested"):
        windows.check_abort()


@pytest.mark.skipif(sys.platform != "win32", reason="Windows adapter")
def test_control_state_reads_selected_toggle_and_expansion(monkeypatch):
    from typesafe_computer_use import windows

    class Pattern:
        IsSelected = True
        ToggleState = windows.auto.ToggleState.On
        ExpandCollapseState = windows.auto.ExpandCollapseState.Expanded

    selected = type("Control", (), {"ControlTypeName": "ListItemControl", "GetSelectionItemPattern": lambda self: Pattern()})()
    unselected_radio = type(
        "Control",
        (),
        {"ControlTypeName": "RadioButtonControl", "GetSelectionItemPattern": lambda self: None},
    )()
    checked = type("Control", (), {"ControlTypeName": "CheckBoxControl", "GetTogglePattern": lambda self: Pattern()})()
    combo = type(
        "Control",
        (),
        {"ControlTypeName": "ComboBoxControl", "GetExpandCollapsePattern": lambda self: Pattern()},
    )()
    monkeypatch.setattr(windows, "ax_value", lambda ref: "Low")
    assert windows._control_state(selected) == ("selected",)
    assert windows._control_state(unselected_radio) == ("unselected",)
    assert windows._control_state(checked) == ("checked",)
    assert windows._control_state(combo) == ("expanded", "value=Low")


@pytest.mark.skipif(sys.platform != "win32", reason="Windows adapter")
def test_combo_arrow_duplicate_is_removed():
    from typesafe_computer_use import windows
    from typesafe_computer_use.models import AxNode

    combo = AxNode("AXComboBox", "Priority", 100, 100, 300, 40, True)
    arrow = AxNode("AXButton", "Aç", 380, 102, 18, 36, True)
    save = AxNode("AXButton", "Save", 100, 200, 100, 40, True)
    assert windows._without_combo_arrow_duplicates([combo, arrow, save]) == [combo, save]


@pytest.mark.skipif(sys.platform != "win32", reason="Windows adapter")
def test_combo_without_expand_pattern_uses_guarded_pixel_fallback(monkeypatch):
    from typesafe_computer_use import windows

    combo = type(
        "Control",
        (),
        {
            "ControlTypeName": "ComboBoxControl",
            "GetExpandCollapsePattern": lambda self: None,
            "ProcessId": 42,
        },
    )()
    monkeypatch.setattr(windows, "_target_guard", lambda ref: None)
    assert windows.ax_press(combo) is False


@pytest.mark.skipif(sys.platform != "win32", reason="Windows adapter")
def test_invoke_control_uses_guarded_physical_click(monkeypatch):
    from typesafe_computer_use import windows

    class Pattern:
        def Invoke(self):
            raise AssertionError("synchronous Invoke must not run")

    control = type(
        "Control",
        (),
        {
            "ControlTypeName": "ButtonControl",
            "GetExpandCollapsePattern": lambda self: None,
            "GetInvokePattern": lambda self: Pattern(),
            "ProcessId": 42,
        },
    )()
    monkeypatch.setattr(windows, "_target_guard", lambda ref: None)
    assert windows.ax_press(control) is False


@pytest.mark.skipif(sys.platform != "win32", reason="Windows adapter")
def test_offscreen_list_item_scrolls_into_view_before_selection(monkeypatch):
    from typesafe_computer_use import windows

    calls = []

    class ScrollPattern:
        def ScrollIntoView(self):
            calls.append("scroll")

    class SelectionPattern:
        def Select(self):
            calls.append("select")

    control = type(
        "Control",
        (),
        {
            "ControlTypeName": "ListItemControl",
            "GetExpandCollapsePattern": lambda self: None,
            "GetScrollItemPattern": lambda self: ScrollPattern(),
            "GetInvokePattern": lambda self: None,
            "GetSelectionItemPattern": lambda self: SelectionPattern(),
            "ProcessId": 42,
        },
    )()
    monkeypatch.setattr(windows, "_target_guard", lambda ref: None)
    assert windows.ax_press(control) is True
    assert calls == ["scroll", "select"]


@pytest.mark.skipif(sys.platform != "win32", reason="Windows adapter")
def test_scroll_targets_the_focused_list_row(monkeypatch):
    from types import SimpleNamespace

    from typesafe_computer_use import windows

    calls = []
    row = SimpleNamespace(role="AXRow", x=40, y=80, w=200, h=30)
    monkeypatch.setattr(windows, "_guard", lambda: None)
    monkeypatch.setattr(windows, "focused_field", lambda: row)
    monkeypatch.setattr(windows, "_scrollable_center", lambda: (400, 500))
    monkeypatch.setattr(windows, "frontmost_window_center", lambda: (999, 999))
    monkeypatch.setattr(windows.auto, "MoveTo", lambda x, y: calls.append(("move", x, y)))
    monkeypatch.setattr(windows.auto, "WheelDown", lambda count, waitTime: calls.append(("down", count, waitTime)))
    windows.scroll(-10)
    assert calls == [("move", 140, 95), ("down", 10, 0.04)]


@pytest.mark.skipif(sys.platform != "win32", reason="Windows adapter")
def test_scroll_targets_a_scrollable_control_when_focus_is_elsewhere(monkeypatch):
    from types import SimpleNamespace

    from typesafe_computer_use import windows

    calls = []
    monkeypatch.setattr(windows, "_guard", lambda: None)
    monkeypatch.setattr(windows, "focused_field", lambda: SimpleNamespace(role="AXButton"))
    monkeypatch.setattr(windows, "_scrollable_center", lambda: (300, 400))
    monkeypatch.setattr(windows, "frontmost_window_center", lambda: (999, 999))
    monkeypatch.setattr(windows.auto, "MoveTo", lambda x, y: calls.append(("move", x, y)))
    monkeypatch.setattr(windows.auto, "WheelDown", lambda count, waitTime: calls.append(("down", count, waitTime)))
    windows.scroll(-10)
    assert calls == [("move", 300, 400), ("down", 10, 0.04)]


@pytest.mark.skipif(sys.platform != "win32", reason="Windows adapter")
def test_scroll_ignores_an_offscreen_zero_size_focused_row(monkeypatch):
    from types import SimpleNamespace

    from typesafe_computer_use import windows

    calls = []
    row = SimpleNamespace(role="AXRow", x=0, y=0, w=0, h=0)
    monkeypatch.setattr(windows, "_guard", lambda: None)
    monkeypatch.setattr(windows, "focused_field", lambda: row)
    monkeypatch.setattr(windows, "_scrollable_center", lambda: (300, 400))
    monkeypatch.setattr(windows.auto, "MoveTo", lambda x, y: calls.append(("move", x, y)))
    monkeypatch.setattr(windows.auto, "WheelDown", lambda count, waitTime: calls.append(("down", count, waitTime)))
    windows.scroll(-10)
    assert calls == [("move", 300, 400), ("down", 10, 0.04)]


def test_sparse_status_change_invalidates_ocr_cache():
    from PIL import Image

    from typesafe_computer_use.perception import changed_tiles, thumbnail, tiles_in

    before = Image.new("RGB", (512, 256), "white")
    after = before.copy()
    after.paste("black", (40, 40, 64, 48))
    assert changed_tiles(thumbnail(after), thumbnail(before), tiles_in((0, 0, 512, 256)))
