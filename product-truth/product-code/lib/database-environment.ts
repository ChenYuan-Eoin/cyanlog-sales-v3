// REQ: WP10. Prevent accidental production database use from local/preview apps.
const productionDatabaseHost = 'wfawwhphfqqwfwrrkogy.supabase.co'
export function assertDatabaseEnvironment(input: {
  databaseUrl: string
  vercel?: string
  vercelEnv?: string
  browserHostname?: string
}) {
  const host = new URL(input.databaseUrl).hostname
  if (host !== productionDatabaseHost) return
  const productionServer = input.vercel === '1' && input.vercelEnv === 'production'
  const productionBrowser = input.browserHostname === 'sales.cyanlog.icu'
  if (!productionServer && !productionBrowser) {
    throw new Error('DATABASE_ENVIRONMENT_MISMATCH: 本地和 Preview 禁止连接生产数据库，请配置隔离数据库')
  }
}
