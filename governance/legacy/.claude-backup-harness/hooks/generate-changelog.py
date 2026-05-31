# 变更记录生成器
# 触发：SessionEnd hook
# 行为：扫描最近提交，按注册表决定是否追加到 CHANGELOG.md

import json
import os
import re
import subprocess
from datetime import datetime
from pathlib import Path


REGISTRY_RELATIVE_PATH = Path(
    'harness-manager-治理管理/runtime-config-AI运行配置/config-配置文件/project-governance-项目治理注册表.json'
)


def find_repo_root(start_path: Path) -> Path:
    current = start_path.resolve()
    for candidate in [current, *current.parents]:
        if (candidate / REGISTRY_RELATIVE_PATH).exists():
            return candidate
    raise FileNotFoundError('project governance registry not found')


def load_registry(repo_root: Path) -> dict:
    return json.loads((repo_root / REGISTRY_RELATIVE_PATH).read_text(encoding='utf-8'))


def get_git_changes(repo_root: Path):
    try:
        result = subprocess.run(
            ['git', 'diff', '--name-only', 'HEAD~1', 'HEAD'],
            capture_output=True,
            text=True,
            cwd=repo_root,
            check=False
        )
        return [line for line in result.stdout.strip().split('\n') if line]
    except Exception:
        return []


def extract_req_id(repo_root: Path, file_path: str):
    try:
        content = (repo_root / file_path).read_text(encoding='utf-8')
        match = re.search(r'//\s*REQ:\s*(F\d{3})', content)
        return match.group(1) if match else '-'
    except Exception:
        return '-'


def detect_change_type(file_path: str):
    if 'REQUIREMENTS.md' in file_path:
        return '需求'
    if 'PRD-PRODUCT.md' in file_path:
        return '产品'
    if 'guide-harness治理指南.md' in file_path or 'PRD-GOVERNANCE.md' in file_path:
        return '治理'
    if '/src/' in file_path:
        return '代码'
    if file_path.endswith('.md'):
        return '文档'
    return '其他'


def generate_changelog_entries(repo_root: Path):
    changes = get_git_changes(repo_root)
    if not changes:
        return []

    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M')
    user = os.environ.get('USER', 'unknown')
    entries = []

    for file_path in changes:
        change_type = detect_change_type(file_path)
        req_id = extract_req_id(repo_root, file_path) if change_type == '代码' else '-'
        entries.append({
            'time': timestamp,
            'user': user,
            'type': change_type,
            'detail': f'变更 {file_path}',
            'req_id': req_id,
            'file': file_path
        })

    return entries


def append_to_changelog(changelog_path: Path, entries):
    if not changelog_path.exists():
        print(f'Skip changelog generation: {changelog_path} not found')
        return

    content = changelog_path.read_text(encoding='utf-8')
    separator = '|------|------|------|------|--------|---------|'

    if separator not in content:
        print('Skip changelog generation: expected markdown table separator not found')
        return

    new_lines = []
    for entry in entries:
        line = (
            f"| {entry['time']} | {entry['user']} | {entry['type']} | "
            f"{entry['detail']} | {entry['req_id']} | {entry['file']} |"
        )
        new_lines.append(line)

    before, after = content.split(separator, 1)
    new_content = before + separator + '\n' + '\n'.join(new_lines) + after
    changelog_path.write_text(new_content, encoding='utf-8')


if __name__ == '__main__':
    repo_root = find_repo_root(Path(__file__).resolve().parent)
    registry = load_registry(repo_root)
    changelog_entry = next(
        (entry for entry in registry.get('documents', []) if entry.get('id') == 'project-changelog'),
        None
    )

    if not changelog_entry or changelog_entry.get('enabled', False) is False:
        print('Skip changelog generation: project changelog not enabled')
        raise SystemExit(0)

    changelog_path = repo_root / changelog_entry['path']
    entries = generate_changelog_entries(repo_root)
    if entries:
        append_to_changelog(changelog_path, entries)
        print(f'Generated {len(entries)} changelog entries')
