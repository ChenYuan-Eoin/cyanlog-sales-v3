// The transport never grants order permissions or treats incoming text as commands.
export function readConfig(env) {
  const botId = env.WECOM_BOT_ID?.trim();
  const secret = env.WECOM_BOT_SECRET?.trim();
  if (!botId || !/^[A-Za-z0-9_-]{4,128}$/.test(botId)) throw new Error('WECOM_BOT_ID is missing or invalid');
  if (!secret || secret.length > 512 || /\s/.test(secret)) throw new Error('WECOM_BOT_SECRET is missing or invalid');
  return { botId, secret };
}

export const quietLogger = Object.freeze({ debug() {}, info() {}, warn() {}, error() {} });

export function authenticationReason(message) {
  if (/signature|签名/i.test(message)) return 'signature_rejected';
  if (/invalid.*(?:secret|credential)|(?:secret|credential).*invalid/i.test(message)) return 'credentials_rejected';
  if (/disabled|revoked|停用|禁用/i.test(message)) return 'bot_disabled';
  return 'provider_rejected';
}

export function createConnection({ Client, config, onMessage, report = () => {}, timeoutMs = 30000, clock = () => new Date().toISOString() }) {
  const client = new Client({ ...config, logger: quietLogger, maxReconnectAttempts: -1, heartbeatInterval: 30000 });
  const state = { phase: 'idle', authenticated: false, business_ready: false, received_messages: 0, replied_messages: 0, message_errors: 0, reconnect_attempts: 0, changed_at: clock() };
  let session = 0;
  let stopped = false, deadline, resolveAuth, rejectAuth;
  const authenticated = new Promise((resolve, reject) => { resolveAuth = resolve; rejectAuth = reject; });
  function change(phase, fields = {}) {
    if (stopped && phase !== 'stopped') return;
    Object.assign(state, fields, { phase, changed_at: clock() });
    report({ ...state });
  }
  client.on('connected', () => { session += 1; change('authenticating', { authenticated: false }); });
  client.on('authenticated', () => {
    if (stopped) return;
    clearTimeout(deadline);
    change('connected', { authenticated: true, error_code: null, authentication_reason: null });
    resolveAuth();
  });
  client.on('disconnected', () => { session += 1; change('disconnected', { authenticated: false }); });
  client.on('reconnecting', attempt => change('reconnecting', { authenticated: false, reconnect_attempts: Number.isSafeInteger(attempt) ? attempt : state.reconnect_attempts + 1 }));
  // Do not print SDK error bodies: they can contain URLs, messages, or credentials.
  client.on('error', error => {
    const message = error instanceof Error ? error.message : '';
    const authRejected = message.startsWith('Authentication failed:');
    const code = authRejected ? message.match(/\(code: (-?\d+)\)$/)?.[1] : null;
    change(authRejected ? 'authentication_rejected' : 'connection_error', { authenticated: false, error_code: code ? Number(code) : null, authentication_reason: authRejected ? authenticationReason(message) : null });
    if (authRejected) {
      rejectAuth(new Error('Robot authentication rejected'));
      queueMicrotask(() => api.stop());
    }
  });
  client.on('message', frame => {
    if (stopped || !state.authenticated) return;
    state.received_messages += 1;
    if (!onMessage) return;
    const receivedSession = session;
    // A reply belongs to this authenticated socket and this exact incoming frame.
    // Business handlers must independently authorize the sender and deduplicate msgid.
    const reply = async (streamId, content, finish = true) => {
      if (stopped || !state.authenticated || session !== receivedSession) throw new Error('Reply connection is no longer authenticated');
      if (!frame?.headers?.req_id || typeof streamId !== 'string' || !streamId || typeof content !== 'string') throw new Error('Invalid reply');
      await client.replyStream(frame, streamId, content, finish);
      state.replied_messages += 1;
    };
    Promise.resolve().then(() => {
      if (stopped || !state.authenticated || session !== receivedSession) return;
      return onMessage(frame, reply);
    }).catch(() => {
      // Never log message text, sender identifiers, or an exception from the handler.
      state.message_errors += 1;
      report({ ...state });
    });
  });
  const api = {
    authenticated,
    snapshot: () => ({ ...state }),
    start() {
      if (state.phase !== 'idle') throw new Error('Connection already started');
      change('connecting');
      deadline = setTimeout(() => {
        if (stopped) return;
        change('authentication_timeout', { authenticated: false });
        rejectAuth(new Error('Robot authentication did not complete before the deadline'));
        this.stop();
      }, timeoutMs);
      try { client.connect(); } catch { clearTimeout(deadline); rejectAuth(new Error('Robot connection could not start')); this.stop(); }
      return authenticated;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(deadline);
      rejectAuth(new Error('Robot connection stopped before authentication'));
      try { client.disconnect(); } finally { change('stopped', { authenticated: false }); }
    }
  };
  return api;
}
