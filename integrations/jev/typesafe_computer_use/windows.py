"""Windows implementation of the upstream macOS adapter contract.

Physical pixels throughout; the first port supports the primary display. Native
UIA patterns are preferred and observed pixels remain the input fallback.
"""

from __future__ import annotations

import contextlib
import ctypes
import os
import time
from ctypes import wintypes
from dataclasses import replace
from pathlib import Path

import psutil
import uiautomation as auto

from .ax_common import AX_PRESS, AxAttrs, walk_actionable
from .config import ABORT_CORNER_PX
from .models import Abort, Field

user32 = ctypes.WinDLL("user32", use_last_error=True)
user32.GetForegroundWindow.restype = wintypes.HWND
user32.GetWindow.argtypes = [wintypes.HWND, wintypes.UINT]
user32.GetWindow.restype = wintypes.HWND
user32.SetForegroundWindow.argtypes = [wintypes.HWND]
user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
user32.ShowWindowAsync.argtypes = [wintypes.HWND, ctypes.c_int]
user32.IsIconic.argtypes = [wintypes.HWND]
user32.IsIconic.restype = wintypes.BOOL
user32.BringWindowToTop.argtypes = [wintypes.HWND]
user32.SetFocus.argtypes = [wintypes.HWND]
user32.AttachThreadInput.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.BOOL]
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
kernel32.GetCurrentThreadId.restype = wintypes.DWORD
with contextlib.suppress(AttributeError, OSError):
    user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
auto.SetGlobalSearchTimeout(0.5)
_observed_hwnd = None
_target_hwnd = None
_target_pid = None

ROLES = {
    "ButtonControl": "AXButton",
    "CheckBoxControl": "AXCheckBox",
    "ComboBoxControl": "AXComboBox",
    "EditControl": "AXTextField",
    "DocumentControl": "AXTextArea",
    "HyperlinkControl": "AXLink",
    "ImageControl": "AXImage",
    "ListItemControl": "AXRow",
    "DataItemControl": "AXCell",
    "MenuItemControl": "AXMenuBarItem",
    "RadioButtonControl": "AXRadioButton",
    "SliderControl": "AXSlider",
    "TabItemControl": "AXTab",
    "TextControl": "AXStaticText",
    "WindowControl": "AXWindow",
    "PaneControl": "AXGroup",
    "GroupControl": "AXGroup",
}


def mouse_location():
    point = wintypes.POINT()
    user32.GetCursorPos(ctypes.byref(point))
    return point.x, point.y


def check_abort():
    x, y = mouse_location()
    stop_path = os.environ.get("CLICKER_STOP_FILE")
    file_stop = bool(stop_path and Path(stop_path).exists())
    corner_stop = x <= ABORT_CORNER_PX and y <= ABORT_CORNER_PX
    if file_stop or corner_stop:
        raise Abort("stop requested")


def sleep_watching(seconds):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        check_abort()
        time.sleep(min(0.1, max(0, end - time.monotonic())))


def accessibility_trusted():
    return auto.GetRootControl() is not None


def _foreground():
    return int(user32.GetForegroundWindow() or 0)


def _pid(hwnd):
    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    return pid.value


def _name(pid):
    raw = psutil.Process(pid).name()
    return {"chrome.exe": "Google Chrome", "msedge.exe": "Microsoft Edge", "notepad.exe": "Notepad"}.get(raw.lower(), raw)


def frontmost_app_and_pid():
    pid = _pid(_foreground())
    return _name(pid), pid


def frontmost_app():
    return frontmost_app_and_pid()[0]


def frontmost_pid():
    return _pid(_foreground())


def _focus_window(hwnd, timeout=3.0):
    """Activate a known top-level window despite Windows' foreground lock."""
    if _foreground() == hwnd:
        return True
    if user32.IsIconic(hwnd):
        user32.ShowWindowAsync(hwnd, 9)  # SW_RESTORE only when minimized
    current_thread = kernel32.GetCurrentThreadId()
    foreground_thread = user32.GetWindowThreadProcessId(_foreground(), None)
    target_thread = user32.GetWindowThreadProcessId(hwnd, None)
    attached = []
    try:
        for thread in {foreground_thread, target_thread}:
            if thread and thread != current_thread and user32.AttachThreadInput(current_thread, thread, True):
                attached.append(thread)
        user32.BringWindowToTop(hwnd)
        user32.SetForegroundWindow(hwnd)
        user32.SetFocus(hwnd)
    finally:
        for thread in attached:
            user32.AttachThreadInput(current_thread, thread, False)
    if _foreground() != hwnd:
        # Windows may reject foreground activation from an MCP child process.
        # A balanced Alt tap grants the standard foreground transition without
        # typing text or targeting any control.
        user32.keybd_event(0x12, 0, 0, 0)
        try:
            user32.SetForegroundWindow(hwnd)
        finally:
            user32.keybd_event(0x12, 0, 2, 0)
    if _foreground() == hwnd:
        return True
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if _foreground() == hwnd:
            return True
        time.sleep(0.05)
    return False


