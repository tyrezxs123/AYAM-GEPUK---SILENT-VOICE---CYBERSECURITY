"""Generate the PWA icons with no image library: a shield with a voice waveform.

    python scripts/make-icons.py

Pure stdlib PNG writer, so there is nothing to install and the icons are
reproducible in CI. Re-run after changing the brand colour.
"""
from __future__ import annotations

import pathlib
import struct
import zlib

OUT = pathlib.Path(__file__).resolve().parent.parent / "public"
BRAND = (27, 77, 219)       # #1b4ddb
BRAND_DARK = (19, 52, 156)
WHITE = (255, 255, 255)


def write_png(path: pathlib.Path, pixels: list[list[tuple[int, int, int]]]) -> None:
    h, w = len(pixels), len(pixels[0])
    raw = bytearray()
    for row in pixels:
        raw.append(0)  # filter type 0
        for r, g, b in row:
            raw += bytes((r, g, b))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def lerp(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))  # type: ignore[return-value]


def shield(x: float, y: float) -> bool:
    """x, y in [-1, 1]. A rounded shield: wide at the top, pointed at the bottom."""
    if y < -0.78 or y > 0.92:
        return False
    half = 0.70 if y < 0.1 else 0.70 * (1.0 - (y - 0.1) / 0.95) ** 0.55
    if y < -0.55:  # round the shoulders
        half *= (1.0 - ((-0.55 - y) / 0.23) ** 2) ** 0.5 if y > -0.78 else 0.0
    return abs(x) <= half


BARS = [0.30, 0.58, 0.95, 0.70, 0.42]


def waveform(x: float, y: float) -> bool:
    """Five rounded bars, like a voice level meter."""
    slot = 0.21
    for i, height in enumerate(BARS):
        cx = (i - 2) * slot
        if abs(x - cx) <= 0.055 and abs(y) <= height * 0.42:
            return True
    return False


SS = 3  # supersampling factor, box-downsampled for smooth edges


def render(size: int, pad: float) -> list[list[tuple[int, int, int]]]:
    big = size * SS
    scale = 1.0 / (1.0 - pad)
    rows: list[list[tuple[int, int, int]]] = []
    for py in range(size):
        row: list[tuple[int, int, int]] = []
        for px in range(size):
            acc = [0, 0, 0]
            for sy_i in range(SS):
                for sx_i in range(SS):
                    x = ((px * SS + sx_i) + 0.5) / big * 2 - 1
                    y = ((py * SS + sy_i) + 0.5) / big * 2 - 1
                    sx, sy = x * scale, y * scale
                    if shield(sx, sy):
                        px_col = (
                            WHITE
                            if waveform(sx, sy * 1.05 + 0.04)
                            else lerp(BRAND, BRAND_DARK, (sy + 1) / 2)
                        )
                    else:
                        px_col = WHITE
                    for c in range(3):
                        acc[c] += px_col[c]
            n = SS * SS
            row.append((acc[0] // n, acc[1] // n, acc[2] // n))
        rows.append(row)
    return rows


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size, pad in [
        ("icon-192.png", 192, 0.10),
        ("icon-512.png", 512, 0.10),
        # maskable icons get cropped to a circle, so keep the art well inside
        ("icon-maskable-512.png", 512, 0.30),
        ("apple-touch-icon.png", 180, 0.10),
    ]:
        write_png(OUT / name, render(size, pad))
        print("wrote", OUT / name)


if __name__ == "__main__":
    main()
