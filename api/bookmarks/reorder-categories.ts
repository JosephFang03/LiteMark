import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, handleOptions, parseJsonBody, sendError, sendJson } from '../_lib/http.js';
import { reorderBookmarkCategories } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';

type ReorderCategoryBody = {
  order?: string[];
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res, 'POST,OPTIONS')) {
    return;
  }

  applyCors(res, 'POST,OPTIONS');

  if (req.method !== 'POST') {
    sendError(res, 405, 'Method Not Allowed');
    return;
  }

  const auth = requireAuth(req, res);
  if (!auth) {
    return;
  }

  try {
    const body = await parseJsonBody<ReorderCategoryBody>(req);
    if (!Array.isArray(body.order)) {
      sendError(res, 400, '请求体需要提供 order 数组');
      return;
    }
    const updated = await reorderBookmarkCategories(body.order);
    sendJson(res, 200, updated);
  } catch (error) {
    console.error('书签分类排序失败', error);
    sendError(res, 500, '书签分类排序失败');
  }
}

