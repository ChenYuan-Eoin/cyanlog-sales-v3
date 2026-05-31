// Cyanlog UI Kit — shared primitives + chrome
// Refactored from the original src/assets/layout.js into proper React components.

const Icon = ({ id, cls = "i" }) => (
  <svg className={cls} aria-hidden="true">
    <use href={"#" + id} />
  </svg>
);

const Pill = ({ tone = "default", noDot, children, style }) => {
  const cls = ["pill", tone === "default" ? "" : tone, noDot ? "no-dot" : ""].filter(Boolean).join(" ");
  return <span className={cls} style={style}>{children}</span>;
};

const Button = ({ variant = "default", size, leading, trailing, children, onClick, style, type = "button" }) => {
  const cls = [
    "btn",
    variant === "primary" ? "btn-primary" : "",
    variant === "ghost" ? "btn-ghost" : "",
    variant === "danger" ? "btn-danger" : "",
    size === "lg" ? "btn-lg" : "",
    size === "sm" ? "btn-sm" : "",
    !children ? "btn-icon" : "",
  ].filter(Boolean).join(" ");
  return (
    <button type={type} className={cls} onClick={onClick} style={style}>
      {leading}
      {children}
      {trailing}
    </button>
  );
};

const Field = ({ label, hint, children }) => (
  <label className="field">
    {label && <span className="field-label">{label}</span>}
    {children}
    {hint && <span className="field-hint">{hint}</span>}
  </label>
);

const Card = ({ children, className = "", style, onClick, as: As = "div" }) => (
  <As className={"card " + className} style={style} onClick={onClick}>{children}</As>
);

const CardHead = ({ title, meta, right, eyebrow }) => (
  <div className="card-head">
    <div>
      {eyebrow && <div className="stat-label" style={{ marginBottom: 4 }}>{eyebrow}</div>}
      {title && <h3 className="card-title">{title}</h3>}
      {meta && <div className="card-meta">{meta}</div>}
    </div>
    {right}
  </div>
);

const Stat = ({ label, value, delta, deltaTone = "up", pill }) => (
  <div>
    <div className="card-head" style={{ marginBottom: 12 }}>
      <div className="stat-label">{label}</div>
      {pill}
    </div>
    <div className="stat-value">{value}</div>
    {delta && <div className={"delta delta-" + deltaTone} style={{ marginTop: 6 }}>{delta}</div>}
  </div>
);

const Avatar = ({ children, tone = "default", size }) => {
  const cls = [
    "avatar",
    size === "lg" ? "lg" : "",
    tone === "brand" ? "brand" : "",
    tone === "gradient" ? "gradient" : "",
  ].filter(Boolean).join(" ");
  return <div className={cls}>{children}</div>;
};

const BrandMark = ({ size = 44, theme = "dark" }) => {
  const styles = {
    width: size, height: size, borderRadius: size * 0.32,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    fontWeight: 700, fontSize: size * 0.32, letterSpacing: "0.04em",
    background: theme === "dark"
      ? "rgba(255,255,255,0.06)"
      : "linear-gradient(135deg, var(--cyan-500) 0%, var(--cyan-700) 100%)",
    border: theme === "dark" ? "1px solid rgba(255,255,255,0.12)" : "none",
    color: "#fff",
    flexShrink: 0,
  };
  return <div style={styles}>CY</div>;
};

// ---------- Sidebar / Rail / Topbar ----------

const RAIL_ITEMS = [
  { key: "home", label: "首页", icon: "i-home" },
  { key: "quote", label: "报价", icon: "i-quote" },
  { key: "tender", label: "标书", icon: "i-tender" },
  { key: "contract", label: "合同", icon: "i-contract" },
  { key: "calendar", label: "日程", icon: "i-calendar" },
  { key: "approval", label: "审批", icon: "i-approval" },
  { key: "settings", label: "系统支撑", icon: "i-settings" },
];

