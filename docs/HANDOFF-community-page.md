# 交接文档 — feat/community-page 合并与嵌入预览

> 收件：open code（Codex）。发件：社区页前端（在 `feat/community-page` 分支完成 v1–v9 迭代）。
> 目的：把 `feat/community-page` 合并进 `main`，并在现有网站中嵌入社区页做预览。

## 1. 分支与改动范围

- 仓库：`github.com/zhuxice-ctrl/livzon-ai-community`
- 分支：`feat/community-page`（自 main 拉出，已推 origin，最新提交见 git log）
- **改动范围（红线）**：
  - `public/app.js` —— 只动了 `CommunitySection`（社团社区页）与 App 的 hash 路由初始化，其他页面（首页/活动/关于/登录等）未动
  - `public/data/community.json` —— 演示种子数据（15 帖，含 4 层嵌套评论链）
  - `docs/api/posts-api.md` —— 数据接口契约（唯一现行契约）
  - `docs/api/push-api.md` —— 飞书集成契约 v2.1（内网约束版）
  - `docs/api/community-api.md`、`docs/api/comments-api.md` —— 已废止的历史契约（文件内注明，勿按其实现）
  - **`server/` 一个文件未动**；新增 CSS 全部 `com-` 前缀，不影响其他页面样式
- 注意：**站内未加任何飞书跳转入口**（如需要，部署时自行加一个普通 `<a>` 链接即可，见 push-api.md §5.1）。

## 2. 前端功能现状（合并后即所得）

- 帖子信息流：推荐/最新双 tab（推荐分 = (1+likes+2×评论数)×exp(-ageHours/36)，服务端权威公式在 posts-api.md）、30s 自动刷新（`after_id` 增量，新帖收进顶部提示条不打断浏览）、搜索框（内容/作者本地过滤，预留服务端 `?q=`）
- 顶部导航栏 + 左侧分区侧边栏（v6；**非 sticky**，不跟随滚动）、丽珠 logo（复用 app.js 内嵌 base64 PNG）
- 独立发布页（导航栏「发布」按钮进入）：分区四选一 resource/tutorial/qa/chat（**无精华**）、图片≤9/附件≤5 本地暂存、草稿跨渲染保留
- 评论：**无限层级嵌套**（v9，父被软删则孤儿提升顶层）、行内展开、帖子作者徽标、点赞
- 公告条 + 图.banner 轮播（config 下发，回落 community.json）
- hash 路由：`#home` `#activities` `#community` `#about` 直达各页
- **双模式**：接口通 → 全走 API；接口失败 → 回落 `/data/community.json` 种子（SEED 模式，发帖/点赞/评论走本地内存演示）。合并后不接后端也能直接预览。

## 3. 合并步骤（建议）

```bash
git checkout main
git pull origin main
git merge --no-ff feat/community-page
# 预期冲突点：仅 public/app.js（若 main 侧也改过该文件）
# 解决原则：app.js 为单文件 React 编译产物——冲突时以 feat/community-page 侧为准做手工合并，
#   保留 main 侧对非社区页部分（首页/活动/关于等）的改动，社区段用本分支版本。
node start.mjs   # 或现有启动方式，本地起服务
# 验证（见 §4）
git push origin main
```

- 若 main 自分支拉出后未改 `public/app.js`，则合并零冲突直接过。
- 合并后 `feat/community-page` 分支可保留或删除，由你定。

## 4. 合并后验证清单

1. `http://localhost:8080/`（或站点实际端口）首页/活动/关于正常，无样式串扰（社区页样式全部 `com-` 前缀）
2. 顶部导航切到「社团社区」，SEED 模式加载 15 帖
3. 直接访问 `http://localhost:8080/#community` 直达社区页，浏览器回退/前进正常
4. 侧边栏切分区（首页/精华/资源分享/教程攻略/问答求助/闲聊灌水），计数随切换变化
5. 搜索框输入关键词过滤、✕ 清空
6. 发布：独立发布页选分区发帖（SEED 本地内存）、图片/附件本地暂存预览
7. 评论：展开帖子评论，多级回复（种子帖 p11 有 4 层链）、点赞、删自己的评论
8. 30s 后观察一次静默刷新不丢草稿（正在输入的评论不被清空）
9. 控制台无新增报错（回落模式下 fetch 404 属预期，前端自动 SEED）

## 5. 嵌入预览（iframe）

站点无 X-Frame-Options 限制，直接嵌：

```html
<iframe src="http://<站点地址>/#community"
        style="width:100%;height:820px;border:0"></iframe>
```

- 高度建议 ≥820px（信息流 + 公告条 + 评论区）
- `#community` 进社区页；不带 hash 则进首页
- 移动端嵌入：建议 iframe 外层限宽，社区页自身已有窄屏适配

## 6. 后端接入（合并后再做，不在本分支范围）

全部契约已写好，照做即可：

- **数据接口**：`docs/api/posts-api.md`（posts/comments 两表 + 全部 REST 端点 + config + upload；末尾有「前端调用点」章节帮你在 app.js 里定位）
- **飞书集成**：`docs/api/push-api.md` v2.1（内网约束：Base 镜像 + 内网出向定时同步 + 精华推送卡片 + 机器人入群置顶社区链接；实施顺序在其 §8）
- 前端零改动自动从 SEED 切到 API（回落仅接口失败时生效）
- 种子数据 `public/data/community.json` 上线后可删可留

## 7. 已知边界（不必处理的"问题"）

- SEED 模式发帖/点赞刷新后不持久（预期，接 API 后消失）
- 搜索为本地过滤（只过滤已加载帖；服务端 `?q=` 实现后自动升级全量搜索）
- 帖子级深链 `#community?post=<pid>` 未做（可选扩展，posts-api.md 有说明）
- 站点仅内网部署；飞书侧只读镜像（push-api.md §0）
