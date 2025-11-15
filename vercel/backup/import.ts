import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  applyCors,
  applyNoCache,
  handleOptions,
  parseJsonBody,
  sendError,
  sendJson
} from '../_lib/http.js';
import { createBookmark, listBookmarks, deleteBookmark } from '../_lib/db.js';
import { updateSettings } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';

type ImportRequestBody = {
  bookmarks?: Array<{
    id?: string;
    title: string;
    url: string;
    category?: string;
    description?: string;
    visible?: boolean;
  }>;
  settings?: {
    theme?: string;
    siteTitle?: string;
    siteIcon?: string;
  };
  overwrite?: boolean; // 是否覆盖现有数据
};

function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return '';
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res, 'POST,OPTIONS')) {
    return;
  }

  applyCors(res, 'POST,OPTIONS');
  applyNoCache(res);

  if (req.method !== 'POST') {
    sendError(res, 405, 'Method Not Allowed');
    return;
  }

  const auth = requireAuth(req, res);
  if (!auth) {
    return;
  }

  try {
    const body = await parseJsonBody<ImportRequestBody>(req);

    if (!body.bookmarks && !body.settings) {
      sendError(res, 400, '导入数据不能为空，至少需要包含 bookmarks 或 settings');
      return;
    }

    let importedBookmarks = 0;
    let updatedSettings = false;
    const errors: string[] = [];

    // 如果选择覆盖，先删除所有现有书签
    if (body.overwrite && body.bookmarks) {
      try {
        const existingBookmarks = await listBookmarks();
        // 删除所有现有书签
        for (const bookmark of existingBookmarks) {
          try {
            await deleteBookmark(bookmark.id);
          } catch (error) {
            console.error(`删除书签 ${bookmark.id} 失败:`, error);
          }
        }
      } catch (error) {
        errors.push('清除现有书签失败：' + (error instanceof Error ? error.message : '未知错误'));
      }
    }

    // 导入书签
    if (body.bookmarks && Array.isArray(body.bookmarks)) {
      for (const bookmarkData of body.bookmarks) {
        try {
          if (!bookmarkData.title || !bookmarkData.url) {
            errors.push('跳过无效书签：标题或链接为空');
            continue;
          }

          const url = sanitizeUrl(bookmarkData.url);
          if (!url) {
            errors.push(`跳过无效书签 "${bookmarkData.title}"：URL 格式错误`);
            continue;
          }

          await createBookmark({
            title: bookmarkData.title.trim(),
            url,
            category: bookmarkData.category?.trim() || undefined,
            description: bookmarkData.description?.trim() || undefined,
            visible: bookmarkData.visible !== undefined ? bookmarkData.visible : true
          });

          importedBookmarks++;
        } catch (error) {
          const message = error instanceof Error ? error.message : '未知错误';
          errors.push(`导入书签 "${bookmarkData.title || bookmarkData.url}" 失败：${message}`);
        }
      }
    }

    // 导入设置
    if (body.settings) {
      try {
        const updates: {
          theme?: string;
          siteTitle?: string;
          siteIcon?: string;
        } = {};

        if (body.settings.theme) {
          updates.theme = body.settings.theme;
        }
        if (body.settings.siteTitle) {
          updates.siteTitle = body.settings.siteTitle;
        }
        if (body.settings.siteIcon) {
          updates.siteIcon = body.settings.siteIcon;
        }

        if (Object.keys(updates).length > 0) {
          await updateSettings(updates);
          updatedSettings = true;
        }
      } catch (error) {
        errors.push('导入设置失败：' + (error instanceof Error ? error.message : '未知错误'));
      }
    }

    sendJson(res, 200, {
      success: true,
      importedBookmarks,
      updatedSettings,
      totalBookmarks: body.bookmarks?.length || 0,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('导入数据失败', error);
    const message = error instanceof Error ? error.message : '导入数据失败';
    sendError(res, 500, message);
  }
}

