#!/usr/bin/env python3
"""
PRD TOC 生成脚本 v3.1
生成树形结构 + 三级目录 + start-end 行号 + 去重校验
"""

import re
import sys
import json
from pathlib import Path
from collections import OrderedDict

REGISTRY_RELATIVE_PATH = Path(
    'governance/runtime-config-AI运行配置/config-配置文件/project-governance-项目治理注册表.json'
)

def find_repo_root(start_path: Path):
    current = start_path.resolve()
    for candidate in [current, *current.parents]:
        if (candidate / REGISTRY_RELATIVE_PATH).exists():
            return candidate
    raise FileNotFoundError('project governance registry not found')

def load_registry(repo_root: Path):
    return json.loads((repo_root / REGISTRY_RELATIVE_PATH).read_text(encoding='utf-8'))

def resolve_document_target(repo_root: Path, registry, raw_target):
    documents = registry.get('documents', [])
    target = raw_target or registry.get('runtime', {}).get('toc', {}).get('default_document_id', 'prd-main')

    for doc in documents:
        if doc.get('id') == target:
            return repo_root / doc['path'], target

    candidate = Path(target)
    if candidate.is_absolute():
        return candidate, target

    cwd_candidate = Path.cwd() / candidate
    if cwd_candidate.exists():
        return cwd_candidate, target

    repo_candidate = repo_root / candidate
    if repo_candidate.exists():
        return repo_candidate, target

    raise FileNotFoundError(f'无法解析文档目标: {target}')

def parse_headings(filepath):
    """解析文档中的所有标题"""
    headings = []
    
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    in_code_block = False
    code_block_marker = None
    
    for line_num, line in enumerate(lines, 1):
        # 检测代码块边界
        if line.strip().startswith('```'):
            if not in_code_block:
                in_code_block = True
                code_block_marker = line_num
            else:
                in_code_block = False
                code_block_marker = None
            continue
        
        # 如果在代码块内，跳过标题检测（防止代码块内的 # 被误认为标题）
        if in_code_block:
            continue
        
        # 检测标题
        match = re.match(r'^(#{2,4})\s+(.+)$', line)
        if match:
            level = len(match.group(1))
            title = match.group(2).strip()
            headings.append({
                'level': level,
                'title': title,
                'start': line_num
            })
    
    return headings, len(lines)

