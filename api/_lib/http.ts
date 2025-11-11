import type { VercelRequest, VercelResponse } from '@vercel/node';

const DEFAULT_ALLOWED_ORIGIN = process.env.CORS_ORIGIN ?? '*';

export function applyCors(res: VercelResponse, methods = 'GET,POST,PUT,DELETE,OPTIONS') {
  const origin = DEFAULT_ALLOWED_ORIGIN;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Cache-Control'
  );
  if (origin !== '*') {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
}

export function handleOptions(req: VercelRequest, res: VercelResponse, methods?: string) {
  if (req.method === 'OPTIONS') {
    applyCors(res, methods);
    res.status(204).end();
    return true;
  }
  return false;
}

export async function parseJsonBody<T = any>(req: VercelRequest): Promise<T> {
  if (req.body && typeof req.body === 'object') {
    return req.body as T;
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) {
    return {} as T;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error('请求体不是合法的 JSON');
  }
}

export function sendJson(res: VercelResponse, status: number, payload: unknown) {
  res.status(status).json(payload);
}

export function sendError(res: VercelResponse, status: number, message: string) {
  sendJson(res, status, { error: message });
}

