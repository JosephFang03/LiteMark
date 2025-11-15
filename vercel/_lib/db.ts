import { randomUUID } from 'crypto';
import { sql } from '@vercel/postgres';
import { backupWriteJson } from './storage.js';

export type BookmarkRecord = {
  id: string;
  title: string;
  url: string;
  category?: string;
  description?: string;
  visible: boolean;
};

type BookmarkInput = {
  title: string;
  url: string;
  category?: string;
  description?: string;
  visible: boolean;
};

type SettingsData = {
  theme: string;
  siteTitle: string;
  siteIcon: string;
};

const DEFAULT_SETTINGS: SettingsData = {
  theme: 'light',
  siteTitle: '个人书签',
  siteIcon: '🔖'
};

function normalizeCategoryValue(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function bookmarkCategoryKey(bookmark: BookmarkRecord): string {
  return normalizeCategoryValue(bookmark.category) ?? '';
}

function normalizeCategoryKeyInput(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

// 初始化数据库表
let tablesInitialized = false;

async function ensureTables() {
  if (tablesInitialized) {
    return;
  }

  try {
    // 创建 bookmarks 表
    await sql`
      CREATE TABLE IF NOT EXISTS bookmarks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        category TEXT,
        description TEXT,
        visible BOOLEAN NOT NULL DEFAULT true,
        "order" INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;

    // 创建 settings 表
    await sql`
      CREATE TABLE IF NOT EXISTS settings (
        id TEXT PRIMARY KEY DEFAULT 'default',
        theme TEXT NOT NULL DEFAULT 'light',
        site_title TEXT NOT NULL DEFAULT '个人书签',
        site_icon TEXT NOT NULL DEFAULT '🔖',
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;

    // 确保有默认设置
    await sql`
      INSERT INTO settings (id, theme, site_title, site_icon)
      VALUES ('default', 'light', '个人书签', '🔖')
      ON CONFLICT (id) DO NOTHING
    `;

    tablesInitialized = true;
  } catch (error) {
    console.error('初始化数据库表失败:', error);
    throw error;
  }
}

// 备份数据到存储
async function backupData(key: 'bookmarks' | 'settings', data: unknown) {
  try {
    // 检查是否配置了备份存储驱动
    const backupDriver = process.env.BACKUP_STORAGE_DRIVER;
    if (!backupDriver || backupDriver === 'none') {
      return; // 未配置备份，跳过
    }

    // 写入备份存储
    await backupWriteJson(key, data, backupDriver);
  } catch (error) {
    // 备份失败不应影响主流程
    console.error(`备份 ${key} 到存储失败:`, error);
  }
}

async function readBookmarksFromDb(): Promise<BookmarkRecord[]> {
  await ensureTables();
  const result = await sql`
    SELECT id, title, url, category, description, visible
    FROM bookmarks
    ORDER BY "order" ASC, created_at ASC
  `;
  
  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    url: row.url,
    category: normalizeCategoryValue(row.category),
    description: row.description ?? undefined,
    visible: row.visible
  }));
}

async function writeBookmarksToDb(bookmarks: BookmarkRecord[]) {
  await ensureTables();
  
  try {
    // 先删除所有现有书签
    await sql`DELETE FROM bookmarks`;
    
    // 批量插入书签
    for (let i = 0; i < bookmarks.length; i++) {
      const bookmark = bookmarks[i];
      await sql`
        INSERT INTO bookmarks (id, title, url, category, description, visible, "order")
        VALUES (
          ${bookmark.id},
          ${bookmark.title},
          ${bookmark.url},
          ${normalizeCategoryValue(bookmark.category) ?? null},
          ${bookmark.description ?? null},
          ${bookmark.visible},
          ${i}
        )
      `;
    }
  } catch (error) {
    console.error('写入书签到数据库失败:', error);
    throw error;
  }

  // 备份到存储
  await backupData('bookmarks', bookmarks);
}

async function readSettingsFromDb(): Promise<SettingsData> {
  await ensureTables();
  const result = await sql`
    SELECT theme, site_title, site_icon
    FROM settings
    WHERE id = 'default'
  `;

  if (result.rows.length === 0) {
    return DEFAULT_SETTINGS;
  }

  const row = result.rows[0];
  return {
    theme: row.theme ?? DEFAULT_SETTINGS.theme,
    siteTitle: row.site_title ?? DEFAULT_SETTINGS.siteTitle,
    siteIcon: row.site_icon ?? DEFAULT_SETTINGS.siteIcon
  };
}

async function writeSettingsToDb(settings: SettingsData) {
  await ensureTables();
  await sql`
    INSERT INTO settings (id, theme, site_title, site_icon, updated_at)
    VALUES ('default', ${settings.theme}, ${settings.siteTitle}, ${settings.siteIcon}, NOW())
    ON CONFLICT (id) 
    DO UPDATE SET
      theme = ${settings.theme},
      site_title = ${settings.siteTitle},
      site_icon = ${settings.siteIcon},
      updated_at = NOW()
  `;

  // 备份到存储
  await backupData('settings', settings);
}

export async function getSettings(): Promise<SettingsData> {
  return readSettingsFromDb();
}

export async function updateSettings(partial: Partial<SettingsData>): Promise<SettingsData> {
  const current = await readSettingsFromDb();
  const next: SettingsData = {
    ...current,
    ...partial,
    theme: partial.theme ?? current.theme,
    siteTitle: partial.siteTitle ?? current.siteTitle,
    siteIcon: partial.siteIcon ?? current.siteIcon
  };
  await writeSettingsToDb(next);
  return next;
}

