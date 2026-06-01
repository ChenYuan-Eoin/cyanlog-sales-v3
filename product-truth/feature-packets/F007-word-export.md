# Feature Packet: F007-Word 批注生成

**Created**: 2026-06-01  
**REQ ID**: F007  
**Status**: completed  
**Parent**: F005 (合同审核), F006 (规则引擎)

---

## 1. 单元定义

**目标**: 根据 AI 审核结果生成带批注的 Word 文档，方便法务人员查看和修改

**边界**:
- 后端生成带批注的 Word 文档
- 前端提供下载按钮
- 批注内容来自审核结果中的风险项

**本轮不做什么**:
- 不做在线预览 Word
- 不做 Word 编辑功能
- 不做批注位置精确定位（简化：按风险项生成批注）
- 不做复杂格式化

---

## 2. 双锚点

### 业务锚点
- 输入：审核结果（risks 数组）+ 原始合同文件
- 输出：带批注的 Word 文档
- 批注颜色：红/黄/绿 对应风险等级
- 批注内容：标题 + 描述 + 建议

### 技术锚点
- 方案：python-docx（母文档已指定）
- 实现方式：API Route 调用 Python 脚本生成
- 存储：临时生成，不保存到数据库

---

## 3. 涉及文件

**新建**:
- `app/api/contracts/[id]/export/route.ts` - Word 导出 API
- `lib/export/word-generator.py` - Python 批注生成脚本
- `lib/export/word-generator.ts` - Node.js 调用 Python 的封装

**修改**:
- `app/contracts/[id]/page.tsx` - 添加导出按钮

---

## 4. 流程

```
用户点击"导出Word"
  ↓
前端调用 POST /api/contracts/[id]/export
  ↓
后端获取合同 + 审核结果
  ↓
调用 Python 脚本生成带批注的 Word
  ↓
返回 Word 文件给浏览器下载
```

---

## 5. 技术要点

### Python 脚本功能
1. 读取原始合同文件（从 Supabase Storage）
2. 根据审核结果添加批注
3. 返回生成的 Word 文件

### 简化策略
- 由于位置定位复杂，先在文档末尾添加"审核摘要"段落
- 批注添加在摘要段落上（而非原文位置）
- 后续可优化为关键词匹配定位

---

## 6. 验证记录

- [x] 前端导出按钮已添加
- [x] Word 导出 API 已创建
- [x] Python 批注生成脚本已创建
- [ ] 需要安装 python-docx: `pip3 install python-docx`
- [ ] 需要执行数据库迁移添加 rules 表
- [ ] 实际导出测试（依赖环境）

## 7. 部署检查清单

### 服务器环境
- [ ] Python3 已安装
- [ ] python-docx 已安装: `pip3 install python-docx`
- [ ] 临时目录可写权限

### 数据库
- [ ] 执行 `002_add_rules_table.sql` 迁移

### 测试步骤
1. 上传合同并触发审核
2. 等待审核完成
3. 点击"导出Word"按钮
4. 下载并检查 Word 文档中的审核结果
