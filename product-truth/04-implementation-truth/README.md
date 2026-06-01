# 04-implementation-truth / manifests

## 用途
承载接口合约、验证结果、发布证据。不放代码副本，只放**证据线**。

## 目录结构

```
04-implementation-truth/
├── README.md                        # 本文件
├── manifests/                       # 证据目录
│   ├── F008/                        # 按 REQ ID 组织
│   │   ├── api-contract.json        # API 合约
│   │   ├── verification-result.md   # 验证结果
│   │   └── release-evidence.json    # 发布证据
│   └── .gitkeep
├── contracts/                       # API 合约模板
│   └── api-contract-template.json
└── templates/                       # 证据模板
    ├── verification-template.md
    └── release-template.json
```

## 证据线定义

| 类型 | 存储位置 | 格式 | 更新时机 |
|------|---------|------|---------|
| API 合约 | `manifests/{REQ_ID}/api-contract.json` | JSON | 技术方案评审后 |
| 验证结果 | `manifests/{REQ_ID}/verification-result.md` | Markdown | 测试验收后 |
| 发布证据 | `manifests/{REQ_ID}/release-evidence.json` | JSON | 发布后 |

## 回写规则

1. **只允许从这 4 处回写**：REQ_REGISTRY.yml / 当前 Packet / 03-design-truth / 04-implementation-truth
2. **不放代码副本**：代码在 git history 里
3. **版本化**：每个 REQ 的 manifests 独立目录
4. **可审计**：通过 `git log` 追溯修改历史
