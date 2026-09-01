# 丽珠 AI 社区 — 飞书集成契约（内网约束版 v2.1）

> 读者：后端（Codex）合并 `feat/community-page` 后实施。
> 前置：先把 `docs/api/posts-api.md`（数据接口）与 `docs/api/announce-upload-api.md`（公告与上传）落地。
> **硬约束（v2 变更原因）：站点只在企业内网运行，不公网部署。飞书云端（妙搭 / 机器人 / OpenAPI 回调）无法入向访问站点。所有集成都改为「内网 → 飞书云」的出向数据推送。**

## 0. 总体链路（v2）

```
┌─ 企业内网 ─────────────────────┐        ┌─ 飞书云 ────────────────┐
│  社区站点 (Node/Express)        │ 出向    │  Base 镜像表（帖子数据）  │
│    ├─ sync-mirror 定时同步 ─────┼───────▶│    ↑                    │
│    └─ PushService 事件推送 ─────┼───────▶│  妙搭应用（读 Base）     │
│         (精华/摘要 → 群卡片)     │ 出向    │  机器人（发卡片/菜单）   │
└────────────────────────────────┘        └─────────────────────────┘
        用户在内网点击卡片链接 → 直达内网站点（hash 深链）
        用户不在内网 → 点妙搭链接看 Base 镜像（只读）
```

- 原则：**数据出内网，站点不出内网**。云上只有一个只读数据镜像（Base）和消息卡片。
- 「飞书自动轮询拿数据」由**内网侧定时推送**实现同等效果（云端无法轮询内网，方向必须反过来）。同步频率即"轮询周期"，默认 10 分钟，可配置。

## 1. Base 镜像表（新增，v2 核心）

在飞书多维表格建镜像表（建议与报名表分开的独立 app），表 `posts`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| post_id | 文本 | 站内帖子 ID，**唯一**，作为 upsert 主键 |
| author | 文本 | 作者姓名 |
| dept | 文本 | 部门 |
| content | 文本 | 正文纯文本（图片附件不入镜像，只存 `images` JSON 数组字符串） |
| section | 单选 | resource / tutorial / qa / chat |
| tag | 文本 | 公告 / 活动 / 精华（可空） |
| pinned | 复选 | 是否置顶 |
| likes | 数字 | 点赞数 |
| comment_count | 数字 | 评论总数（嵌套全计） |
| images | 文本 | 图片文件名 JSON 数组，如 `["u-a1.png"]` |
| created_at | 日期 | 发布时间（毫秒） |
| updated_at | 日期 | 最后变更（毫秒） |
| deleted | 复选 | 站内已删除（镜像保留墓碑，妙搭侧过滤） |
| sync_at | 日期 | 本次同步时间（毫秒） |

说明：评论全文不镜像（量大、增量复杂），只镜像 `comment_count`；需要看评论的用户点链接回内网站点。

## 2. 同步契约（内网 → Base，定时）

`server/push/sync-mirror.js`，node-cron 定时执行：

- env `MIRROR_SYNC_CRON`，默认 `0 */10 * * * *`（每 10 分钟）；服务启动后立即先跑一轮全量。
- 增量游标：本地持久化 `logs/mirror_cursor.json`（`{"last_sync_ts": <ms>}`）。每轮取 `updated_at > last_sync_ts` 的帖子（含 deleted 墓碑），逐条 **upsert**：按 `post_id` 检索镜像表——存在则 update，不存在则 create；同步成功才把游标推到本轮最大 `updated_at`。失败保留游标，下轮重试（幂等）。
- 删除传播：站内删除 → 镜像记录 `deleted=true`（不物理删，避免误删历史推送上下文）。
- 复用 `server/lark-client.js`：tenant_access_token 缓存与获取逻辑照用；写失败同样落 `logs/mirror_fallback.jsonl` 兜底。
- 需要的 OpenAPI：`bitable.app_table_record.search`（按 post_id 查）/ `batch_create` / `batch_update`（应用需开通 Base 读写权限并授权该表）。

## 3. 推送契约（内网 → 群卡片，事件驱动）

`server/push/PushService.js`，复用 LarkClient。env：

- `LARK_APP_ID` / `LARK_APP_SECRET`（已有）
- `LARK_MIRROR_APP_TOKEN`（镜像 Base app token）
- `LARK_PUSH_WEBHOOK_URL`（自定义机器人 webhook，**优先**）或 `LARK_PUSH_CHAT_ID`（应用机器人，备选）——二选一
- `SITE_INTRANET_URL`（内网地址，如 `http://ai-community.livzon.local:8080`）
- `MIAODA_APP_URL`（妙搭应用链接，云端兜底入口）

### 3.1 sendFeaturedDigest()

- cron `0 0 10 * * 1`（每周一 10:00）；收集近 7 天 `tag=精华` 的帖子；空则跳过；卡片同 3.2 多行版。

### 3.2 pushFeatured(post)

卡片 elements：作者+部门、正文（截 200 字）、`[公告]`/`[精华]` 标记、点赞/评论数、发布时间。
actions **双按钮**（v2 变更）：

```json
"actions": [
  { "tag": "button", "text": { "tag": "plain_text", "content": "进入社区（内网）" },
    "type": "primary", "url": "http://ai-community.livzon.local:8080/#community" },
  { "tag": "button", "text": { "tag": "plain_text", "content": "手机查看" },
    "type": "default", "url": "<MIAODA_APP_URL>" }
]
```

- 内网用户点第一个直达站点；移动端/外网用户点第二个看妙搭镜像。

