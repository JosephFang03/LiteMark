import { list, put } from '@vercel/blob';
import { randomUUID } from 'crypto';

export type BookmarkRecord = {
  id: string;
  title: string;
  url: string;
  category?: string;
  description?: string;
  visible: boolean;
  createdAt: string;
  updatedAt: string;
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
};

const BOOKMARKS_BLOB_KEY = process.env.BLOB_BOOKMARKS_KEY ?? 'data/bookmarks.json';
const SETTINGS_BLOB_KEY = process.env.BLOB_SETTINGS_KEY ?? 'data/settings.json';

async function readBlobJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const { blobs } = await list({ prefix: key, limit: 1 });
    const blob = blobs.find((item) => item.pathname === key);
    if (!blob) {
      return fallback;
    }
    const response = await fetch(blob.downloadUrl);
    if (!response.ok) {
      throw new Error(`读取 Blob 失败：${response.status}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    console.error(`读取 ${key} 失败`, error);
    return fallback;
  }
}

async function writeBlobJson(key: string, data: unknown) {
  const body = JSON.stringify(data, null, 2);
  await put(key, body, {
    access: 'public',
    contentType: 'application/json'
  });
}

async function loadBookmarks(): Promise<BookmarkRecord[]> {
  return readBlobJson<BookmarkRecord[]>(BOOKMARKS_BLOB_KEY, []);
}

async function saveBookmarks(bookmarks: BookmarkRecord[]) {
  await writeBlobJson(BOOKMARKS_BLOB_KEY, bookmarks);
}

async function loadSettings(): Promise<SettingsData> {
  return readBlobJson<SettingsData>(SETTINGS_BLOB_KEY, { theme: 'light' });
}

async function saveSettings(settings: SettingsData) {
  await writeBlobJson(SETTINGS_BLOB_KEY, settings);
}

export async function listBookmarks(): Promise<BookmarkRecord[]> {
  return loadBookmarks();
}

export async function createBookmark(data: BookmarkInput): Promise<BookmarkRecord> {
  const bookmarks = await loadBookmarks();
  const now = new Date().toISOString();
  const bookmark: BookmarkRecord = {
    id: randomUUID(),
    title: data.title,
    url: data.url,
    category: data.category,
    description: data.description,
    visible: data.visible,
    createdAt: now,
    updatedAt: now
  };
  bookmarks.unshift(bookmark);
  await saveBookmarks(bookmarks);
  return bookmark;
}

export async function updateBookmark(
  id: string,
  data: BookmarkInput
): Promise<BookmarkRecord | null> {
  const bookmarks = await loadBookmarks();
  const index = bookmarks.findIndex((item) => item.id === id);
  if (index === -1) {
    return null;
  }
  const existing = bookmarks[index];
  const updated: BookmarkRecord = {
    ...existing,
    title: data.title,
    url: data.url,
    category: data.category,
    description: data.description,
    visible: data.visible,
    updatedAt: new Date().toISOString()
  };
  bookmarks[index] = updated;
  await saveBookmarks(bookmarks);
  return updated;
}

export async function deleteBookmark(id: string): Promise<BookmarkRecord | null> {
  const bookmarks = await loadBookmarks();
  const index = bookmarks.findIndex((item) => item.id === id);
  if (index === -1) {
    return null;
  }
  const [removed] = bookmarks.splice(index, 1);
  await saveBookmarks(bookmarks);
  return removed;
}

export async function getTheme(): Promise<string> {
  const settings = await loadSettings();
  return settings.theme;
}

export async function setTheme(theme: string): Promise<string> {
  const settings = await loadSettings();
  settings.theme = theme;
  await saveSettings(settings);
  return settings.theme;
}

