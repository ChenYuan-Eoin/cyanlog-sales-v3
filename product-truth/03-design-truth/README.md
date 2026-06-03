# 设计真相层（Design Truth / Design SoT）

本目录的目标是把“视觉主题与组件语言”抽象成**可复用、可迁移、可执行校验**的设计真相（Source of Truth, SoT），用于约束后续 UI 实现。

重要边界：

1. 本目录只定义 **主题（tokens）+ 组件原语（primitives）+ 少量布局常量（可选）**。
2. 本目录**不**定义具体业务页面的信息架构、流程、模块入口、字段含义，也不把某个原型页面当成真相。
3. `archived/` 下的内容属于历史参考资产，允许查阅，但禁止被业务代码直接 import 作为设计真相。

## 目录结构

1. `foundations/`
2. `components/`
3. `examples/`
4. `assets/`
5. `archived/`

## 真相文件（唯一口径）

1. Foundations tokens：`foundations/tokens.css`
2. Components primitives：`components/primitives.css`

兼容入口（为了让旧 HTML/预览能直接跑）：

1. `colors_and_type.css` -> `foundations/tokens.css`（symlink）
2. `components.css` -> `components/primitives.css`（symlink）

## Examples（仅示例，不是 SoT）

`examples/` 里的 HTML/CSS 只用于快速肉眼验证 tokens 与组件效果（比如按钮、字体比例、色板），不代表最终产品页面必须长成这样。

## Archived（历史参考，不可作为真相）

`archived/` 下包含从外部包导入的原型页面、截图、旧 token 等内容：

1. 允许作为灵感与参考
2. 禁止在产品代码里直接引用
3. 如果与 SoT 冲突，以 SoT 为准

## 当前状态（2026-06-03 冻结）

> **Accent 已冻结为 Cyan**（`--accent-*` 指向 cyan ramp，`--cyan-*` 为 `--accent-*` 的 alias）。
>
> 具体定义见 `foundations/tokens.css`。遗留 `--blue-*` ramp 仅用于与历史品牌资产对齐的场景，新开发应使用 `--accent-*`。}