export async function listBookmarks(): Promise<BookmarkRecord[]> {
  return readBookmarksFromDb();
}

export async function createBookmark(data: BookmarkInput): Promise<BookmarkRecord> {
  await ensureTables();
  
  const bookmark: BookmarkRecord = {
    id: randomUUID(),
    title: data.title,
    url: data.url,
    category: normalizeCategoryValue(data.category),
    description: data.description,
    visible: data.visible
  };

  // 获取当前最大 order 值
  const maxOrderResult = await sql`
    SELECT COALESCE(MAX("order"), -1) + 1 as next_order
    FROM bookmarks
  `;
  const nextOrder = Number(maxOrderResult.rows[0]?.next_order ?? 0);

  await sql`
    INSERT INTO bookmarks (id, title, url, category, description, visible, "order")
    VALUES (
      ${bookmark.id},
      ${bookmark.title},
      ${bookmark.url},
      ${bookmark.category ?? null},
      ${bookmark.description ?? null},
      ${bookmark.visible},
      ${nextOrder}
    )
  `;

  // 备份数据
  const allBookmarks = await readBookmarksFromDb();
  await backupData('bookmarks', allBookmarks);

  return bookmark;
}

export async function reorderBookmarks(order: string[]): Promise<BookmarkRecord[]> {
  await ensureTables();
  
  try {
    // 更新每个书签的 order 值
    for (let i = 0; i < order.length; i++) {
      await sql`
        UPDATE bookmarks
        SET "order" = ${i}
        WHERE id = ${order[i]}
      `;
    }
  } catch (error) {
    console.error('重新排序书签失败:', error);
    throw error;
  }

  // 备份数据
  const reordered = await readBookmarksFromDb();
  await backupData('bookmarks', reordered);
  
  return reordered;
}

export async function reorderBookmarkCategories(order: string[]): Promise<BookmarkRecord[]> {
  await ensureTables();
  
  const bookmarks = await readBookmarksFromDb();
  const categoryMap = new Map<string, BookmarkRecord[]>();
  const originalOrder: string[] = [];

  bookmarks.forEach((bookmark) => {
    const key = bookmarkCategoryKey(bookmark);
    if (!categoryMap.has(key)) {
      categoryMap.set(key, []);
      originalOrder.push(key);
    }
    categoryMap.get(key)!.push(bookmark);
  });

  const requestedOrder: string[] = [];
  order.forEach((value) => {
    const key = normalizeCategoryKeyInput(value);
    if (categoryMap.has(key) && !requestedOrder.includes(key)) {
      requestedOrder.push(key);
    }
  });

  originalOrder.forEach((key) => {
    if (!requestedOrder.includes(key)) {
      requestedOrder.push(key);
    }
  });

  const reordered: BookmarkRecord[] = [];
  requestedOrder.forEach((key) => {
    const items = categoryMap.get(key);
    if (items) {
      reordered.push(...items);
    }
  });

  // 更新 order 值
  try {
    for (let i = 0; i < reordered.length; i++) {
      await sql`
        UPDATE bookmarks
        SET "order" = ${i}
        WHERE id = ${reordered[i].id}
      `;
    }
  } catch (error) {
    console.error('重新排序分类失败:', error);
    throw error;
  }

  // 备份数据
  await backupData('bookmarks', reordered);
  
  return reordered;
}

export async function updateBookmark(
  id: string,
  data: BookmarkInput
): Promise<BookmarkRecord | null> {
  await ensureTables();
  
  // 检查书签是否存在
  const existingResult = await sql`
    SELECT id FROM bookmarks WHERE id = ${id}
  `;
  
  if (existingResult.rows.length === 0) {
    return null;
  }

  // 更新书签
  await sql`
    UPDATE bookmarks
    SET
      title = ${data.title},
      url = ${data.url},
      category = ${normalizeCategoryValue(data.category) ?? null},
      description = ${data.description ?? null},
      visible = ${data.visible}
    WHERE id = ${id}
  `;

  // 获取更新后的书签
  const updatedResult = await sql`
    SELECT id, title, url, category, description, visible
    FROM bookmarks
    WHERE id = ${id}
  `;

  const row = updatedResult.rows[0];
  const updated: BookmarkRecord = {
    id: row.id,
    title: row.title,
    url: row.url,
    category: normalizeCategoryValue(row.category),
    description: row.description ?? undefined,
    visible: row.visible
  };

  // 备份数据
  const allBookmarks = await readBookmarksFromDb();
  await backupData('bookmarks', allBookmarks);

  return updated;
}

export async function deleteBookmark(id: string): Promise<BookmarkRecord | null> {
  await ensureTables();
  
  // 获取要删除的书签
  const existingResult = await sql`
    SELECT id, title, url, category, description, visible
    FROM bookmarks
    WHERE id = ${id}
  `;

  if (existingResult.rows.length === 0) {
    return null;
  }

  const row = existingResult.rows[0];
  const removed: BookmarkRecord = {
    id: row.id,
    title: row.title,
    url: row.url,
    category: normalizeCategoryValue(row.category),
    description: row.description ?? undefined,
    visible: row.visible
  };

  // 删除书签
  await sql`DELETE FROM bookmarks WHERE id = ${id}`;

  // 备份数据
  const allBookmarks = await readBookmarksFromDb();
  await backupData('bookmarks', allBookmarks);

  return removed;
}