def _guard():
    check_abort()
    _guard_target(_foreground())
    if not _observed_hwnd or _foreground() != _observed_hwnd:
        raise Abort("foreground window changed after observation; no input sent")
    app = frontmost_app().lower()
    if any(
        word in app
        for word in (
            "powershell",
            "windowsterminal",
            "cmd.exe",
            "credential",
            "keepass",
            "bitwarden",
            "lockapp",
            "codex",
            "chatgpt",
            "sechealth",
        )
    ):
        raise Abort("this application requires host/user handling")


def pin_target():
    """Keep the selected window and its owned dialogs for this process/run."""
    global _target_hwnd, _target_pid
    _target_hwnd = _foreground()
    if not _target_hwnd:
        raise Abort("no target window")
    _target_pid = _pid(_target_hwnd)


def _guard_target(hwnd):
    if _target_hwnd is None:
        return  # standalone/replay compatibility; MCP always pins a target
    if _pid(hwnd) != _target_pid or _pid(_target_hwnd) != _target_pid:
        raise Abort("target application changed or exited; no input sent")
    candidate = hwnd
    for _ in range(8):
        if candidate == _target_hwnd:
            return
        candidate = int(user32.GetWindow(candidate, 4) or 0)  # GW_OWNER
        if not candidate:
            break
    raise Abort("foreground is outside the selected window and its owned dialogs")


def validate_capture():
    """Refuse a mixed capture if focus moved while pixels and controls were read."""
    if _foreground() != _observed_hwnd:
        raise Abort("foreground changed during capture")


def prepare_after_host(screen):
    """Return from an explicit host handoff only if the original field is unchanged."""
    if not _observed_hwnd or _pid(_observed_hwnd) != screen.pid:
        raise Abort("original target window is no longer available")
    field = screen.field
    if not field or field.ref is None or ax_value(field.ref) != field.value:
        raise Abort("target field changed while waiting for the host; inspect before retrying")
    auto.ControlFromHandle(_observed_hwnd).SetActive()
    time.sleep(0.1)
    _guard()
    if not ax_focus(field.ref):
        raise Abort("cannot restore the original field focus")


def activate(app, timeout=3.0):
    matches = []
    for control in auto.GetRootControl().GetChildren():
        try:
            if _name(control.ProcessId).lower() == app.lower() and not control.IsOffscreen:
                matches.append(control)
        except (OSError, psutil.Error):
            continue
    if frontmost_app().lower() == app.lower():
        return True
    if len(matches) != 1:
        return False
    matches[0].SetActive()
    return _focus_window(matches[0].NativeWindowHandle, timeout)


def activate_title(title):
    matches = [c for c in auto.GetRootControl().GetChildren() if c.Name == title]
    if len(matches) != 1:
        raise Abort("target title must identify exactly one open window")
    matches[0].SetActive()
    if not _focus_window(matches[0].NativeWindowHandle):
        raise Abort("target window could not be activated")


def open_url(browser, url):
    # The browser must already be uniquely selected; never silently switch profiles.
    if not activate(browser):
        return False
    if not url.startswith("https://") or any(c in url for c in "\r\n"):
        return False
    global _observed_hwnd
    _observed_hwnd = _foreground()
    _guard()
    auto.SendKeys("{Ctrl}l", waitTime=0.05)
    type_text(url)
    press("return")
    return True


def browser_url(browser):
    if frontmost_app().lower() != browser.lower():
        return None
    root = auto.ControlFromHandle(_foreground())
    for node, _depth in auto.WalkControl(root, maxDepth=6):
        if node.ControlTypeName == "EditControl":
            try:
                value = ax_value(node) or ""
                if value.startswith(("https://", "http://")) and any(s in node.Name.lower() for s in ("address", "adres", "url")):
                    return value
            except Exception:
                continue
    return None


