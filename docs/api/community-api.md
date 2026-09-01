# 社团社区页 · 新增接口契约

> 分支：`feat/community-page`（自 main 拉出）
> 前端实现：`public/app.js` 的 `CommunitySection` 组件
> 本文档供合并分支时后端对接使用。前端已按此契约实现调用，并在接口未上线时自动回落静态数据，后端接入前页面可正常预览。

## 背景

社团社区页只做前端改造，不改任何后端与其它页面（横切解耦）。页面数据分三路：

| 数据 | 来源 | 状态 |
|---|---|---|
| 社区动态 moments | `GET /api/community/moments`（**新增**，本文档） | 前端已按契约调用，失败时回落 `/data/community.json` 的 `moments` 字段 |
| 精选作品 | `GET /api/works` | 复用现有接口，无变更 |
| 课程目录 / 知识库 / 高校联合 | `GET /data/community.json`（静态文件 `public/data/community.json`） | 纯静态，不走后端 |

仅第 1 路是新增接口。回落逻辑：请求失败 / 返回非 200 / 返回体不符合契约（缺 `ok`/`data.moments`）时，前端改读静态 JSON，并在页面以 `SEED` 标记提示当前为种子数据。

## GET /api/community/moments

社区动态列表。语义：运营/成员在社区里的公开动态流（发布了作品、解锁了 Skill、参加了活动、写了复盘、冒泡）。

### 请求

```
GET /api/community/moments
```

- 无鉴权（公开内容，与 `/api/works` 列表口径一致）。
- 可选查询参数（后端接入时可先忽略，前端当前不传）：
  - `limit`：返回条数，默认 30，上限建议 50。
  - `before`：动态 id，用于向下翻页（游标分页）。

### 成功响应

```json
{
  "ok": true,
  "data": {
    "moments": [
      {
        "id": "m-2026-09-01-01",
        "author": "阿禾",
        "dept": "研发中心",
        "action": "skill",
        "text": "解锁了「飞书多维表格自动化」Skill，报表半天变十分钟",
        "time": "09-01 14:20"
      }
    ]
  }
}
```

字段约定（与 `server/contract.js` 的 ok 包装一致）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 动态唯一 id，前端未强校验，但翻页/去重依赖它，务必稳定且时序递增 |
| `author` | string | 是 | 展示昵称，缺省时前端兜底显示「同学」 |
| `dept` | string | 否 | 部门名，纯展示 |
| `action` | string | 是 | 枚举：`work`（发布了作品）/ `skill`（解锁了 Skill）/ `event`（参加了活动）/ `review`（写了复盘）/ `chat`（冒了个泡）；未知值前端按原文展示 |
| `text` | string | 是 | 动态正文，前端做 HTML 转义，纯文本即可，勿传富文本 |
| `time` | string | 是 | 展示用时间，建议 `MM-DD HH:mm`；也可传 ISO 时间串，前端原样展示 |

- 列表按 `time` 倒序（新的在前）。
- 空列表返回 `"moments": []`，前端渲染空态，不是错误。

### 错误响应

沿用 `server/contract.js` 的 `err(code, message)` 包装：

```json
{
  "ok": false,
  "error": { "code": "INTERNAL", "message": "..." }
}
```

错误码建议复用现有 `ErrorCodes`：参数非法 → `VALIDATION`；服务异常 → `INTERNAL`。任何非 200 / 非 `ok:true` 响应都会触发前端回落静态数据，不会报错弹窗。

### 后端接入建议（合并时做，本分支不做）

1. 新建 `server/routes/community.js`，风格对齐 `server/routes/works.js`（contract + validate 包装）。
2. 在 `server/server.js` 挂载：`app.use('/api/community', communityRouter)`，与现有路由并列。
3. 数据源可用现表扩展（如 works 表加 kind 或单建 moments 表），无强约束——前端只认上面响应结构。
4. 接口上线后，可删除 `public/data/community.json` 中 `moments` 字段或保留作兜底，均不影响页面。

## 前端调用点（合并时定位用）

- `public/app.js` → `CommunitySection` → `loadMoments()`：`fetch("/api/community/moments")`，成功解析 `j.data.moments`，失败回落 `/data/community.json`。
- `loadStatic()`：课程/知识库/高校联合静态数据。
- `loadWorks()`：精选作品，复用 `/api/works`（取前 8 条）。

## 兼容性说明

- 本分支不改 `server/` 任何文件、不改其它页面组件、不改 App 壳路由（社区页入口在壳里原本就有）。
- 所有新增 CSS 类名以 `com-` 前缀命名，避免与其它 section 样式冲突。
