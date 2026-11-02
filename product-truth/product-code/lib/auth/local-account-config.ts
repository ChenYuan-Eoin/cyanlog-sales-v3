// F003 / WP94: one server-owned switch for discovery and credential admission.
// Kept free of database/password imports so public discovery remains lightweight.
export function isLocalAccountLoginEnabled(): boolean {
  return process.env.LOCAL_ACCOUNT_LOGIN_ENABLED === 'true'
}