def frontmost_window_bounds(pid=None):
    hwnd = _foreground()
    if pid is not None and _pid(hwnd) != pid:
        raise Abort("foreground changed while reading window")
    rect = wintypes.RECT()
    if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
        return None
    w, h = user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)
    if rect.right <= 0 or rect.bottom <= 0 or rect.left >= w or rect.top >= h:
        raise Abort("move the target window onto the primary monitor")
    return float(rect.left), float(rect.top), float(rect.right - rect.left), float(rect.bottom - rect.top)


def frontmost_window_center(pid=None):
    bounds = frontmost_window_bounds(pid)
    if bounds:
        x, y, w, h = bounds
        return x + w / 2, y + h / 2
    return None


def screenshot():
    global _observed_hwnd
    candidate = _foreground()
    _guard_target(candidate)  # check BEFORE replacing the observed window
    _observed_hwnd = candidate
    if not _observed_hwnd:
        raise Abort("no foreground desktop window")
    _guard()
    # Capture the selected HWND itself, never the desktop composite behind/over it.
    # Keep full-display coordinates for the upstream OCR/AX merge and input code.
    from PIL import Image

    bounds = frontmost_window_bounds()
    if not bounds:
        raise Abort("target window bounds unavailable")
    x, y, w, h = bounds
    from .windows_capture import capture_window

    capture = capture_window(_observed_hwnd, int(w), int(h))
    if max(hi - lo for lo, hi in capture.getextrema()) < 2:
        raise Abort("application did not provide a readable window capture")
    image = Image.new("RGB", (user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)), "black")
    image.paste(capture, (int(x), int(y)))
    return image


def display_scale(image):
    return 1.0


def _is_secret(ref):
    try:
        return bool(ref.IsPassword)
    except Exception:
        return True


def ax_value(ref):
    if _is_secret(ref):
        return None
    try:
        pattern = ref.GetValuePattern()
        if pattern:
            return pattern.Value
    except Exception:
        pass
    try:
        pattern = ref.GetTextPattern()
        if pattern:
            return pattern.DocumentRange.GetText(-1)
    except Exception:
        pass
    return None


def focused_field():
    ref = auto.GetFocusedControl()
    if ref is None or ref.ProcessId != frontmost_pid():
        return None
    rect = ref.BoundingRectangle
    role = "AXSecureTextField" if _is_secret(ref) else ROLES.get(ref.ControlTypeName, "AXGroup")
    return Field(
        role, ref.Name or "", ref.HelpText or "", ax_value(ref) or "", rect.left, rect.top, rect.width(), rect.height(), ref
    )


def _target_guard(ref):
    _guard()
    if ref.ProcessId != frontmost_pid() or _is_secret(ref):
        raise Abort("control is outside the observed app or is a password field")


def ax_focus(ref):
    _target_guard(ref)
    try:
        return ref.SetFocus() is not False
    except Exception:
        return False


def ax_set_value(ref, text):
    _target_guard(ref)
    try:
        pattern = ref.GetValuePattern()
        if pattern and not pattern.IsReadOnly:
            pattern.SetValue(text)
            return True
    except Exception:
        pass
    return False


