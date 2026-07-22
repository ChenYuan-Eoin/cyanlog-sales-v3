#!/usr/bin/env python3
"""
Source DOCX native comment exporter for contract review.

This script must not rebuild the contract body or append a report section. It
opens the uploaded DOCX, anchors customer-facing comments to existing evidence
paragraphs, and fails when no comment can be safely located.
"""

import json
import hashlib
import posixpath
import re
import shutil
import sys
import zipfile
from copy import deepcopy
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.text.run import Run
from lxml import etree as ET

try:
    import olefile
except ImportError:  # The DOCM path fails closed when the declared dependency is absent.
    olefile = None

try:
    from oletools.olevba import VBA_Parser
except ImportError:  # Static MS-OVBA parsing is mandatory for DOCM; macros are never executed.
    VBA_Parser = None


WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CONTENT_TYPE_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
OFFICE_DOCUMENT_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
RELATIONSHIPS_CONTENT_TYPE = "application/vnd.openxmlformats-package.relationships+xml"
COMMENTS_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments"
COMMENTS_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"
DOCM_MAIN_CONTENT_TYPE = "application/vnd.ms-word.document.macroEnabled.main+xml"
VBA_PROJECT_CONTENT_TYPE = "application/vnd.ms-office.vbaProject"
VBA_PROJECT_REL_TYPE = "http://schemas.microsoft.com/office/2006/relationships/vbaProject"
VBA_DATA_CONTENT_TYPE = "application/vnd.ms-word.vbaData+xml"
VBA_DATA_REL_TYPE = "http://schemas.microsoft.com/office/2006/relationships/wordVbaData"
VBA_DATA_NS = "http://schemas.microsoft.com/office/word/2006/wordml"
MAX_DOCM_ENTRIES = 4096
MAX_DOCM_ENTRY_SIZE = 128 * 1024 * 1024
MAX_DOCM_TOTAL_SIZE = 512 * 1024 * 1024
MAX_DOCM_COMPRESSION_RATIO = 1000
ALLOWED_DOCM_COMPRESSION = {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}


def xml_name(namespace: str, local: str) -> str:
    return f"{{{namespace}}}{local}"


TECHNICAL_TOKENS = (
    "RiskFinding",
    "RuleSnapshot",
    "SourceRange",
    "source range",
    "evidence_text",
    "selected_text",
    "model_invocations",
    "uuid",
    "commit ",
    "规则来源:",
    "Rule:",
    "riskfinding",
    "配置中心",
    "规则集",
    "AI翻译",
    "规则源",
    "规则快照",
    "快照",
    "风险等级说明",
)

UUID_RE = re.compile(
    r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"
)


def clean_text(value: Any) -> str:
    if value is None:
        return ""

    text = str(value).replace("\r", "\n")
    lines = []
    for line in text.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue
        if UUID_RE.search(stripped):
            continue
        if re.search(r"\{(?:risk|rule|source|model|matched|basis|level|text|id)[^}]*\}", stripped, re.I):
            continue
        if any(token in stripped for token in TECHNICAL_TOKENS):
            continue
        if re.search(r"(?:^|\s)Level\s*[ABC]\b", stripped, re.I):
            continue
        if re.search(r"(?:请在\s*)?Word\s*(?:文档|批注)?中[^。；;]*(?:插入|使用|标记|标注)[^。；;]*批注", stripped, re.I):
            continue
        if "请根据实际条款文本核对本评估结果" in stripped:
            continue
        lines.append(stripped)

    return "\n".join(lines).strip()


def normalize(value: str) -> str:
    return re.sub(r"\s+", "", value or "")


def level_label(level: str) -> str:
    return {
        "red": "必须修改",
        "yellow": "建议调整",
        "green": "符合标准",
        "white": "提示",
        "critical": "必须修改",
        "high": "必须修改",
        "medium": "建议调整",
        "low": "提示",
    }.get(level or "", "建议调整")


def map_clause_level(value: str) -> str:
    return {
        "critical": "red",
        "high": "red",
        "medium": "yellow",
        "low": "green",
    }.get(value or "", "yellow")


def significant_anchors(anchor_text: str) -> list[str]:
    text = clean_text(anchor_text)
    if not text:
        return []

    anchors = [text]
    pieces = re.split(r"[。；;.!！?\n]", text)
    for piece in pieces:
        piece = piece.strip()
        if len(normalize(piece)) >= 14:
            anchors.append(piece)
    if len(normalize(text)) > 80:
        anchors.append(text[:80])
        anchors.append(text[:50])

    seen = set()
    result = []
    for anchor in anchors:
        key = normalize(anchor)
        if len(key) < 4 or key in seen:
            continue
        seen.add(key)
        result.append(anchor)
    return result


def paragraph_text(paragraph) -> str:
    return "".join(run.text for run in paragraph.runs) or paragraph.text or ""


def find_paragraph(doc: Document, anchor_text: str):
    anchors = significant_anchors(anchor_text)
    if not anchors:
        return None

    paragraphs = list(doc.paragraphs)
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                paragraphs.extend(cell.paragraphs)

    for anchor in anchors:
        needle = normalize(anchor)
        matches = [
            paragraph for paragraph in paragraphs
            if needle and needle in normalize(paragraph_text(paragraph))
        ]
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            return None
    return None


def _split_run_at(run: Run, offset: int) -> Run | None:
    text = run.text or ""
    if offset <= 0:
        return run
    if offset >= len(text):
        return None
    right_xml = deepcopy(run._r)
    run._r.addnext(right_xml)
    right = Run(right_xml, run._parent)
    run.text = text[:offset]
    right.text = text[offset:]
    return right


