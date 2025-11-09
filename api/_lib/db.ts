import { randomUUID } from 'crypto';
import { readJson, writeJson } from './storage.js';

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
  siteTitle: string;
  siteIcon: string;
};

const DEFAULT_SETTINGS: SettingsData = {
  theme: 'light',
  siteTitle: '个人书签',
  siteIcon: '🔖'
};

async function loadBookmarks(): Promise<BookmarkRecord[]> {
  return readJson('bookmarks', [] as BookmarkRecord[]);
}

async function saveBookmarks(bookmarks: BookmarkRecord[]) {
  await writeJson('bookmarks', bookmarks);
}

async function loadSettings(): Promise<SettingsData> {
  return readJson('settings', DEFAULT_SETTINGS);
}

async function saveSettings(settings: SettingsData) {
  await writeJson('settings', settings);
}

export async function getSettings(): Promise<SettingsData> {
  return loadSettings();
}

export async function updateSettings(partial: Partial<SettingsData>): Promise<SettingsData> {
  const current = await loadSettings();
  const next: SettingsData = {
    ...current,
    ...partial,
    theme: partial.theme ?? current.theme,
    siteTitle: partial.siteTitle ?? current.siteTitle,
    siteIcon: partial.siteIcon ?? current.siteIcon
  };
  await saveSettings(next);
  return next;
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

