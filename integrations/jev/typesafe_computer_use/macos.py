"""Compatibility facade preserving the upstream adapter interface on Windows and macOS."""

import sys

if sys.platform == "win32":
    from .ax_common import AxAttrs, walk_actionable  # noqa: F401
    from .windows import *  # noqa: F403
else:
    from .macos_native import *  # noqa: F403