def exact_comment_runs(paragraph, exact_text: str) -> list[Run]:
    if not exact_text:
        return []
    full_text = paragraph_text(paragraph)
    positions = []
    offset = 0
    while True:
        found = full_text.find(exact_text, offset)
        if found < 0:
            break
        positions.append(found)
        offset = found + 1
    if len(positions) != 1:
        return []

    start = positions[0]
    end = start + len(exact_text)
    runs = list(paragraph.runs)
    cursor = 0
    start_run = None
    start_offset = 0
    end_run = None
    end_offset = 0
    for run in runs:
        run_text = run.text or ""
        run_end = cursor + len(run_text)
        if start_run is None and cursor <= start < run_end:
            start_run, start_offset = run, start - cursor
        if cursor < end <= run_end:
            end_run, end_offset = run, end - cursor
            break
        cursor = run_end
    if start_run is None or end_run is None:
        return []

    _split_run_at(end_run, end_offset)
    _split_run_at(start_run, start_offset)

    selected = []
    cursor = 0
    for run in paragraph.runs:
        run_text = run.text or ""
        run_end = cursor + len(run_text)
        if run_text and cursor >= start and run_end <= end:
            selected.append(run)
        cursor = run_end
    return selected if "".join(run.text or "" for run in selected) == exact_text else []


def build_comment(title: str, level: str, description: str, suggestion: str, feedback: str = "") -> str:
    comment_lines = [f"[{level_label(level)}] {clean_text(title) or '合同条款需要调整'}"]

    clean_suggestion = clean_text(suggestion)
    clean_description = clean_text(description)
    clean_feedback = clean_text(feedback)

    if clean_suggestion:
        comment_lines.append(f"建议修改为：{clean_suggestion}")
    elif clean_description:
        comment_lines.append(f"建议处理：请将该条款调整为双方可执行、可书面确认的明确表述。")

    if clean_feedback:
        comment_lines.append(f"客户反馈：{clean_feedback}")

    if clean_description:
        comment_lines.append(f"原因：{clean_description}")

    if level in ("red", "critical", "high"):
        comment_lines.append("如客户无法接受，请补充书面原因或提交特批，不能仅口头确认。")

    return "\n".join(line for line in comment_lines if line.strip())


def add_item(items: list[dict[str, str]], anchor: Any, title: Any, level: str, description: Any, suggestion: Any, feedback: Any = ""):
    anchor_text = clean_text(anchor)
    comment_text = build_comment(
        title=clean_text(title),
        level=level,
        description=clean_text(description),
        suggestion=clean_text(suggestion),
        feedback=clean_text(feedback),
    )
    if not anchor_text or not comment_text:
        return

    key = (normalize(anchor_text)[:120], normalize(comment_text)[:120])
    items.append({
        "key": "|".join(key),
        "anchor": anchor_text,
        "exact_text": anchor_text,
        "comment": comment_text,
        "title": clean_text(title),
    })


def response_text(ask_item: dict[str, Any]) -> str:
    responses = ask_item.get("ask_responses") or []
    if not responses:
        return ""
    latest = responses[-1] if isinstance(responses, list) else None
    if not isinstance(latest, dict):
        return ""
    return clean_text(latest.get("response_text"))


def build_comment_items(data: dict[str, Any]) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []

    for decision in data.get("decision_drafts") or []:
        anchor = decision.get("source_anchor") or {}
        exact_text = clean_text(anchor.get("exact_text"))
        anchor_text = exact_text or clean_text(anchor.get("excerpt")) or clean_text(anchor.get("clause_ref"))
        revision_text = clean_text(decision.get("revision_text"))
        customer_comment = clean_text(decision.get("customer_comment"))
        negotiation_result = decision.get("negotiation_result")

        if (
            revision_text
            and negotiation_result == "customer_agreed"
            and anchor.get("locator") == "rendered"
            and exact_text
        ):
            items.append({
                "key": f"revision|{normalize(exact_text)[:120]}|{normalize(revision_text)[:120]}",
                "anchor": anchor_text,
                "exact_text": exact_text,
                "comment": customer_comment,
                "replacement": revision_text,
                "kind": "revision",
                "title": clean_text(anchor.get("clause_ref")) or "受控修订",
            })
        elif customer_comment:
            items.append({
                "key": f"comment|{normalize(anchor_text)[:120]}|{normalize(customer_comment)[:120]}",
                "anchor": anchor_text,
                "exact_text": exact_text,
                "comment": customer_comment,
                "replacement": "",
                "kind": "comment",
                "title": clean_text(anchor.get("clause_ref")) or "客户侧批注",
            })

    for annotation in data.get("annotations") or []:
        add_item(
            items,
            annotation.get("selected_text"),
            annotation.get("category") or "合同批注",
            annotation.get("priority") or "yellow",
            "",
            annotation.get("comment"),
        )

    # The G5 source-annotated export accepts explicit user annotations and
    # reviewed decisions only. Generic findings and internal notes stay out.
    if data.get("export_mode") == "source_annotated":
        return items

    for clause in data.get("clauses") or []:
        level = map_clause_level(clause.get("risk_level") or "")
        suggestion = clause.get("suggested_text") or clause.get("suggestion")
        if not suggestion and level == "green":
            continue
        title = clause.get("risk_category") or clause.get("clause_title") or clause.get("clause_number")
        add_item(
            items,
            clause.get("clause_text"),
            title or "条款风险",
            level,
            clause.get("risk_description"),
            suggestion,
        )

    for risk in data.get("risk_cards") or []:
        if risk.get("status") == "ignored" or risk.get("level") == "green":
            continue
        anchor = risk.get("clause_ref") or risk.get("description") or risk.get("title")
        add_item(
            items,
            anchor,
            risk.get("title"),
            risk.get("level") or "yellow",
            risk.get("description"),
            risk.get("suggestion"),
        )

    for ask in data.get("ask_items") or []:
        level = ask.get("initial_level") or "yellow"
        if ask.get("status") == "closed" and level == "green":
            continue
        title = ask.get("risk_name") or ask.get("ask_code") or "需补充业务反馈"
        feedback = response_text(ask)
        suggestion = ask.get("qualified_std") or ask.get("question_text")
        anchor = ask.get("clause_ref") or ask.get("risk_name") or ask.get("question_text")
        add_item(
            items,
            anchor,
            title,
            level,
            ask.get("question_text"),
            suggestion,
            feedback,
        )

    for risk in data.get("risks") or []:
        if risk.get("level") == "green":
            continue
        add_item(
            items,
            risk.get("title") or risk.get("description"),
            risk.get("title"),
            risk.get("level") or "yellow",
            risk.get("description"),
            risk.get("suggestion"),
        )

    deduped = []
    seen = set()
    for item in items:
        if item["key"] in seen:
            continue
        seen.add(item["key"])
        deduped.append(item)
    return deduped


