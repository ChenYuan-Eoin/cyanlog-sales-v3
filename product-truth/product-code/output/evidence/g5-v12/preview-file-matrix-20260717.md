# G5 Preview 多格式文件矩阵（2026-07-17）

## 结论

免费隔离 Supabase Preview `vsfropnfsmnonkotywsx` 已完成 DOCM、文本 PDF、扫描 PDF 的真实上传、源身份绑定、预览、人工锚点、原生批注导出、桌面/iPad 浏览器和文件结构验收。所有正式对象、临时分块、数据库 fixture 与临时认证 token 已清理为 0；Production 始终只读。本矩阵没有注册付费账号、购买服务或引入持续付费依赖，新增成本为 `0 USD/month`。

本矩阵关闭的是“格式引擎与浏览器文件链”门禁，不关闭合同审核产品线的全部门禁：DOCM 的这条批注是通过 service-role 写入的导出引擎 fixture，不是完整的 `ReviewRun -> 发布 Option -> 用户决策 -> REVIEW_PASSED -> 导出` 法律决策链；代表性审核精度和 release-eligible SkillBundle 仍未完成。

## 源文件与源身份

| 类型 | 可复现源文件 | SHA-256 | Preview 解析事实 |
|---|---|---|---|
| DOCM | `output/evidence/g5-v11/apache-poi-SimpleMacro.docm` | `fd591958fcf5322f72c0a740e9606309c949254bda4c3d9bd966481ddf220563` | 当前正文 40 字；浏览器直接读取 OOXML，不执行宏 |
| 文本 PDF | `output/evidence/g5/ones-long-source.pdf` | `3f3baa5c3971bd813e365758a0c085a25c6a96d5c50cc4baa6e66428f090247e` | 当前正文 1378 字；8 页；页图与 source/text SHA 绑定 |
| 扫描 PDF | `output/playwright/g5-review-ui/scan-image-only-source.pdf` | `fc88f0cca4e38b85fa29953fd88106f672a502f503c8d545677d2f2154f151de` | 文本层为空；1 页；不依赖 OCR，人工 region/point 锚点可用 |

三类文件都通过真实 `create -> upload-chunk -> merge-chunks` 链进入 Preview；合并时整文件 SHA、storage path、source text hash 与 page map 绑定。错误源路径、错误文本哈希和并发陈旧 page-map 写入由 source fence 拒绝。

## 浏览器验收

三类文件均在真实审核页通过桌面 `1440x900` 与 iPad `1180x820` 验收：无横向溢出、对话框、console error 或错误跳转。导航时浏览器主动取消的 4 条后台预取请求为 `net::ERR_ABORTED`，对应服务端请求均为 200；它们是导航取消，不是产品请求失败。

| 文件 | 桌面证据 | iPad 证据 |
|---|---|---|
| DOCM | `preview-docm-review-desktop-20260717.png` | `preview-docm-review-ipad-20260717.png` |
| 文本 PDF | `preview-text-pdf-review-desktop-20260717.png` | `preview-text-pdf-review-ipad-20260717.png` |
| 扫描 PDF | `preview-scan-pdf-review-desktop-20260717.png` | `preview-scan-pdf-review-ipad-20260717.png` |

PDF 批注通过公开 `/api/contracts/:id/annotations` 链写入：

- 文本 PDF：region 批注 `文本 PDF 原生区域批注验收`。
- 扫描 PDF：region 批注 `扫描 PDF 人工区域批注验收`；point 批注 `扫描 PDF 人工点位批注验收`。

## 原生导出文件

### DOCM

- 输出：`preview-docm-annotated-20260717.docm`
- SHA-256：`24d21a00ce2b41c4adece61b1f59f58849141a4cf3cdeb590d42f491b4b68db9`
- 原生 Word 批注：1 条，文本为 `[建议调整] issue\n建议修改为：DOCM 源文件原生批注验收`。
- VBA 相关 package parts：3 个；源文件与输出文件逐 part SHA-256 相同。
- 服务器只做静态 OPC/MS-OVBA 结构校验，不执行宏。
- LibreOffice 26.2.4.2 以独立 profile 在 2.8 秒内读取并渲染为 1 页 PDF，正文为 `This is a macro word processing document`，证明当前输出不是损坏包。
- 本机 Microsoft Word 当前卡在应用自身 `_dyld_start`，未进入文档界面；因此当前 v12 输出的 Word GUI 打开验收保持未完成，不将环境故障伪装成产品通过。

