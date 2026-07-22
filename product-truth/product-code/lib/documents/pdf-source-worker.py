#!/usr/bin/env python3
"""Short-lived PDFium worker for source text, geometry, and page PNGs."""

from __future__ import annotations

import argparse
import json
import re
import struct
import zlib
from pathlib import Path
from typing import Any

import pypdfium2 as pdfium


class WorkerError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _normalized_text(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _line_geometry(text_page: Any, raw_text: str, page_width: float, page_height: float) -> list[dict[str, Any]]:
    lines: list[dict[str, Any]] = []
    for match in re.finditer(r"[^\r\n]+", raw_text):
        line_text = match.group(0).strip()
        if not line_text:
            continue
        boxes: list[tuple[float, float, float, float]] = []
        for index in range(match.start(), match.end()):
            if raw_text[index].isspace():
                continue
            try:
                left, bottom, right, top = text_page.get_charbox(index)
            except Exception:
                continue
            if right > left and top > bottom:
                boxes.append((left, bottom, right, top))
        if not boxes:
            continue
        left = min(box[0] for box in boxes)
        bottom = min(box[1] for box in boxes)
        right = max(box[2] for box in boxes)
        top = max(box[3] for box in boxes)
        lines.append({
            "text": line_text,
            "left": max(0.0, min(100.0, left / page_width * 100.0)),
            "top": max(0.0, min(100.0, (page_height - top) / page_height * 100.0)),
            "width": max(0.0, min(100.0, (right - left) / page_width * 100.0)),
            "height": max(0.0, min(100.0, (top - bottom) / page_height * 100.0)),
        })
    return lines


def inspect_pdf(input_path: Path) -> dict[str, Any]:
    try:
        document = pdfium.PdfDocument(str(input_path))
    except Exception as error:
        raise WorkerError("PDF_OPEN_FAILED", f"PDF 文件无法打开：{error}") from error

    pages: list[dict[str, Any]] = []
    try:
        for page_index in range(len(document)):
            page = document[page_index]
            try:
                text_page = page.get_textpage()
                try:
                    raw_text = text_page.get_text_range()
                    pages.append({
                        "page": page_index + 1,
                        "text": _normalized_text(raw_text),
                        "lines": _line_geometry(
                            text_page,
                            raw_text,
                            max(float(page.get_width()), 1.0),
                            max(float(page.get_height()), 1.0),
                        ),
                    })
                finally:
                    text_page.close()
            finally:
                page.close()
    finally:
        document.close()

    page_texts = [page["text"] for page in pages]
    return {
        "ok": True,
        "page_count": len(pages),
        "text": "\f".join(page_texts),
        "pages": pages,
    }


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)


def _bitmap_png_bytes(bitmap: Any) -> bytes:
    width = int(bitmap.width)
    height = int(bitmap.height)
    stride = int(bitmap.stride)
    mode = str(bitmap.mode)
    source = bytes(bitmap.buffer)
    rows: list[bytes] = []
    for row_index in range(height):
        row = source[row_index * stride:(row_index + 1) * stride]
        if mode == "BGR":
            pixels = b"".join(row[offset:offset + 3][::-1] for offset in range(0, width * 3, 3))
            color_type = 2
        elif mode in {"BGRA", "BGRx"}:
            pixels = b"".join(
                bytes((row[offset + 2], row[offset + 1], row[offset], row[offset + 3]))
                for offset in range(0, width * 4, 4)
            )
            color_type = 6
        elif mode in {"L", "GRAY"}:
            pixels = row[:width]
            color_type = 0
        else:
            raise WorkerError("PDF_BITMAP_UNSUPPORTED", f"PDFium 返回了不支持的位图格式：{mode}")
        rows.append(b"\x00" + pixels)
    header = struct.pack(">IIBBBBB", width, height, 8, color_type, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + _png_chunk(b"IHDR", header) + _png_chunk(
        b"IDAT", zlib.compress(b"".join(rows), level=6)
    ) + _png_chunk(b"IEND", b"")


def render_page(input_path: Path, output_path: Path, page_number: int, dpi: int) -> dict[str, Any]:
    if page_number < 1:
        raise WorkerError("PAGE_OUT_OF_RANGE", "页码必须是正整数")
    if dpi < 72 or dpi > 300:
        raise WorkerError("DPI_OUT_OF_RANGE", "PDF 渲染 DPI 必须在 72 到 300 之间")
    try:
        document = pdfium.PdfDocument(str(input_path))
    except Exception as error:
        raise WorkerError("PDF_OPEN_FAILED", f"PDF 文件无法打开：{error}") from error

    try:
        if page_number > len(document):
            raise WorkerError("PAGE_OUT_OF_RANGE", f"页码 {page_number} 超出 PDF 总页数 {len(document)}")
        page = document[page_number - 1]
        try:
            bitmap = page.render(scale=dpi / 72.0)
            try:
                output_path.parent.mkdir(parents=True, exist_ok=True)
                output_path.write_bytes(_bitmap_png_bytes(bitmap))
            finally:
                bitmap.close()
        finally:
            page.close()
        return {"ok": True, "page": page_number, "page_count": len(document), "dpi": dpi}
    finally:
        document.close()


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Price V3 PDF source worker")
    subparsers = parser.add_subparsers(dest="command", required=True)
    inspect_parser = subparsers.add_parser("inspect")
    inspect_parser.add_argument("--input", type=Path, required=True)
    render_parser = subparsers.add_parser("render")
    render_parser.add_argument("--input", type=Path, required=True)
    render_parser.add_argument("--output", type=Path, required=True)
    render_parser.add_argument("--page", type=int, required=True)
    render_parser.add_argument("--dpi", type=int, default=144)
    return parser


def main() -> int:
    args = _parser().parse_args()
    try:
        if not args.input.is_file():
            raise WorkerError("INPUT_NOT_FOUND", "PDF 输入文件不存在")
        result = inspect_pdf(args.input) if args.command == "inspect" else render_page(
            args.input, args.output, args.page, args.dpi
        )
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
        return 0
    except WorkerError as error:
        print(json.dumps({
            "ok": False,
            "error": {"code": error.code, "message": error.message},
        }, ensure_ascii=False, separators=(",", ":")))
        return 2
    except Exception as error:
        print(json.dumps({
            "ok": False,
            "error": {"code": "PDF_WORKER_FAILED", "message": str(error)},
        }, ensure_ascii=False, separators=(",", ":")))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