def _revision_run(text: str, run_properties, deleted: bool = False):
    run = OxmlElement("w:r")
    if run_properties is not None:
        run.append(deepcopy(run_properties))
    text_element = OxmlElement("w:delText" if deleted else "w:t")
    if text.startswith(" ") or text.endswith(" "):
        text_element.set(qn("xml:space"), "preserve")
    text_element.text = text
    run.append(text_element)
    return run


def add_tracked_revision(paragraph, exact_text: str, replacement: str, revision_id: int) -> bool:
    """Replace an exact single-run anchor with native w:del/w:ins markup.

    Refuse fuzzy or cross-run replacements; callers then fall back to a comment.
    This keeps the uploaded DOCX structure unchanged outside the exact anchor.
    """
    if not exact_text or not replacement:
        return False

    for run in paragraph.runs:
        original = run.text or ""
        start = original.find(exact_text)
        if start < 0:
            continue
        end = start + len(exact_text)
        parent = run._r.getparent()
        insert_at = parent.index(run._r)
        run_properties = run._r.rPr
        prefix, suffix = original[:start], original[end:]
        revision_date = datetime.now(timezone.utc).isoformat()

        new_elements = []
        if prefix:
            new_elements.append(_revision_run(prefix, run_properties))

        deleted = OxmlElement("w:del")
        deleted.set(qn("w:id"), str(revision_id))
        deleted.set(qn("w:author"), "ONES 业务运营")
        deleted.set(qn("w:date"), revision_date)
        deleted.append(_revision_run(exact_text, run_properties, deleted=True))
        new_elements.append(deleted)

        inserted = OxmlElement("w:ins")
        inserted.set(qn("w:id"), str(revision_id + 1))
        inserted.set(qn("w:author"), "ONES 业务运营")
        inserted.set(qn("w:date"), revision_date)
        inserted.append(_revision_run(replacement, run_properties))
        new_elements.append(inserted)

        if suffix:
            new_elements.append(_revision_run(suffix, run_properties))

        parent.remove(run._r)
        for offset, element in enumerate(new_elements):
            parent.insert(insert_at + offset, element)
        return True
    return False


def macro_asset_hashes(package_path: str) -> dict[str, str]:
    with zipfile.ZipFile(package_path) as package:
        return {
            name: hashlib.sha256(package.read(name)).hexdigest()
            for name in package.namelist()
            if "/vba" in name.lower() or name.lower().startswith("vba")
        }


def _docm_failure(error_code: str, error: str) -> dict[str, Any]:
    return {"success": False, "valid": False, "error_code": error_code, "error": error}


def _validate_zip_members(package: zipfile.ZipFile) -> dict[str, Any] | None:
    infos = package.infolist()
    if len(infos) > MAX_DOCM_ENTRIES:
        return _docm_failure("DOCM_ZIP_LIMIT_EXCEEDED", "DOCM 包含过多 ZIP 条目")

    seen: set[str] = set()
    total_size = 0
    for info in infos:
        raw_name = info.filename
        if not raw_name or "\\" in raw_name or "\x00" in raw_name or raw_name.startswith("/"):
            return _docm_failure("DOCM_ZIP_PATH_INVALID", f"DOCM 包含异常部件路径：{raw_name!r}")
        normalized = posixpath.normpath(raw_name.rstrip("/"))
        if normalized in ("", ".") or normalized.startswith("../") or normalized != raw_name.rstrip("/"):
            return _docm_failure("DOCM_ZIP_PATH_INVALID", f"DOCM 包含非规范部件路径：{raw_name}")
        normalized_key = normalized.casefold()
        if normalized_key in seen:
            return _docm_failure("DOCM_ZIP_DUPLICATE_MEMBER", f"DOCM 包含重复或大小写冲突部件：{raw_name}")
        seen.add(normalized_key)

        if info.flag_bits & 0x1:
            return _docm_failure("DOCM_ZIP_ENCRYPTED", f"DOCM 部件使用 ZIP 加密，已拒绝：{raw_name}")
        if info.compress_type not in ALLOWED_DOCM_COMPRESSION:
            return _docm_failure("DOCM_ZIP_COMPRESSION_UNSUPPORTED", f"DOCM 部件使用非 OPC 压缩方式：{raw_name}")
        if info.file_size > MAX_DOCM_ENTRY_SIZE:
            return _docm_failure("DOCM_ZIP_LIMIT_EXCEEDED", f"DOCM 单个部件解压后过大：{raw_name}")
        total_size += info.file_size
        if total_size > MAX_DOCM_TOTAL_SIZE:
            return _docm_failure("DOCM_ZIP_LIMIT_EXCEEDED", "DOCM 解压后总大小超过安全上限")
        if info.file_size and (
            info.compress_size == 0
            or info.file_size / info.compress_size > MAX_DOCM_COMPRESSION_RATIO
        ):
            return _docm_failure("DOCM_ZIP_RATIO_EXCEEDED", f"DOCM 部件压缩比异常：{raw_name}")
    return None


def _parse_package_xml(data: bytes):
    return ET.fromstring(data, parser=ET.XMLParser(resolve_entities=False, no_network=True, huge_tree=False))


def _parse_content_types(root) -> tuple[dict[str, str], dict[str, str]]:
    defaults: dict[str, str] = {}
    overrides: dict[str, str] = {}
    override_keys: set[str] = set()
    for node in root.findall(xml_name(CONTENT_TYPE_NS, "Default")):
        extension = (node.get("Extension") or "").lower()
        content_type = node.get("ContentType") or ""
        if (
            not extension
            or any(character in extension for character in (".", "/", "\\", "\x00"))
            or extension in defaults
            or "/" not in content_type
        ):
            raise ValueError(f"duplicate or empty Default Content-Type: {extension}")
        defaults[extension] = content_type
    for node in root.findall(xml_name(CONTENT_TYPE_NS, "Override")):
        part_name = node.get("PartName") or ""
        content_type = node.get("ContentType") or ""
        part_key = part_name.casefold()
        if (
            not part_name.startswith("/")
            or "\\" in part_name
            or "\x00" in part_name
            or posixpath.normpath(part_name) != part_name
            or part_key in override_keys
            or "/" not in content_type
        ):
            raise ValueError(f"duplicate or invalid Override Content-Type: {part_name}")
        override_keys.add(part_key)
        overrides[part_name] = content_type
    return defaults, overrides


