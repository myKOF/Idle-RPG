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

  // Paid call. Never retried here; callers must pass the approval gate first.
  async post(pathname, body) {
    if (!this.key) throw new Error('MESHY_API_KEY is not set');
    const res = await fetch(new URL(pathname, this.host), {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`POST ${pathname} -> ${res.status} ${data.message || ''}`.trim());
    return data;
  }

  createTextTo3d(params) {
    return this.post('/openapi/v2/text-to-3d', params);
  }

  getTextTo3d(id) {
    return this.get(`/openapi/v2/text-to-3d/${id}`);
  }

  createRetexture(params) {
    return this.post('/openapi/v1/retexture', params);
  }

  getRetexture(id) {
    return this.get(`/openapi/v1/retexture/${id}`);
  }

  createImageTo3d(params) {
    return this.post('/openapi/v1/image-to-3d', params);
  }

  getImageTo3d(id) {
    return this.get(`/openapi/v1/image-to-3d/${id}`);
  }

  createTextToImage(params) {
    return this.post('/openapi/v1/text-to-image', params);
  }

  getTextToImage(id) {
    return this.get(`/openapi/v1/text-to-image/${id}`);
  }

  balance() {
    return this.get('/openapi/v1/balance');
  }

  animationLibrary(query = {}) {
    return this.get('/openapi/v1/animations/library', query);
  }
}