const SIDEBAR_GROUPS = [
  {
    label: "用户旅程",
    items: [
      { key: "home", label: "首页", route: "home" },
      { key: "lead", label: "客户接触", route: "home", badge: "3" },
      { key: "routing", label: "机会分流", route: "home" },
      { key: "quote", label: "报价中心", route: "quote", badge: "14" },
      { key: "tender", label: "标书解析", route: "home", badge: "9" },
    ],
  },
  {
    label: "执行与协同",
    items: [
      { key: "schedule", label: "日程引擎", route: "home" },
      { key: "contract", label: "合同生成", route: "home", badge: "6" },
      { key: "calendar", label: "团队日程", route: "home" },
      { key: "approval", label: "审批中心", route: "approval", badge: "4" },
    ],
  },
  {
    label: "系统支撑",
    items: [
      { key: "config", label: "配置中心", route: "home" },
      { key: "brand", label: "品牌中心", route: "home" },
    ],
  },
];

const Rail = ({ active, onNav }) => (
  <aside className="rail">
    <a className="rail-logo" onClick={() => onNav("home")}>CY</a>
    {RAIL_ITEMS.map(item => (
      <a key={item.key}
         className={"rail-icon " + (item.key === active ? "active" : "")}
         title={item.label}
         onClick={() => onNav(item.key === "quote" ? "quote" : item.key === "approval" ? "approval" : "home")}>
        <Icon id={item.icon} />
      </a>
    ))}
  </aside>
);

const Sidebar = ({ activePage, onNav }) => (
  <aside className="sidebar">
    <div className="sidebar-header">
      <div className="product-title">Cyanlog</div>
      <div className="product-subtitle">销售支撑平台</div>
    </div>
    <div className="workspace-block">
      <div>
        <div className="workspace-name">华东销售作战空间</div>
        <div className="workspace-meta">12 个活跃机会 · 6 个关键节点</div>
      </div>
      <span className="workspace-chip">ONES</span>
    </div>
    {SIDEBAR_GROUPS.map(group => (
      <div key={group.label} className="sidebar-section">
        <div className="sidebar-label">{group.label}</div>
        <div className="nav-list">
          {group.items.map(item => (
            <a key={item.key}
               className={"nav-item " + (item.key === activePage ? "active" : "")}
               onClick={() => onNav(item.route, item.key)}>
              <span>{item.label}</span>
              {item.badge && <span className="nav-badge">{item.badge}</span>}
            </a>
          ))}
        </div>
      </div>
    ))}
  </aside>
);

const TopBar = ({ title, meta, action }) => (
  <header className="topbar">
    <div>
      <div className="topbar-title">{title}</div>
      <div className="topbar-meta">{meta}</div>
    </div>
    <div className="topbar-actions">
      <label className="search-shell">
        <Icon id="i-search" cls="i i-sm" />
        <input placeholder="搜索机会、客户、单据、模板" />
        <span className="kbd">⌘ K</span>
      </label>
      <Button variant="ghost" size="sm">
        <Icon id="i-bell" cls="i i-sm" />
      </Button>
      {action}
      <div className="topbar-user">
        <div className="topbar-user-meta">
          <strong>张一鸣</strong>
          <span>华东销售</span>
        </div>
        <Avatar tone="gradient">张</Avatar>
      </div>
    </div>
  </header>
);

const Shell = ({ activeRail, activePage, topTitle, topMeta, topAction, children, onNav }) => (
  <div className="shell">
    <Rail active={activeRail} onNav={onNav} />
    <Sidebar activePage={activePage} onNav={onNav} />
    <TopBar title={topTitle} meta={topMeta} action={topAction} />
    <main className="content">
      <div className="page">{children}</div>
    </main>
  </div>
);

// Export to window so other Babel script files can use these
Object.assign(window, {
  Icon, Pill, Button, Field, Card, CardHead, Stat, Avatar, BrandMark,
  Rail, Sidebar, TopBar, Shell,
});