def _content_type_for_part(part_name: str, defaults: dict[str, str], overrides: dict[str, str]) -> str | None:
    if part_name in overrides:
        return overrides[part_name]
    extension = posixpath.basename(part_name).rsplit(".", 1)[-1].lower()
    return defaults.get(extension)


def _resolve_internal_part_target(source_part: str, target: str) -> str | None:
    parsed = urlsplit(target)
    if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment:
        return None
    decoded = unquote(parsed.path)
    if not decoded or "\\" in decoded or "\x00" in decoded:
        return None
    segments = [] if decoded.startswith("/") else [
        segment for segment in posixpath.dirname(source_part).split("/") if segment
    ]
    for segment in decoded.split("/"):
        if not segment:
            continue
        if segment == ".":
            return None
        if segment == "..":
            if not segments:
                return None
            segments.pop()
            continue
        segments.append(segment)
    return "/" + "/".join(segments) if segments else None


def _source_part_for_relationship_part(relationship_part: str) -> str:
    if relationship_part == "_rels/.rels":
        return "/"
    marker = "/_rels/"
    if marker not in relationship_part:
        raise ValueError(f"invalid relationship part path: {relationship_part}")
    prefix, leaf = relationship_part.split(marker, 1)
    if not prefix or "/" in leaf or not leaf.endswith(".rels"):
        raise ValueError(f"invalid relationship part path: {relationship_part}")
    source_leaf = leaf[:-5]
    if not source_leaf:
        raise ValueError(f"invalid relationship source: {relationship_part}")
    return "/" + posixpath.join(prefix, source_leaf).lstrip("/")


def _is_relationship_part_name(part_name: str) -> bool:
    normalized = part_name.lstrip("/")
    if normalized == "_rels/.rels":
        return True
    if "/_rels/" not in normalized or not normalized.endswith(".rels"):
        return False
    prefix, leaf = normalized.split("/_rels/", 1)
    return bool(prefix and leaf and "/" not in leaf)


def _collect_package_relationships(package: zipfile.ZipFile, names: set[str]) -> list[dict[str, str]]:
    relationships: list[dict[str, str]] = []
    relationship_parts = sorted(
        name for name in names
        if name == "_rels/.rels" or ("/_rels/" in name and name.endswith(".rels"))
    )
    for relationship_part in relationship_parts:
        source_part = _source_part_for_relationship_part(relationship_part)
        if source_part != "/" and source_part.lstrip("/") not in names:
            raise ValueError(f"relationship source part does not exist: {relationship_part}")
        if source_part != "/" and _is_relationship_part_name(source_part):
            raise ValueError(f"relationship part cannot be a relationship source: {relationship_part}")
        root = _parse_package_xml(package.read(relationship_part))
        if root.tag != xml_name(REL_NS, "Relationships"):
            raise ValueError(f"invalid relationship root: {relationship_part}")
        seen_ids: set[str] = set()
        for node in root:
            if node.tag != xml_name(REL_NS, "Relationship"):
                raise ValueError(f"invalid relationship element: {relationship_part}")
            relationship_id = node.get("Id") or ""
            relationship_type = node.get("Type") or ""
            target = node.get("Target") or ""
            target_mode = node.get("TargetMode", "Internal")
            if (
                not relationship_id
                or relationship_id in seen_ids
                or not relationship_type
                or not target
                or target_mode not in {"Internal", "External"}
            ):
                raise ValueError(f"invalid or duplicate relationship: {relationship_part}")
            resolved_target = None
            if target_mode == "Internal":
                resolved_target = _resolve_internal_part_target(source_part, target)
                if resolved_target is None or resolved_target.lstrip("/") not in names:
                    raise ValueError(f"relationship target part does not exist: {relationship_part} -> {target}")
                if (
                    resolved_target == "/[Content_Types].xml"
                    or _is_relationship_part_name(resolved_target)
                ):
                    raise ValueError(f"relationship cannot target a package metadata part: {relationship_part} -> {target}")
            seen_ids.add(relationship_id)
            relationships.append({
                "part": relationship_part,
                "source": source_part,
                "id": relationship_id,
                "type": relationship_type,
                "target": target,
                "target_mode": target_mode,
                "resolved_target": resolved_target or "",
            })
    return relationships


