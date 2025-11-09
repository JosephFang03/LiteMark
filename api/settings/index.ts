import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  applyCors,
  handleOptions,
  parseJsonBody,
  sendError,
  sendJson
} from '../_lib/http.js';
import { getSettings, updateSettings } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';

type SettingsBody = {
  theme?: string;
  siteTitle?: string;
  siteIcon?: string;
};

const ALLOWED_THEMES = new Set(['light', 'twilight', 'dark', 'forest', 'ocean', 'sunrise']);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res, 'GET,PUT,OPTIONS')) {
    return;
  }
  applyCors(res, 'GET,PUT,OPTIONS');

  if (req.method === 'GET') {
    try {
      const settings = await getSettings();
      sendJson(res, 200, settings);
    } catch (error) {
      console.error('获取站点设置失败', error);
      sendError(res, 500, '获取站点设置失败');
    }
    return;
  }

  if (req.method === 'PUT') {
    const auth = requireAuth(req, res);
    if (!auth) {
      return;
    }
    try {
      const body = await parseJsonBody<SettingsBody>(req);
      const updates: SettingsBody = {};

      if (typeof body.theme === 'string') {
        const theme = body.theme.trim();
        if (!ALLOWED_THEMES.has(theme)) {
          sendError(res, 400, '无效的主题');
          return;
        }
        updates.theme = theme;
      }

      if (typeof body.siteTitle === 'string') {
        const title = body.siteTitle.trim();
        if (!title) {
          sendError(res, 400, '站点标题不能为空');
          return;
        }
        if (title.length > 60) {
          sendError(res, 400, '站点标题长度不能超过 60 个字符');
          return;
        }
        updates.siteTitle = title;
      }

      if (typeof body.siteIcon === 'string') {
        const icon = body.siteIcon.trim();
        if (icon.length > 512) {
          sendError(res, 400, '站点图标长度不能超过 512 个字符');
          return;
        }
        updates.siteIcon = icon;
      }

      if (Object.keys(updates).length === 0) {
        sendError(res, 400, '请求体不能为空');
        return;
      }

      const updated = await updateSettings(updates);
      sendJson(res, 200, updated);
    } catch (error) {
      console.error('更新站点设置失败', error);
      sendError(res, 500, '更新站点设置失败');
    }
    return;
  }

  sendError(res, 405, 'Method Not Allowed');
}

