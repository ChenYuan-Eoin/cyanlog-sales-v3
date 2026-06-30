#!/usr/bin/env python3
"""
Generate a Word document with native Word comments for contract review.

Usage: python word-generator.py <input_docx_path> <output_docx_path> <export_data_json>
"""

import json
import os
import sys
import zipfile
from copy import deepcopy
from datetime import datetime, timezone
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
COMMENTS_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments"
COMMENTS_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"
AUTHOR = "ONES 业务运营"
INITIALS = "OB"

ET.register_namespace("w", W_NS)
ET.register_namespace("r", R_NS)
ET.register_namespace("", REL_NS)


def qn(ns, tag):
    return f"{{{ns}}}{tag}"


def safe_text(value):
    if value is None:
        return ""
    return str(value)


def paragraph_text(paragraph):
    return "".join(node.text or "" for node in paragraph.iter(qn(W_NS, "t")))


def normalize_comments(payload):
    if isinstance(payload, list):
        source_items = payload
        annotations = []
    else:
        source_items = payload.get("risks") or []
        annotations = payload.get("annotations") or []

    comments = []
    for annotation in annotations:
        if not isinstance(annotation, dict):
            continue
        if annotation.get("status") and annotation.get("status") != "open":
            continue
        comments.append({
            "title": "风险批注",
            "body": safe_text(annotation.get("comment")),
            "selected_text": safe_text(annotation.get("selected_text")),
            "level": safe_text(annotation.get("priority") or "high"),
        })

    if comments:
        return comments

    for item in source_items:
        if not isinstance(item, dict):
            continue
        title = safe_text(item.get("title") or "风险项")
        description = safe_text(item.get("description"))
        suggestion = safe_text(item.get("suggestion"))
        level = safe_text(item.get("level") or "yellow")
        body_lines = [f"【{level}】{title}"]
        if description:
            body_lines.append(f"问题：{description}")
        if suggestion:
            body_lines.append(f"建议：{suggestion}")
        comments.append({
            "title": title,
            "body": "\n".join(body_lines),
            "selected_text": title,
            "level": level,
        })

    return comments


def create_comment_element(comment_id, body):
    comment = ET.Element(qn(W_NS, "comment"), {
        qn(W_NS, "id"): str(comment_id),
        qn(W_NS, "author"): AUTHOR,
        qn(W_NS, "initials"): INITIALS,
        qn(W_NS, "date"): datetime.now(timezone.utc).isoformat(),
    })
    for line in safe_text(body).splitlines() or [""]:
        paragraph = ET.SubElement(comment, qn(W_NS, "p"))
        run = ET.SubElement(paragraph, qn(W_NS, "r"))
        text = ET.SubElement(run, qn(W_NS, "t"))
        text.text = line
    return comment


def create_comment_reference(comment_id):
    run = ET.Element(qn(W_NS, "r"))
    ref = ET.SubElement(run, qn(W_NS, "commentReference"))
    ref.set(qn(W_NS, "id"), str(comment_id))
    return run


def anchor_comment(paragraph, comment_id):
    start = ET.Element(qn(W_NS, "commentRangeStart"))
    start.set(qn(W_NS, "id"), str(comment_id))
    end = ET.Element(qn(W_NS, "commentRangeEnd"))
    end.set(qn(W_NS, "id"), str(comment_id))

    paragraph.insert(0, start)
    paragraph.append(end)
    paragraph.append(create_comment_reference(comment_id))


def load_or_create_comments_tree(zip_file):
    if "word/comments.xml" in zip_file.namelist():
      root = ET.fromstring(zip_file.read("word/comments.xml"))
    else:
      root = ET.Element(qn(W_NS, "comments"))

    max_id = -1
    for comment in root.findall(qn(W_NS, "comment")):
        raw_id = comment.get(qn(W_NS, "id"))
        if raw_id and raw_id.isdigit():
            max_id = max(max_id, int(raw_id))

    return root, max_id + 1


def ensure_comments_relationship(zip_file, modified_files):
    rels_path = "word/_rels/document.xml.rels"
    if rels_path in zip_file.namelist():
        rels_root = ET.fromstring(zip_file.read(rels_path))
    else:
        rels_root = ET.Element(qn(REL_NS, "Relationships"))

    for rel in rels_root.findall(qn(REL_NS, "Relationship")):
        if rel.get("Type") == COMMENTS_REL_TYPE:
            modified_files[rels_path] = ET.tostring(rels_root, encoding="utf-8", xml_declaration=True)
            return

    existing_ids = {rel.get("Id") for rel in rels_root.findall(qn(REL_NS, "Relationship"))}
    rel_id = "rIdComments"
    counter = 1
    while rel_id in existing_ids:
        rel_id = f"rIdComments{counter}"
        counter += 1

    ET.SubElement(rels_root, qn(REL_NS, "Relationship"), {
        "Id": rel_id,
        "Type": COMMENTS_REL_TYPE,
        "Target": "comments.xml",
    })
    modified_files[rels_path] = ET.tostring(rels_root, encoding="utf-8", xml_declaration=True)


