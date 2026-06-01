#!/usr/bin/env python3
"""
Word document comment generator for contract review
REQ:F007

Usage: python word-generator.py <input_docx_path> <output_docx_path> <comments_json>
"""

import sys
import json
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from datetime import datetime


def add_comment_to_paragraph(paragraph, text, comment_id, author="AI审核", color="yellow"):
    """Add a comment to a paragraph"""
    # Create comment element
    comment = OxmlElement('w:comment')
    comment.set(qn('w:id'), str(comment_id))
    comment.set(qn('w:author'), author)
    comment.set(qn('w:date'), datetime.now().isoformat())
    comment.set(qn('w:initials'), 'AI')

    # Create comment paragraph
    comment_para = OxmlElement('w:p')
    comment_run = OxmlElement('w:r')
    comment_text = OxmlElement('w:t')
    comment_text.text = text
    comment_run.append(comment_text)
    comment_para.append(comment_run)
    comment.append(comment_para)

    # Mark the paragraph with comment range
    # Add commentRangeStart at the beginning
    run = paragraph.runs[0] if paragraph.runs else paragraph._p
    range_start = OxmlElement('w:commentRangeStart')
    range_start.set(qn('w:id'), str(comment_id))
    run.insert(0, range_start)

    # Add commentRangeEnd at the end
    range_end = OxmlElement('w:commentRangeEnd')
    range_end.set(qn('w:id'), str(comment_id))
    run.append(range_end)

    # Add commentReference
    comment_ref = OxmlElement('w:r')
    comment_ref_elem = OxmlElement('w:commentReference')
    comment_ref_elem.set(qn('w:id'), str(comment_id))
    comment_ref.append(comment_ref_elem)
    run.append(comment_ref)

    return comment


def add_comments_section(doc, comments, color_map):
    """Add a summary section with all comments"""
    # Add separator
    doc.add_paragraph()
    separator = doc.add_paragraph("=" * 50)
    separator.alignment = 1  # Center align

    # Add title
    title = doc.add_paragraph("AI 审核结果")
    title.alignment = 1
    title_run = title.runs[0]
    title_run.bold = True
    title_run.font.size = 280000  # 14pt

    doc.add_paragraph()

    # Add each comment as a formatted paragraph
    for i, comment in enumerate(comments, 1):
        level = comment.get('level', 'yellow')
        title_text = comment.get('title', f'问题 {i}')
        description = comment.get('description', '')
        suggestion = comment.get('suggestion', '')

        # Color mapping
        color_label = {
            'red': '【红灯】',
            'yellow': '【黄灯】',
            'green': '【绿灯】'
        }.get(level, '【提示】')

        # Add comment paragraph
        para = doc.add_paragraph()

        # Level label
        level_run = para.add_run(f"{color_label} ")
        level_run.bold = True
        if level == 'red':
            level_run.font.color.rgb = None  # Will be styled by comment

        # Title
        title_run = para.add_run(title_text)
        title_run.bold = True

        # Description
        if description:
            desc_para = doc.add_paragraph(f"问题：{description}")
            desc_para.paragraph_format.left_indent = 400000  # Indent

        # Suggestion
        if suggestion:
            sugg_para = doc.add_paragraph(f"建议：{suggestion}")
            sugg_para.paragraph_format.left_indent = 400000

        doc.add_paragraph()

    # Add footer
    doc.add_paragraph()
    footer = doc.add_paragraph("=" * 50)
    footer.alignment = 1

    timestamp = doc.add_paragraph(f"生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    timestamp.alignment = 1


def generate_document(input_path, output_path, comments_json):
    """Generate Word document with comments"""
    try:
        comments = json.loads(comments_json)

        # Load existing document or create new
        try:
            doc = Document(input_path)
        except Exception:
            # If can't load, create blank document with message
            doc = Document()
            doc.add_paragraph("原始合同文件加载失败，以下为审核结果：")

        # Color mapping for comments
        color_map = {
            'red': 'FF0000',
            'yellow': 'FFC000',
            'green': '00B050'
        }

        # Add comments section at the end
        add_comments_section(doc, comments, color_map)

        # Save document
        doc.save(output_path)

        return {"success": True, "message": f"Document saved to {output_path}"}

    except Exception as e:
        return {"success": False, "error": str(e)}


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python word-generator.py <input_docx> <output_docx> <comments_json>")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]
    comments_json = sys.argv[3]

    result = generate_document(input_path, output_path, comments_json)
    print(json.dumps(result))