def ax_press(ref):
    _target_guard(ref)
    # A list row outside the viewport can still be present in UI Automation,
    # but WinForms refuses SelectionItem.Select until the row has been brought
    # into view. ScrollItem is synchronous without opening a modal, so make the
    # target visible before asking its selection/toggle pattern to act.
    try:
        scroll_item = ref.GetScrollItemPattern()
    except Exception:
        scroll_item = None
    if scroll_item:
        with contextlib.suppress(Exception):
            scroll_item.ScrollIntoView()
        # Some providers advertise ScrollItem for already-visible rows but
        # reject the redundant call; their normal action may still work.
    # Combo boxes expose ExpandCollapse rather than Invoke. Using the native
    # pattern is faster and avoids a coordinate click on the tiny arrow child.
    try:
        pattern = ref.GetExpandCollapsePattern()
    except Exception:
        pattern = None
    if pattern:
        try:
            if pattern.ExpandCollapseState == auto.ExpandCollapseState.Collapsed:
                pattern.Expand()
            else:
                pattern.Collapse()
        except Exception as exc:
            raise Abort("UIA input outcome unknown; inspect before retrying") from exc
        return True
    if ref.ControlTypeName == "ComboBoxControl":
        # WinForms can advertise a legacy default action and return success
        # without opening the popup. Returning False makes click_item use its
        # guarded coordinate fallback, whose effect is visible next capture.
        return False
    # UIA Invoke is synchronous. A WinForms handler that opens MessageBox.Show
    # does not return until the modal closes, deadlocking a driver that must
    # observe and close that same modal. Let click_item use its guarded physical
    # click for invoke controls; input injection returns immediately while the
    # app enters its normal modal loop.
    for getter, operation in [
        ("GetInvokePattern", "Invoke"),
        ("GetSelectionItemPattern", "Select"),
        ("GetTogglePattern", "Toggle"),
    ]:
        try:
            pattern = getattr(ref, getter)()
        except Exception:
            continue
        if pattern:
            if operation == "Invoke":
                return False
            try:
                getattr(pattern, operation)()
            except Exception as exc:
                raise Abort("UIA input outcome unknown; inspect before retrying") from exc
            return True
    if ref.ControlTypeName in ("EditControl", "DocumentControl"):
        return ax_focus(ref)
    return False


def click_at(point):
    _guard()
    x, y = map(round, point)
    hit = auto.ControlFromPoint(x, y)
    if hit is None or hit.ProcessId != frontmost_pid():
        raise Abort("click point is covered by a different application")
    auto.Click(x, y, waitTime=0.04)


def press(key, command=False):
    _guard()
    mapping = {"return": "{Enter}", "tab": "{Tab}", "escape": "{Esc}", "a": "a", "s": "s", "delete": "{Delete}"}
    auto.SendKeys(("{Ctrl}" if command else "") + mapping[key], waitTime=0.04)


def type_text(text):
    _guard()
    field = focused_field()
    # Address bar is allowed for open_url; all other typing also requires an editable field.
    if not field or not field.is_text:
        raise Abort("no non-password text field has focus")
    if text:
        auto.SendKeys(escape_literal(text), charMode=True, interval=0, waitTime=0.04)


def escape_literal(text):
    return "".join("{{}" if ch == "{" else "{}}" if ch == "}" else ch for ch in text)


def clear_field():
    field = focused_field()
    if not field or not field.is_text:
        raise Abort("no editable field to clear")
    press("a", command=True)
    press("delete")


def scroll(lines):
    _guard()
    field = focused_field()
    center = (
        (field.x + field.w / 2, field.y + field.h / 2)
        if field and field.role == "AXRow" and field.w > 1 and field.h > 1
        else _scrollable_center() or frontmost_window_center()
    )
    if center:
        auto.MoveTo(*map(round, center))
    (auto.WheelUp if lines > 0 else auto.WheelDown)(abs(lines), waitTime=0.04)


def _scrollable_center():
    """Return the center of the largest visible vertically scrollable control."""
    candidates = []
    with contextlib.suppress(Exception):
        root = auto.ControlFromHandle(_foreground())
        for ref, _depth in auto.WalkControl(root, maxDepth=6):
            if ref.ControlTypeName not in {
                "ListControl",
                "DataGridControl",
                "TreeControl",
                "DocumentControl",
                "PaneControl",
            }:
                continue
            pattern = ref.GetScrollPattern()
            rect = ref.BoundingRectangle
            width, height = rect.width(), rect.height()
            if pattern and pattern.VerticallyScrollable and width > 1 and height > 1:
                candidates.append((width * height, rect.left + width / 2, rect.top + height / 2))
    return max(candidates)[1:] if candidates else None


def _attrs(ref):
    try:
        if _is_secret(ref):
            return AxAttrs("AXSecureTextField", "", None)
        rect = ref.BoundingRectangle
        label = ref.Name or ""
        if not label and ref.ControlTypeName in ("EditControl", "DocumentControl"):
            label = ref.HelpText or ("Text editor" if ref.ControlTypeName == "DocumentControl" else "Text field")
        return AxAttrs(ROLES.get(ref.ControlTypeName, "AXGroup"), label, (rect.left, rect.top, rect.width(), rect.height()))
    except Exception:
        return AxAttrs("AXGroup", "", None)


def _children(ref):
    try:
        return ref.GetChildren()
    except Exception:
        return []


