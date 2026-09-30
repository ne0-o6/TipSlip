/**
 * Minimal client for the receipt service. Works on Node 18+ (global fetch).
 *
 *   const receipts = new ReceiptClient();
 *   const png = await receipts.render('thermal', data);
 */
export class ReceiptServiceError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = 'ReceiptServiceError';
    this.status = status;
    this.code = code;
  }
}

export class ReceiptClient {
  constructor(baseUrl = process.env.RECEIPT_SERVICE_URL ?? 'http://127.0.0.1:3939', { timeout = 30_000 } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeout = timeout;
  }

  /** @returns {Promise<Array<{id: string, code: string, name: string, description: string}>>} */
  async templates() {
    return (await this.#request('/templates')).json();
  }

  /** @returns {Promise<Array<{key: string, label: string, status: string}>>} */
  async payments() {
    return (await this.#request('/payments')).json();
  }

  /** @returns {Promise<Buffer>} PNG bytes */
  async render(template, data, { scale } = {}) {
    const res = await this.#request('/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template, data, scale }),
    });
    return Buffer.from(await res.arrayBuffer());
  }

  async #request(pathname, init = {}) {
    const res = await fetch(this.baseUrl + pathname, { ...init, signal: AbortSignal.timeout(this.timeout) });
    if (res.ok) return res;

    let error = {};
    try {
      ({ error = {} } = await res.json());
    } catch {
      // Non-JSON error body; fall back to the status line.
    }
    throw new ReceiptServiceError(error.message ?? `${res.status} ${res.statusText}`, {
      status: res.status,
      code: error.code,
    });
  }
}
