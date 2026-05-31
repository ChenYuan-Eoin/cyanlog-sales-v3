// Quote workspace — left worksheet, right paper preview
function ScreenQuote() {
  return (
    <>
      <div className="breadcrumbs">
        <span>用户旅程</span><span className="sep">/</span><span>报价中心</span><span className="sep">/</span><span style={{ color: "var(--fg-1)" }}>华润万家云平台二期</span>
      </div>

      <section className="page-header">
        <div>
          <div className="eyebrow">报价</div>
          <h1 className="page-title">华润万家云平台二期</h1>
          <p className="page-description">左侧录入与判断，右侧维护正式报价稿。低毛利规则会自动抬升审批门槛。</p>
        </div>
        <div className="header-actions">
          <Button leading={<Icon id="i-download" cls="i i-sm" />}>导出 PDF</Button>
          <Button variant="primary" leading={<Icon id="i-check-circle" cls="i i-sm" />}>提交审批</Button>
        </div>
      </section>

      <section className="quote-dual">
        {/* Left worksheet */}
        <Card>
          <div className="row row-between" style={{ marginBottom: 18 }}>
            <div>
              <div className="eyebrow">报价测算</div>
              <h2 style={{ marginTop: 6, fontSize: 22 }}>测算工作台</h2>
            </div>
            <Pill tone="brand" noDot>14 单在推进</Pill>
          </div>

          <div className="grid grid-2" style={{ gap: 12, marginBottom: 18 }}>
            <div className="card-flat">
              <div className="overline">客户名称</div>
              <div style={{ marginTop: 6, fontSize: 15, fontWeight: 600 }}>华润万家集团</div>
            </div>
            <div className="card-flat">
              <div className="overline">机会 ID</div>
              <div className="num" style={{ marginTop: 6, fontSize: 15, fontWeight: 600 }}>CY-2024-0089</div>
            </div>
            <div className="card-flat">
              <div className="overline">报价版本</div>
              <div className="num" style={{ marginTop: 6, fontSize: 15, fontWeight: 600 }}>V3 · 2024.11.18</div>
            </div>
            <div className="card-flat">
              <div className="overline">交付日期</div>
              <div style={{ marginTop: 6, fontSize: 15, fontWeight: 600, color: "var(--warning-700)" }}>待补 ⚠</div>
            </div>
          </div>

          <hr className="divider" style={{ margin: "18px 0" }} />

          <div className="row row-between" style={{ marginBottom: 12 }}>
            <h4 style={{ fontSize: 14 }}>报价明细</h4>
            <Button size="sm" leading={<Icon id="i-file-plus" cls="i i-sm" />}>添加产品</Button>
          </div>

          <div className="line-item">
            <div className="line-item-head">
              <strong>云平台基础服务（年）</strong>
              <Pill tone="brand" noDot>主品</Pill>
            </div>
            <div className="line-item-grid">
              <div className="line-item-cell"><label>数量</label><div className="value">1</div></div>
              <div className="line-item-cell"><label>单价</label><div className="value">820.0万</div></div>
              <div className="line-item-cell"><label>折扣</label><div className="value">9.2 折</div></div>
              <div className="line-item-cell"><label>小计</label><div className="value" style={{ color: "var(--accent)" }}>754.4万</div></div>
            </div>
          </div>

          <div className="line-item">
            <div className="line-item-head">
              <strong>实施与培训服务</strong>
              <Pill tone="warning" noDot>低毛利</Pill>
            </div>
            <div className="line-item-grid">
              <div className="line-item-cell"><label>数量</label><div className="value">1</div></div>
              <div className="line-item-cell"><label>单价</label><div className="value">320.0万</div></div>
              <div className="line-item-cell"><label>折扣</label><div className="value">原价</div></div>
              <div className="line-item-cell"><label>小计</label><div className="value">320.0万</div></div>
            </div>
          </div>

          <div className="line-item">
            <div className="line-item-head">
              <strong>三年增值维保</strong>
              <Pill noDot>选配</Pill>
            </div>
            <div className="line-item-grid">
              <div className="line-item-cell"><label>数量</label><div className="value">3</div></div>
              <div className="line-item-cell"><label>单价</label><div className="value">68.5万</div></div>
              <div className="line-item-cell"><label>折扣</label><div className="value">8.8 折</div></div>
              <div className="line-item-cell"><label>小计</label><div className="value">180.8万</div></div>
            </div>
          </div>

          <hr className="divider" style={{ margin: "20px 0" }} />

          <div className="card-flat" style={{ background: "var(--success-100)", borderColor: "var(--success-100)" }}>
            <div className="row row-between" style={{ marginBottom: 8 }}>
              <strong style={{ fontSize: 13, color: "var(--success-700)" }}>毛利评估</strong>
              <span className="num" style={{ fontSize: 13, fontWeight: 700, color: "var(--success-700)" }}>32.4%</span>
            </div>
            <div className="progress-track" style={{ background: "rgba(21,113,90,0.15)" }}>
              <div className="progress-fill" style={{ width: "68%", background: "var(--success-600)" }}></div>
            </div>
            <div className="caption" style={{ marginTop: 8, color: "var(--success-700)" }}>高于阈值 25%，无需特批。</div>
          </div>
        </Card>

        {/* Right paper preview */}
        <div style={{ position: "sticky", top: 20 }}>
          <div className="row row-between" style={{ marginBottom: 12 }}>
            <div className="overline">正式稿预览</div>
            <div className="row row-gap-2">
              <Button size="sm" variant="ghost">编辑模板</Button>
              <Button size="sm" leading={<Icon id="i-download" cls="i i-sm" />}>下载</Button>
            </div>
          </div>
          <div className="paper">
            <div className="paper-head">
              <div>
                <div className="paper-brand">CYANLOG</div>
                <div className="caption" style={{ marginTop: 6 }}>青云科技有限公司</div>
              </div>
              <div className="paper-meta">
                报价单 · QT-2024-1118<br/>
                2024.11.18 · 张一鸣
              </div>
            </div>

            <h2>报价单 / Quotation</h2>

            <div className="property-list" style={{ marginBottom: 22 }}>
              <div className="property-row"><span className="key">客户</span><span className="val">华润万家集团</span></div>
              <div className="property-row"><span className="key">项目</span><span className="val">华润万家云平台二期</span></div>
              <div className="property-row"><span className="key">有效期</span><span className="val">30 个自然日</span></div>
              <div className="property-row"><span className="key">付款条件</span><span className="val">3-4-3，里程碑分阶段</span></div>
            </div>

            <table className="paper-table">
              <thead>
                <tr><th>条目</th><th>说明</th><th style={{ width: 60, textAlign: "center" }}>数量</th><th className="num" style={{ width: 90 }}>单价</th><th className="num" style={{ width: 90 }}>金额</th></tr>
              </thead>
              <tbody>
                <tr><td>云平台基础服务</td><td className="caption">含 7×24 监控、SLA 99.9%</td><td style={{ textAlign: "center" }}>1</td><td className="num">820.0万</td><td className="num">754.4万</td></tr>
                <tr><td>实施与培训</td><td className="caption">现场实施 / 在线培训</td><td style={{ textAlign: "center" }}>1</td><td className="num">320.0万</td><td className="num">320.0万</td></tr>
                <tr><td>三年增值维保</td><td className="caption">备件 + 季度演练</td><td style={{ textAlign: "center" }}>3</td><td className="num">68.5万</td><td className="num">180.8万</td></tr>
              </tbody>
            </table>

            <div className="paper-totals">
              <div className="row"><span>小计</span><span className="num">1,255.2万</span></div>
              <div className="row"><span>税额（6%）</span><span className="num">75.3万</span></div>
              <div className="row final"><span>总计</span><span className="num">1,330.5万</span></div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

Object.assign(window, { ScreenQuote });