def _validate_vba_project(data: bytes) -> dict[str, Any] | None:
    if olefile is None or VBA_Parser is None:
        return _docm_failure(
            "DOCM_OLE_INSPECTOR_UNAVAILABLE",
            "DOCM 宏检查器不可用；请安装 requirements.txt 中固定版本的 olefile 与 oletools",
        )
    vba_parser = None
    try:
        with olefile.OleFileIO(BytesIO(data), raise_defects=olefile.DEFECT_INCORRECT) as compound:
            paths = compound.listdir(streams=True, storages=False)
            by_name = {"/".join(path).casefold(): path for path in paths}
            if len(by_name) != len(paths):
                return _docm_failure("DOCM_VBA_PROJECT_INVALID", "VBA Project 包含重复的 OLE stream")
            required = ("project", "vba/_vba_project", "vba/dir")
            missing = [name for name in required if name not in by_name]
            if missing:
                return _docm_failure(
                    "DOCM_VBA_PROJECT_INVALID",
                    f"VBA Project 缺少必需 stream：{', '.join(missing)}",
                )
            required_streams = {
                name: compound.openstream(by_name[name]).read()
                for name in required
            }
            for name, stream_data in required_streams.items():
                if not stream_data or not any(stream_data):
                    return _docm_failure("DOCM_VBA_PROJECT_INVALID", f"VBA Project stream 为空或仅含零字节：{name}")
            project_stream = required_streams["project"]
            if b'ID="' not in project_stream or not any(
                marker in project_stream for marker in (b"Document=", b"Module=", b"Class=")
            ):
                return _docm_failure("DOCM_VBA_PROJECT_INVALID", "VBA PROJECT stream 缺少项目或模块声明")
            project_binary = required_streams["vba/_vba_project"]
            if len(project_binary) < 7 or project_binary[:2] != b"\xcc\x61":
                return _docm_failure("DOCM_VBA_PROJECT_INVALID", "VBA _VBA_PROJECT 固定头无效")
            if not required_streams["vba/dir"].startswith(b"\x01"):
                return _docm_failure("DOCM_VBA_PROJECT_INVALID", "VBA dir 不是有效的 MS-OVBA 压缩容器")
            module_streams = [
                name for name in by_name
                if name.startswith("vba/")
                and name not in {"vba/_vba_project", "vba/dir"}
                and not name.startswith("vba/__srp_")
            ]
            if not module_streams:
                return _docm_failure("DOCM_VBA_PROJECT_INVALID", "VBA Project 未包含任何模块 stream")

        # oletools performs a strict, static MS-OVBA dir/module decompression. It
        # parses bytes only; it does not instantiate Office or execute macros.
        vba_parser = VBA_Parser("vbaProject.bin", data=data, relaxed=False)
        if not vba_parser.detect_vba_macros():
            return _docm_failure("DOCM_VBA_PROJECT_INVALID", "VBA Project 无法解析出有效宏模块")
        extracted_modules = list(vba_parser.extract_macros())
        parsed_streams: set[str] = set()
        for _, stream_path, _, vba_code in extracted_modules:
            normalized_stream = (stream_path or "").replace("\\", "/").casefold()
            if not normalized_stream or not vba_code or not vba_code.strip():
                return _docm_failure("DOCM_VBA_PROJECT_INVALID", "VBA 模块 stream 或解压后的源码为空")
            parsed_streams.add(normalized_stream)
        if parsed_streams != set(module_streams):
            return _docm_failure(
                "DOCM_VBA_PROJECT_INVALID",
                "VBA dir 声明的模块与 OLE module streams 不一致",
            )
    except Exception as error:
        return _docm_failure("DOCM_VBA_PROJECT_INVALID", f"vbaProject.bin 无法作为 OLE CFB 解析：{error}")
    finally:
        if vba_parser is not None:
            vba_parser.close()
    return None


