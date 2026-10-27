import { getApiKey } from '../../core/secrets.mjs';

// Thin REST client. Only read-only, credit-free endpoints are implemented here;
// paid calls are added together with the approval gate.
export class MeshyClient {
  constructor(cfg) {
    this.host = cfg.meshy.apiHost;
    this.key = getApiKey(cfg.meshy.keyEnvVar);
  }

  async get(pathname, query = {}) {
    if (!this.key) throw new Error('MESHY_API_KEY is not set');
    const url = new URL(pathname, this.host);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.key}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`GET ${pathname} -> ${res.status} ${body.message || ''}`.trim());
    return body;
  }

  balance() {
    return this.get('/openapi/v1/balance');
  }

  animationLibrary(query = {}) {
    return this.get('/openapi/v1/animations/library', query);
  }
}
