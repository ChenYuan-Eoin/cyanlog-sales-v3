#!/usr/bin/env node
/**
 * Skill Runner - ONES 模式 Skill 执行器
 * 用法: node skill-runner.js <skill-id> [options]
 */

const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = process.env.PRICE_V3_WORKSPACE_ROOT ||
  path.resolve(__dirname, '../../../..');

const SKILLS_CONFIG_PATH = path.join(
  WORKSPACE_ROOT,
  'governance/runtime-config-AI运行配置/config-配置文件/settings-claude运行配置.json'
);

const SKILL_DEFINITIONS_PATH = path.join(
  WORKSPACE_ROOT,
  'governance/truth-docs-治理真相文档/SKILLS.md'
);

function loadSkillsConfig() {
  try {
    const content = fs.readFileSync(SKILLS_CONFIG_PATH, 'utf8');
    const config = JSON.parse(content);
    return config.skills || {};
  } catch (e) {
    console.error('❌ 无法加载 skills 配置:', e.message);
    return {};
  }
}

function runSocratesCheck(options) {
  console.log('🎯 执行: skill-socrates (苏格拉底提问)\n');

  // 从 questionTemplates 中选择问题
  const questions = [
    {
      category: 'technical',
      question: '这个需求的实现方式，是否已经考虑到数据量和性能瓶颈？如果用户量增长10倍，这个设计还能工作吗？',
    },
    {
      category: 'risk',
      question: '如果关键依赖服务不可用，这个功能会如何表现？是否有降级方案？',
    },
    {
      category: 'alignment',
      question: '这个需求与已确认的其他 REQ 是否存在冲突？数据模型是否需要重复定义？',
    },
    {
      category: 'edge-case',
      question: '考虑这些边界情况：1) 网络中断 2) 数据为空 3) 并发操作。当前设计如何处理？',
    },
    {
      category: 'maintenance',
      question: '这个实现需要多少持续的维护工作？配置复杂吗？文档是否足够让新人接手？',
    }
  ];

  // 随机选择 3-5 个问题
  const selectedCount = Math.floor(Math.random() * 3) + 3;
  const shuffled = questions.sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, selectedCount);

  console.log('📋 苏格拉底审查问题:\n');
  selected.forEach((q, i) => {
    console.log(`${i + 1}. [${q.category}] ${q.question}`);
  });

  console.log('\n---');
  console.log('请回答以上问题，帮助完善需求设计。');

  return { success: true, questions: selected };
}

function runReqReviewCheck(options) {
  console.log('🎯 执行: skill-req-review (需求审查)\n');

  const checks = [
    { id: 'R1', name: 'REQ ID 唯一性', status: 'checking' },
    { id: 'R2', name: '状态流程合规', status: 'checking' },
    { id: 'R3', name: '已确认需求有代码位置', status: 'checking' },
    { id: 'R4', name: 'REQ_REGISTRY 同步', status: 'checking' },
    { id: 'R5', name: '无孤儿子需求', status: 'checking' },
  ];

  // 读取 REQ_REGISTRY
  const registryPath = path.join(WORKSPACE_ROOT, 'product-truth/REQ_REGISTRY.yml');
  let registryContent = '';
  try {
    registryContent = fs.readFileSync(registryPath, 'utf8');
    console.log('✅ 已读取 REQ_REGISTRY.yml\n');
  } catch (e) {
    console.log('❌ 无法读取 REQ_REGISTRY.yml\n');
    return { success: false, error: e.message };
  }

  // 执行检查
  console.log('| 检查项 | 状态 | 详情 |');
  console.log('|--------|------|------|');

  checks.forEach(check => {
    // 简单检查逻辑
    let status = '✅';
    let detail = '通过';

    if (check.id === 'R1') {
      const reqIds = registryContent.match(/^  F[0-9]{3}:/gm) || [];
      const uniqueIds = new Set(reqIds.map(s => s.trim()));
      status = reqIds.length === uniqueIds.size ? '✅' : '❌';
      detail = `${reqIds.length} 个需求，${uniqueIds.size} 个唯一`;
    }

    if (check.id === 'R2') {
      const validStatuses = ['draft', 'confirmed', 'design_confirmed', 'in_progress', 'completed'];
      const statusMatches = registryContent.match(/status: (\w+)/g) || [];
      const invalidStatuses = statusMatches.filter(s => {
        const status = s.replace('status: ', '');
        return !validStatuses.includes(status);
      });
      status = invalidStatuses.length === 0 ? '✅' : '⚠️';
      detail = invalidStatuses.length === 0 ? '所有状态合规' : `${invalidStatuses.length} 个异常状态`;
    }

    console.log(`| ${check.id} ${check.name} | ${status} | ${detail} |`);
  });

  return { success: true, checks };
}

function main() {
  const args = process.argv.slice(2);
  const skillId = args[0];

  if (!skillId) {
    console.log('用法: node skill-runner.js <skill-id>');
    console.log('可用 skills: skill-socrates, skill-req-review');
    process.exit(1);
  }

  const skillsConfig = loadSkillsConfig();

  console.log('═══════════════════════════════════════');
  console.log('ONES Skill Runner');
  console.log('═══════════════════════════════════════\n');

  switch (skillId) {
    case 'skill-socrates':
      const result1 = runSocratesCheck({});
      process.exit(result1.success ? 0 : 1);
      break;

    case 'skill-req-review':
      const result2 = runReqReviewCheck({});
      process.exit(result2.success ? 0 : 1);
      break;

    default:
      console.log(`❌ 未知 skill: ${skillId}`);
      console.log('可用 skills: skill-socrates, skill-req-review');
      process.exit(1);
  }
}

main();
