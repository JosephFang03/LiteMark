import { list, put } from '@vercel/blob';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createClient as createWebdavClient } from 'webdav';

const DRIVER = (process.env.STORAGE_DRIVER ?? 'vercel-blob').toLowerCase();

const BOOKMARKS_KEY = process.env.BOOKMARKS_KEY ?? 'data/bookmarks.json';
const SETTINGS_KEY = process.env.SETTINGS_KEY ?? 'data/settings.json';

function getKeys() {
  return { bookmarksKey: BOOKMARKS_KEY, settingsKey: SETTINGS_KEY };
}

async function readVercelBlob<T>(key: string, fallback: T): Promise<T> {
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
}

async function writeVercelBlob(key: string, data: unknown) {
  const body = JSON.stringify(data, null, 2);
  await put(key, body, {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false
  });
}

let s3Client: S3Client | null = null;
let webdavClient: ReturnType<typeof createWebdavClient> | null = null;

function ensureS3Client(): S3Client {
  if (!s3Client) {
    const region = process.env.S3_REGION;
    const bucket = process.env.S3_BUCKET;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
    const endpoint = process.env.S3_ENDPOINT;
    const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === 'true';

    if (!region || !bucket || !accessKeyId || !secretAccessKey) {
      throw new Error('S3 配置缺失：请设置 S3_REGION、S3_BUCKET、S3_ACCESS_KEY_ID、S3_SECRET_ACCESS_KEY');
    }

    s3Client = new S3Client({
      region,
      endpoint,
      forcePathStyle,
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    });
  }
  return s3Client;
}

function ensureWebdavClient() {
  if (!webdavClient) {
    const url = process.env.WEBDAV_URL;
    const username = process.env.WEBDAV_USERNAME;
    const password = process.env.WEBDAV_PASSWORD;

    if (!url) {
      throw new Error('WebDAV 配置缺失：请设置 WEBDAV_URL');
    }

    webdavClient = createWebdavClient(url, {
      username,
      password
    });
  }
  return webdavClient;
}

async function readS3Json<T>(key: string, fallback: T): Promise<T> {
  const client = ensureS3Client();
  const bucket = process.env.S3_BUCKET!;
  try {
    const result = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    if (!result.Body) {
      return fallback;
    }
    const text = await result.Body.transformToString();
    return text ? (JSON.parse(text) as T) : fallback;
  } catch (error: any) {
    if (error?.$metadata?.httpStatusCode === 404) {
      return fallback;
    }
    console.error('读取 S3 失败：', error);
    return fallback;
  }
}

async function writeS3Json(key: string, data: unknown) {
  const client = ensureS3Client();
  const bucket = process.env.S3_BUCKET!;
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(data, null, 2),
      ContentType: 'application/json'
    })
  );
}

async function readWebdavJson<T>(key: string, fallback: T): Promise<T> {
  const client = ensureWebdavClient();
  try {
    const contents = await client.getFileContents(key, { format: 'text' });
    if (!contents) {
      return fallback;
    }
    return JSON.parse(contents as string) as T;
  } catch (error: any) {
    if (error?.status === 404) {
      return fallback;
    }
    console.error('读取 WebDAV 失败：', error);
    return fallback;
  }
}

async function writeWebdavJson(key: string, data: unknown) {
  const client = ensureWebdavClient();
  const body = JSON.stringify(data, null, 2);
  await client.putFileContents(key, body, {
    overwrite: true
  });
}

export async function readJson<T>(key: 'bookmarks' | 'settings', fallback: T): Promise<T> {
  const { bookmarksKey, settingsKey } = getKeys();
  const resolvedKey = key === 'bookmarks' ? bookmarksKey : settingsKey;
  if (DRIVER === 's3') {
    return readS3Json(resolvedKey, fallback);
  }
  if (DRIVER === 'webdav') {
    return readWebdavJson(resolvedKey, fallback);
  }
  return readVercelBlob(resolvedKey, fallback);
}

export async function writeJson(key: 'bookmarks' | 'settings', data: unknown) {
  const { bookmarksKey, settingsKey } = getKeys();
  const resolvedKey = key === 'bookmarks' ? bookmarksKey : settingsKey;
  if (DRIVER === 's3') {
    await writeS3Json(resolvedKey, data);
    return;
  }
  if (DRIVER === 'webdav') {
    await writeWebdavJson(resolvedKey, data);
    return;
  }
  await writeVercelBlob(resolvedKey, data);
}
