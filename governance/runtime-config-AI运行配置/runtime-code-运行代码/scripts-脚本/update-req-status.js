// REQ:GOV-V003
// PURPOSE: 需求状态批量更新工具
// 用法: node update-req-status.js [Fxxx] [status]

const fs = require('fs');
const { resolveEnabledDocumentPath } = require('./project-registry');

const requirementsDoc = resolveEnabledDocumentPath('requirements');
const REQ_FILE = requirementsDoc ? requirementsDoc.absolutePath : null;

function updateStatus(reqId, newStatus) {
  if (!REQ_FILE) {
    console.error('❌ Requirements tracking is not enabled');
    process.exit(1);
  }

  let content = fs.readFileSync(REQ_FILE, 'utf-8');

  // 构建状态的正则匹配
  const regex = new RegExp(`(\\|\\s*${reqId}\\s*\\|[^|]+\\|[^|]+\\|\\s*)(待确认|已确认|开发中|已完成|草稿)(\\s*\\|)`, 'g');

  if (!regex.test(content)) {
    console.error(`❌ Requirement ${reqId} not found`);
    process.exit(1);
  }

  // 替换状态
  content = content.replace(regex, `$1${newStatus}$3`);

  fs.writeFileSync(REQ_FILE, content);
  console.log(`✅ Updated ${reqId} status to "${newStatus}"`);
}

function listRequirements() {
  if (!REQ_FILE) {
    console.log('ℹ️ Requirements tracking is not enabled');
    return;
  }

  const content = fs.readFileSync(REQ_FILE, 'utf-8');
  const lines = content.split('\n');

  console.log('\n📋 Current Requirements Status:\n');
  console.log('| ID    | Name              | Status    |');
  console.log('|-------|-------------------|-----------|');

  for (const line of lines) {
    const match = line.match(/\|\s*(F\d{3})\s*\|\s*([^|]+)\|[^|]+\|\s*(\S+)\s*\|/);
    if (match) {
      const [, id, name, status] = match;
      const statusIcon = status === '已完成' ? '✅' :
                        status === '开发中' ? '🚧' :
                        status === '已确认' ? '✓' : '○';
      console.log(`| ${id} | ${name.trim().padEnd(17)} | ${status.padEnd(9)} ${statusIcon} |`);
    }
  }
  console.log('');
}

function main() {
  const [reqId, newStatus] = process.argv.slice(2);

  if (!reqId) {
    listRequirements();
    console.log('Usage: node update-req-status.js [Fxxx] [status]');
    console.log('Status options: 待确认, 已确认, 开发中, 已完成, 草稿');
    process.exit(0);
  }

  if (!/^F\d{3}$/.test(reqId)) {
    console.error('❌ Invalid REQ ID format. Use F001, F002, etc.');
    process.exit(1);
  }

  const validStatuses = ['待确认', '已确认', '开发中', '已完成', '草稿'];
  if (!validStatuses.includes(newStatus)) {
    console.error(`❌ Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    process.exit(1);
  }

  updateStatus(reqId, newStatus);
}

main();
