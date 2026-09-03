// server/routes/activities.js
// 活动：公开读（DB 聚合，与原 activities.json 同构 → 前端零改动）+ 预约写（登录态身份）。
// 横切约定：contract 信封 / db 唯一数据入口 / validate 松紧校验 / middleware-auth 鉴权
// 数据流：activities.json --import_activities.js--> activities 表（data JSONB 原样存）；
//         顶层元字段（updatedAt/intro/motto/types）暂以 json 为准（后台管理活动编辑落地前）。
const express = require('express');
const fs = require('fs');
const path = require('path');
const { query } = require('../db');
const { ok, err, ErrorCodes } = require('../contract');
const { checkRules } = require('../validate');
const { authRequired } = require('../middleware/auth');
const { userSnapshot } = require('../lib/community-core');

const router = express.Router();
const DATA_PATH = path.join(__dirname, '..', '..', 'public', 'data', 'activities.json');

function readJsonMeta() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
    return {
      updatedAt: raw.updatedAt || '', intro: raw.intro || '', motto: raw.motto || '',
      types: raw.types || [], current: raw.current || [], upcoming: raw.upcoming || [], past: raw.past || [],
    };
  } catch (_) {
    return { updatedAt: '', intro: '', motto: '', types: [], current: [], upcoming: [], past: [] };
  }
}

// DB 聚合出与 json 同构的列表；DB 不可用/空表时回落 json（全仓优雅降级风格）
async function loadActivities() {
  try {
    const r = await query(`SELECT kind, data FROM activities ORDER BY kind, sort`);
    if (r.rows.length) {
      const meta = readJsonMeta();
      const groups = { current: [], upcoming: [], past: [] };
      for (const row of r.rows) {
        if (groups[row.kind]) groups[row.kind].push(row.data);
      }
      return { ...meta, ...groups, _source: 'db' };
    }
  } catch (e) {
    console.error('[activities.db]', e.message);
  }
  return { ...readJsonMeta(), _source: 'json' };
}

// GET /api/activities —— 列表（current/upcoming/past + types/motto 等顶层字段）
router.get('/', async (req, res) => {
  try {
    const data = await loadActivities();
    res.json(ok(data));
  } catch (e) {
    console.error('[activities.list]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// GET /api/activities/:id —— 单活动详情（供「查看回顾」/预约校验复用）
router.get('/:id', async (req, res) => {
  try {
    const data = await loadActivities();
    const all = [...data.current, ...data.upcoming, ...data.past];
    const item = all.find((x) => String(x.id) === String(req.params.id));
    if (!item) return res.status(404).json(err(ErrorCodes.NOT_FOUND, '活动不存在'));
    res.json(ok(item));
  } catch (e) {
    console.error('[activities.get]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// POST /api/activities/:id/reserve —— 预约（authRequired；身份=登录态，姓名/部门快照落库）
// body: { note? }  ≤500；UNIQUE(user_id,activity_id) 幂等：重复提交 200 repeated，不报错不累积
router.post('/:id/reserve', authRequired, async (req, res) => {
  const id = String(req.params.id || '').slice(0, 64);
  const rules = { note: { type: 'string', max: 500 } };
  const { valid, errors, casted } = checkRules(req.body || {}, rules);
  if (!valid) return res.status(400).json(err(ErrorCodes.VALIDATION, errors.join('；')));
  try {
    const a = await query(`SELECT id, kind, title FROM activities WHERE id=$1`, [id]);
    if (!a.rows.length) return res.status(404).json(err(ErrorCodes.NOT_FOUND, '活动不存在'));
    if (a.rows[0].kind !== 'upcoming') {
      return res.status(400).json(err(ErrorCodes.VALIDATION, '该活动不接受预约（已结束或为本期特展）'));
    }
    const snap = await userSnapshot(req);
    const r = await query(
      `INSERT INTO activity_reservations (activity_id, user_id, name, dept, note)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, activity_id) DO NOTHING RETURNING id`,
      [id, req.session.userId, snap.name, snap.dept, casted.note || '']);
    if (!r.rows.length) {
      return res.json(ok({ reserved: true, repeated: true, message: '您已预约过该活动' }));
    }
    // 预约确认 → 站内消息中心（飞书单聊通知 Phase 2 账号打通后启用，push-api.md §7）
    await query(
      `INSERT INTO notifications (user_id, type, title, body, link) VALUES ($1,'reserve',$2,$3,'#activities')`,
      [req.session.userId, '已收到您的预约', `活动「${a.rows[0].title}」预约成功，开始前将通过飞书通知您。`]);
    res.status(201).json(ok({ reserved: true, repeated: false, message: '预约成功' }));
  } catch (e) {
    console.error('[activities.reserve]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

module.exports = router;
