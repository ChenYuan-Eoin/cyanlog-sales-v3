// Home dashboard — today's queue + module switchboard
function ScreenHome({ onNav }) {
  return (
    <>
      <section className="page-header">
        <div>
          <div className="eyebrow">首页</div>
          <h1 className="page-title">销售作战首页</h1>
          <p className="page-description">今天要推的项目、要补的缺口、要切换的工作台都在这里。</p>
        </div>
        <div className="header-actions">
          <Button leading={<Icon id="i-file-plus" cls="i i-sm" />}>录入客户接触</Button>
          <Button variant="primary" leading={<Icon id="i-network" cls="i i-sm" />}>新建机会分流</Button>
        </div>
      </section>

      <section className="metric-strip">
        <Card><Stat label="活跃机会" value="27" delta="+6 较上周" deltaTone="up" pill={<Pill tone="brand" noDot>总览</Pill>} /></Card>
        <Card><Stat label="今日硬节点" value="4 个" delta="需跨角色协同" deltaTone="flat" pill={<Pill tone="warning" noDot>11</Pill>} /></Card>
        <Card><Stat label="待审批" value="5h 28m" delta="平均停留" deltaTone="flat" pill={<Pill tone="danger" noDot>4</Pill>} /></Card>
        <Card><Stat label="本周签约目标" value="3,210万" delta="完成率 62%" deltaTone="up" pill={<Pill tone="success" noDot>6 单</Pill>} /></Card>
      </section>

      <section className="split-12">
        <div className="dark-dock">
          <div className="eyebrow">华东销售作战空间</div>
          <h2>今日优先队列</h2>
          <p>优先处理下列项目与动作。每一项都还差一个明确节点。</p>
          <div className="dock-strip">
            <div className="dock-chip">
              <strong>华润万家云平台二期</strong>
              <span>报价确认中 · 待补交付日</span>
            </div>
            <div className="dock-chip">
              <strong>省医疗云平台招标</strong>
              <span>标书准备中 · 待校案例</span>
            </div>
            <div className="dock-chip">
              <strong>连锁零售续约协议</strong>
              <span>合同审核中 · 待确认账期</span>
            </div>
          </div>
        </div>

        <div className="stack-4">
          <Card>
            <CardHead title="今日安排" />
            <div className="timeline">
              <div className="timeline-row"><div className="time">09:30</div><div><strong>确认报价交付日</strong><span>3 个项目待补。</span></div></div>
              <div className="timeline-row"><div className="time">11:00</div><div><strong>标书材料校核</strong><span>补齐案例与附件。</span></div></div>
              <div className="timeline-row"><div className="time">15:30</div><div><strong>合同审核反馈</strong><span>确认是否进入审批。</span></div></div>
            </div>
          </Card>

          <Card>
            <CardHead title="今日提醒" right={<Pill tone="warning" noDot>3</Pill>} />
            <div className="property-list">
              <div className="property-row"><span className="key">待补客户信息</span><span className="val">3 条</span></div>
              <div className="property-row"><span className="key">待锁定节点</span><span className="val">4 个项目</span></div>
              <div className="property-row"><span className="key">品牌与模板更新</span><span className="val">1 项待确认</span></div>
            </div>
          </Card>
        </div>
      </section>

      <section className="split-grid-3">
        <a className="module-tile" onClick={() => onNav("quote", "quote")}>
          <div className="card-head">
            <div className="icon-chip brand"><Icon id="i-quote" cls="i i-lg" /></div>
            <Pill tone="brand" noDot>报价工作台</Pill>
          </div>
          <h3>输入与正式稿并排</h3>
          <p>左侧录入与判断，右侧维护正式报价稿。</p>
          <ul>
            <li>14 单在推进，其中 5 单等交付日期</li>
            <li>低毛利规则会自动抬升审批门槛</li>
          </ul>
          <div className="module-foot">
            <span style={{ color: "var(--fg-3)" }}>当前焦点</span>
            <span>华润二期 →</span>
          </div>
        </a>

        <a className="module-tile" onClick={() => onNav("home", "tender")}>
          <div className="card-head">
            <div className="icon-chip"><Icon id="i-tender" cls="i i-lg" /></div>
            <Pill tone="warning" noDot>标书工作台</Pill>
          </div>
          <h3>边读原文边做对标与风险</h3>
          <p>正文、对标、风险三层并行。</p>
          <ul>
            <li>9 单在推进，3 单进入高压周期</li>
            <li>标书页直接可转到日程引擎</li>
          </ul>
          <div className="module-foot">
            <span style={{ color: "var(--fg-3)" }}>当前焦点</span>
            <span>医疗云项目 →</span>
          </div>
        </a>

        <a className="module-tile" onClick={() => onNav("home", "contract")}>
          <div className="card-head">
            <div className="icon-chip"><Icon id="i-contract" cls="i i-lg" /></div>
            <Pill tone="success" noDot>合同工作台</Pill>
          </div>
          <h3>生成与审核分层处理</h3>
          <p>生成、审核、审批分层处理。</p>
          <ul>
            <li>6 份待审核，2 份涉及特殊账期</li>
            <li>付款条款与报价字段自动继承</li>
          </ul>
          <div className="module-foot">
            <span style={{ color: "var(--fg-3)" }}>当前焦点</span>
            <span>续约协议 →</span>
          </div>
        </a>
      </section>

      <section className="split-12">
        <Card>
          <CardHead title="当前机会队列" right={<Button variant="ghost" size="sm" trailing={<Icon id="i-arrow-right" cls="i i-sm" />}>查看全部</Button>} />
          <table className="table">
            <thead>
              <tr><th>机会</th><th>当前页</th><th>下一动作</th><th>状态</th><th style={{ textAlign: "right" }}>金额</th></tr>
            </thead>
            <tbody>
              <tr><td><strong>华润万家云平台二期</strong><div className="caption">张一鸣</div></td><td>报价中心</td><td>补交付日期</td><td><Pill tone="warning" noDot>待补</Pill></td><td className="num" style={{ textAlign: "right" }}>1,280万</td></tr>
              <tr><td><strong>省医疗云平台招标</strong><div className="caption">王蕾</div></td><td>标书解析</td><td>生成日程</td><td><Pill tone="info" noDot>进行中</Pill></td><td className="num" style={{ textAlign: "right" }}>3,210万</td></tr>
              <tr><td><strong>连锁零售续约协议</strong><div className="caption">陈瑶</div></td><td>合同审核</td><td>进入审批</td><td><Pill tone="success" noDot>已通过</Pill></td><td className="num" style={{ textAlign: "right" }}>486万</td></tr>
              <tr><td><strong>制造业 MES 改造</strong><div className="caption">李哲</div></td><td>机会分流</td><td>确定主路径</td><td><Pill tone="info" noDot>进行中</Pill></td><td className="num" style={{ textAlign: "right" }}>2,750万</td></tr>
              <tr><td><strong>华中电力数据平台</strong><div className="caption">赵晗</div></td><td>客户接触</td><td>补录信息</td><td><Pill noDot>未开始</Pill></td><td className="num" style={{ textAlign: "right" }}>—</td></tr>
            </tbody>
          </table>
        </Card>

        <div className="stack-4">
          <Card>
            <CardHead title="今天要补的缺口" />
            <div className="stack-3">
              <div className="card-flat">
                <strong style={{ fontSize: 13 }}>案例材料待补</strong>
                <div className="caption" style={{ marginTop: 4 }}>1 项未完成。</div>
              </div>
              <div className="card-flat">
                <strong style={{ fontSize: 13 }}>交付日期待确认</strong>
                <div className="caption" style={{ marginTop: 4 }}>2 个报价待补。</div>
              </div>
              <div className="card-flat">
                <strong style={{ fontSize: 13 }}>模板待确认</strong>
                <div className="caption" style={{ marginTop: 4 }}>品牌中心 1 项待处理。</div>
              </div>
            </div>
          </Card>
        </div>
      </section>
    </>
  );
}

Object.assign(window, { ScreenHome });
