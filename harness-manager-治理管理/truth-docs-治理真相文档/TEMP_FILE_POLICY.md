<!--
文件名: TEMP_FILE_POLICY.md
用途: 临时文件处理原则 - 设计稿价值确认与清理规范
所属层: 治理层
创建者: AI Assistant
更新规则: 临时文件策略变更时更新
REQ: GOV-TEMP-001
-->

# 临时文件处理原则

## 问题

项目根目录存在 `临时文件/` 目录，但：
1. 不清楚哪些文件有保存价值
2. 没有定期清理机制
3. 临时文件可能混入 git

## 原则

> **临时文件必须分类、限时、可追溯**

---

## 临时文件分类

| 类别 | 说明 | 保存期限 | 示例 |
|------|------|---------|------|
| **设计稿** | UI/UX 设计源文件 | 产品生命周期 | .fig, .sketch, .xd |
| **原型图** | 交互原型 | 开发完成后 3 个月 | .rp, .proto |
| **调研资料** | 竞品分析、用户调研 | 6 个月 | .pdf, .docx |
| **脚本工具** | 一次性脚本 | 使用后 1 个月 | .py, .sh |
| **日志/缓存** | 临时输出 | 7 天 | .log, .tmp |
| **未知** | 无法识别 | 需人工确认 | - |

---

## 处理流程

```
发现临时文件
     │
     ▼
┌─────────────────┐
│ 1. 分类识别     │
│    - 文件扩展名 │
│    - 内容预览   │
│    - 创建时间   │
└───────┬─────────┘
        │
   ┌────┴────┬────────┬────────┐
   │         │        │        │
   ▼         ▼        ▼        ▼
设计稿     原型图    脚本     未知
   │         │        │        │
   ▼         ▼        ▼        ▼
归档保存   归档保存   执行后   人工确认
到 docs/   3月后删除  1月删除  或删除
```

---

## 当前临时文件目录处理

### 现状检查

```bash
# 检查临时文件目录
ls -la 临时文件/

# 按类型统计
find 临时文件/ -type f | sed 's/.*\.//' | sort | uniq -c
```

### 处理决策树

```
文件扩展名?
├── .fig, .sketch, .xd, .png, .jpg
│   └── 设计稿 → 移动到 product/docs/design/
│
├── .pdf, .docx, .xlsx (含"调研""分析")
│   └── 调研资料 → 移动到 product/docs/research/
│
├── .py, .sh, .js (一次性)
│   └── 脚本 → 执行/记录后删除
│
├── .log, .tmp, .cache
│   └── 缓存 → 直接删除
│
└── 其他
    └── 人工确认 → 有价值归档/无价值删除
```

---

## 治理规则

### 规则 T001: 临时文件不入 git

```bash
# .gitignore 已配置
echo "临时文件/" >> .gitignore
echo "*.tmp" >> .gitignore
echo "*.log" >> .gitignore
```

### 规则 T002: 临时文件定期清理

```bash
#!/bin/bash
# governance/harness/scripts/cleanup-temp.sh

TEMP_DIR="临时文件"
CUTOFF_DAYS=30

echo "Cleaning up temporary files older than $CUTOFF_DAYS days..."

# 删除旧日志和缓存
find "$TEMP_DIR" -name "*.log" -mtime +7 -delete
find "$TEMP_DIR" -name "*.tmp" -mtime +1 -delete

# 移动设计稿到归档
find "$TEMP_DIR" -name "*.fig" -o -name "*.sketch" | while read f; do
    mv "$f" product/docs/design/ 2>/dev/null || true
done

echo "Cleanup complete"
```

### 规则 T003: 临时文件价值确认

每个进入 `临时文件/` 的文件必须回答：

```markdown
## 临时文件登记
- 文件名: xxx.fig
- 类别: 设计稿
- 价值: 产品UI设计源文件
- 保存期限: 产品生命周期
- 最终去向: product/docs/design/v2.0/
- 确认人: ChenYuan
- 确认日期: 2026-05-14
```

---

## 检查清单

### 每周

- [ ] 检查 `临时文件/` 是否有新文件
- [ ] 确认新文件的价值和去向
- [ ] 删除已过期文件

### 每月

- [ ] 执行 cleanup-temp.sh
- [ ] 更新临时文件登记册
- [ ] 确认设计稿已归档

---

## 当前行动

**针对 `临时文件/` 目录**：

1. [ ] 列出所有文件
2. [ ] 按上述分类识别
3. [ ] 有价值的 → 移动到 product/docs/
4. [ ] 无价值的 → 删除
5. [ ] 更新 .gitignore
6. [ ] 建立定期清理机制
