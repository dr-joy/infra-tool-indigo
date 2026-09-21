
export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!response.ok) {
    const text = await response.text();
    let body: { message?: string; code?: string; details?: unknown } | null = null;
    try { body = JSON.parse(text); } catch { /* body không phải JSON */ }
    throw new ApiError(response.status, body?.message || text || `HTTP ${response.status}`, body?.code, body?.details);
  }
  return response.json() as Promise<T>;
}