def validate_docm_package(package_path: str) -> dict[str, Any]:
    """Validate the OPC/VBA graph without executing macros or trusting extensions."""
    try:
        with zipfile.ZipFile(package_path) as package:
            zip_error = _validate_zip_members(package)
            if zip_error:
                return zip_error

            names = {info.filename for info in package.infolist() if not info.is_dir()}
            required = {
                "[Content_Types].xml",
                "_rels/.rels",
                "word/document.xml",
                "word/_rels/document.xml.rels",
            }
            missing = sorted(required - names)
            if missing:
                return _docm_failure("DOCM_PACKAGE_PART_MISSING", f"DOCM 缺少必需部件：{', '.join(missing)}")

            content_types = _parse_package_xml(package.read("[Content_Types].xml"))
            if content_types.tag != xml_name(CONTENT_TYPE_NS, "Types"):
                return _docm_failure("DOCM_CONTENT_TYPE_INVALID", "DOCM Content-Types 根元素无效")
            defaults, overrides = _parse_content_types(content_types)
            actual_part_uris = {"/" + name for name in names if name != "[Content_Types].xml"}
            orphan_overrides = sorted(part for part in overrides if part not in actual_part_uris)
            if orphan_overrides:
                return _docm_failure(
                    "DOCM_CONTENT_TYPE_INVALID",
                    f"DOCM Content-Type Override 未精确对应实际部件：{', '.join(orphan_overrides)}",
                )
            untyped_parts = sorted(
                part for part in actual_part_uris
                if _content_type_for_part(part, defaults, overrides) is None
            )
            if untyped_parts:
                return _docm_failure(
                    "DOCM_CONTENT_TYPE_INVALID",
                    f"DOCM 部件缺少有效 Content-Type：{', '.join(untyped_parts)}",
                )
            relationship_typed_parts = {
                part for part in actual_part_uris
                if _content_type_for_part(part, defaults, overrides) == RELATIONSHIPS_CONTENT_TYPE
            }
            recognized_relationship_parts = {
                part for part in actual_part_uris if _is_relationship_part_name(part)
            }
            invalid_relationship_types = sorted(
                relationship_typed_parts.symmetric_difference(recognized_relationship_parts)
            )
            if invalid_relationship_types:
                return _docm_failure(
                    "DOCM_CONTENT_TYPE_INVALID",
                    f"DOCM relationship part 的 Content-Type 无效：{', '.join(invalid_relationship_types)}",
                )
            if _content_type_for_part("/word/document.xml", defaults, overrides) != DOCM_MAIN_CONTENT_TYPE:
                return _docm_failure("DOCM_CONTENT_TYPE_INVALID", "DOCM 主文档不是宏启用 Content-Type")
            document_root = _parse_package_xml(package.read("word/document.xml"))
            if document_root.tag != xml_name(WORD_NS, "document"):
                return _docm_failure("DOCM_MAIN_DOCUMENT_INVALID", "word/document.xml 根元素不是规范 w:document")

            relationships = _collect_package_relationships(package, names)
            office_relationships = [
                relationship for relationship in relationships
                if relationship["type"] == OFFICE_DOCUMENT_REL_TYPE
            ]
            if len(office_relationships) != 1:
                return _docm_failure(
                    "DOCM_OFFICE_RELATIONSHIP_INVALID",
                    "DOCM package root 必须恰好包含一个 officeDocument relationship",
                )
            office_relationship = office_relationships[0]
            if (
                office_relationship["source"] != "/"
                or office_relationship["target_mode"] != "Internal"
                or _resolve_internal_part_target("/", office_relationship["target"]) != "/word/document.xml"
            ):
                return _docm_failure(
                    "DOCM_OFFICE_RELATIONSHIP_INVALID",
                    "DOCM package root 未精确指向 /word/document.xml",
                )

            effective_content_types = {
                "/" + name: _content_type_for_part("/" + name, defaults, overrides)
                for name in names
            }
            vba_project_parts = {
                part for part, content_type in effective_content_types.items()
                if content_type == VBA_PROJECT_CONTENT_TYPE
            }
            vba_data_parts = {
                part for part, content_type in effective_content_types.items()
                if content_type == VBA_DATA_CONTENT_TYPE
            }
            project_default_extensions = {
                extension for extension, content_type in defaults.items()
                if content_type == VBA_PROJECT_CONTENT_TYPE
            }
            data_default_extensions = {
                extension for extension, content_type in defaults.items()
                if content_type == VBA_DATA_CONTENT_TYPE
            }
            project_override_parts = {
                part for part, content_type in overrides.items()
                if content_type == VBA_PROJECT_CONTENT_TYPE
            }
            data_override_parts = {
                part for part, content_type in overrides.items()
                if content_type == VBA_DATA_CONTENT_TYPE
            }
            vba_relationships = [
                relationship for relationship in relationships
                if relationship["type"] == VBA_PROJECT_REL_TYPE
            ]
            data_relationships = [
                relationship for relationship in relationships
                if relationship["type"] == VBA_DATA_REL_TYPE
            ]

            if not vba_relationships:
                if (
                    vba_project_parts
                    or vba_data_parts
                    or project_default_extensions
                    or data_default_extensions
                    or project_override_parts
                    or data_override_parts
                    or data_relationships
                ):
                    return _docm_failure("DOCM_VBA_GRAPH_INCOMPLETE", "DOCM 含孤立的 VBA 部件或 Content-Type")
                return {"valid": True, "macro_project_present": False}

            if len(vba_relationships) != 1:
                return _docm_failure("DOCM_VBA_RELATIONSHIP_INVALID", "DOCM 必须恰好包含一个 VBA Project relationship")
            relationship = vba_relationships[0]
            if (
                relationship["source"] != "/word/document.xml"
                or relationship["target_mode"] != "Internal"
                or _resolve_internal_part_target(relationship["source"], relationship["target"])
                != "/word/vbaProject.bin"
            ):
                return _docm_failure("DOCM_VBA_RELATIONSHIP_INVALID", "VBA Project relationship 未精确指向 /word/vbaProject.bin")

            vba_required = {
                "word/vbaProject.bin",
                "word/vbaData.xml",
                "word/_rels/vbaProject.bin.rels",
            }
            missing_vba = sorted(vba_required - names)
            if missing_vba:
                return _docm_failure("DOCM_VBA_GRAPH_INCOMPLETE", f"DOCM VBA 图缺少部件：{', '.join(missing_vba)}")
            if _content_type_for_part("/word/vbaProject.bin", defaults, overrides) != VBA_PROJECT_CONTENT_TYPE:
                return _docm_failure("DOCM_CONTENT_TYPE_INVALID", "vbaProject.bin 的有效 Content-Type 不正确")
            if _content_type_for_part("/word/vbaData.xml", defaults, overrides) != VBA_DATA_CONTENT_TYPE:
                return _docm_failure("DOCM_CONTENT_TYPE_INVALID", "vbaData.xml 的有效 Content-Type 不正确")
            if vba_project_parts != {"/word/vbaProject.bin"} or vba_data_parts != {"/word/vbaData.xml"}:
                return _docm_failure(
                    "DOCM_VBA_GRAPH_AMBIGUOUS",
                    "DOCM 的有效 VBA Content-Type 未唯一绑定到标准 VBA Project/Data 部件",
                )
            if (
                project_default_extensions - {"bin"}
                or data_default_extensions
                or project_override_parts - {"/word/vbaProject.bin"}
                or data_override_parts - {"/word/vbaData.xml"}
            ):
                return _docm_failure("DOCM_VBA_GRAPH_AMBIGUOUS", "DOCM 包含额外或歧义 VBA Content-Type 声明")

            if len(data_relationships) != 1:
                return _docm_failure("DOCM_VBA_DATA_RELATIONSHIP_INVALID", "VBA Project 必须恰好关联一个 VBA Supplemental Data")
            data_relationship = data_relationships[0]
            if (
                data_relationship["source"] != "/word/vbaProject.bin"
                or data_relationship["target_mode"] != "Internal"
                or _resolve_internal_part_target(data_relationship["source"], data_relationship["target"])
                != "/word/vbaData.xml"
            ):
                return _docm_failure("DOCM_VBA_DATA_RELATIONSHIP_INVALID", "VBA Supplemental Data relationship 目标无效")

            vba_data_root = _parse_package_xml(package.read("word/vbaData.xml"))
            if vba_data_root.tag != xml_name(VBA_DATA_NS, "vbaSuppData"):
                return _docm_failure("DOCM_VBA_DATA_INVALID", "vbaData.xml 根元素不是规范 vbaSuppData")

            vba_error = _validate_vba_project(package.read("word/vbaProject.bin"))
            if vba_error:
                return vba_error
    except (KeyError, ValueError, ET.XMLSyntaxError, zipfile.BadZipFile, OSError) as error:
        return _docm_failure("DOCM_PACKAGE_INVALID", f"DOCM 包结构无效：{error}")
    return {"valid": True, "macro_project_present": True}


def has_opc_digital_signature(package_path: str) -> bool:
    with zipfile.ZipFile(package_path) as package:
        return any(name.lower().startswith("_xmlsignatures/") for name in package.namelist())


def _paragraph_for_anchor(document_root, anchor_text: str):
    for candidate in significant_anchors(anchor_text):
        needle = normalize(candidate)
        matches = []
        for paragraph in document_root.iter(xml_name(WORD_NS, "p")):
            text = "".join(node.text or "" for node in paragraph.iter(xml_name(WORD_NS, "t")))
            if needle and needle in normalize(text):
                matches.append(paragraph)
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            return None
    return None


