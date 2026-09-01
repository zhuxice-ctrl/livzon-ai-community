# 社区飞书推送与嵌入契约（push-api.md）

> 版本：v1（2026-09-01）｜分支 `feat/community-page`
> 前置阅读：[posts-api.md](./posts-api.md)（帖子/评论/点赞接口与数据模型）
> 定位：**后端合并时的集成契约**——飞书侧「快速跳转入口 + 精华文章推送 + 互动通知」。
> 现状底座：`server/lark-client.js` 已实现 tenant_access_token 缓存（env：LARK_APP_ID / LARK_APP_SECRET），
> 报名链路已在用同一凭据，本契约在其上扩展，**不新增飞书应用**。

## 一、总体链路

```
社区后端(Express) ── 精华帖/互动事件 ──> PushService ──> 飞书群/个人
                                                     │
浏览器 iframe 嵌入 <── 站点(#community) ──┘           └── 卡片按钮「进入社区」──> 妙搭应用 / 站点链接
```

三种消费形态共用一个站点：

| 形态 | 入口 | 说明 |
|---|---|---|
| 网页嵌入 | `<iframe src="https://站点/#community">` | hash 直达社区 tab，已在前端实现 |
| 妙搭应用 | 飞书内点开应用即社区页 | 站点公网部署后可实时拉 API；过渡期用静态预览版 |
| 机器人推送 | 消息卡片按钮 | 点开拉起站点/妙搭，落在对应帖子 |

## 二、嵌入（前端已完成，后端无需改动）

- **前端已支持**：`index.html#community` 直达社区分区（`HASH_PAGES` 白名单：home / activities / community / about；非法 hash 回落 home）。iframe 示例：
  ```html
  <iframe src="https://站点域名/#community"
          style="width:100%;height:100vh;border:0" title="社团社区"></iframe>
  ```
- **响应头**：当前 server 未设 `X-Frame-Options` / CSP `frame-ancestors`，静态页可被任意来源 iframe 嵌入，无需后端改动。
- **限制（Phase 2 一行配置）**：跨站 iframe 内**登录态**受 SameSite=Lax 影响（浏览、看帖不受影响；发帖/点赞需登录）。如需在跨站 iframe 内登录，express-session cookie 增加 `sameSite: "none", secure: true`（要求 HTTPS）。
- **深链（可选扩展）**：帖子级直达 `#community?post=<pid>`——前端展开对应评论串；本次未实现，需要时前端加 10 行。

## 三、PushService（后端新增模块 `server/push.js`）

### 环境变量

| env | 必填 | 说明 |
|---|---|---|
| `LARK_APP_ID` / `LARK_APP_SECRET` | 是（已有） | 复用现有飞书应用凭据 |
| `LARK_PUSH_WEBHOOK_URL` | 二选一 | **自定义机器人 webhook**（群内添加机器人即得；最简路径，无需应用权限） |
| `LARK_PUSH_CHAT_ID` | 二选一 | **自建应用机器人** `oc_xxx` 群 chat_id（走 im/v1/messages，可 @人、可私发，需开 `im:message` 权限） |

两者都配置时优先 webhook（群广播）；互动通知（发给个人）必须走应用机器人。

### 接口（模块内部函数，非 HTTP API）

```js
// 1) 精华速递（定时 digest）：拉 since 之后新打精华标的帖子
PushService.sendFeaturedDigest({ since /* ISO 时间，默认近 7 天 */ })
// 数据源：GET posts（同进程直查 DB）where tag='featured' and pinned and created_at > since
// 无新帖时静默跳过（不发空卡片）

// 2) 新精华即时推（管理员打标那一刻）
PushService.pushFeatured(post)   // 单帖卡片，同下文格式

// 3) 互动通知（Phase 2，发给帖主）
PushService.notifyInteraction({ post, actor, type /* 'comment' | 'like' */ })
```

### 触发点埋设（routes 里调用）

| 事件 | 位置 | 动作 |
|---|---|---|
| 管理员给帖子打精华标 | `PUT /api/community/posts/:id/tag`（admin 鉴权） | `pushFeatured(post)` |
| 新评论 | `POST /api/community/posts/:id/comments` | `notifyInteraction({type:'comment'})`（帖主 ≠ 评论人时才发） |
| 新点赞 | `POST /api/community/posts/:id/like` | `notifyInteraction({type:'like'})`（同上，且仅「从未赞过→赞」方向发） |
| 定时 digest | `node-cron`（建议 `0 0 10 * * 1` 每周一 10:00，env `PUSH_DIGEST_CRON` 可配） | `sendFeaturedDigest({since: 上次运行时间})` |

### 卡片格式（interactive card，两种通道通用 JSON）

```json
{
  "title": "社区精选 · 本周 N 篇",
  "elements": [
    { "author": "老周", "summary": "RAG 选型实测：20 轮评测里只挂了 2 次…", "likes": 12,
      "url": "https://站点域名/#community" }
  ],
  "button": { "text": "进入社区", "url": "https://站点域名/#community", "fallback": "https://妙搭应用链接" }
}
```

- `url` 落在站点（公网部署后）；按钮 `fallback` 指向妙搭应用链接（站点不可达时的兜底）。
- webhook 通道注意：飞书自定义机器人可选「签名校验」（env `LARK_PUSH_WEBHOOK_SECRET`），payload 加 `timestamp + sign` 字段；**webhook URL 与 secret 一律走 env，不入库不入日志**。
- 发送失败降级：写 `logs/push_fallback.jsonl`（沿用 LarkClient 的 fallback 模式），不阻塞主请求。

### 频率与防打扰

- digest 默认每周一次；即时精华推送仅 admin 打标触发（量可控）。
- 互动通知 Phase 2 再上，需要帖主→飞书用户的映射（依赖账号打通，见下）。

## 四、账号打通（Phase 2，仅发互动通知时需要）

- 方案 A（轻）：帖主注册时绑定飞书 user_id（`users` 表加 `lark_user_id` 列，登录页提供一次性绑定链接）。
- 方案 B（重）：整站接飞书 OAuth 免登（妙搭/飞书内进入时直接知道「你是谁」）。
- 只做精华推送（群广播）**不需要**任何账号打通。

## 五、妙搭应用入口（无后端依赖，站点部署前后都可用）

- 过渡期：妙搭静态预览版（seed 数据）即是飞书内入口，机器人卡片可直挂该链接。
- 站点公网部署后（CORS 已是 `*`）：妙搭应用把 seed fetch 换成 `https://站点域名/api/community/posts` 即为实时数据入口；或改为全屏 iframe 壳嵌 `https://站点域名/#community`（二选一，前者体验更好）。

## 六、实施顺序建议

1. ✅ 前端 hash 直达（本次已提交）
2. 站点公网部署（HTTPS + 域名）——嵌入与推送的 URL 依赖它
3. 群里加自定义机器人 → 配 `LARK_PUSH_WEBHOOK_URL` → 后端实现 `pushFeatured` + 打标触发（最小可用精华推送）
4. node-cron digest（每周精选）
5. Phase 2：互动通知 + 账号打通 + 跨站 iframe 登录（sameSite 配置）
