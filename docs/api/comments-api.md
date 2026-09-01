# 作品/Agent 评论区 · 新增接口契约（推特式）

> 分支：`feat/community-page`（自 main 拉出）
> 前端实现：`public/app.js` 的 `CommunitySection` → 作品详情弹窗（`openWorkModal` / `commentStore` / `window.comSend|comReply|comLike`）
> 关联文档：`docs/api/community-api.md`（动态流接口）
> 本文档供合并分支时后端对接使用。前端已按此契约实现调用，接口未上线时自动回落 DEMO 评论（`public/data/community.json` 的 `comments` 字段，本地内存交互、刷新即失）。

## 产品口径（与聊天房间方案的区别）

不做独立聊天房间。讨论挂在**被分享的内容**上：创作者发布作品/Agent → 其他人点开详情 → 看 简介 + **导入链接** → 在评论区随意留建议。评论管理参考推特：

- **顶层时间线**新的在前；**回复**按时间正序嵌在根评论下（一层嵌套）
- 回复的回复**自动挂回根评论**（不出现三层嵌套，同推特）
- 创作者本人的回复带「作者」徽标（按 `comment.author === work.author` 匹配）
- 点赞（♥）为轻互动，不是讨论主体

## 数据模型（建议 1 张表）

`comments`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | text PK | 评论 id，建议时序可排序（如 `c-<ts>-<seq>`） |
| `work_id` | text/int | 所属作品（works.id），带索引 |
| `parent_id` | text, null | 根评论 id；回复的回复由后端同样拍平到根（见上） |
| `user_id` | bigint | 发布者（登录用户） |
| `author` | text | 发布者昵称快照（列表直出，避免联表） |
| `dept` | text, null | 部门名快照，纯展示 |
| `text` | text | 正文，纯文本（前端 HTML 转义），≤500 字 |
| `likes` | int | 点赞数（服务端权威） |
| `deleted` | boolean | 软删标记，删除后不再返回 |
| `created_at` | timestamp | 创建时间 |

点赞去重可选：简单版不做点赞人表（前端本地记状态，刷新丢失）；要做则加 `comment_likes(comment_id, user_id)` 唯一键。

## 接口（挂在作品维度，沿用 contract.js 的 ok/err 包装）

### GET /api/works/:id/comments

拉取某作品的评论（含一层回复）。

- 无鉴权（公开浏览）。
- 可选 query：`limit`（默认 50，上限 100）、`cursor`（上一页最后一条 id，向下翻页）。
- 排序口径（前端会重排，但建议后端一致）：顶层新的在前、回复时间正序。

成功响应：

```json
{
  "ok": true,
  "data": {
    "comments": [
      { "id": "c1", "work_id": 101, "parent_id": null, "author": "Momo", "dept": "市场部", "text": "导进我们组的群试了一周…", "time": "09-01 11:20", "likes": 12 },
      { "id": "c2", "work_id": 101, "parent_id": "c1", "author": "阿禾", "dept": "研发中心", "text": "同感…", "time": "09-01 11:35", "likes": 3 }
    ],
    "nextCursor": null
  }
}
```

- `time` 展示用（建议 `MM-DD HH:mm`）；也可加 `created_at` ISO 字段，前端展示优先用 `time`。
- 空列表返回 `"comments": []`，非错误。

### POST /api/works/:id/comments

发布评论/回复。**要求登录**（`req.session.userId`，与 works 上传同口径）。

请求体：

```json
{ "content": "建议加一个失败重试的说明", "parent_id": "c3" }
```

- `content` 必填、去首尾空格后非空、≤500 字；`parent_id` 可选，传则须为**同作品**的顶层评论 id；回复的回复由后端拍平到根后入库。
- 未登录返回 401（`err("UNAUTHORIZED", ...)`，code 名以现有 ErrorCodes 为准）；前端收到 401 显示「登录后才能发布/点赞」提示，不弹窗。

成功响应：

```json
{ "ok": true, "data": { "comment": { "id": "c8", "work_id": 101, "parent_id": "c3", "author": "我", "dept": "", "text": "…", "time": "09-01 12:00", "likes": 0 } } }
```

### POST /api/works/:id/comments/:cid/like

切换点赞（toggle）。要求登录。返回 `{ "ok": true, "data": { "likes": 13, "liked": true } }`。

### DELETE /api/comments/:id

删除自己的评论（软删 `deleted=true`）。admin 可删任何。返回 `{ "ok": true, "data": {} }`。

## 前端调用点（合并时定位用）

- `public/app.js` → `CommunitySection`：
  - `loadComments(w)`：打开弹窗时 GET，失败回落 DEMO（弹窗右上 `DEMO` 标记）
  - `sendComment()`（`window.comSend`）：DEMO 模式本地内存发布；API 模式 POST，401 → 登录提示
  - `window.comReply(cid, name)`：点「回复」聚焦底部输入框并记录 `parent_id`（同推特：回复统一在底部输入框完成）
  - `window.comLike(cid)`：DEMO 本地切换；API 模式 POST like 后用服务端返回值覆盖
- 「导入到我的环境」按钮：`work.source` 有值时渲染为外链（下载/导入入口由作者在上传作品时填的 source 字段承载，**无需新接口**）。

## 后端接入建议（合并时做，本分支不做）

1. 新建 `server/routes/comments.js`（或在 works.js 内嵌），风格对齐 works.js（contract + validate）。
2. `server/server.js` 挂载：作品维度路径挂在 works 路由之前或用 `mergeParams` 的子路由均可。
3. 建表 SQL 走现有建表流程；`parent_id` 与 `work_id` 建索引。
4. 上线后前端零改动自动切换（回落逻辑只在接口失败时生效）；DEMO 数据可留作兜底或删除。

## 兼容性说明

- 本分支不改 `server/` 任何文件、不改其它页面；新增 CSS 仍全部 `com-` 前缀。
- 评论区仅存在于作品详情弹窗内，不影响列表页与其它 section。