def _xml_run_text(run) -> str:
    return "".join(node.text or "" for node in run.iter(xml_name(WORD_NS, "t")))


def _split_xml_run_at(run, offset: int):
    text = _xml_run_text(run)
    if offset <= 0:
        return run
    if offset >= len(text):
        return None
    text_nodes = list(run.iter(xml_name(WORD_NS, "t")))
    if len(text_nodes) != 1 or (text_nodes[0].text or "") != text:
        return None
    right = deepcopy(run)
    run.addnext(right)
    left_text = text[:offset]
    right_text = text[offset:]
    text_nodes[0].text = left_text
    right_node = next(right.iter(xml_name(WORD_NS, "t")))
    right_node.text = right_text
    xml_space = "{http://www.w3.org/XML/1998/namespace}space"
    for node, value in ((text_nodes[0], left_text), (right_node, right_text)):
        if value.startswith(" ") or value.endswith(" "):
            node.set(xml_space, "preserve")
        else:
            node.attrib.pop(xml_space, None)
    return right


def _exact_xml_comment_runs(paragraph, exact_text: str):
    runs = [child for child in paragraph if child.tag == xml_name(WORD_NS, "r")]
    full_text = "".join(_xml_run_text(run) for run in runs)
    positions = []
    offset = 0
    while exact_text:
        found = full_text.find(exact_text, offset)
        if found < 0:
            break
        positions.append(found)
        offset = found + 1
    if len(positions) != 1:
        return None

    start = positions[0]
    end = start + len(exact_text)
    cursor = 0
    start_run = end_run = None
    start_offset = end_offset = 0
    for run in runs:
        run_text = _xml_run_text(run)
        run_end = cursor + len(run_text)
        if start_run is None and cursor <= start < run_end:
            start_run, start_offset = run, start - cursor
        if cursor < end <= run_end:
            end_run, end_offset = run, end - cursor
            break
        cursor = run_end
    if start_run is None or end_run is None:
        return None
    if 0 < end_offset < len(_xml_run_text(end_run)) and _split_xml_run_at(end_run, end_offset) is None:
        return None
    if 0 < start_offset < len(_xml_run_text(start_run)) and _split_xml_run_at(start_run, start_offset) is None:
        return None

    selected = []
    cursor = 0
    for run in [child for child in paragraph if child.tag == xml_name(WORD_NS, "r")]:
        run_text = _xml_run_text(run)
        run_end = cursor + len(run_text)
        if run_text and cursor >= start and run_end <= end:
            selected.append(run)
        cursor = run_end
    if not selected or "".join(_xml_run_text(run) for run in selected) != exact_text:
        return None
    return selected[0], selected[-1]


def _next_relationship_id(root) -> str:
    used = {relationship.get("Id") for relationship in root}
    index = 1
    while f"rId{index}" in used:
        index += 1
    return f"rId{index}"


