import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  applyCors,
  handleOptions,
  parseJsonBody,
  sendError,
  sendJson
} from '../_lib/http.js';
import { createBookmark, listBookmarks } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';

type BookmarkBody = {
  title?: string;
  url?: string;
  category?: string;
  description?: string;
  visible?: boolean;
};

function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res, 'GET,POST,OPTIONS')) {
    return;
  }

  applyCors(res, 'GET,POST,OPTIONS');

  if (req.method === 'GET') {
    try {
      console.log('获取书签');
      const bookmarks = await listBookmarks();
      console.log('书签', bookmarks);
      sendJson(res, 200, bookmarks);
    } catch (error) {
      console.error('获取书签失败', error);
      sendError(res, 500, '获取书签失败');
    }
    return;
  }

  if (req.method === 'POST') {
    const auth = requireAuth(req, res);
    if (!auth) {
      return;
    }
    try {
      const body = await parseJsonBody<BookmarkBody>(req);
      const title = body.title?.trim();
      const url = body.url?.trim();

      if (!title || !url) {
        sendError(res, 400, '标题和链接不能为空');
        return;
      }

      const bookmark = await createBookmark({
        title,
        url: sanitizeUrl(url),
        category: body.category?.trim() || undefined,
        description: body.description?.trim() || undefined,
        visible: body.visible ?? true
      });
      sendJson(res, 201, bookmark);
    } catch (error) {
      console.error('新增书签失败', error);
      sendError(res, 500, '新增书签失败');
    }
    return;
  }

  sendError(res, 405, 'Method Not Allowed');
}

