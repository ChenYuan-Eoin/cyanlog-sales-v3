#!/bin/bash
# check-05-git.sh - Git 提交质量检查
# AI 行为硬约束 #5：提交前必须完成基础验证

set -e

echo "🔍 检查 Git 提交质量..."

# 1. 检查是否有未跟踪的大文件
LARGE_FILES=$(git ls-files --others --exclude-standard 2>/dev/null | head -20 | while read f; do
    if [ -f "$f" ]; then
        size=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null || echo "0")
        if [ "$size" -gt 10485760 ]; then
            echo "$f (${size} bytes)"
        fi
    fi
done || true)

if [ -n "$LARGE_FILES" ]; then
    echo "⚠️  发现大文件（>10MB），可能不应该提交:"
    echo "$LARGE_FILES" | sed 's/^/     - /'
fi

# 2. 检查暂存区新增文件是否有对应文档
NEW_FILES=$(git diff --cached --name-only --diff-filter=A 2>/dev/null | grep -v "node_modules" | grep -E "\.(ts|tsx|js|jsx)$" || true)

if [ -n "$NEW_FILES" ]; then
    echo "   新增代码文件:"
    echo "$NEW_FILES" | head -5 | sed 's/^/     - /'
fi

# 3. 检查敏感信息。只输出文件、行号和规则 ID，绝不把疑似密钥值写进
# 终端或长期审计日志；高置信命中直接阻断，普通关键词只提示文件名。
SECRET_SCAN=$(node <<'NODE'
const { spawnSync } = require('node:child_process');
const diff = spawnSync('git', ['diff', '--cached', '--no-ext-diff', '--unified=0', '--no-color'], {
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});
if (diff.status !== 0) {
  process.stderr.write(diff.stderr || '无法读取 staged diff\n');
  process.exit(diff.status || 1);
}
const input = diff.stdout;
  let file = '';
  let newLine = 0;
  const keywordFiles = new Set();
  const findings = [];
  for (const line of input.split(/\r?\n/)) {
    if (line.startsWith('+++ b/')) {
      file = line.slice(6);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const added = line.slice(1);
    if (/(?:password|passwd|secret|api[_-]?key|token)/i.test(added)) keywordFiles.add(file || 'unknown');

    const assignment = /(?:password|passwd|secret|api[_-]?key|token)\s*["']?\s*[:=]\s*["'`]([^"'`]{8,})["'`]/i.exec(added);
    const assignedValue = assignment?.[1] || '';
    const placeholder = /(?:process\.env|import\.meta|example|placeholder|replace[_ -]?me|test-signature|masked|\*{3,}|<[^>]+>|\$\{)/i.test(assignedValue);
    let rule = '';
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(added)) rule = 'private-key';
    else if (/(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[0-9A-Z]{16}|sb_secret_[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9_-]{20,})/.test(added)) rule = 'known-secret-format';
    else if (/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/.test(added)) rule = 'jwt-literal';
    else if (assignedValue && !placeholder) rule = 'credential-assignment';
    if (rule) findings.push({ file: file || 'unknown', line: newLine, rule });
    newLine += 1;
  }

  for (const finding of findings) {
    console.log(`BLOCK\t${finding.file}\t${finding.line}\t${finding.rule}`);
  }
  for (const name of [...keywordFiles].sort()) console.log(`KEYWORD\t${name}`);
NODE
)

if printf '%s\n' "$SECRET_SCAN" | grep -q '^BLOCK[[:space:]]'; then
    echo "❌ 提交中发现高置信秘密，已阻断（值已脱敏）:"
    printf '%s\n' "$SECRET_SCAN" | awk -F '\t' '$1 == "BLOCK" { printf "     - %s:%s [%s]\n", $2, $3, $4 }'
    exit 1
fi

KEYWORD_FILES=$(printf '%s\n' "$SECRET_SCAN" | awk -F '\t' '$1 == "KEYWORD" { print $2 }' | head -10)
if [ -n "$KEYWORD_FILES" ]; then
    echo "⚠️  提交中包含敏感语义关键词（仅列文件，不输出内容）:"
    printf '%s\n' "$KEYWORD_FILES" | sed 's/^/     - /'
fi

echo "✅ Git 检查完成"
exit 0
