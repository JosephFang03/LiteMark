import { list, put } from '@vercel/blob';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { GetObjectCommandOutput } from '@aws-sdk/client-s3';
import type OSS from 'ali-oss';
import { createRequire } from 'module';
import { createClient as createWebdavClient } from 'webdav';

const require = createRequire(import.meta.url);
const AliOss = require('ali-oss') as typeof OSS;

type COSClient = {
  getObject: (
    params: { Bucket: string; Region: string; Key: string },
    callback: (err: unknown, data: { Body?: Buffer | NodeJS.ReadableStream | string }) => void
  ) => void;
  putObject: (
    params: {
      Bucket: string;
      Region: string;
      Key: string;
      Body: Buffer | string;
      ContentType?: string;
    },
    callback: (err: unknown, data: unknown) => void
  ) => void;
};

type COSConstructor = new (options: { SecretId: string; SecretKey: string }) => COSClient;
const CosSdk = require('cos-nodejs-sdk-v5') as COSConstructor;

const DRIVER = (process.env.STORAGE_DRIVER ?? 'vercel-blob').toLowerCase();

const BOOKMARKS_KEY = process.env.BOOKMARKS_KEY ?? 'litemark/data/bookmarks.json';
const SETTINGS_KEY = process.env.SETTINGS_KEY ?? 'litemark/data/settings.json';

function getKeys() {
  return { bookmarksKey: BOOKMARKS_KEY, settingsKey: SETTINGS_KEY };
}

function ensureValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`存储配置缺失：请设置 ${name}`);
  }
  return value;
}

function logStorageError(driver: string, error: unknown) {
  console.error(`[storage:${driver}]`, error);
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

function isReadable(stream: unknown): stream is NodeJS.ReadableStream {
  return Boolean(stream && typeof (stream as NodeJS.ReadableStream).pipe === 'function');
}

function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    stream.on('error', reject);
  });
}

async function resolveBodyText(body: unknown): Promise<string | null> {
  if (!body) {
    return null;
  }
  if (typeof body === 'string') {
    return body;
  }
  if (Buffer.isBuffer(body)) {
    return body.toString('utf-8');
  }
  if (typeof (body as GetObjectCommandOutput['Body'])?.transformToString === 'function') {
    return (body as GetObjectCommandOutput['Body']).transformToString();
  }
  if (isReadable(body)) {
    return streamToString(body);
  }
  return null;
}

const s3Clients: Partial<Record<'s3' | 'r2', S3Client>> = {};
const s3Buckets: Partial<Record<'s3' | 'r2', string>> = {};

type S3Config = {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  forcePathStyle?: boolean;
};

function getS3Config(driver: 's3' | 'r2'): S3Config {
  if (driver === 's3') {
    return {
      bucket: ensureValue('S3_BUCKET', process.env.S3_BUCKET),
      region: ensureValue('S3_REGION', process.env.S3_REGION),
      accessKeyId: ensureValue('S3_ACCESS_KEY_ID', process.env.S3_ACCESS_KEY_ID),
      secretAccessKey: ensureValue('S3_SECRET_ACCESS_KEY', process.env.S3_SECRET_ACCESS_KEY),
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true'
    };
  }

  const endpoint =
    process.env.R2_ENDPOINT ??
    (process.env.R2_ACCOUNT_ID
      ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
      : undefined);

  if (!endpoint) {
    throw new Error('R2 配置缺失：请设置 R2_ENDPOINT 或 R2_ACCOUNT_ID');
  }

  return {
    bucket: ensureValue('R2_BUCKET', process.env.R2_BUCKET),
    region: process.env.R2_REGION ?? 'auto',
    accessKeyId: ensureValue('R2_ACCESS_KEY_ID', process.env.R2_ACCESS_KEY_ID),
    secretAccessKey: ensureValue('R2_SECRET_ACCESS_KEY', process.env.R2_SECRET_ACCESS_KEY),
    endpoint,
    forcePathStyle: process.env.R2_FORCE_PATH_STYLE
      ? process.env.R2_FORCE_PATH_STYLE === 'true'
      : true
  };
}

function ensureS3Client(driver: 's3' | 'r2'): { client: S3Client; bucket: string } {
  const existing = s3Clients[driver];
  if (existing) {
    return { client: existing, bucket: s3Buckets[driver]! };
  }

  const config = getS3Config(driver);
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });

  s3Clients[driver] = client;
  s3Buckets[driver] = config.bucket;

  return { client, bucket: config.bucket };
}

async function readS3Json<T>(driver: 's3' | 'r2', key: string, fallback: T): Promise<T> {
  const { client, bucket } = ensureS3Client(driver);
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const text = await resolveBodyText(result.Body);
    return text ? (JSON.parse(text) as T) : fallback;
  } catch (error: any) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NoSuchKey') {
      return fallback;
    }
    logStorageError(driver, error);
    return fallback;
  }
}

async function writeS3Json(driver: 's3' | 'r2', key: string, data: unknown) {
  const { client, bucket } = ensureS3Client(driver);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(data, null, 2),
      ContentType: 'application/json'
    })
  );
}

let aliOssClient: OSS | null = null;

