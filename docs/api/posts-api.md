# 社团社区 · 社交 Feed 接口契约（v3，当前有效）

> 分支：`feat/community-page`（自 main 拉出）
> 前端实现：`public/app.js` 的 `CommunitySection`（发帖框 / 置顶区 / 时间线 / 行内评论串）
> **本文档是社区页数据接口的唯一现行契约**。早期两份文档已废止：
> - `docs/api/community-api.md`（moments 动态流）→ 被 posts 取代
> - `docs/api/comments-api.md`（works 维度评论）→ 评论改挂在 posts 维度
> 废止原因：页面改为「社交优先」布局，moments / 作品弹窗评论区 / 各分区陈列合并为统一帖子流。

## 产品口径

- **一进来就是帖子**：顶部发帖框 + 管理员置顶（精华/教程/资源）+ 时间线（新的在前），以社交为主
- 任何人可随时发帖（登录后）；帖子可纯文字，可**内嵌一件作品/Agent**（附「⤓ 导入到我的环境」链接，走作品 source 字段）
- 评论参考推特：顶层新的在前、回复一层嵌套时间正序、回复的回复拍平到根、帖子作者徽标、点赞
- 置顶 = 管理员给帖子打标（featured / tutorial / resource），打标帖子从时间线提到置顶区

## 数据模型（2 张表）

`posts`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | text PK | 时序可排序（如 `p-<ts>-<seq>`） |
| `user_id` | bigint | 发帖人（登录用户） |
| `author` / `dept` | text | 昵称/部门快照，列表直出 |
| `text` | text | 正文，纯文本（前端转义），≤2000 字 |
| `work_id` | int, null | 引用的 works.id（可选）；作品分享帖带此字段 |
| `pinned` | boolean | 是否置顶 |
| `tag` | text, null | 置顶标签枚举：`featured` / `tutorial` / `resource` |
| `likes` | int | 点赞数（服务端权威） |
| `deleted` | boolean | 软删 |
| `created_at` | timestamp | 发帖时间 |

`comments`（与早期 comments-api.md 的差异：`work_id` 改为 `post_id`）：
`id` PK、`post_id`（索引）、`parent_id`、`user_id`、`author`/`dept` 快照、`text` ≤500 字、`likes`、`deleted`、`created_at`。
拍平规则：回复的回复由后端统一挂到根评论 `parent_id`（一层嵌套）。

## 接口（挂 `/api/community`，contract.js 的 ok/err 包装）

### GET /api/community/posts

时间线（含置顶）。无鉴权。

- 可选 query：`limit`（默认 30，上限 100）、`cursor`（游标向下翻页）。
- 排序：置顶在前（置顶内部新的在前），其余新的在前。

```json
{
  "ok": true,
  "data": {
    "posts": [
      {
        "id": "p9", "author": "阿茉", "dept": "财务部",
        "text": "把自用两个月的周报小结 Agent 挂上来了…",
        "time": "09-01 15:12", "likes": 18, "liked": false,
        "pinned": false, "tag": null, "commentCount": 5,
        "work": { "id": 101, "kind": "app", "title": "飞书周报小结 Agent", "description": "…", "source": "https://…" }
      }
    ],
    "nextCursor": null
  }
}
```

- `work` 为 null 表示纯文字帖；`work.source` 驱动「导入到我的环境」按钮（无则显示提示语）。
- `liked`：当前登录用户是否已赞（未登录恒 false）。
- 空列表返回 `"posts": []`，非错误。

### POST /api/community/posts

发帖。**要求登录**。body：`{ "content": "…", "work_id": 101 }`（`work_id` 可选，须为本人可见的作品）。
校验：content 去空格非空 ≤2000 字。未登录 401（`err("UNAUTHORIZED", …)`，code 以现有 ErrorCodes 为准）。
成功：`{ "ok": true, "data": { "post": { …同上单条结构, "commentCount": 0 } } }`。

### GET /api/community/posts/:id/comments

拉某帖评论（含一层回复），展开评论区时前端调用。无鉴权。query：`limit` / `cursor`。
排序口径：顶层新的在前、回复时间正序。空列表非错误。

### POST /api/community/posts/:id/comments

发评论/回复。**要求登录**。body：`{ "content": "…", "parent_id": "c3" }`。
`parent_id` 可选，须为**同帖**的顶层评论 id；回复的回复后端拍平到根再入库。
成功：`{ "ok": true, "data": { "comment": { "id": "c8", "post_id": "p9", "parent_id": null, "author": "我", "dept": "", "text": "…", "time": "09-01 17:30", "likes": 0 } } }`。

### POST /api/community/posts/:id/like 与 POST /api/community/posts/:id/comments/:cid/like

切换点赞（toggle），要求登录。返回 `{ "ok": true, "data": { "likes": 13, "liked": true } }`。
点赞去重可选：做则加 `likes(subject_type, subject_id, user_id)` 唯一键；不做则前端本地记状态。

### DELETE /api/community/posts/:id 与 DELETE /api/comments/:id

删自己的帖子/评论（软删）；admin 可删任何。返回 `{ "ok": true, "data": {} }`。

### POST /api/admin/community/posts/:id/pin（管理员）

置顶/取消置顶。body：`{ "pinned": true, "tag": "featured" }`（tag ∈ featured/tutorial/resource；取消置顶传 `pinned:false`）。走现有 admin 鉴权。返回 `{ "ok": true, "data": { "post": { … } } }`。

## 前端调用点（合并时定位用）

`public/app.js` → `CommunitySection`：
- `loadPosts()`：GET posts，失败回落 `/data/community.json` 的 `posts`（SEED 标记）
- `window.comPost`：发帖（DEMO 本地内存；401 → 发帖框下登录提示）
- `window.comToggleThread`：展开/收起行内评论串；首次展开 `loadComments(p)` GET comments
- `window.comSendComment` / `comReplyComment` / `comCancelReply` / `comLikeComment` / `comLikePost`：评论与点赞（DEMO 本地切换；API 模式 POST 后以服务端返回覆盖）
- 「导入到我的环境」按钮：`post.work.source` 外链，**无需新接口**

## 后端接入建议（合并时做，本分支不做）

1. 新建 `server/routes/community.js`，风格对齐 works.js（contract + validate）；建 posts / comments 两表。
2. `server/server.js` 挂载 `app.use('/api/community', communityRouter)`；admin 置顶子路由走现有 admin 鉴权中间件。
3. 发帖/评论/点赞一律 `req.session.userId`（与 works 上传同口径）。
4. 上线后前端零改动自动切换（回落只在接口失败时生效）；种子数据可删可留。

## 兼容性说明

- 本分支不改 `server/` 任何文件、不改其它页面；新增 CSS 全部 `com-` 前缀。
- 页面不再请求 `/api/works` 与 `/data/community.json` 的 moments/courses/resources/partner 字段——作品数据通过 posts.work 内嵌返回（后端联 works 表），静态分区数据全部并入置顶帖子。
