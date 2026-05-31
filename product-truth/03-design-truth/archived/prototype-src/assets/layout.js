function appIcon(id, cls = "i") {
    return `<svg class="${cls}" aria-hidden="true"><use href="./assets/icons.svg#${id}"></use></svg>`;
}

function pageShell(options) {
    const {
        activeRail = "home",
        activePage = "",
        topTitle = "",
        topMeta = "",
        searchPlaceholder = "搜索机会、客户、单据、模板",
        topAction = "",
        pageClass = "",
        content = ""
    } = options;

    const railItems = [
        { key: "home", label: "首页", icon: "i-home", href: "./home-dashboard.html" },
        { key: "quote", label: "报价", icon: "i-quote", href: "./quote-center.html" },
        { key: "tender", label: "标书", icon: "i-tender", href: "./tender-analysis.html" },
        { key: "contract", label: "合同", icon: "i-contract", href: "./contract-center.html" },
        { key: "calendar", label: "日程", icon: "i-calendar", href: "./calendar-overview.html" },
        { key: "approval", label: "审批", icon: "i-approval", href: "./approval-center.html" },
        { key: "settings", label: "系统支撑", icon: "i-settings", href: "./config-center.html" }
    ];

    const journeyPages = [
        { key: "login", label: "登录", href: "./login.html" },
        { key: "home-dashboard", label: "首页", href: "./home-dashboard.html" },
        { key: "lead-intake", label: "客户接触", href: "./lead-intake.html", badge: "3" },
        { key: "opportunity-routing", label: "机会分流", href: "./opportunity-routing.html" },
        { key: "quote-center", label: "报价中心", href: "./quote-center.html", badge: "14" },
        { key: "tender-analysis", label: "标书解析", href: "./tender-analysis.html", badge: "9" },
        { key: "tender-schedule", label: "日程引擎", href: "./tender-schedule.html" },
        { key: "contract-center", label: "合同生成", href: "./contract-center.html", badge: "6" },
        { key: "contract-review", label: "合同审核", href: "./contract-review.html" },
        { key: "calendar-overview", label: "团队日程", href: "./calendar-overview.html" },
        { key: "approval-center", label: "审批中心", href: "./approval-center.html", badge: "4" },
        { key: "config-center", label: "配置中心", href: "./config-center.html" },
        { key: "brand-center", label: "品牌中心", href: "./brand-center.html" }
    ];

    const sidebarGroups = [
        {
            label: "用户旅程",
            items: journeyPages.slice(0, 6)
        },
        {
            label: "执行与协同",
            items: journeyPages.slice(6, 11)
        },
        {
            label: "系统支撑",
            items: journeyPages.slice(11)
        }
    ];

    return `
    <div class="shell">
        <aside class="rail">
            <a class="rail-logo" href="./home-dashboard.html">CY</a>
            ${railItems.map(item => `
                <a class="rail-icon ${item.key === activeRail ? "active" : ""}" href="${item.href}" title="${item.label}">
                    ${appIcon(item.icon)}
                </a>
            `).join("")}
        </aside>

        <aside class="sidebar">
            <div class="sidebar-header">
                <div class="product-title">Cyanlog</div>
                <div class="product-subtitle">销售支撑平台</div>
            </div>

            <div class="workspace-block">
                <div>
                    <div class="workspace-name">华东销售作战空间</div>
                    <div class="workspace-meta">12 个活跃机会 · 6 个关键节点</div>
                </div>
                <div class="workspace-chip">ONES</div>
            </div>

            ${sidebarGroups.map(group => `
                <div class="sidebar-section">
                    <div class="sidebar-label">${group.label}</div>
                    <div class="nav-list">
                        ${group.items.map(item => `
                            <a class="nav-item ${item.key === activePage ? "active" : ""}" href="${item.href}">
                                <span>${item.label}</span>
                                ${item.badge ? `<span class="nav-badge">${item.badge}</span>` : ""}
                            </a>
                        `).join("")}
                    </div>
                </div>
            `).join("")}
        </aside>

        <header class="topbar">
            <div>
                <div class="topbar-title">${topTitle}</div>
                <div class="topbar-meta">${topMeta}</div>
            </div>
            <div class="topbar-actions">
                <label class="search-shell">
                    ${appIcon("i-search")}
                    <input class="search" placeholder="${searchPlaceholder}">
                </label>
                <a class="btn" href="./brand-center.html">品牌中心</a>
                ${topAction}
                <div class="topbar-user">
                    <div class="topbar-user-meta">
                        <strong>张一鸣</strong>
                        <span>华东销售</span>
                    </div>
                    <div class="topbar-avatar">张</div>
                </div>
            </div>
        </header>

        <main class="content">
            <div class="page ${pageClass}">${content}</div>
        </main>
    </div>`;
}
