import sys
from types import SimpleNamespace

import pytest

pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="Windows OCR")


def word(text, x, width):
    return SimpleNamespace(text=text, bounding_rect=SimpleNamespace(x=x, y=0, width=width, height=17))


def test_menu_bar_controls_have_distinct_click_targets():
    from typesafe_computer_use.windows_ocr import line_groups

    line = SimpleNamespace(words=[word("Dosya", 27, 45), word("Düzenle", 111, 54), word("Görünüm", 202, 77)])
    assert [[w.text for w in group] for group in line_groups(line)] == [["Dosya"], ["Düzenle"], ["Görünüm"]]


def test_one_multiword_control_is_kept_together():
    from typesafe_computer_use.windows_ocr import line_groups

    line = SimpleNamespace(words=[word("Farkl\u0131", 20, 40), word("Kaydet", 65, 50)])
    assert [[w.text for w in group] for group in line_groups(line)] == [["Farkl\u0131", "Kaydet"]]
