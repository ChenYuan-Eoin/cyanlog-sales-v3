#!/usr/bin/env python3
"""Add review decisions as standard PDF text/highlight annotations.

The source pages are cloned; comments are attached to the declared source page
and optional normalized/percentage boxes. OCR text is never required, so a
scanned page can still receive a manual point or region comment.
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pypdf import PdfReader, PdfWriter
from pypdf.annotations import Highlight, Text
from pypdf.generic import ArrayObject, FloatObject, NameObject, TextStringObject


def clean_comment(value: Any) -> str:
    return str(value or "").strip()


def decision_comment(decision: dict[str, Any]) -> str:
    comment = clean_comment(decision.get("customer_comment"))
    revision = clean_comment(decision.get("revision_text"))
    if comment and revision:
        return f"{comment}\n建议替换为：{revision}"
    if revision:
        return f"建议替换为：{revision}"
    return comment


def normalized_box(box: dict[str, Any]) -> tuple[float, float, float, float] | None:
    try:
        left = float(box.get("left", box.get("x", 0)))
        top = float(box.get("top", box.get("y", 0)))
        width = float(box.get("width", 0))
        height = float(box.get("height", 0))
    except (TypeError, ValueError):
        return None

    # Existing rendered line boxes use 0-100 percentages; the unified manual
    # anchor contract uses 0-1 normalized values.
    scale = 100.0 if max(abs(left), abs(top), abs(width), abs(height)) > 1 else 1.0
    left, top, width, height = left / scale, top / scale, width / scale, height / scale
    if width <= 0 or height <= 0 or min(left, top) < 0 or left + width > 1 or top + height > 1:
        return None
    return left, top, width, height


def page_bounds(page) -> tuple[float, float, float, float]:
    box = page.cropbox
    return float(box.left), float(box.bottom), float(box.right), float(box.top)


def display_point_to_pdf(page, x: float, y: float) -> tuple[float, float]:
    """Map normalized browser coordinates into unrotated PDF user space."""
    page_left, page_bottom, page_right, page_top = page_bounds(page)
    page_width = page_right - page_left
    page_height = page_top - page_bottom
    rotation = int(page.get("/Rotate", 0) or 0) % 360
    if rotation == 90:
        local_x, local_y = y * page_width, x * page_height
    elif rotation == 180:
        local_x, local_y = (1 - x) * page_width, y * page_height
    elif rotation == 270:
        local_x, local_y = (1 - y) * page_width, (1 - x) * page_height
    else:
        local_x, local_y = x * page_width, (1 - y) * page_height
    return page_left + local_x, page_bottom + local_y


def pdf_rect(page, box: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    left, top, width, height = box
    corners = [
        display_point_to_pdf(page, left, top),
        display_point_to_pdf(page, left + width, top),
        display_point_to_pdf(page, left, top + height),
        display_point_to_pdf(page, left + width, top + height),
    ]
    xs = [point[0] for point in corners]
    ys = [point[1] for point in corners]
    return min(xs), min(ys), max(xs), max(ys)


def add_contents(annotation, comment: str, annotation_id: str) -> None:
    annotation[NameObject("/Contents")] = TextStringObject(comment)
    annotation[NameObject("/T")] = TextStringObject("ONES 业务运营")
    annotation[NameObject("/NM")] = TextStringObject(annotation_id)
    annotation[NameObject("/M")] = TextStringObject(datetime.now(timezone.utc).strftime("D:%Y%m%d%H%M%SZ"))


def has_digital_signature(reader: PdfReader) -> bool:
    root = reader.trailer.get("/Root")
    root = root.get_object() if hasattr(root, "get_object") else root
    if not isinstance(root, dict):
        return False
    if root.get("/Perms") is not None:
        return True
    acroform = root.get("/AcroForm")
    acroform = acroform.get_object() if hasattr(acroform, "get_object") else acroform
    fields = list(acroform.get("/Fields", [])) if isinstance(acroform, dict) else []
    while fields:
        field = fields.pop().get_object()
        if field.get("/FT") == "/Sig":
            return True
        fields.extend(field.get("/Kids", []))
    return False


def generate_annotated_pdf(input_path: str, output_path: str, payload: dict[str, Any]) -> dict[str, Any]:
    reader = PdfReader(input_path)
    if has_digital_signature(reader):
        return {"success": False, "error": "PDF 包含数字签名；写入批注会使签名失效，已拒绝输出"}
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    anchored = 0
    unlocated: list[str] = []

    candidates = [
        (decision_comment(decision), decision.get("source_anchor") or {})
        for decision in (payload.get("decision_drafts") or [])
    ] + [
        (clean_comment(annotation.get("comment")), annotation.get("source_anchor") or {})
        for annotation in (payload.get("annotations") or [])
    ]
    for index, (comment, anchor) in enumerate(candidates):
        if not comment:
            continue
        try:
            page_number = int(anchor.get("page") or 1)
        except (TypeError, ValueError):
            page_number = 1
        if page_number < 1 or page_number > len(writer.pages):
            unlocated.append(clean_comment(anchor.get("clause_ref")) or f"批注 {index + 1}")
            continue

        page_index = page_number - 1
        page = writer.pages[page_index]
        anchor_kind = anchor.get("anchor_kind") or anchor.get("kind")
        raw_boxes = anchor.get("boxes") or (
            [anchor.get("region")]
            if anchor_kind == "region" and isinstance(anchor.get("region"), dict)
            else []
        )
        boxes = [box for raw in raw_boxes if (box := normalized_box(raw))]
        annotation_id = f"ones-review-{index + 1}"

        if boxes:
            for box_index, box in enumerate(boxes):
                x1, y1, x2, y2 = pdf_rect(page, box)
                quad_points = ArrayObject([
                    FloatObject(x1), FloatObject(y2),
                    FloatObject(x2), FloatObject(y2),
                    FloatObject(x1), FloatObject(y1),
                    FloatObject(x2), FloatObject(y1),
                ])
                highlight = Highlight(
                    rect=(x1, y1, x2, y2),
                    quad_points=quad_points,
                    highlight_color="ffd54f",
                    printing=True,
                    title_bar="ONES 业务运营",
                )
                add_contents(highlight, comment, f"{annotation_id}-highlight-{box_index + 1}")
                writer.add_annotation(page_index, highlight)
            x1, _y1, x2, y2 = pdf_rect(page, boxes[0])
            page_left, page_bottom, page_right, page_top = page_bounds(page)
            note_x = min(max(x2, page_left), page_right - 18)
            note_y = min(max(y2 - 18, page_bottom), page_top - 18)
        elif anchor_kind == "point" and isinstance(anchor.get("point"), dict):
            point = anchor["point"]
            try:
                point_x, point_y = float(point.get("x")), float(point.get("y"))
            except (TypeError, ValueError):
                unlocated.append(clean_comment(anchor.get("clause_ref")) or f"批注 {index + 1}")
                continue
            if not 0 <= point_x <= 1 or not 0 <= point_y <= 1:
                unlocated.append(clean_comment(anchor.get("clause_ref")) or f"批注 {index + 1}")
                continue
            anchor_x, anchor_y = display_point_to_pdf(page, point_x, point_y)
            page_left, page_bottom, page_right, page_top = page_bounds(page)
            note_x = min(max(page_left, anchor_x - 9), page_right - 18)
            note_y = min(max(page_bottom, anchor_y - 9), page_top - 18)
        else:
            # A page number alone is not an auditable annotation position.
            unlocated.append(clean_comment(anchor.get("clause_ref")) or f"批注 {index + 1}")
            continue

        note = Text(
            rect=(note_x, note_y, note_x + 18, note_y + 18),
            text=comment,
            open=False,
            title_bar="ONES 业务运营",
        )
        add_contents(note, comment, annotation_id)
        writer.add_annotation(page_index, note)
        anchored += 1

    if anchored == 0:
        return {"success": False, "error": "没有可写入 PDF 的已提交客户侧批注", "unlocated": unlocated}

    with Path(output_path).open("wb") as output:
        writer.write(output)
    return {"success": True, "anchored": anchored, "unlocated": unlocated, "pages": len(writer.pages)}


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python pdf-annotator.py <input_pdf> <output_pdf> <payload_json>")
        sys.exit(1)
    try:
        result = generate_annotated_pdf(sys.argv[1], sys.argv[2], json.loads(sys.argv[3]))
    except Exception as error:  # API wrapper needs one structured failure surface.
        result = {"success": False, "error": str(error)}
    print(json.dumps(result, ensure_ascii=False))
