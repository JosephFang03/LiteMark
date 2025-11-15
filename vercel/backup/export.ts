import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  applyCors,
  applyNoCache,
  handleOptions,
  sendError,
  sendJson
} from '../_lib/http.js';
import { listBookmarks } from '../_lib/db.js';
import { getSettings } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res, 'GET,OPTIONS')) {
    return;
  }

  applyCors(res, 'GET,OPTIONS');
  applyNoCache(res);

  if (req.method !== 'GET') {
    sendError(res, 405, 'Method Not Allowed');
    return;
  }

  const auth = requireAuth(req, res);
  if (!auth) {
    return;
  }

  try {
    // 获取所有数据
    const bookmarks = await listBookmarks();
    const settings = await getSettings();

    // 转换为之前的文件格式
    const exportData = {
      bookmarks: bookmarks.map((bookmark) => ({
        id: bookmark.id,
        title: bookmark.title,
        url: bookmark.url,
        category: bookmark.category || undefined,
        description: bookmark.description || undefined,
        visible: bookmark.visible
      })),
      settings: {
        theme: settings.theme,
        siteTitle: settings.siteTitle,
        siteIcon: settings.siteIcon
      }
    };

    // 设置响应头，让浏览器下载文件
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="litemark-backup-${new Date().toISOString().split('T')[0]}.json"`
    );

    sendJson(res, 200, exportData);
  } catch (error) {
    console.error('导出数据失败', error);
    const message = error instanceof Error ? error.message : '导出数据失败';
    sendError(res, 500, message);
  }
}

