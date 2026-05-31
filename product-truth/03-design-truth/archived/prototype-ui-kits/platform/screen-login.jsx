// Login screen — auth gate
function ScreenLogin({ onLogin }) {
  return (
    <div className="login-layout">
      <section className="login-visual">
        <div className="login-brand">
          <BrandMark size={44} theme="dark" />
          <div>
            <strong style={{ display: "block", fontSize: 18, fontWeight: 700, letterSpacing: "-0.005em" }}>Cyanlog</strong>
            <span style={{ display: "block", marginTop: 4, fontSize: 11, color: "rgba(255,255,255,0.55)", letterSpacing: "0.04em" }}>企业销售支撑平台</span>
          </div>
        </div>

        <div>
          <div className="eyebrow" style={{ color: "var(--cyan-300)" }}>访问验证</div>
          <h1>把销售流程<br/>装进同一个工作空间。</h1>
          <p>从客户接触到合同审批，所有节点、所有人、所有材料在一个空间内推进。验证通过后进入华东作战空间。</p>
        </div>

        <div className="login-illustration-stage">
          <img src="../../assets/illustrations/login-secure.svg" alt="安全工作空间" />
        </div>
      </section>

      <section className="login-panel">
        <div className="auth-card">
          <div className="auth-badge">
            <Icon id="i-login" cls="i i-sm" />
            企业工作空间
          </div>
          <h2>企业登录</h2>
          <p className="lede">使用企业邮箱或 SSO 完成验证。通过后进入首页。</p>

          <form onSubmit={(e) => { e.preventDefault(); onLogin(); }} className="stack-5">
            <Field label="企业邮箱">
              <input className="input" type="email" defaultValue="zhang.ym@cyanlog.com" autoComplete="email" />
            </Field>
            <Field label="密码">
              <input className="input" type="password" defaultValue="••••••••" autoComplete="current-password" />
            </Field>
            <Field label="工作空间">
              <input className="input" defaultValue="华东销售作战空间" />
            </Field>

            <div className="stack-3" style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid var(--border-2)" }}>
              <Button type="submit" variant="primary" size="lg" style={{ width: "100%" }}>
                进入首页
                <Icon id="i-arrow-right" cls="i i-sm" />
              </Button>
              <Button onClick={onLogin} size="lg" style={{ width: "100%" }}>使用企业 SSO 登录</Button>
            </div>
          </form>

          <p className="caption" style={{ marginTop: 28, color: "var(--fg-3)" }}>
            仅授权成员可访问机会、报价、合同、审批和协同记录。
          </p>
        </div>
      </section>
    </div>
  );
}

Object.assign(window, { ScreenLogin });
