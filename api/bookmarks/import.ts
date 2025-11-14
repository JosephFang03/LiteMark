import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  applyCors,
  applyNoCache,
  handleOptions,
  parseJsonBody,
  sendError,
  sendJson
} from '../_lib/http.js';
import { createBookmark, listBookmarks } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';

type ImportRequestBody = {
  html: string;
  overwrite?: boolean; // 是否覆盖现有书签
};

interface ParsedBookmark {
  title: string;
  url: string;
  category?: string;
  description?: string;
}

/**
 * 解析 Netscape Bookmark 格式的 HTML 文件
 */
function parseBookmarkHTML(html: string): ParsedBookmark[] {
  const bookmarks: ParsedBookmark[] = [];
  const categoryStack: string[] = [];
  let inBookmarkBar = false;
  let bookmarkBarDepth = 0;
  
  // 按行解析，跟踪分类层级
  const lines = html.split(/\r?\n/);
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    
    // 检查是否进入书签栏
    if (trimmedLine.includes('PERSONAL_TOOLBAR_FOLDER="true"')) {
      inBookmarkBar = true;
      continue;
    }
    
    // 匹配文件夹开始：<DL><p>
    if (trimmedLine === '<DL><p>' || trimmedLine.startsWith('<DL><p>')) {
      if (inBookmarkBar) {
        bookmarkBarDepth++;
      }
      continue;
    }
    
    // 匹配文件夹结束：</DL><p>
    if (trimmedLine === '</DL><p>' || trimmedLine.endsWith('</DL><p>')) {
      if (inBookmarkBar) {
        bookmarkBarDepth--;
        // 如果层级回到 0，说明书签栏结束了
        if (bookmarkBarDepth === 0) {
          inBookmarkBar = false;
        } else if (categoryStack.length > 0) {
          // 如果层级减少，可能是一个文件夹结束了
          categoryStack.pop();
        }
      }
      continue;
    }
    
    // 匹配文件夹开始：<DT><H3>...</H3> 后跟 <DL><p>
    const h3Match = trimmedLine.match(/<DT><H3[^>]*>([^<]+)<\/H3>/i);
    if (h3Match) {
      const folderName = h3Match[1].trim();
      // 检查下一行是否是 <DL><p>，如果是，则这是一个文件夹
      const nextLine = lines[i + 1]?.trim();
      if (nextLine === '<DL><p>' || nextLine?.startsWith('<DL><p>')) {
        // 排除系统文件夹名称
        if (inBookmarkBar && folderName !== 'Bookmarks bar' && folderName !== 'Bookmarks') {
          categoryStack.push(folderName);
        }
      }
      continue;
    }
    
    // 匹配书签链接：<DT><A HREF="...">...</A>
    const bookmarkMatch = trimmedLine.match(/<DT><A[^>]*HREF="([^"]+)"[^>]*>([^<]+)<\/A>/i);
    if (bookmarkMatch) {
      const url = bookmarkMatch[1].trim();
      const title = bookmarkMatch[2].trim();
      
      // 只导入书签栏内的书签
      if (inBookmarkBar) {
        // 获取当前分类（栈顶元素）
        const category = categoryStack.length > 0 ? categoryStack[categoryStack.length - 1] : undefined;
        
        bookmarks.push({
          title,
          url,
          category,
          description: undefined
        });
      }
    }
  }
  
  // 如果上面的方法没有找到书签，使用更简单的方法
  if (bookmarks.length === 0) {
    // 直接匹配所有书签链接，忽略分类
    const bookmarkRegex = /<DT><A[^>]*HREF="([^"]+)"[^>]*>([^<]+)<\/A>/gi;
    let match;
    while ((match = bookmarkRegex.exec(html)) !== null) {
      bookmarks.push({
        title: match[2].trim(),
        url: match[1].trim(),
        category: undefined,
        description: undefined
      });
    }
  }
  
  return bookmarks;
}

/**
 * 清理 URL，确保格式正确
 */
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
    const html = body.html?.trim();

    if (!html) {
      sendError(res, 400, 'HTML 内容不能为空');
      return;
    }

    // 解析书签
    const parsedBookmarks = parseBookmarkHTML(html);

    if (parsedBookmarks.length === 0) {
      sendError(res, 400, '未在 HTML 文件中找到任何书签');
      return;
    }

    // 如果选择覆盖，先删除所有现有书签
    if (body.overwrite) {
      const existingBookmarks = await listBookmarks();
      // 注意：这里我们没有批量删除的 API，需要逐个删除
      // 但为了性能，我们可以直接清空存储（如果支持的话）
      // 暂时先不实现覆盖功能，只是添加新书签
    }

    // 导入书签（添加到现有书签中）
    const importedBookmarks = [];
    const errors: string[] = [];

    for (const parsed of parsedBookmarks) {
      try {
        const url = sanitizeUrl(parsed.url);
        if (!url || !parsed.title) {
          errors.push(`跳过无效书签：${parsed.title || parsed.url}`);
          continue;
        }

        const bookmark = await createBookmark({
          title: parsed.title,
          url,
          category: parsed.category,
          description: parsed.description,
          visible: true
        });
        importedBookmarks.push(bookmark);
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误';
        errors.push(`导入 "${parsed.title}" 失败：${message}`);
      }
    }

    sendJson(res, 200, {
      success: true,
      imported: importedBookmarks.length,
      total: parsedBookmarks.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('导入书签失败', error);
    const message = error instanceof Error ? error.message : '导入书签失败';
    sendError(res, 500, message);
  }
}