def validate_heading_numbering(headings):
    """校验标题编号格式"""
    errors = []

    current_top_kind = None
    current_top_code = None
    current_level3_code = None
    last_chapter_num = None
    appendix_started = False
    seen_codes = OrderedDict()

    for h in headings:
        title = h['title']
        level = h['level']

        if level == 2:
            chapter_match = re.match(r'^第(\d+)章[：:].+', title)
            appendix_match = re.match(r'^附录([A-Z][A-Z0-9]*)[：:].+', title)

            current_level3_code = None

            if chapter_match:
                chapter_num = int(chapter_match.group(1))
                if appendix_started:
                    errors.append(
                        f"行 {h['start']}: 附录开始后不允许再出现正文顶层章节，当前: {title}"
                    )
                if last_chapter_num is not None and chapter_num != last_chapter_num + 1:
                    errors.append(
                        f"行 {h['start']}: 正文章节号必须连续，期望第{last_chapter_num + 1}章，当前: 第{chapter_num}章"
                    )
                current_top_kind = 'chapter'
                current_top_code = str(chapter_num)
                last_chapter_num = chapter_num
                continue

            if appendix_match:
                appendix_started = True
                current_top_kind = 'appendix'
                current_top_code = appendix_match.group(1)
                continue

            errors.append(
                f"行 {h['start']}: 二级标题只允许'第X章：标题'或'附录X：标题'格式，当前: {title}"
            )
            current_top_kind = None
            current_top_code = None
            continue

        if level == 3:
            if current_top_kind is None:
                errors.append(f"行 {h['start']}: 三级标题缺少有效的二级标题父节点，当前: {title}")
                continue

            if current_top_kind == 'chapter':
                match = re.match(r'^(\d+)\.(\d+)\s+.+', title)
                if not match:
                    errors.append(f"行 {h['start']}: 三级标题必须是'X.Y 标题'格式，当前: {title}")
                    continue
                if match.group(1) != current_top_code:
                    errors.append(
                        f"行 {h['start']}: 三级标题章号必须与父章节一致，父章节是第{current_top_code}章，当前: {title}"
                    )
                code = f"{match.group(1)}.{match.group(2)}"
            else:
                match = re.match(r'^([A-Z][A-Z0-9]*)\.(\d+)\s+.+', title)
                if not match:
                    errors.append(f"行 {h['start']}: 附录三级标题必须是'附录代号.Y 标题'格式，当前: {title}")
                    continue
                if match.group(1) != current_top_code:
                    errors.append(
                        f"行 {h['start']}: 附录三级标题前缀必须与父附录一致，父附录是{current_top_code}，当前: {title}"
                    )
                code = f"{match.group(1)}.{match.group(2)}"

            if code in seen_codes:
                errors.append(
                    f"行 {h['start']}: 标题编号重复 '{code}'，此前出现在行 {seen_codes[code]}"
                )
            else:
                seen_codes[code] = h['start']
            current_level3_code = code
            continue

        if level == 4:
            if current_top_kind is None or current_level3_code is None:
                errors.append(f"行 {h['start']}: 四级标题缺少有效的父级编号，当前: {title}")
                continue

            if current_top_kind == 'chapter':
                match = re.match(r'^(\d+)\.(\d+)\.(\d+)\s+.+', title)
                if not match:
                    errors.append(f"行 {h['start']}: 四级标题必须是'X.Y.Z 标题'格式，当前: {title}")
                    continue
                if match.group(1) != current_top_code:
                    errors.append(
                        f"行 {h['start']}: 四级标题章号必须与父章节一致，父章节是第{current_top_code}章，当前: {title}"
                    )
                parent_code = f"{match.group(1)}.{match.group(2)}"
            else:
                match = re.match(r'^([A-Z][A-Z0-9]*)\.(\d+)\.(\d+)\s+.+', title)
                if not match:
                    errors.append(f"行 {h['start']}: 附录四级标题必须是'附录代号.Y.Z 标题'格式，当前: {title}")
                    continue
                if match.group(1) != current_top_code:
                    errors.append(
                        f"行 {h['start']}: 附录四级标题前缀必须与父附录一致，父附录是{current_top_code}，当前: {title}"
                    )
                parent_code = f"{match.group(1)}.{match.group(2)}"

            if parent_code != current_level3_code:
                errors.append(
                    f"行 {h['start']}: 四级标题父编号必须挂在当前三级标题 '{current_level3_code}' 下，当前: {title}"
                )

            code = title.split(' ', 1)[0]
            if code in seen_codes:
                errors.append(
                    f"行 {h['start']}: 标题编号重复 '{code}'，此前出现在行 {seen_codes[code]}"
                )
            else:
                seen_codes[code] = h['start']

    return errors

def check_duplicate_titles(headings):
    """检查重复标题"""
    seen = OrderedDict()
    duplicates = []
    
    for h in headings:
        title = h['title']
        if title in seen:
            duplicates.append(f"重复标题 '{title}' 出现在行 {h['start']} 和行 {seen[title]}")
        else:
            seen[title] = h['start']
    
    return duplicates

def calculate_end_lines(headings, total_lines):
    """计算每个标题的 end 行号
    
    规则：end = 下一条"同级或更高层级标题"的上一行
    """
    for i, h in enumerate(headings):
        current_level = h['level']
        end_line = total_lines  # 默认到文件末尾
        
        # 查找下一个同级或更高级别的标题
        for next_h in headings[i+1:]:
            if next_h['level'] <= current_level:
                end_line = next_h['start'] - 1
                break
        
        h['end'] = end_line
    
    return headings

def generate_toc(headings):
    """生成树形 TOC"""
    lines = []
    lines.append('```')
    lines.append('')
    
    for h in headings:
        level = h['level']
        title = h['title']
        start = h['start']
        end = h['end']
        
        # 计算缩进
        if level == 2:
            indent = ''
        elif level == 3:
            indent = '  '
        elif level == 4:
            indent = '    '
        else:
            indent = ''
        
        lines.append(f"{indent}[{start:5d}-{end:5d}] {title}")
    
    lines.append('')
    lines.append('```')
    return '\n'.join(lines)

