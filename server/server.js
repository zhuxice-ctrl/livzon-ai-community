// server/server.js
// 丽珠 AI 社团官网后端
// - 静态文件服务（public/）
// - GET  /api/works       作品列表
// - GET  /api/activities  活动列表
// - GET  /api/schedule    进度
// - POST /api/register    报名提交（写飞书多维表格）
// - GET  /api/health      健康检查
// - GET  /api/info        服务元信息（IP/端口/状态）
// - GET  /api/report      数据报表（作品/报名聚合统计）
// - GET  /api/report/csv  报名明细 CSV 导出

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { LarkClient } = require('./lark-client');
const session = require('express-session');
const worksRouter = require('./routes/works');
const adminRouter = require('./routes/admin');
const registerRouter = require('./routes/register');
const voteRouter = require('./routes/vote');
const artifactRouter = require('./routes/artifact');
const authRouter = require('./routes/auth');
const myRouter = require('./routes/my');
const communityRouter = require('./routes/community');
const workCommentsRouter = require('./routes/work-comments');
const activitiesRouter = require('./routes/activities');

const PORT = parseInt(process.env.PORT || '8787', 10);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DATA_DIR = path.join(PUBLIC_DIR, 'data');

const app = express();
app.use(express.json({ limit: '64kb' }));

// Session（登录态）
app.use(session({
  secret: process.env.SESSION_SECRET || 'pingce-dev-secret-' + (process.env.LARK_APP_ID || ''),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7 }, // 7 天
}));

// CORS（允许同 LAN 内任意来源）
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// 简单访问日志
app.use((req, res, next) => {
  const ts = new Date().toISOString().split('T')[1].split('.')[0];
  console.log(`[${ts}] ${req.method} ${req.url}`);
  next();
});

// 静态文件
app.use(express.static(PUBLIC_DIR, {
  etag: true,
  maxAge: 0,
  index: 'index.html',
}));

// 工具：读 JSON 数据
function readData(name) {
  const p = path.join(DATA_DIR, name);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// 服务元信息
app.get('/api/info', (req, res) => {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push({ name, ip: net.address });
      }
    }
  }
  res.json({
    service: 'livzon-ai-club',
    version: '1.0.0',
    port: PORT,
    ips,
    larkConfigured: lark.isConfigured(),
    fallbackEnabled: lark.fallbackEnabled,
  });
});

// 数据 API —— works 从 PG 读，保持旧前端兼容的平铺结构 { session, works: [] }
app.get('/api/works', async (req, res) => {
  try {
    const { query } = require('./db');
    const r = await query(
      `SELECT id, kind, title, author, category, description AS desc, cover, source, session, detail, status, published
       FROM works WHERE status='approved' AND published=true ORDER BY id`
    );
    const sessName = r.rows.length ? r.rows[0].session : '第 01 期';
    res.json({ session: sessName, updatedAt: new Date().toISOString().slice(0, 10), intro: '', works: r.rows });
  } catch (e) {
    console.error('[works.get]', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 作品上传（真写库，走契约信封）
app.use('/api/works', worksRouter);

// 社团社区（帖子流/评论/点赞/上传/config，契约见 docs/api/posts-api.md）
app.use('/api/community', communityRouter);

// 作品评论（独立于社区帖子，挂在 /api/work-comments 避免与 /api/works 冲突）
app.use('/api/work-comments', workCommentsRouter);

// 契约路径别名：DELETE /api/comments/:id（社区评论软删，复用同一处理器）
const commentsAlias = express.Router();
commentsAlias.delete('/:id', ...communityRouter.deleteComment);
app.use('/api/comments', commentsAlias);

// 飞书 SSO 登录
app.use('/api/auth', authRouter);

// 个人中心（我的）
app.use('/api/my', myRouter);

// 管理后台（作品审核/发布）
app.use('/api/admin', adminRouter);

// 投票
app.use('/api/vote', voteRouter);

// 作品资源/制品
app.use('/api/artifacts', artifactRouter);

// 活动（列表/详情 DB 同构读 + 预约写，契约见 routes/activities.js）
app.use('/api/activities', activitiesRouter);

app.get('/api/schedule', (req, res) => {
  const data = readData('schedule.json');
  if (!data) return res.status(404).json({ error: 'schedule.json not found' });
  res.json(data);
});

// 报名（POST /api/register → PG 第一落点，含降级）
app.use('/api/register', registerRouter);

// ========= 数据报表 API =========
// 报名记录采集：优先从 PostgreSQL registrations 表读取；未配置/失败时降级到飞书+JSONL
async function collectRegistrations() {
  const { query } = require('./db');
  try {
    const r = await query(`SELECT name, department, contact, activity, will_share, share_topic, remark, status, created_at AS ts
      FROM registrations ORDER BY created_at DESC`);
    const records = r.rows.map(x => ({
      name: x.name,
      department: x.department,
      contact: x.contact,
      activity: x.activity,
      willShare: !!x.will_share,
      shareTopic: x.share_topic || '',
      ts: x.ts,
      origin: 'pg',
      status: x.status,
    }));
    return { records, mode: 'pg' };
  } catch (e) {
    console.error('[collectRegistrations.pg]', e.message);
  }
  // ---- 降级：飞书 + JSONL ----
  const records = [];
  let mode = 'fallback';
  if (lark.isConfigured()) {
    const r = await lark.listRegistrations();
    if (r.ok) {
      records.push(...r.records);
      mode = 'lark';
    }
  }
  const fp = lark.fallbackPath;
  if (fs.existsSync(fp)) {
    const lines = fs.readFileSync(fp, 'utf-8').split('\n').filter(Boolean);
    let hasFallback = false;
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        records.push({
          name: obj.formData && obj.formData.name,
          department: obj.formData && obj.formData.department,
          contact: obj.formData && obj.formData.contact,
          activity: obj.formData && obj.formData.activity,
          willShare: !!(obj.formData && obj.formData.willShare),
          shareTopic: (obj.formData && obj.formData.shareTopic) || '',
          ts: obj.ts,
          origin: 'fallback',
        });
        hasFallback = true;
      } catch (_) { /* 跳过损坏行 */ }
    }
    if (hasFallback) mode = (mode === 'lark') ? 'mixed' : 'fallback';
  }
  records.sort((a, b) => new Date(b.ts || 0) - new Date(a.ts || 0));
  return { records, mode };
}

function maskContact(s) {
  s = String(s || '');
  if (s.length <= 4) return '****';
  return s.slice(0, 2) + '****' + s.slice(-2);
}

app.get('/api/report', async (req, res) => {
  try {
    // 作品统计：从 PostgreSQL works 表（本地数据库）
    const { query } = require('./db');
    const w = await query(`SELECT category, source, session, detail
      FROM works WHERE status='approved'`);
    const byCategory = {};
    const bySource = {};
    let withLink = 0;
    for (const r of w.rows) {
      const cat = r.category || '未分类';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
      const src = r.source ? String(r.source).split(' \u00b7 ')[0] : '未标注';
      bySource[src] = (bySource[src] || 0) + 1;
      if (r.detail && r.detail.link) withLink++;
    }
    const worksTotal = w.rows.length;
    const works = { total: worksTotal, session: w.rows[0] ? w.rows[0].session : '', withLink, byCategory, bySource };
    // 以下 registrations 统计保留原逻辑（报名通道后续轮次切 PG，暂留 TODO）
    const { records, mode } = await collectRegistrations();
    const byActivity = {};
    let willShare = 0;
    for (const r of records) {
      const act = r.activity || '未知';
      byActivity[act] = (byActivity[act] || 0) + 1;
      if (r.willShare) willShare++;
    }
    const recent = records.slice(0, 30).map(r => ({
      ts: r.ts,
      name: r.name,
      department: r.department,
      activity: r.activity,
      willShare: !!r.willShare,
      shareTopic: r.shareTopic || '',
      contactMasked: maskContact(r.contact),
    }));
    res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      works: {
        total: works.total,
        session: works.session || '',
        withLink: works.withLink,
        byCategory,
        bySource,
      },
      registrations: {
        total: records.length,
        willShare,
        byActivity,
        mode,
        recent,
      },
    });
  } catch (e) {
    console.error('[REPORT]', e);
    res.status(500).json({ ok: false, error: '报表生成失败' });
  }
});

