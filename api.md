# LiteMark API 说明

所有接口前缀均为 `/api`，除特别说明外返回值为 `application/json`。  
后端在启用登录保护的接口上要求 `Authorization: Bearer <token>`，token 通过登录接口获取，默认有效期 7 天。

> **提示**：本地仅运行函数时，可通过 `npm run dev` + `VITE_API_BASE_URL` 指向 `vercel dev`，或直接跑 `npx vercel dev --listen <port>`。

---

## 认证

### `POST /api/auth/login`

| 项目 | 说明 |
| --- | --- |
| 鉴权 | 不需要 |
| 请求体 | `{"username":"admin","password":"admin123"}` |
| 返回 | `{"token":"<jwt>","username":"admin"}` |
| 错误 | 400 用户名/密码缺失；401 凭证错误；500 登录异常 |

---

## 健康检查

### `GET /api/health`

| 项目 | 说明 |
| --- | --- |
| 鉴权 | 不需要 |
| 返回 | `{"status":"ok"}` |

---

## 书签接口

### `GET /api/bookmarks`

| 项目 | 说明 |
| --- | --- |
| 鉴权 | 不需要 |
| 返回 | `BookmarkRecord[]`（数组元素包括 `id/title/url/category/description/visible`；顺序即前端展示顺序，先按分类顺序、再按分类内书签顺序排列） |

### `POST /api/bookmarks`

| 项目 | 说明 |
| --- | --- |
| 鉴权 | 需要 |
| 请求体 | `{"title":"必填","url":"必填","category":"可选","description":"可选","visible":true}` |
| 返回 | 201 新增书签对象 |
| 校验 | `title`、`url` 不能为空，`url` 自动补协议 |

### `PUT /api/bookmarks/{id}`

| 项目 | 说明 |
| --- | --- |
| 鉴权 | 需要 |
| 参数 | 路径变量 `id` |
| 请求体 | 同新增接口 |
| 返回 | 更新后的书签；不存在返回 404 |

### `DELETE /api/bookmarks/{id}`

| 项目 | 说明 |
| --- | --- |
| 鉴权 | 需要 |
| 参数 | 路径变量 `id` |
| 返回 | 被删除的书签；不存在返回 404 |

### `POST /api/bookmarks/reorder`

| 项目 | 说明 |
| --- | --- |
| 鉴权 | 需要 |
| 请求体 | `{"order":["id1","id2",...]}` |
| 返回 | 根据新顺序重排后的全部书签数组 |
| 校验 | `order` 必须是数组，未出现的书签会按原顺序追加到末尾 |

### `POST /api/bookmarks/reorder-categories`

| 项目 | 说明 |
| --- | --- |
| 鉴权 | 需要 |
| 请求体 | `{"order":["", "学习", "工具", ...]}`（元素为分类名称，空字符串表示默认分类；未提交的分类会自动排在后面） |
| 返回 | 根据新分类顺序重新排列后的书签数组 |
| 说明 | 仅调整分类块的顺序，分类内部书签的相对顺序保持不变 |

### `POST /api/bookmarks/refresh`

| 项目 | 说明 |
| --- | --- |
| 鉴权 | 需要 |
| 功能 | 强制刷新书签缓存（重新从存储加载） |
| 返回 | 最新书签数组 |

---

## 站点设置接口

### `GET /api/settings`

| 项目 | 说明 |
| --- | --- |
| 鉴权 | 不需要 |
| 返回 | `{"theme":"light","siteTitle":"个人书签","siteIcon":"🔖"}` 等配置 |

### `PUT /api/settings`

| 项目 | 说明 |
| --- | --- |
| 鉴权 | 需要 |
| 请求体 | 支持任意组合：<br>`theme`：`light`/`dark`/`forest`/`ocean`/`sunrise`/`twilight`；<br>`siteTitle`：非空，≤60 字符；<br>`siteIcon`：≤512 字符 |
| 返回 | 更新后的设置对象 |
| 错误 | 参数为空或不合法时 400 |

### `POST /api/settings/refresh`

| 项目 | 说明 |
| --- | --- |
| 鉴权 | 需要 |
| 功能 | 强制刷新站点设置缓存 |
| 返回 | 最新设置对象 |

---

## 返回格式与错误约定

- 成功：`200 OK`（新增为 `201 Created`），响应体为 JSON。
- 预检：`OPTIONS` 返回 `204`，带必要的 CORS 头。
- 常见错误状态：
  - `400 Bad Request`：缺失或不合法的参数。
  - `401 Unauthorized`：未携带或令牌无效。
  - `404 Not Found`：资源不存在。
  - `405 Method Not Allowed`：方法不被支持。
  - `500 Internal Server Error`：服务器异常（具体日志在函数控制台）。

---

## 调试建议

- 本地仅调试函数：在 `vercel.json` 中禁用 `devCommand`/`buildCommand`（已配置），运行 `npx vercel dev --listen 127.0.0.1:<port>`。
- 前端联调：Vite `npm run dev` 并设置 `VITE_API_BASE_URL` 指向已启用的 API 地址。
- 刷新缓存：后台“刷新数据”按钮分别调用 `/api/bookmarks/refresh` 和 `/api/settings/refresh`。

