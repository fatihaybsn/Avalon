"""Window ownership guard with fake Win32 calls; never captures or inputs."""

import sys

import pytest

from typesafe_computer_use.models import Abort

pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="Windows guard")


@pytest.fixture
def pinned(monkeypatch):
    from typesafe_computer_use import windows

    monkeypatch.setattr(windows, "_target_hwnd", 10)
    monkeypatch.setattr(windows, "_target_pid", 100)
    monkeypatch.setattr(windows, "_pid", lambda hwnd: 100 if hwnd in {10, 11, 12} else 200)
    monkeypatch.setattr(windows.user32, "GetWindow", lambda hwnd, _: 10 if hwnd == 11 else 0)
    return windows


def test_pinned_window_and_its_owned_dialog_are_allowed(pinned):
    pinned._guard_target(10)
    pinned._guard_target(11)


def test_unowned_same_process_window_is_refused(pinned):
    with pytest.raises(Abort, match="outside the selected"):
        pinned._guard_target(12)


def test_another_process_is_refused_before_capture(pinned, monkeypatch):
    monkeypatch.setattr(pinned, "_foreground", lambda: 99)
    monkeypatch.setattr(pinned, "_observed_hwnd", 10)
    with pytest.raises(Abort, match="target application"):
        pinned.screenshot()
    assert pinned._observed_hwnd == 10


def test_exited_target_is_not_replaced_by_the_new_foreground(pinned, monkeypatch):
    monkeypatch.setattr(pinned, "_pid", lambda hwnd: 999)
    with pytest.raises(Abort, match="changed or exited"):
        pinned._guard_target(10)


def test_save_shortcut_refuses_input_when_target_guard_fails(pinned, monkeypatch):
    sent = []
    monkeypatch.setattr(pinned.auto, "SendKeys", lambda *args, **kwargs: sent.append(args[0]))

    def refuse():
        raise Abort("target changed")

    monkeypatch.setattr(pinned, "_guard", refuse)
    with pytest.raises(Abort, match="target changed"):
        pinned.press("s", command=True)
    assert sent == []
    monkeypatch.setattr(pinned, "_guard", lambda: None)
    pinned.press("s", command=True)
    assert sent == ["{Ctrl}s"]
