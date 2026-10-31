"""Windows' local OCR behind the ocrmac interface used by the upstream cache."""

from __future__ import annotations

import asyncio
from functools import lru_cache

from winrt.windows.graphics.imaging import BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap
from winrt.windows.media.ocr import OcrEngine
from winrt.windows.storage.streams import DataWriter


@lru_cache(maxsize=1)
def engine():
    result = OcrEngine.try_create_from_user_profile_languages()
    if result is None:
        languages = list(OcrEngine.available_recognizer_languages)
        if languages:
            result = OcrEngine.try_create_from_language(languages[0])
    if result is None:
        raise RuntimeError("Windows OCR language is unavailable. Install an OCR language in Windows Settings.")
    return result


def line_groups(line):
    """Keep separate controls separated: OCR may join an entire menu bar."""
    groups = []
    for word in line.words:
        if groups:
            previous = groups[-1][-1].bounding_rect
            current = word.bounding_rect
            gap = current.x - previous.x - previous.width
            if gap > max(previous.height, current.height) * 0.8:
                groups.append([])
        else:
            groups.append([])
        groups[-1].append(word)
    return groups


class OCR:
    def __init__(self, image, recognition_level="accurate"):
        self.image = image

    def recognize(self, px=True):
        if not px:
            raise ValueError("This adapter returns pixel boxes only.")
        return asyncio.run(self._recognize())

    async def _recognize(self):
        image = self.image.convert("RGBA")
        ratio = min(1.0, OcrEngine.max_image_dimension / max(image.size))
        if ratio < 1:
            image = image.resize((max(1, round(image.width * ratio)), max(1, round(image.height * ratio))))
        writer = DataWriter()
        writer.write_bytes(image.tobytes("raw", "BGRA"))
        bitmap = SoftwareBitmap(BitmapPixelFormat.BGRA8, image.width, image.height, BitmapAlphaMode.IGNORE)
        bitmap.copy_from_buffer(writer.detach_buffer())
        try:
            result = await engine().recognize_async(bitmap)
            lines = []
            for line in result.lines:
                groups = line_groups(line)
                for words in groups:
                    boxes = [w.bounding_rect for w in words]
                    box = (
                        min(b.x for b in boxes),
                        min(b.y for b in boxes),
                        max(b.x + b.width for b in boxes),
                        max(b.y + b.height for b in boxes),
                    )
                    text = line.text if len(groups) == 1 else " ".join(w.text for w in words)
                    # Accepted OCR text, not calibrated model confidence.
                    lines.append((text, 1.0, tuple(v / ratio for v in box)))
            return lines
        finally:
            bitmap.close()
            writer.close()