### 文本 PDF

- 输出：`preview-text-pdf-annotated-20260717.pdf`
- SHA-256：`4051a6de9a4542b447c35a5f68803b40c113821e5d5a15223b464891b6f995c1`
- 8/8 原页面保留；第 1 页新增一个 `/Highlight` 和一个 `/Text`，两者 `/Contents` 均为 `文本 PDF 原生区域批注验收`。
- macOS Preview 识别为 8 页，并在“高亮标记和备注”清单中显示上述两条标准 annotation：`preview-text-pdf-macos-preview-20260717.png`。

### 扫描 PDF

- 输出：`preview-scan-pdf-annotated-20260717.pdf`
- SHA-256：`96bb36f434ffea990edfdddec3fefe0f9ef9755b304c2ea8b963d48e261e945a`
- 1/1 原页面保留；新增一个 `/Highlight` 和两个 `/Text`，分别携带区域与点位批注文本。
- 原 PDF 只有一个图像流；导出前后该图像流解压后 SHA-256 相同。
- macOS Preview 在“高亮标记和备注”中识别到 1 个高亮、2 个备注及完整中文内容：`preview-scan-pdf-macos-preview-20260717.png`。

## 性能根因与换路

最初开发服务使用 Python 3.14。文本 PDF 首次失败是声明依赖 `pypdfium2` 未装；补齐免费依赖后，DOCM 导出仍达到 60 秒超时。进程采样定位到 Python 3.14 在 `lxml.etree` 动态导入处长时间阻塞，而不是宏扫描或文件算法。

换用完全按 `requirements.txt` 安装的免费 Python 3.11 隔离运行时后：

- 依赖导入约 2.45 秒。
- DOCM 生成器直接调用约 0.10 秒；本地 production-mode API 导出约 1.95 秒。
- 扫描 PDF 生成器直接调用约 0.08 秒；真实 Preview production-mode API 导出约 2.05 秒。
- 扫描 PDF 一次完整链路耗时：create 2741ms、chunk 1606ms、merge 4145ms、review 3695ms、两次 annotations 1945/2082ms、export 2053ms。

开发服务的热更新/module reload 还制造过 route 丢失和 60 秒假超时；切到同一构建产物的本地 production server 后消失。文本 PDF 在受干扰的 dev server 上导出 40.6 秒但文件正确，因此该数字只记为 harness 污染样本，不作为产品性能结论。

## 回归与清理

- Word/upload 专项：7 文件 / 40 用例通过。
- source-render：8/8 通过。
- `pnpm tsc --noEmit` 通过。
- `pnpm build` 通过，81/81 页面；仅保留既有 OTel、review page lint 和动态路由诊断。
- 扫描 PDF production-mode fixture 合同：`2ace720d-3485-4607-8421-30689831f5cb`。
- 验收后：数据库 residue 0、`contracts` bucket residue 0、`contract-chunks` bucket residue 0、临时 auth token 0。

## 仍未关闭的 G5 门禁

1. 建立最小 release-eligible SkillBundle，并用 DOCM 跑通合法的风险决策、批量提交、复审通过与导出链；当前 service-role fixture 只能证明文件引擎。
2. 在固定 release-eligible 规则包下执行 50 页 / 10 类风险的精度、漏检和误报对照；格式 canary 不能代替准确率样本。
3. Microsoft Word 当前输出实机打开验收；Word 应用恢复前不重复空转，可用 OPC 哈希、LibreOffice 读取和历史 Word 样本作为临时分层证据。
4. Production P0 RLS/RPC forward migration 与发布复验；在用户改变只读边界前不得执行、push 或部署。
