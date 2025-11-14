# 本地开发指南

## 前置要求

- Node.js 20.x 或更高版本
- npm/yarn 包管理器
- Vercel CLI（用于本地运行 API）

## 安装步骤

### 1. 安装依赖

```bash
# 使用 npm
npm install

# 或使用 yarn（推荐，项目配置了 yarn）
yarn install
```

### 2. 安装 Vercel CLI（如果还没有）

```bash
npm install -g vercel
# 或
yarn global add vercel
```

### 3. 配置环境变量

在项目根目录创建 `.env.local` 文件：

```env
# API 基础地址（本地开发时留空，会自动使用当前域名）
VITE_API_BASE_URL=

# 存储驱动（本地开发建议使用 vercel-blob 或配置其他存储）
STORAGE_DRIVER=vercel-blob

# Vercel Blob 令牌（如果使用 vercel-blob）
BLOB_READ_WRITE_TOKEN=你的令牌

# 管理员账号（可选，默认值如下）
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123

# 如果使用其他存储驱动，需要配置对应的环境变量
# 例如 S3:
# S3_BUCKET=your-bucket
# S3_REGION=us-east-1
# S3_ACCESS_KEY_ID=your-key
# S3_SECRET_ACCESS_KEY=your-secret
```

## 运行项目

### 方法一：使用 Vercel CLI（推荐）

这是最接近生产环境的运行方式，可以同时运行前端和 API：

```bash
# 在项目根目录运行
vercel dev
```

这会：
- 启动前端开发服务器（通常是 http://localhost:3000）
- 启动 API 路由（/api/*）
- 自动加载 .env.local 中的环境变量

### 方法二：分别运行前端和 API

#### 终端 1：运行前端

```bash
npm run dev
# 或
yarn dev
```

前端会在 http://localhost:5173 运行

#### 终端 2：运行 API（使用 Vercel CLI）

```bash
vercel dev --listen 3001
```

然后在 `.env.local` 中设置：
```env
VITE_API_BASE_URL=http://localhost:3001
```

## 访问应用

- **前台页面**：http://localhost:3000（使用 vercel dev）或 http://localhost:5173（使用 vite dev）
- **后台管理**：http://localhost:3000/admin 或 http://localhost:5173/admin
- **默认账号**：admin / admin123（可在环境变量中修改）

## 测试导入功能

1. 登录后台管理界面（/admin）
2. 点击"导入书签"按钮
3. 选择浏览器导出的 HTML 书签文件
4. 等待导入完成，查看结果

## 常见问题

### 1. API 路由返回 404

确保使用 `vercel dev` 运行，而不是只运行 `npm run dev`。Vercel CLI 会处理 API 路由。

### 2. 存储驱动错误

- 如果使用 `vercel-blob`，需要配置 `BLOB_READ_WRITE_TOKEN`
- 如果使用其他存储，确保配置了所有必需的环境变量
- 参考 `api/_lib/storage.ts` 查看各驱动所需的配置

### 3. 端口冲突

如果 3000 端口被占用，Vercel CLI 会自动使用其他端口，注意查看终端输出。

### 4. 环境变量不生效

- 确保 `.env.local` 文件在项目根目录
- 使用 `vercel dev` 时，环境变量会自动加载
- 如果使用 `npm run dev`，需要重启开发服务器

## 查看日志

### API 日志

当使用 `vercel dev` 启动后，所有 API 相关的日志会直接输出到**运行 `vercel dev` 的终端窗口**：

#### 1. 查看 API 请求日志

每次 API 请求都会在终端显示：
```
> GET /api/bookmarks 200 in 123ms
> POST /api/bookmarks/import 200 in 456ms
```

#### 2. 查看代码中的日志

在 API 代码中使用 `console.log`、`console.error` 等，输出会显示在终端：

```typescript
// api/bookmarks/index.ts
console.log('获取书签');  // ✅ 会显示在终端
console.log('书签', bookmarks);  // ✅ 会显示在终端
console.error('获取书签失败', error);  // ✅ 会显示在终端（红色）
```

#### 3. 日志示例

运行 `vercel dev` 后，终端会显示类似以下内容：

```
▲ Vercel CLI 48.9.0
> Ready! Available at http://localhost:3000
> 
> [GET] /api/bookmarks
> 获取书签
> 书签 [ { id: '...', title: '...', ... } ]
> 
> [POST] /api/bookmarks/import
> 导入书签失败 Error: ...
```

### 前端日志

前端代码的日志会显示在**浏览器的开发者工具控制台**：

1. 打开浏览器（Chrome/Edge/Firefox）
2. 按 `F12` 或右键选择"检查"
3. 切换到 "Console"（控制台）标签
4. 查看 `console.log`、`console.error` 等输出

### 查看详细请求信息

#### 方法一：在代码中添加日志

在 API 处理函数中添加详细日志：

```typescript
export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('请求方法:', req.method);
  console.log('请求路径:', req.url);
  console.log('请求头:', req.headers);
  console.log('请求体:', req.body);
  
  // ... 处理逻辑 ...
  
  console.log('响应状态:', res.statusCode);
}
```

#### 方法二：使用 Vercel CLI 的调试模式

```bash
# 启用详细日志
vercel dev --debug

# 或查看所有日志
vercel dev --listen 3000 --debug
```

### 日志类型说明

- **`console.log()`** - 普通信息（白色/默认色）
- **`console.error()`** - 错误信息（红色，会显示堆栈）
- **`console.warn()`** - 警告信息（黄色）
- **`console.info()`** - 信息提示（蓝色）

### 过滤日志

在终端中可以使用以下方式过滤日志：

#### Windows PowerShell
```powershell
vercel dev | Select-String "bookmarks"
```

#### Linux/Mac
```bash
vercel dev | grep "bookmarks"
```

### 常见日志位置

1. **API 错误日志**：运行 `vercel dev` 的终端
2. **前端错误日志**：浏览器控制台（F12）
3. **网络请求日志**：浏览器 Network 标签（F12 → Network）
4. **存储操作日志**：终端（代码中使用 `console.error` 记录）

### 调试技巧

1. **添加时间戳**：
```typescript
console.log(`[${new Date().toISOString()}] 获取书签`);
```

2. **添加请求 ID**：
```typescript
const requestId = Math.random().toString(36).substring(7);
console.log(`[${requestId}] 开始处理请求`);
```

3. **结构化日志**：
```typescript
console.log(JSON.stringify({
  timestamp: new Date().toISOString(),
  method: req.method,
  url: req.url,
  data: bookmarks
}, null, 2));
```

## 开发建议

1. **使用 Vercel CLI**：`vercel dev` 是最接近生产环境的运行方式
2. **热重载**：前端代码修改会自动刷新，API 代码修改需要重启 `vercel dev`
3. **调试**：可以在 API 代码中使用 `console.log`，输出会在运行 `vercel dev` 的终端显示
4. **测试导入功能**：准备一个 HTML 书签文件用于测试
5. **查看日志**：API 日志在终端，前端日志在浏览器控制台