### 3.3 notifyInteraction(toUserOpenId, kind, post)

- 管理员打精华 → 应用机器人发单聊卡片；`SITE_INTRANET_URL` 为空则跳过。
- 依赖账号打通（Phase 2）；打通前不启用。

### 3.4 触发点

| 事件 | 调用 |
| --- | --- |
| 管理员打/改精华标 | `pushFeatured(post)` + 即时 upsert 镜像（不等定时） |
| 帖子增删改 | 由 sync-mirror 定时同步 |
| 每周一 10:00 | `sendFeaturedDigest()` |

## 4. 嵌入网页（限定：嵌入方与站点同内网）

- 嵌入方系统也在企业内网 → iframe 直嵌，站点无需任何改造（无 X-Frame-Options 限制）：
  `<iframe src="http://ai-community.livzon.local:8080/#community" style="width:100%;height:800px;border:0"></iframe>`
- hash 深链直达各页：`#home` `#activities` `#community` `#about`（前端已实现）。
- 帖子级深链（建议）：`#community?post=<pid>` —— 前端在 `hashchange` 时读取 `post` 参数滚动定位到对应卡片。前端可选扩展，后端无工作。
- 嵌入方是公网系统 → **不可嵌入**（站点不可达），用妙搭应用代替。

## 5. 妙搭应用（数据源 = Base 镜像）

- 推荐**妙搭 + 多维表格数据源（连接器）**：直接绑定 `posts` 镜像表，做精华列表 / 分区浏览 / 搜索；按 `deleted=false` 过滤、按 `pinned` + `created_at` 排序。零代码、纯只读、天然公网可达。
- 需要更定制交互时用妙搭全栈函数读 Base（同样只读）。
- 原 v1 方案「妙搭全栈函数拉站点 API」**作废**——云端够不到内网。若未来站点开放公网再启用。
- 妙搭侧互动按钮（点赞/评论）不回写内网，统一引导：「互动请在内网打开社区站点」+ `SITE_INTRANET_URL` 链接。

### 5.1 网站内打开妙搭（双向互链，v2.1 新增）

社区站点导航栏右侧新增「☁ 云端版」入口，新标签打开妙搭应用（内网用户在移动端/临时无内网环境时的兜底入口）：

- 前端**已实现**：`app.js` 社区组件顶部 `var MIAODA_URL = "..."` 常量 + 导航栏 `.com-nav-cloud` 链接（`target="_blank"`）；常量留空则入口自动隐藏，无侵入。
- 部署时把 `MIAODA_URL` 替换为正式妙搭应用链接（当前值为开发预览链接，仅作占位）。
- 为什么是新标签跳转而不是 iframe 内嵌：飞书页面（feishu.cn 域）带 frame 限制头，iframe 内嵌大概率被浏览器拒绝；新标签打开稳定可靠。
- 方向说明：站点（内网）→ 妙搭（公网）出向可达，该入口在内网浏览器正常工作；反向（妙搭嵌站点）依旧不可能，见第 4 节。

## 6. 机器人快速跳转与置顶链接（v2.1 扩充）

- 机器人简介/菜单放两个入口：内网站点链接（附「需内网」说明）+ 妙搭应用链接（云端兜底）。
- 精华/digest 卡片即 3.2 双按钮格式。

### 6.1 置顶社区链接（v2.1 新增）

机器人进群后发一条「社区入口卡片」并**置顶（pin）**，让群成员随时能在会话顶部看到置顶链接一键跳转：

- 卡片内容：标题「丽珠 AI 社区 · 入口」+ 双按钮（同 3.2：`进入社区（内网）` → `SITE_INTRANET_URL/#community`；`手机查看` → `MIAODA_APP_URL`）+ 一行说明「内网直达，外网走云端镜像」。
- **实现约束：置顶只能用应用机器人，不能用自定义 webhook 机器人**（webhook 机器人没有 pin 权限）。OpenAPI：先 `im/v1/messages` 发卡片拿 `message_id`，再 `im/v1/pins`（`chat_id` + `message_id`）置顶；需要 `im:message` 发送 + `im:message:pin`（或会话置顶权限）scope，由 Codex 在开放平台为应用开权限。
- 触发时机：机器人首次入群（`im.chat.member.bot.added_v1` 事件）自动发卡并置顶；`LARK_PIN_ON_JOIN`（默认 true）开关控制。存量群由管理员手动触发一次（提供一个 npm script：`npm run pin:community`）。
- 置顶卡片与 3.2 精华推送共用 PushService 的发卡函数，只换标题/按钮；单聊场景不置顶（pin 仅群会话有效），用户与机器人单聊时菜单入口即可跳转。

## 7. 账号打通（Phase 2，不变）

- 登录后：站内账号绑定 open_id（OAuth 或绑定码）；打通后启用 3.3 单聊互动通知。
- 未打通阶段：所有通知走群 webhook/群消息。

## 8. 实施顺序（v2.1）

1. ✅ hash 直达（前端已完成）
2. ✅ 站点内「☁ 云端版」入口（前端已完成，v2.1）
3. Base 镜像表 + `sync-mirror.js` 定时同步（妙搭和机器人都依赖它）
4. webhook/机器人 + `pushFeatured`（精华即时推送，顺带即时 upsert 镜像）
5. `sendFeaturedDigest` 周报
6. 妙搭应用接 Base 数据源，配置机器人菜单
7. 机器人入群发卡并置顶社区链接（`im/v1/pins`，v2.1）
8. （可选）帖子级深链 `#community?post=`
9. Phase 2：账号打通 + 单聊通知
