import { execFileSync } from 'node:child_process';

// Key is read from the environment; on Windows a user-level variable set after this
// process started is read from the registry. The value is never logged.
export function getApiKey(envVar = 'MESHY_API_KEY') {
  if (process.env[envVar]) return process.env[envVar];
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', envVar], { encoding: 'utf8' });
      const m = out.match(/REG_SZ\s+(\S+)/);
      if (m) return m[1];
    } catch { /* not set */ }
  }
  return null;
}

export function maskKey(key) {
  return key ? `${key.slice(0, 4)}…(${key.length} chars)` : '(not set)';
}