function ensureAliOssClient(): OSS {
  if (!aliOssClient) {
    const region = ensureValue('OSS_REGION', process.env.OSS_REGION);
    const bucket = ensureValue('OSS_BUCKET', process.env.OSS_BUCKET);
    const accessKeyId = ensureValue('OSS_ACCESS_KEY_ID', process.env.OSS_ACCESS_KEY_ID);
    const accessKeySecret = ensureValue('OSS_SECRET_ACCESS_KEY', process.env.OSS_SECRET_ACCESS_KEY);
    aliOssClient = new AliOss({
      region,
      bucket,
      endpoint: process.env.OSS_ENDPOINT,
      accessKeyId,
      accessKeySecret,
      internal: process.env.OSS_INTERNAL === 'true',
      secure: process.env.OSS_SECURE !== 'false',
      timeout: process.env.OSS_TIMEOUT
    });
  }
  return aliOssClient;
}

async function readAliOssJson<T>(key: string, fallback: T): Promise<T> {
  const client = ensureAliOssClient();
  try {
    const result = await client.get(key);
    const text = await resolveBodyText(result?.content);
    return text ? (JSON.parse(text) as T) : fallback;
  } catch (error: any) {
    if (error?.status === 404 || error?.name === 'NoSuchKey') {
      return fallback;
    }
    logStorageError('oss', error);
    return fallback;
  }
}

async function writeAliOssJson(key: string, data: unknown) {
  const client = ensureAliOssClient();
  await client.put(key, Buffer.from(JSON.stringify(data, null, 2)), {
    headers: { 'Content-Type': 'application/json' }
  });
}

let cosClient: COSClient | null = null;
let cosBucket: string | null = null;
let cosRegion: string | null = null;

function ensureCosClient(): { client: COSClient; bucket: string; region: string } {
  if (!cosClient) {
    cosBucket = ensureValue('COS_BUCKET', process.env.COS_BUCKET);
    cosRegion = ensureValue('COS_REGION', process.env.COS_REGION);
    cosClient = new CosSdk({
      SecretId: ensureValue('COS_SECRET_ID', process.env.COS_SECRET_ID),
      SecretKey: ensureValue('COS_SECRET_KEY', process.env.COS_SECRET_KEY)
    });
  }

  return { client: cosClient!, bucket: cosBucket!, region: cosRegion! };
}

async function readCosJson<T>(key: string, fallback: T): Promise<T> {
  const { client, bucket, region } = ensureCosClient();
  try {
    const data = await new Promise<{ Body?: Buffer | NodeJS.ReadableStream | string }>((resolve, reject) => {
      client.getObject({ Bucket: bucket, Region: region, Key: key }, (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });

    const text = await resolveBodyText(data.Body);
    return text ? (JSON.parse(text) as T) : fallback;
  } catch (error: any) {
    if (error?.statusCode === 404 || error?.code === 'NoSuchKey' || error?.errorCode === 'NoSuchKey') {
      return fallback;
    }
    logStorageError('cos', error);
    return fallback;
  }
}

async function writeCosJson(key: string, data: unknown) {
  const { client, bucket, region } = ensureCosClient();
  const body = Buffer.from(JSON.stringify(data, null, 2));
  await new Promise<void>((resolve, reject) => {
    client.putObject(
      { Bucket: bucket, Region: region, Key: key, Body: body, ContentType: 'application/json' },
      (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}

let webdavClient: ReturnType<typeof createWebdavClient> | null = null;

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
    logStorageError('webdav', error);
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
  switch (DRIVER) {
    case 's3':
      return readS3Json('s3', resolvedKey, fallback);
    case 'r2':
      return readS3Json('r2', resolvedKey, fallback);
    case 'oss':
      return readAliOssJson(resolvedKey, fallback);
    case 'cos':
      return readCosJson(resolvedKey, fallback);
    case 'webdav':
      return readWebdavJson(resolvedKey, fallback);
    case 'vercel-blob':
    default:
      return readVercelBlob(resolvedKey, fallback);
  }
}

export async function writeJson(key: 'bookmarks' | 'settings', data: unknown) {
  const { bookmarksKey, settingsKey } = getKeys();
  const resolvedKey = key === 'bookmarks' ? bookmarksKey : settingsKey;
  switch (DRIVER) {
    case 's3':
      await writeS3Json('s3', resolvedKey, data);
      break;
    case 'r2':
      await writeS3Json('r2', resolvedKey, data);
      break;
    case 'oss':
      await writeAliOssJson(resolvedKey, data);
      break;
    case 'cos':
      await writeCosJson(resolvedKey, data);
      break;
    case 'webdav':
      await writeWebdavJson(resolvedKey, data);
      break;
    case 'vercel-blob':
    default:
      await writeVercelBlob(resolvedKey, data);
      break;
  }
}

// 使用指定驱动写入备份数据
export async function backupWriteJson(
  key: 'bookmarks' | 'settings',
  data: unknown,
  backupDriver: string
) {
  const { bookmarksKey, settingsKey } = getKeys();
  const resolvedKey = key === 'bookmarks' ? bookmarksKey : settingsKey;
  const driver = backupDriver.toLowerCase();

  switch (driver) {
    case 's3':
      await writeS3Json('s3', resolvedKey, data);
      break;
    case 'r2':
      await writeS3Json('r2', resolvedKey, data);
      break;
    case 'oss':
      await writeAliOssJson(resolvedKey, data);
      break;
    case 'cos':
      await writeCosJson(resolvedKey, data);
      break;
    case 'webdav':
      await writeWebdavJson(resolvedKey, data);
      break;
    case 'vercel-blob':
      await writeVercelBlob(resolvedKey, data);
      break;
    default:
      console.warn(`未知的备份驱动: ${backupDriver}，跳过备份`);
      break;
  }
}

