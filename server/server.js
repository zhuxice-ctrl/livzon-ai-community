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

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { LarkClient } = require('./lark-client');

const PORT = parseInt(process.env.PORT || '8787', 10);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DATA_DIR = path.join(PUBLIC_DIR, 'data');

const app = express();
app.use(express.json({ limit: '64kb' }));

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

// 数据 API
app.get('/api/works', (req, res) => {
  const data = readData('works.json');
  if (!data) return res.status(404).json({ error: 'works.json not found' });
  res.json(data);
});

app.get('/api/activities', (req, res) => {
  const data = readData('activities.json');
  if (!data) return res.status(404).json({ error: 'activities.json not found' });
  res.json(data);
});

app.get('/api/schedule', (req, res) => {
  const data = readData('schedule.json');
  if (!data) return res.status(404).json({ error: 'schedule.json not found' });
  res.json(data);
});

// 报名
app.post('/api/register', async (req, res) => {
  const b = req.body || {};
  // 基础校验
  if (!b.name || !b.contact || !b.activity) {
    return res.status(400).json({
      ok: false,
      error: '缺少必填字段：姓名、联系方式、报名活动',
    });
  }
  if (!['AI 训练营', '技术沙龙', '项目实战', '内部分享'].includes(b.activity)) {
    return res.status(400).json({ ok: false, error: '报名活动取值非法' });
  }

  const result = await lark.addRegistration({
    name: String(b.name).trim().slice(0, 50),
    department: String(b.department || '').trim().slice(0, 100),
    contact: String(b.contact).trim().slice(0, 50),
    activity: b.activity,
    willShare: !!b.willShare,
    shareTopic: String(b.shareTopic || '').trim().slice(0, 200),
    remark: String(b.remark || '').trim().slice(0, 500),
  });

  if (!result.ok) {
    return res.status(502).json({ ok: false, error: result.error || '写入失败' });
  }

  res.json({
    ok: true,
    mode: result.mode,
    recordId: result.recordId,
    message: result.mode === 'lark'
      ? '报名成功，我们已收到您的报名信息'
      : '报名已暂存，管理员稍后会同步到名单',
  });
});

// ========= 数据报表 API =========
// 报名记录采集：飞书多维表格（若已配置且可读）+ 本地降级 JSONL 合并
async function collectRegistrations() {
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
    const works = readData('works.json');
    if (!works) return res.status(404).json({ ok: false, error: 'works.json not found' });
    const byCategory = {};
    const bySource = {};
    let withLink = 0;
    for (const w of (works.works || [])) {
      const cat = w.category || '未分类';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
      const src = (w.detail && w.detail.source) ? String(w.detail.source).split(' \u00b7 ')[0] : '未标注';
      bySource[src] = (bySource[src] || 0) + 1;
      if (w.detail && w.detail.link) withLink++;
    }
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
        total: (works.works || []).length,
        session: works.session || '',
        withLink,
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

app.listen(PORT, '0.0.0.0', () => {
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