def check_code_block_titles(filepath):
    """检查是否有标题出现在代码块内"""
    errors = []
    
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    in_code_block = False
    code_start = 0
    
    for line_num, line in enumerate(lines, 1):
        if line.strip().startswith('```'):
            if not in_code_block:
                in_code_block = True
                code_start = line_num
            else:
                in_code_block = False
            continue
        
        if in_code_block:
            # 检查代码块内是否有看起来像标题的行
            if re.match(r'^#{2,4}\s+.+$', line):
                errors.append(f"行 {line_num}: 标题出现在代码块内（代码块始于行 {code_start}）")
    
    return errors

def check_end_markers(filepath):
    """检查 THE END/文档结束/完成宣言 是否只在文件末尾"""
    errors = []
    
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    total_lines = len(lines)
    end_markers = ['THE END', '文档结束', '完成宣言', '文档完成', '最终完成']
    
    for line_num, line in enumerate(lines, 1):
        # 跳过最后100行（允许在末尾出现）
        if line_num > total_lines - 100:
            continue
        
        for marker in end_markers:
            if marker in line.upper() or marker in line:
                errors.append(f"行 {line_num}: 发现结束标记 '{marker}'，结束标记只能出现在文件末尾100行内")
                break
    
    return errors

def main():
    repo_root = find_repo_root(Path(__file__).resolve().parent)
    registry = load_registry(repo_root)
    raw_target = sys.argv[1] if len(sys.argv) >= 2 else None
    filepath, target_label = resolve_document_target(repo_root, registry, raw_target)

    print(f"正在分析文档: {target_label}")
    print(f"解析路径: {filepath}")
    print("=" * 60)
    
    # 解析标题
    headings, total_lines = parse_headings(str(filepath))
    print(f"\n共发现 {len(headings)} 个标题")
    print(f"文档总行数: {total_lines}")
    
    # 计算 end 行号
    headings = calculate_end_lines(headings, total_lines)
    
    # 校验
    print("\n" + "=" * 60)
    print("【校验结果】")
    print("=" * 60)
    
    has_errors = False
    
    # 1. 标题编号格式
    numbering_errors = validate_heading_numbering(headings)
    if numbering_errors:
        print("\n❌ 标题编号格式错误:")
        for err in numbering_errors[:10]:  # 最多显示10条
            print(f"   {err}")
        if len(numbering_errors) > 10:
            print(f"   ... 还有 {len(numbering_errors) - 10} 条错误")
        has_errors = True
    else:
        print("\n✅ 标题编号格式正确")
    
    # 2. 重复标题
    duplicates = check_duplicate_titles(headings)
    if duplicates:
        print("\n❌ 发现重复标题:")
        for dup in duplicates:
            print(f"   {dup}")
        has_errors = True
    else:
        print("✅ 无重复标题")
    
    # 3. 代码块内标题
    code_errors = check_code_block_titles(str(filepath))
    if code_errors:
        print("\n❌ 发现标题在代码块内:")
        for err in code_errors[:5]:
            print(f"   {err}")
        has_errors = True
    else:
        print("✅ 无代码块内标题")
    
    # 4. 结束标记位置
    end_errors = check_end_markers(str(filepath))
    if end_errors:
        print("\n❌ 发现结束标记位置错误:")
        for err in end_errors[:5]:
            print(f"   {err}")
        has_errors = True
    else:
        print("✅ 结束标记位置正确")
    
    # 生成 TOC
    print("\n" + "=" * 60)
    print("【生成的 TOC】")
    print("=" * 60)
    toc = generate_toc(headings)
    print(toc)
    
    print("\n提示：当前脚本采用单文件治理模式，不再默认落地 `.toc.md` 文件。")
    print("如需保存结果，请自行使用 shell 重定向输出。")
    
    if has_errors:
        print("\n⚠️  发现错误，请修复后再更新文档")
        return 1
    
    return 0

if __name__ == '__main__':
    sys.exit(main())
