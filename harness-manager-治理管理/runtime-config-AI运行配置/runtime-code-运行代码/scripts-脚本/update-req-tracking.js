// REQ:GOV-TRK-002
// ⚠️ LEGACY: 此脚本已弃用，原用于更新 REQUIREMENTS.md 表格格式
// 当前需求注册表使用 YAML 格式 (REQ_REGISTRY.yml)，此脚本不再适用
// 如需自动回填 code_locations，需重写为 YAML 安全写入
// 保留仅作参考，不纳入 active runtime

const fs = require('fs');
const path = require('path');
const { resolveEnabledDocumentPath } = require('./project-registry');

const requirementsDoc = resolveEnabledDocumentPath('requirements');
const productSrcDoc = resolveEnabledDocumentPath('product-src');
const REQ_FILE = requirementsDoc ? requirementsDoc.absolutePath : null;
const SRC_DIR = productSrcDoc ? productSrcDoc.absolutePath : null;

function scanSourceFiles() {
    const reqToFiles = new Map();

    if (!SRC_DIR) {
        return reqToFiles;
    }

    // Simple file scanning without glob dependency
    const { readdirSync, statSync } = require('fs');

    function scanDir(dir, basePath = '') {
        const files = [];
        try {
            const entries = readdirSync(dir);
            for (const entry of entries) {
                const fullPath = path.join(dir, entry);
                const relPath = basePath ? `${basePath}/${entry}` : entry;
                const stat = statSync(fullPath);
                if (stat.isDirectory()) {
                    files.push(...scanDir(fullPath, relPath));
                } else if (/\.(ts|tsx|js|jsx)$/.test(entry) && !/\.(test|spec|d)\.ts$/.test(entry)) {
                    files.push(relPath);
                }
            }
        } catch (e) {}
        return files;
    }

    const files = scanDir(SRC_DIR);

    for (const file of files) {
        const fullPath = path.join(SRC_DIR, file);
        const content = fs.readFileSync(fullPath, 'utf-8');
        const match = content.match(/REQ:\s*(F\d{3})/);
        if (match) {
            const reqId = match[1];
            if (!reqToFiles.has(reqId)) {
                reqToFiles.set(reqId, []);
            }
            reqToFiles.get(reqId).push(file);
        }
    }

    return reqToFiles;
}

function updateRequirementsMd(reqToFiles) {
    if (!REQ_FILE) {
        console.log('ℹ️ Requirements tracking not enabled, skipping update');
        return;
    }

    let content = fs.readFileSync(REQ_FILE, 'utf-8');
    const lines = content.split('\n');
    const newLines = [];

    for (const line of lines) {
        const match = line.match(/^(\|\s*F\d{3}\s*\|[^|]+\|[^|]+\|\s*)([^|]*)(\s*\|.*)$/);

        if (match) {
            const prefix = match[1];
            const suffix = match[3];
            const reqMatch = line.match(/F\d{3}/);

            if (reqMatch) {
                const reqId = reqMatch[0];
                const files = reqToFiles.get(reqId);

                if (files && files.length > 0) {
                    const location = files[0];
                    newLines.push(`${prefix}${location}${suffix}`);
                } else {
                    newLines.push(line);
                }
            } else {
                newLines.push(line);
            }
        } else {
            newLines.push(line);
        }
    }

    fs.writeFileSync(REQ_FILE, newLines.join('\n'));
    console.log('✅ Updated REQUIREMENTS.md code locations');
}

function main() {
    if (!REQ_FILE || !SRC_DIR) {
        console.log('ℹ️ Product truth layer not enabled, skipping REQ tracking update');
        return;
    }

    console.log('🔍 Scanning source files for REQ IDs...');
    const reqToFiles = scanSourceFiles();
    console.log(`   Found ${reqToFiles.size} requirements with code`);
    updateRequirementsMd(reqToFiles);
}

main();
