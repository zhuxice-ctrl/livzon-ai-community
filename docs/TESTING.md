# 测试环境全链路验收报告

> 环境：本机 `node start.mjs`（LAN:8787）+ 本地 PostgreSQL(`pingce`) + 飞书**测试企业**自建应用（`测试it服务平台` cli_aa0ff9fd4ef85d1d）。
> 结论：**展示 / 报名 / 预约 / 记录 / 社区会话 / 消息通知 / 制品上传下载 / 登录持久性 八项全绿**，可进行正式应用部署。

| # | 能力 | 验证方式 | 结果 |
|---|---|---|---|
| 1 | 上线·展示 | LAN 起服务；作品巨幕/详情、活动大厅、社区信息流渲染；作品详情含「作品资源」下载区 | ✅ |
| 2 | 活动报名 | `POST /api/register`（UTF-8）→ registrations 落库 `recordId/status=pending` → 管理控制台报名审核通过 | ✅ |
| 3 | 活动预约 | `POST /api/activities/:id/reserve`：首次 201 / 重复幂等 200「您已预约过」/ past·current 400 / 未登录 401 | ✅ |
| 4 | 记录 | DB 计数核对：works 29 / posts 17 / comments 42 / registrations（种子 2）等基线一致 | ✅ |
| 5 | 社区会话 | 发帖 → 评论/回复（NL 式连贯轨道线）→ 帖子/评论点赞，端到端一致 | ✅ |
| 6 | 消息通知 | 站内铃铛未读角标 + 弹层真实数据；活动开始**飞书交互卡片**真实送达测试号（含「加入日程」.ics） | ✅ |
| 7 | 上传→下载 | 中文文件名 + 中文说明上传 → 作品详情正确显示 → 登录态下载字节完全一致 + downloads 计数 +1 | ✅ |
| 8 | 登录持久性 | session 落 PG（`sessions` 表）；服务多次重启后 `/api/auth/me` 仍认证、右上角仍「个人中心」 | ✅ |

## 制品上传下载 · 关键实现与坑

- 存储：`public/uploads/artifacts/<genId>.<ext>`，`express.static` 直供；`GET /api/artifacts/:id/download`（`authRequired`）流式回传 + 计数；外链 302 / 占位 410 诚实处理。
- **所有权**：`authRequired` + 作者（`works.user_id===session.userId`）或 `admin` 才可挂资源。
- **中文名编码坑（已解）**：multipart header 里的 `filename` 被 busboy 有损 UTF-8 解码（丢字节、不可逆）。解法=前端额外用**文本字段 `origname` 传 `file.name`**（文本字段无损），后端优先取它。社区上传同理修（`utf8Field` 兜底 latin1 还原）。
- 测试须知：Windows Git Bash 的 `curl -F/-d` 按 GBK 发送中文会触发枚举/编码报错——**这是 shell 编码问题非应用缺陷**，用 node fetch（UTF-8）或真实浏览器验证即通过。

## 正式部署前最终检查清单（切换到生产/正式租户时）

1. **正式租户飞书应用**：在丽珠正式企业租户重建自建应用，开 `authen`（登录）+ `im:message:send_as_bot`（提醒）+（可选）contact 部门读；配 `重定向URL`、加管理员 open_id；发版本审批通过。
2. **`.env`**：`LARK_APP_ID/SECRET` 换正式应用；`LARK_LOGIN_REDIRECT_URI` + `SITE_INTRANET_URL` 填**公司 WiFi 网段内网 IP**（当前为热点 IP，切网必改）；`SESSION_SECRET` 强随机；`NODE_ENV=production`；`ALLOW_DEV_LOGIN=0`。
3. **管理员名单**：正式环境把管理员工号 open_id 写入 `ADMIN_OPEN_IDS`，或 `node server/sql/seed_admin.js --promote <open_id>`。
4. **活动真实排期**：`activities.json` 的 `upcoming[].start_at` 由占位改为真实时间 → `node server/sql/import_activities.js`。
5. **数据库迁移**：部署环境按序跑 `node server/sql/run_migrate.js`（现含 007/008/009）。
6. **对象存储**（Phase E，可后续）：制品现本地磁盘，量大/持久化诉求再平替为对象存储（接口不变，改 `storage_url` 读写两处）。
7. **内网发布**：走基建「内网应用网站发布」流程登记地址（B3 待对齐）。
