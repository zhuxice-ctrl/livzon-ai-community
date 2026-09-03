# 丽珠 AI 社团官网 · 本地部署

> 公司内部员工使用。Node.js + Express 轻量后端 + 静态前端 + 飞书多维表格存储报名数据。
> 本机作为服务器，LAN 内访问，**不部署公网**。

## 快速启动

需要本机已安装 **Node.js 18+**。

```bash
# 第一次：安装依赖
cd F:\pingce
node start.mjs

# 浏览器打开（控制台会打印）
#   http://127.0.0.1:8787/
#   http://<你电脑内网IP>:8787/   ← 告诉同网段同事

# 停止服务
node start.mjs --stop

# 查看状态
node start.mjs --status
```

## 项目结构

```
F:\pingce\
├── start.mjs                # 启动脚本（Node 启动器）
├── README.md                # 本文档
├── server\
│   ├── package.json
│   ├── server.js            # Express 入口
│   ├── lark-client.js       # 飞书多维表格 API 封装
│   ├── .env.example         # 凭证模板
│   └── .env                 # 实际凭证（首次启动自动生成）
├── public\
│   ├── index.html           # 主页（含报名 FAB）
│   ├── app.js               # 主页 React 应用
│   ├── data\
│   │   ├── works.json       # 作品列表（每期编辑）
│   │   ├── activities.json  # 活动列表
│   │   └── schedule.json    # 进度里程碑
│   └── images\              # 静态资源
└── logs\                    # 运行日志
```

