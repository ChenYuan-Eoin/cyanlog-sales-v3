#!/usr/bin/env node
/**
 * Feedback Collector - ONES 模式反馈收集器
 * 收集编译、测试、lint 结果，供 AI 自我修正
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WORKSPACE_ROOT = process.env.PRICE_V3_WORKSPACE_ROOT ||
  path.resolve(__dirname, '../../../..');

const FEEDBACK_PATH = path.join(
  WORKSPACE_ROOT,
  'governance/runtime-state/feedback.json'
);

function collectTypecheckFeedback() {
  console.log('📦 收集 TypeScript 类型检查反馈...');
  try {
    execSync('cd product-truth/product-code && pnpm tsc --noEmit', {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
      stdio: 'pipe'
    });
    return { success: true, errors: 0, message: '类型检查通过' };
  } catch (e) {
    const output = e.stdout || e.stderr || '';
    const errorLines = output.split('\n').filter(l => l.includes('error TS'));
    return {
      success: false,
      errors: errorLines.length,
      message: '类型检查失败',
      details: errorLines.slice(0, 10)
    };
  }
}

function collectLintFeedback() {
  console.log('📦 收集 ESLint 反馈...');
  try {
    execSync('cd product-truth/product-code && pnpm lint', {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
      stdio: 'pipe'
    });
    return { success: true, errors: 0, warnings: 0, message: 'Lint 检查通过' };
  } catch (e) {
    const output = e.stdout || e.stderr || '';
    const errors = (output.match(/error/gi) || []).length;
    const warnings = (output.match(/warning/gi) || []).length;
    return {
      success: false,
      errors,
      warnings,
      message: 'Lint 检查发现问题',
      details: output.split('\n').filter(l => l.includes('Error') || l.includes('Warning')).slice(0, 10)
    };
  }
}

function collectTestFeedback() {
  console.log('📦 收集测试反馈...');
  try {
    const output = execSync('cd product-truth/product-code && pnpm test:run', {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 120000
    });

    const passedMatch = output.match(/(\d+) passed/);
    const failedMatch = output.match(/(\d+) failed/);

    return {
      success: !failedMatch || parseInt(failedMatch[1]) === 0,
      passed: passedMatch ? parseInt(passedMatch[1]) : 0,
      failed: failedMatch ? parseInt(failedMatch[1]) : 0,
      message: '测试执行完成'
    };
  } catch (e) {
    const output = e.stdout || e.stderr || '';
    const failedMatch = output.match(/(\d+) failed/);
    return {
      success: false,
      passed: 0,
      failed: failedMatch ? parseInt(failedMatch[1]) : 1,
      message: '测试失败',
      details: output.split('\n').filter(l => l.includes('FAIL') || l.includes('Error')).slice(0, 5)
    };
  }
}

function saveFeedback(feedback) {
  const fullFeedback = {
    timestamp: new Date().toISOString(),
    ...feedback
  };

  fs.writeFileSync(FEEDBACK_PATH, JSON.stringify(fullFeedback, null, 2));
  console.log(`\n✅ 反馈已保存到: ${FEEDBACK_PATH}`);
}

function main() {
  console.log('═══════════════════════════════════════');
  console.log('ONES Feedback Collector');
  console.log('═══════════════════════════════════════\n');

  const feedback = {
    typecheck: collectTypecheckFeedback(),
    lint: collectLintFeedback(),
    test: collectTestFeedback(),
    summary: {
      allPassed: false,
      totalErrors: 0,
      recommendation: ''
    }
  };

  // 计算汇总
  feedback.summary.totalErrors =
    (feedback.typecheck.success ? 0 : feedback.typecheck.errors) +
    (feedback.lint.success ? 0 : feedback.lint.errors) +
    feedback.test.failed;

  feedback.summary.allPassed =
    feedback.typecheck.success &&
    feedback.lint.success &&
    feedback.test.success;

  feedback.summary.recommendation = feedback.summary.allPassed
    ? '✅ 所有检查通过，可以提交'
    : `⚠️ 发现 ${feedback.summary.totalErrors} 个问题，请修正后再提交`;

  saveFeedback(feedback);

  console.log('\n───────────────────────────────────────');
  console.log('📊 反馈汇总:');
  console.log(`   类型检查: ${feedback.typecheck.success ? '✅' : '❌'}`);
  console.log(`   Lint:     ${feedback.lint.success ? '✅' : '❌'}`);
  console.log(`   测试:     ${feedback.test.success ? '✅' : '❌'}`);
  console.log('───────────────────────────────────────');
  console.log(`\n${feedback.summary.recommendation}\n`);

  process.exit(feedback.summary.allPassed ? 0 : 1);
}

main();