def ensure_comments_content_type(zip_file, modified_files):
    content_path = "[Content_Types].xml"
    root = ET.fromstring(zip_file.read(content_path))
    for override in root.findall(qn(CT_NS, "Override")):
        if override.get("PartName") == "/word/comments.xml":
            modified_files[content_path] = ET.tostring(root, encoding="utf-8", xml_declaration=True)
            return

    ET.SubElement(root, qn(CT_NS, "Override"), {
        "PartName": "/word/comments.xml",
        "ContentType": COMMENTS_CONTENT_TYPE,
    })
    modified_files[content_path] = ET.tostring(root, encoding="utf-8", xml_declaration=True)


def write_zip_with_modifications(input_path, output_path, modified_files):
    with zipfile.ZipFile(input_path, "r") as zin:
        written = set()
        with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                if item.filename in written:
                    continue
                data = modified_files.get(item.filename)
                if data is None:
                    data = zin.read(item.filename)
                zout.writestr(item, data)
                written.add(item.filename)

            for filename, data in modified_files.items():
                if filename not in written:
                    zout.writestr(filename, data)


def add_native_comments(input_path, output_path, comments):
    with zipfile.ZipFile(input_path, "r") as zin:
        if "word/document.xml" not in zin.namelist() or "[Content_Types].xml" not in zin.namelist():
            raise ValueError("input file is not a writable docx")

        document_root = ET.fromstring(zin.read("word/document.xml"))
        paragraphs = document_root.findall(f".//{qn(W_NS, 'p')}")
        text_paragraphs = [p for p in paragraphs if paragraph_text(p).strip()]
        if not text_paragraphs:
            raise ValueError("input docx has no text paragraphs")

        comments_root, next_comment_id = load_or_create_comments_tree(zin)
        modified_files = {}

        for index, item in enumerate(comments):
            selected_text = item.get("selected_text", "").strip()
            target = None
            if selected_text:
                target = next((p for p in text_paragraphs if selected_text in paragraph_text(p)), None)
            if target is None:
                target = text_paragraphs[min(index, len(text_paragraphs) - 1)]

            comment_id = next_comment_id
            next_comment_id += 1
            comments_root.append(create_comment_element(comment_id, item.get("body", "")))
            anchor_comment(target, comment_id)

        modified_files["word/document.xml"] = ET.tostring(
            document_root,
            encoding="utf-8",
            xml_declaration=True,
        )
        modified_files["word/comments.xml"] = ET.tostring(
            comments_root,
            encoding="utf-8",
            xml_declaration=True,
        )
        ensure_comments_relationship(zin, modified_files)
        ensure_comments_content_type(zin, modified_files)

    write_zip_with_modifications(input_path, output_path, modified_files)


def p(text):
    return f"<w:p><w:r><w:t>{escape(safe_text(text))}</w:t></w:r></w:p>"


def create_report_docx(output_path, payload, comments, note):
    lines = [
        "ONES 业务运营合同审核批注报告",
        note,
        f"生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
    ]

    if isinstance(payload, dict):
        summary = safe_text(payload.get("summary"))
        if summary:
            lines.extend(["", "审核摘要", summary])
        effectiveness = safe_text(payload.get("effectiveness_analysis"))
        if effectiveness:
            lines.extend(["", "效力与风险分析", effectiveness])

    lines.append("")
    lines.append("风险批注")
    for index, item in enumerate(comments, 1):
        lines.append(f"{index}. {safe_text(item.get('body'))}")

    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:document xmlns:w="{W_NS}" xmlns:r="{R_NS}"><w:body>'
        + "".join(p(line) for line in lines)
        + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>'
        + "</w:body></w:document>"
    )

    content_types = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<Types xmlns="{CT_NS}">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '</Types>'
    )
    package_rels = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<Relationships xmlns="{REL_NS}">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        '</Relationships>'
    )
    document_rels = f'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="{REL_NS}"/>'

    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        zout.writestr("[Content_Types].xml", content_types)
        zout.writestr("_rels/.rels", package_rels)
        zout.writestr("word/document.xml", document_xml)
        zout.writestr("word/_rels/document.xml.rels", document_rels)


def generate_document(input_path, output_path, export_data_json):
    try:
        payload = json.loads(export_data_json)
        comments = normalize_comments(payload)
        if not comments:
            return {"success": False, "error": "没有可导出的风险批注"}

        if input_path and os.path.exists(input_path) and zipfile.is_zipfile(input_path):
            try:
                add_native_comments(input_path, output_path, comments)
                return {
                    "success": True,
                    "message": "Native Word comments were added",
                    "comment_count": len(comments),
                }
            except Exception as native_error:
                create_report_docx(
                    output_path,
                    payload,
                    comments,
                    f"源文件无法写入 Word 原生批注，已生成降级报告：{native_error}",
                )
                return {
                    "success": True,
                    "message": "Fallback report generated",
                    "comment_count": len(comments),
                    "degraded": True,
                }

        create_report_docx(
            output_path,
            payload,
            comments,
            "源文件不是可写 docx，已生成批注报告版本。",
        )
        return {
            "success": True,
            "message": "Fallback report generated",
            "comment_count": len(comments),
            "degraded": True,
        }
    except Exception as error:
        return {"success": False, "error": str(error)}


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python word-generator.py <input_docx> <output_docx> <export_data_json>")
        sys.exit(1)

    result = generate_document(sys.argv[1], sys.argv[2], sys.argv[3])
    print(json.dumps(result, ensure_ascii=False))