## API

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/info` | 服务元信息（IP、端口、飞书配置状态） |
| GET | `/api/works` | 作品列表 |
| GET | `/api/activities` | 活动列表（DB 聚合，与原 json 同构；DB 不可用回落 json） |
| GET | `/api/activities/:id` | 单活动详情 |
| POST | `/api/activities/:id/reserve` | 活动预约（需登录，见下文） |
| GET | `/api/my/messages` | 我的站内消息 + 未读数 |
| POST | `/api/my/messages/read` | 标记已读（`{id}` 单条 / `{}` 全部） |
| GET | `/api/admin/activities/reservations` | 预约名单（仅管理员，按活动分组） |
| GET | `/api/schedule` | 进度 |
| POST | `/api/register` | 报名提交 |

（社区帖子/评论/点赞/上传等端点契约见 `docs/api/posts-api.md`，作品评论见 `routes/work-comments.js` 头注释。）

### POST /api/activities/:id/reserve · 活动预约

- **身份**：需飞书登录态（`authRequired`）；姓名/部门从 session+users 快照落库，请求体只收 `{note}`（参与期待，选填 ≤500 字）
- **幂等**：`UNIQUE(user_id, activity_id)`——重复提交返回 200 `{reserved:true, repeated:true, message:"您已预约过该活动"}`，不报错不累积
- **约束**：仅 `upcoming` 活动可约；past/current 返回 400；活动不存在 404；未登录 401（前端引导去登录）
- **成功副作用**：写一条站内通知（消息中心/顶栏铃铛）；「开始前飞书通知」的推送待 Phase 2 凭证打通后接入（见飞书清单）
- **数据维护**：活动以 `public/data/activities.json` 为编辑源，改完跑 `node server/sql/import_activities.js` 幂等刷新入库

### POST /api/register

请求体：

```json
{
  "name": "张三",
  "department": "研发中心",
  "contact": "13800000000",
  "activity": "AI 训练营",
  "willShare": true,
  "shareTopic": "RAG 在临床检索中的实践",
  "remark": "对 Agent 感兴趣"
}
```

返回：

```json
{
  "ok": true,
  "mode": "lark",
  "recordId": "rec...",
  "message": "报名成功，我们已收到您的报名信息"
}
```

`mode` 取值：
- `lark`：成功写入飞书多维表格
- `fallback`：飞书 API 失败，**已暂存到 logs/registration_fallback.jsonl**，管理员可批量导入
- `failed`：完全失败（极少见）

## 飞书多维表格配置

报名表已通过 lark-cli 帮你建好：

- **Base URL / app_token / table_id**：请在内部部署环境的凭证配置中填写，不随公开代码分发。
- **字段**：姓名 / 部门 / 联系方式 / 报名活动（单选）/ 是否愿意分享（勾选）/ 分享方向 / 备注 / 报名时间（自动）/ 状态（单选：待审核/已通过/已驳回）

### 让后端能写入表格（一次性设置）

后端调飞书 OpenAPI 需要企业自建应用的凭证。**lark-cli 的凭证由 aily 平台托管，不能直接给 Node.js 后端复用**，需要单独创建一个飞书自建应用：

1. **创建应用**：登录 https://open.feishu.cn/app → 企业自建应用 → 创建企业自建应用
   - 应用名：`丽珠 AI 社团后端`（任意）
2. **添加权限**：权限管理 → 搜索「多维表格」，勾选：
   - `bitable:app`（读写 Bitable）
   - `bitable:app:readonly`（读）
3. **发布版本**：版本管理与发布 → 创建版本 → 提交发布（企业内部自审通过）
4. **获取凭证**：基础信息 → 复制 `App ID` 和 `App Secret`
5. **填到 .env**：编辑 `server/.env`：
   ```
   LARK_APP_ID=cli_xxxxxxxxxxxx
   LARK_APP_SECRET=你的App Secret
   ```
6. **重启服务**：`node start.mjs --stop && node start.mjs`

### 如果不想配飞书（纯本地模式）

把 `.env` 里的 `LOCAL_FALLBACK=0` 改为 `LOCAL_FALLBACK=1`（**默认就是 1**）。
所有报名会暂存到 `logs/registration_fallback.jsonl`（每行一条 JSON），管理员可定期：
- 复制到飞书多维表格手动导入
- 或用 lark-cli `base +record-batch-create --records @registrations.json` 批量补录

## 局域网内其他员工访问

服务默认监听 `0.0.0.0:8787`。同 WiFi / 同网段的同事可通过你的内网 IP 访问：

```
http://<你的内网IP>:8787/
```

如何查看你的内网 IP：
- `Win + R` → `cmd` → `ipconfig` → 找「IPv4 地址」
- 或在服务启动时看控制台输出

防火墙可能拦截首次访问（Windows 防火墙弹窗），**允许访问**即可。

不在同网段（含家里/4G）访问不到，这是「本机当服务器」的天然限制。

## 数据库迁移（PostgreSQL）

后端数据表全部在本地 `pingce` 库。启动前需保证服务已运行（`E:\PostgreSQL\launch_pg.cmd` 拉起 PG）。

```bash
# 建表/补列（幂等，可重复执行）
cd F:\pingce
node server/sql/run_migrate.js
```

迁移脚本按文件名顺序执行 `server/sql/*.sql`：`schema.sql`（基线）→ `004_*` → `005_community.sql`（社区帖子/评论/点赞/配置）→ `006_work_comments.sql`（作品评论）→ `007_activities.sql`（活动落库/预约/站内消息）。升级时拉取新 SQL 后重跑一次 `run_migrate.js` 即可；活动数据变更后另跑 `node server/sql/import_activities.js` 刷新入库。

## 每期更新作品

1. 编辑 `public/data/works.json`，修改 `works` 数组（每件作品 id/title/author/category/desc）
2. 改 `session` 字段（如「第 02 期」）和 `updatedAt` 日期
3. 保存即生效（前端下次刷新即拉到新数据，无需重启服务）

## 已知限制

- **不公网访问**：仅 LAN。需要公网请加内网穿透或部署到云。
- **并发量**：单 Node 进程，~百级并发没问题，**不适合数千并发**。
- **HTTPS**：当前 HTTP 内网环境，敏感信息靠 LAN 隔离。
- **报名后端凭证**：需要你单独创建飞书自建应用（5 分钟一次性操作），详见上文。
- **`public/admin.html` 为旧后台产物，已废弃**：站内无任何入口链接（已核实），文件暂时保留不再迭代。管理功能后续归并进「账号权限」体系（有管理权限的账号在个人中心获得专属入口）。