def generate_macro_document(input_path: str, output_path: str, data: dict[str, Any]) -> dict[str, Any]:
    """Insert native comments by OOXML package surgery, preserving VBA bytes."""
    source_validation = validate_docm_package(input_path)
    if not source_validation["valid"]:
        return source_validation

    items = build_comment_items(data)
    if not items:
        return {"success": False, "error": "没有可写入源 DOCM 的客户侧批注"}

    ET.register_namespace("w", WORD_NS)
    with zipfile.ZipFile(input_path) as source:
        names = source.namelist()
        infos = {info.filename: info for info in source.infolist()}
        document_bytes = source.read("word/document.xml")
        comments_name = "word/comments.xml"
        comments_bytes = source.read(comments_name) if comments_name in infos else None
        rels_name = "word/_rels/document.xml.rels"
        rels_bytes = source.read(rels_name)
        content_types_name = "[Content_Types].xml"
        content_types_bytes = source.read(content_types_name)

    document_root = _parse_package_xml(document_bytes)
    comments_root = _parse_package_xml(comments_bytes) if comments_bytes else ET.Element(xml_name(WORD_NS, "comments"))
    existing_ids = [
        int(value) for comment in comments_root.findall(xml_name(WORD_NS, "comment"))
        if (value := comment.get(xml_name(WORD_NS, "id"), "")).isdigit()
    ]
    next_comment_id = max(existing_ids, default=-1) + 1
    anchored = 0
    unlocated = []

    for item in items:
        paragraph = _paragraph_for_anchor(document_root, item.get("anchor") or "")
        if paragraph is None:
            unlocated.append(item.get("title") or (item.get("anchor") or "")[:30])
            continue
        comment_range = _exact_xml_comment_runs(
            paragraph,
            item.get("exact_text") or item.get("anchor") or "",
        )
        if comment_range is None:
            unlocated.append(item.get("title") or (item.get("anchor") or "")[:30])
            continue
        comment_text = item.get("comment") or (
            f"建议受控替换为：{item.get('replacement')}" if item.get("replacement") else ""
        )
        if not comment_text:
            continue

        comment_id = str(next_comment_id)
        next_comment_id += 1
        start_marker = ET.Element(xml_name(WORD_NS, "commentRangeStart"), {xml_name(WORD_NS, "id"): comment_id})
        end_marker = ET.Element(xml_name(WORD_NS, "commentRangeEnd"), {xml_name(WORD_NS, "id"): comment_id})
        reference_run = ET.Element(xml_name(WORD_NS, "r"))
        reference_props = ET.SubElement(reference_run, xml_name(WORD_NS, "rPr"))
        ET.SubElement(reference_props, xml_name(WORD_NS, "rStyle"), {xml_name(WORD_NS, "val"): "CommentReference"})
        ET.SubElement(reference_run, xml_name(WORD_NS, "commentReference"), {xml_name(WORD_NS, "id"): comment_id})
        first_run, last_run = comment_range
        first_run.addprevious(start_marker)
        last_run.addnext(end_marker)
        end_marker.addnext(reference_run)

        comment = ET.SubElement(comments_root, xml_name(WORD_NS, "comment"), {
            xml_name(WORD_NS, "id"): comment_id,
            xml_name(WORD_NS, "author"): "ONES 业务运营",
            xml_name(WORD_NS, "initials"): "ONES",
            xml_name(WORD_NS, "date"): datetime.now(timezone.utc).isoformat(),
        })
        comment_paragraph = ET.SubElement(comment, xml_name(WORD_NS, "p"))
        comment_run = ET.SubElement(comment_paragraph, xml_name(WORD_NS, "r"))
        ET.SubElement(comment_run, xml_name(WORD_NS, "t")).text = comment_text
        anchored += 1

    if anchored == 0:
        return {"success": False, "error": "所有批注都无法稳定定位到源 DOCM", "unlocated": unlocated}

    replacements = {
        "word/document.xml": ET.tostring(document_root, encoding="utf-8", xml_declaration=True),
        comments_name: ET.tostring(comments_root, encoding="utf-8", xml_declaration=True),
    }

    rels_root = _parse_package_xml(rels_bytes)
    if not any(relationship.get("Type") == COMMENTS_REL_TYPE for relationship in rels_root):
        ET.SubElement(rels_root, xml_name(REL_NS, "Relationship"), {
            "Id": _next_relationship_id(rels_root),
            "Type": COMMENTS_REL_TYPE,
            "Target": "comments.xml",
        })
    replacements[rels_name] = ET.tostring(rels_root, encoding="utf-8", xml_declaration=True)

    content_types = _parse_package_xml(content_types_bytes)
    if not any(node.get("PartName") == "/word/comments.xml" for node in content_types):
        ET.SubElement(content_types, xml_name(CONTENT_TYPE_NS, "Override"), {
            "PartName": "/word/comments.xml",
            "ContentType": COMMENTS_CONTENT_TYPE,
        })
    replacements[content_types_name] = ET.tostring(content_types, encoding="utf-8", xml_declaration=True)

    with zipfile.ZipFile(input_path) as source, zipfile.ZipFile(output_path, "w") as output:
        for name in names:
            if name in replacements:
                output.writestr(infos[name], replacements[name])
                continue
            with source.open(infos[name], "r") as source_part, output.open(infos[name], "w") as output_part:
                shutil.copyfileobj(source_part, output_part, length=1024 * 1024)
        if comments_name not in infos:
            output.writestr(comments_name, replacements[comments_name], compress_type=zipfile.ZIP_DEFLATED)

    output_validation = validate_docm_package(output_path)
    if not output_validation["valid"]:
        Path(output_path).unlink(missing_ok=True)
        return {
            "success": False,
            "error_code": "DOCM_MACRO_PACKAGE_CORRUPTED",
            "error": "DOCM 宏包在批注往返中失去有效结构，已拒绝输出",
        }

    source_macro_hashes = macro_asset_hashes(input_path)
    if source_macro_hashes != macro_asset_hashes(output_path):
        Path(output_path).unlink(missing_ok=True)
        return {
            "success": False,
            "error_code": "DOCM_MACRO_ASSET_CHANGED",
            "error": "DOCM 宏资产在批注往返中发生变化，已拒绝输出",
        }
    return {
        "success": True,
        "anchored": anchored,
        "revisions": 0,
        "unlocated": unlocated,
        "macro_assets_verified": len(source_macro_hashes),
        "macro_project_present": source_validation.get("macro_project_present", False),
    }


def generate_document(input_path: str, output_path: str, comments_json: str) -> dict[str, Any]:
    try:
        if not input_path:
            return {"success": False, "error": "源 DOCX 文件不存在，不能生成原生批注版"}
        if has_opc_digital_signature(input_path):
            return {"success": False, "error": "Word 文件包含 OPC 数字签名；写入批注会使签名失效，已拒绝输出"}

        data = json.loads(comments_json)
        if isinstance(data, list):
            data = {"risks": data}

        if input_path.lower().endswith(".docm"):
            return generate_macro_document(input_path, output_path, data)

        doc = Document(input_path)
        items = build_comment_items(data)
        if not items:
            return {"success": False, "error": "没有可写入源文件批注的风险或反馈项"}

        anchored = 0
        revisions = 0
        unlocated = []
        existing_revision_ids = []
        for element in doc.element.iter():
            if element.tag not in (qn("w:del"), qn("w:ins")):
                continue
            value = element.get(qn("w:id"))
            if value is not None and str(value).isdigit():
                existing_revision_ids.append(int(value))
        next_revision_id = max(existing_revision_ids, default=-1) + 1
        for item in items:
            paragraph = find_paragraph(doc, item["anchor"])
            if paragraph is None:
                unlocated.append(item.get("title") or item["anchor"][:30])
                continue

            if item.get("kind") == "revision" and add_tracked_revision(
                paragraph,
                item.get("exact_text") or "",
                item.get("replacement") or "",
                next_revision_id,
            ):
                next_revision_id += 2
                revisions += 1
                anchored += 1
                continue

            fallback_comment = item.get("comment") or (
                f"建议受控替换为：{item.get('replacement')}"
                if item.get("replacement") else ""
            )
            if not fallback_comment:
                unlocated.append(item.get("title") or item["anchor"][:30])
                continue
            comment_runs = exact_comment_runs(paragraph, item.get("exact_text") or item["anchor"])
            if not comment_runs:
                unlocated.append(item.get("title") or item["anchor"][:30])
                continue

            doc.add_comment(
                comment_runs,
                text=fallback_comment,
                author="ONES 业务运营",
                initials="ONES",
            )
            anchored += 1

        if anchored == 0:
            return {
                "success": False,
                "error": "所有批注都无法稳定定位到源文件，已拒绝生成伪批注版",
                "unlocated": unlocated,
            }

        doc.save(output_path)
        return {
            "success": True,
            "message": f"Document saved to {output_path}",
            "anchored": anchored,
            "revisions": revisions,
            "unlocated": unlocated,
        }

    except Exception as error:
        return {"success": False, "error": str(error)}


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python word-generator.py <input_docx> <output_docx> <comments_json>")
        sys.exit(1)

    result = generate_document(sys.argv[1], sys.argv[2], sys.argv[3])
    print(json.dumps(result, ensure_ascii=False))