app.get('/api/report/csv', async (req, res) => {
  try {
    const { records } = await collectRegistrations();
    const header = ['报名时间', '姓名', '部门', '联系方式', '报名活动', '愿意分享', '分享方向', '记录来源'];
    const rows = records.map(r => [
      r.ts || '',
      r.name || '',
      r.department || '',
      r.contact || '',
      r.activity || '',
      r.willShare ? '是' : '否',
      r.shareTopic || '',
      r.origin === 'fallback' ? '本地暂存' : '飞书多维表格',
    ]);
    const esc = v => '"' + String(v).replace(/"/g, '""') + '"';
    const csv = '\uFEFF' + [header].concat(rows).map(rw => rw.map(esc).join(',')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="registrations.csv"');
    res.send(csv);
  } catch (e) {
    console.error('[REPORT-CSV]', e);
    res.status(500).json({ ok: false, error: 'CSV 导出失败' });
  }
});

// 兜底 404
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ ok: false, error: 'API 不存在' });
  }
  res.status(404).send('404 Not Found');
});

// 错误处理
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ ok: false, error: '服务内部错误' });
});

const lark = new LarkClient(process.env);

// ===== 活动开始提醒定时任务（node-cron；REMINDERS_ENABLED=0 关闭）=====
function startReminderScheduler() {
  if (process.env.REMINDERS_ENABLED === '0') { console.log('[reminders] 已禁用 (REMINDERS_ENABLED=0)'); return; }
  let cron;
  try { cron = require('node-cron'); }
  catch (_) { console.log('[reminders] node-cron 未安装，提醒任务未启用（npm i node-cron 后重启）'); return; }
  const { runReminders } = require('./lib/reminders');
  const expr = process.env.REMINDER_CRON || '0 * * * *';       // 默认每小时整点扫一次
  const ahead = parseInt(process.env.REMIND_AHEAD_HOURS || '24', 10);
  cron.schedule(expr, async () => {
    const notify = (tag, msg) => console.log(`[reminders:${tag}]`, msg);
    try {
      const r = await runReminders(lark, { aheadHours: ahead, notify });
      if (r.scanned) notify('run', JSON.stringify(r));
    } catch (e) { notify('error', e.message); }
  });
  console.log(`[reminders] 已启用：cron='${expr}' 提前 ${ahead}h`);
}

app.listen(PORT, '0.0.0.0', () => {
  startReminderScheduler();
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  console.log('=========================================');
  console.log(` 丽珠 AI 社团官网服务已启动`);
  console.log(` 端口: ${PORT}`);
  console.log(` 飞书配置: ${lark.isConfigured() ? '已配置' : '未配置（仅本地降级）'}`);
  console.log(` 降级开关: ${lark.fallbackEnabled ? '开启' : '关闭'}`);
  console.log(' 内网访问地址:');
  for (const ip of ips) {
    console.log(`   http://${ip}:${PORT}/`);
  }
  console.log('  本机回环: http://127.0.0.1:' + PORT + '/');
  console.log('=========================================');
});
