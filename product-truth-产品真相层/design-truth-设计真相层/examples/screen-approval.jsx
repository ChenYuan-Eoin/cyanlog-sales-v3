// Approval workspace — left queue (dark), right detail + node matrix + console
function ScreenApproval() {
  const [active, setActive] = React.useState(0);
  const tickets = [
    { id: 0, title: "华润万家云平台二期 · 报价审批", amount: "1,330.5 万", owner: "张一鸣", time: "5h 28m", prio: "high" },
    { id: 1, title: "省医疗云平台招标 · 让价审批", amount: "3,210.0 万", owner: "王蕾", time: "1h 14m", prio: "high" },
    { id: 2, title: "连锁零售续约协议 · 合同审批", amount: "486.0 万", owner: "陈瑶", time: "8h 02m", prio: "med" },
    { id: 3, title: "制造业 MES 改造 · 路径审批", amount: "2,750.0 万", owner: "李哲", time: "12h", prio: "med" },
    { id: 4, title: "华中电力数据平台 · 立项审批", amount: "—", owner: "赵晗", time: "新建", prio: "low" },
  ];
  const t = tickets[active];

  return (
    <>
      <section className="page-header">
        <div>
          <div className="eyebrow">审批</div>
          <h1 className="page-title">审批中心</h1>
          <p className="page-description">左队列、中详情、底操作。每条审批都展开为可见的流程矩阵。</p>
        </div>
        <div className="header-actions">
          <Button leading={<Icon id="i-bell" cls="i i-sm" />}>催办</Button>
          <Button variant="primary" leading={<Icon id="i-check-circle" cls="i i-sm" />}>批量通过</Button>
        </div>
      </section>

      <section className="approval-shell">
        {/* Left queue (dark) */}
        <aside className="approval-queue">
          <div className="approval-queue-head">
            <div className="overline">待办审批 · 4 件</div>
            <div className="approval-queue-search">
              <Icon id="i-search" cls="i i-sm" />
              <input placeholder="搜索单据 / 客户" />
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {tickets.map(ticket => (
              <div key={ticket.id}
                   className={"approval-ticket " + (active === ticket.id ? "active" : "")}
                   onClick={() => setActive(ticket.id)}>
                <div className="approval-ticket-head">
                  <strong>{ticket.title}</strong>
                  <span className={"approval-prio " + ticket.prio}>{ticket.prio === "high" ? "高优" : ticket.prio === "med" ? "中" : "低"}</span>
                </div>
                <div className="approval-ticket-meta">
                  <span>{ticket.owner}</span><span>停留 {ticket.time}</span>
                </div>
                <div className="approval-ticket-amount">{ticket.amount}</div>
              </div>
            ))}
          </div>
        </aside>

        {/* Right detail */}
        <div className="approval-detail">
          <div className="approval-hero">
            <div className="overline" style={{ color: "var(--cyan-300)" }}>报价审批 · 立项 → 商务</div>
            <div className="approval-hero-head">
              <h2 className="approval-hero-title">{t.title}</h2>
              <div className="approval-hero-total">
                <strong>{t.amount}</strong>
                <span>含税总额</span>
              </div>
            </div>
            <div className="approval-hero-grid">
              <div className="approval-hero-cell"><label>毛利率</label><strong>32.4%</strong></div>
              <div className="approval-hero-cell"><label>账期</label><strong>3-4-3 里程碑</strong></div>
              <div className="approval-hero-cell"><label>预计签约</label><strong>2024.12.20</strong></div>
            </div>
            <p className="caption" style={{ marginTop: 18, color: "rgba(255,255,255,0.66)", lineHeight: 1.7 }}>
              本单已通过法务初审。需要财务确认账期、销售总监确认让价幅度后即可签发。
            </p>
          </div>

          <div className="approval-nodes">
            <div className="row row-between">
              <h4 style={{ fontSize: 14 }}>流转矩阵</h4>
              <span className="caption">4 / 5 节点已到位</span>
            </div>
            <div className="approval-track">
              <div className="approval-node-card done">
                <div className="approval-node-user">
                  <Avatar>张</Avatar>
                  <div><strong>张一鸣</strong><span>发起 · 销售</span></div>
                </div>
                <div className="approval-node-comment">提交报价审批，包含三年维保。</div>
                <div className="approval-node-meta">11-18 09:32 · 通过</div>
              </div>
              <div className="approval-connector done"></div>
              <div className="approval-node-card done">
                <div className="approval-node-user">
                  <Avatar>林</Avatar>
                  <div><strong>林朗</strong><span>法务</span></div>
                </div>
                <div className="approval-node-comment">合同条款已覆盖云服务 SLA 与维保。无异议。</div>
                <div className="approval-node-meta">11-18 14:08 · 通过</div>
              </div>
              <div className="approval-connector done"></div>
              <div className="approval-node-card active">
                <div className="approval-node-user">
                  <Avatar tone="brand">高</Avatar>
                  <div><strong>高磊</strong><span>财务总监 · 待审</span></div>
                </div>
                <div className="approval-node-comment">需要确认 3-4-3 账期与里程碑回款节奏。</div>
                <div className="approval-node-meta">停留 5h 28m</div>
              </div>
              <div className="approval-connector"></div>
              <div className="approval-node-card pending">
                <div className="approval-node-user">
                  <Avatar>赵</Avatar>
                  <div><strong>赵明</strong><span>销售总监 · 待发</span></div>
                </div>
                <div className="approval-node-comment" style={{ color: "var(--fg-4)", fontStyle: "italic" }}>等待财务确认后发起。</div>
                <div className="approval-node-meta">—</div>
              </div>
              <div className="approval-connector"></div>
              <div className="approval-node-card pending">
                <div className="approval-node-user">
                  <Avatar>系</Avatar>
                  <div><strong>系统</strong><span>归档</span></div>
                </div>
                <div className="approval-node-comment" style={{ color: "var(--fg-4)", fontStyle: "italic" }}>自动归档到机会卡片。</div>
                <div className="approval-node-meta">—</div>
              </div>
            </div>
          </div>

          <div className="approval-console">
            <Avatar tone="gradient">张</Avatar>
            <input placeholder="留下评论或 @ 团队成员 …" />
            <span className="console-divider"></span>
            <div className="approval-console-actions">
              <Button variant="danger">驳回</Button>
              <Button variant="primary" leading={<Icon id="i-check-circle" cls="i i-sm" />}>通过</Button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

Object.assign(window, { ScreenApproval });
