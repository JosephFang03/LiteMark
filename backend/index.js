import cors from 'cors';
import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const dataDir = path.join(__dirname, 'data');
const bookmarksFile = path.join(dataDir, 'bookmarks.json');
const settingsFile = path.join(dataDir, 'settings.json');
const frontendDist = path.join(rootDir, 'frontend', 'dist');

const JWT_SECRET = process.env.JWT_SECRET || 'bookmark-secret';
const TOKEN_TTL = '7d';
const THEMES = ['light', 'twilight', 'dark'];

const adminCredential = {
  username: process.env.ADMIN_USERNAME || 'admin',
  password: process.env.ADMIN_PASSWORD || 'admin123'
};

async function ensureFileExists(filePath, defaultContent) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, defaultContent, 'utf-8');
  }
}

async function ensureDataFiles() {
  await ensureFileExists(bookmarksFile, '[]');
  await ensureFileExists(settingsFile, JSON.stringify({ theme: THEMES[0] }, null, 2));
}

async function readJson(filePath, fallback) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`读取文件失败: ${filePath}`, error);
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error('无法读取数据文件');
  }
}

async function writeJson(filePath, data) {
  try {
    const content = JSON.stringify(data, null, 2);
    await fs.writeFile(filePath, content, 'utf-8');
  } catch (error) {
    console.error(`写入文件失败: ${filePath}`, error);
    throw new Error('无法写入数据文件');
  }
}

function sanitizeText(value) {
  if (value === null || value === undefined) {
    return undefined;
  }
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : undefined;
}

function sanitizeUrl(value) {
  return String(value ?? '').trim();
}

function authenticate(req, res, next) {
  const authHeader = req.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).send('未授权');
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    res.status(401).send('令牌无效或已过期');
  }
}

async function maybeServeFrontend(app) {
  try {
    const stat = await fs.stat(frontendDist);
    if (!stat.isDirectory()) {
      return;
    }
    app.use(express.static(frontendDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        return next();
      }
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  } catch {
    // dist 不存在时忽略
  }
}

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/settings', async (_req, res) => {
  try {
    const settings = await readJson(settingsFile, { theme: THEMES[0] });
    if (!THEMES.includes(settings.theme)) {
      settings.theme = THEMES[0];
    }
    res.json(settings);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).send('请输入用户名和密码');
  }
  if (String(username) !== adminCredential.username || String(password) !== adminCredential.password) {
    return res.status(401).send('用户名或密码错误');
  }
  const token = jwt.sign({ username: adminCredential.username }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  res.json({ token, username: adminCredential.username });
});

app.put('/api/settings/theme', authenticate, async (req, res) => {
  const { theme } = req.body ?? {};
  if (!theme || !THEMES.includes(String(theme))) {
    return res.status(400).send('无效的主题');
  }
  try {
    const settings = await readJson(settingsFile, { theme: THEMES[0] });
    settings.theme = String(theme);
    await writeJson(settingsFile, settings);
    res.json(settings);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.get('/api/bookmarks', async (_req, res) => {
  try {
    const bookmarks = await readJson(bookmarksFile, []);
    res.json(bookmarks);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.post('/api/bookmarks', authenticate, async (req, res) => {
  const { title, url, category, description, visible } = req.body ?? {};
  if (!title || !url) {
    return res.status(400).send('标题和链接不能为空');
  }

  const now = new Date().toISOString();
  const newBookmark = {
    id: randomUUID(),
    title: sanitizeText(title),
    url: sanitizeUrl(url),
    category: sanitizeText(category),
    description: sanitizeText(description),
    visible: typeof visible === 'boolean' ? visible : true,
    createdAt: now,
    updatedAt: now
  };

  try {
    const bookmarks = await readJson(bookmarksFile, []);
    bookmarks.push(newBookmark);
    await writeJson(bookmarksFile, bookmarks);
    res.status(201).json(newBookmark);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.put('/api/bookmarks/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { title, url, category, description, visible } = req.body ?? {};
  if (!title || !url) {
    return res.status(400).send('标题和链接不能为空');
  }
  try {
    const bookmarks = await readJson(bookmarksFile, []);
    const index = bookmarks.findIndex((item) => item.id === id);
    if (index === -1) {
      return res.status(404).send('未找到指定书签');
    }

    const existing = bookmarks[index];
    const updated = {
      ...existing,
      title: sanitizeText(title),
      url: sanitizeUrl(url),
      category: sanitizeText(category),
      description: sanitizeText(description),
      visible: typeof visible === 'boolean' ? visible : existing.visible !== false,
      updatedAt: new Date().toISOString()
    };

    bookmarks[index] = updated;
    await writeJson(bookmarksFile, bookmarks);
    res.json(updated);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.delete('/api/bookmarks/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  try {
    const bookmarks = await readJson(bookmarksFile, []);
    const index = bookmarks.findIndex((item) => item.id === id);
    if (index === -1) {
      return res.status(404).send('未找到指定书签');
    }
    const [removed] = bookmarks.splice(index, 1);
    await writeJson(bookmarksFile, bookmarks);
    res.json(removed);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

ensureDataFiles()
  .then(async () => {
    await maybeServeFrontend(app);
    app.listen(port, () => {
      console.log(`🚀 书签服务已启动，端口：${port}`);
    });
  })
  .catch((error) => {
    console.error('初始化数据文件失败：', error);
    process.exit(1);
  });