def _actions(ref):
    if ref.ControlTypeName in (
        "ButtonControl",
        "CheckBoxControl",
        "ComboBoxControl",
        "RadioButtonControl",
        "HyperlinkControl",
        "MenuItemControl",
        "TabItemControl",
        "ListItemControl",
    ):
        return [AX_PRESS]
    return []


def _control_state(ref) -> tuple[str, ...]:
    """Stable UIA state that changes what the next useful action is."""
    states: list[str] = []
    kind = ref.ControlTypeName
    try:
        legacy = ref.GetLegacyIAccessiblePattern()
        legacy_state = legacy.State if legacy else 0
    except Exception:
        legacy_state = 0
    if kind in ("ListItemControl", "DataItemControl", "MenuItemControl", "RadioButtonControl", "TabItemControl"):
        try:
            pattern = ref.GetSelectionItemPattern()
            if pattern and pattern.IsSelected:
                states.append("selected")
        except Exception:
            pass
        if not states and legacy_state & auto.AccessibleState.Selected:
            states.append("selected")
        if kind == "RadioButtonControl" and not states:
            states.append("unselected")
    if kind == "CheckBoxControl":
        try:
            pattern = ref.GetTogglePattern()
            if pattern:
                state = pattern.ToggleState
                states.append(
                    "checked"
                    if state == auto.ToggleState.On
                    else "mixed"
                    if state == auto.ToggleState.Indeterminate
                    else "unchecked"
                )
        except Exception:
            pass
        if not states:
            states.append(
                "checked"
                if legacy_state & auto.AccessibleState.Checked
                else "mixed"
                if legacy_state & auto.AccessibleState.Mixed
                else "unchecked"
            )
    if kind == "ComboBoxControl":
        try:
            pattern = ref.GetExpandCollapsePattern()
            if pattern:
                state = pattern.ExpandCollapseState
                states.append(
                    "expanded"
                    if state in (auto.ExpandCollapseState.Expanded, auto.ExpandCollapseState.PartiallyExpanded)
                    else "collapsed"
                )
        except Exception:
            pass
        if not states:
            if legacy_state & auto.AccessibleState.Expanded:
                states.append("expanded")
            elif legacy_state & auto.AccessibleState.Collapsed:
                states.append("collapsed")
        value = ax_value(ref)
        if value:
            states.append(f"value={value[:120]}")
    return tuple(states)


def _with_inferred_combo_state(nodes):
    """WinForms sometimes exposes combo state only through its visible popup rows."""
    rows = [node for node in nodes if node.role == "AXRow"]
    out = []
    for node in nodes:
        if node.role != "AXComboBox" or any(s in node.state for s in ("expanded", "collapsed")):
            out.append(node)
            continue
        expanded = any(
            row.y >= node.y + node.h - 2
            and row.y < node.y + node.h + 500
            and min(row.x + row.w, node.x + node.w) - max(row.x, node.x) >= min(row.w, node.w) * 0.5
            for row in rows
        )
        out.append(replace(node, state=("expanded" if expanded else "collapsed", *node.state)))
    return out


def _inside(inner, outer, slack=2.0):
    return (
        inner.x >= outer.x - slack
        and inner.y >= outer.y - slack
        and inner.x + inner.w <= outer.x + outer.w + slack
        and inner.y + inner.h <= outer.y + outer.h + slack
    )


def _without_combo_arrow_duplicates(nodes):
    """Drop localized open/close arrow children already represented by a combo."""
    combos = [node for node in nodes if node.role == "AXComboBox"]
    generic = {"open", "close", "expand", "collapse", "aç", "kapat"}
    return [
        node
        for node in nodes
        if not (
            node.role == "AXButton" and node.label.strip().casefold() in generic and any(_inside(node, combo) for combo in combos)
        )
    ]


def actionable_elements(pid, display_w_pt, display_h_pt):
    if pid != frontmost_pid():
        raise Abort("foreground changed before reading controls")
    visible, hidden, capped = walk_actionable(
        auto.ControlFromHandle(_foreground()), _children, _attrs, _actions, display_w_pt, display_h_pt, time_cap=1.0
    )
    visible = _without_combo_arrow_duplicates(visible)
    visible = _with_inferred_combo_state([replace(node, state=_control_state(node.ref)) for node in visible])
    return (
        visible,
        [replace(node, state=_control_state(node.ref)) for node in hidden],
        capped,
    )
