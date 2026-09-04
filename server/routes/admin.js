// server/routes/admin.js
// 管理后台：作品审核/发布、报名审核、社区置顶与配置。
// 身份：session role='admin' 为权威；非生产环境兼容 admin.html 旧的 x-user-role 头（内网调试过渡）。
// 读接口对登录用户开放（member 只读）；写接口一律 adminRequired 强校验。

const express = require('express');
const { query } = require('../db');
const { ok, err, ErrorCodes } = require('../contract');
const { adminRequired } = require('../middleware/auth');
const community = require('./community');
const { LarkClient } = require('../lark-client');
const { runReminders } = require('../lib/reminders');

const router = express.Router();
const lark = new LarkClient(process.env);

const FIELDS = `id, kind, title, author, category, description, cover, source, session, status, published, created_at`;

// 读取视图用的角色：session 优先，开发态回退旧头（不影响写接口的强校验）
function viewRole(req) {
  if (req.session && req.session.role === 'admin') return 'admin';
  if (process.env.NODE_ENV !== 'production') {
    return String(req.headers['x-user-role'] || 'admin').toLowerCase();
  }
  return (req.session && req.session.role) || 'member';
}

// GET /api/admin/works —— 作品列表（admin 看全部；member 只看已发布）
router.get('/works', async (req, res) => {
  const role = viewRole(req);
  try {
    let rows;
    if (role === 'admin') {
      const r = await query(`SELECT ${FIELDS} FROM works ORDER BY id`);
      rows = r.rows;
    } else {
      const r = await query(`SELECT ${FIELDS} FROM works WHERE published=true ORDER BY id`);
      rows = r.rows;
    }
    res.json(ok({ role, works: rows }));
  } catch (e) {
    console.error('[admin.works]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// PATCH /api/admin/works/:id —— 更新审核状态 / 发布（仅管理员）
router.patch('/works/:id', adminRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json(err(ErrorCodes.VALIDATION, 'id 非法'));

  const { status, published } = req.body || {};
  if (status && !['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json(err(ErrorCodes.VALIDATION, 'status 取值非法'));
  }
  if (published != null && typeof published !== 'boolean') {
    return res.status(400).json(err(ErrorCodes.VALIDATION, 'published 应为布尔'));
  }

  const sets = [];
  const vals = [id];
  if (status) { vals.push(status); sets.push(`status=$${vals.length}`); }
  if (published != null) { vals.push(published); sets.push(`published=$${vals.length}`); }
  if (!sets.length) return res.status(400).json(err(ErrorCodes.VALIDATION, '无可更新字段'));

  vals.push(new Date().toISOString());
  sets.push(`updated_at=$${vals.length}`);

  try {
    const r = await query(`UPDATE works SET ${sets.join(', ')} WHERE id=$1 RETURNING ${FIELDS}`, vals);
    if (!r.rows.length) return res.status(404).json(err(ErrorCodes.NOT_FOUND, '作品不存在'));
    res.json(ok(r.rows[0]));
  } catch (e) {
    console.error('[admin.patch]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// ===== 报名管理 =====

// GET /api/admin/registrations —— 报名列表
router.get('/registrations', async (req, res) => {
  const role = viewRole(req);
  try {
    const r = await query(`SELECT id, name, department, contact, activity, will_share, share_topic, remark, status, created_at
      FROM registrations ORDER BY created_at DESC`);
    res.json(ok({ role, registrations: r.rows }));
  } catch (e) {
    console.error('[admin.registrations]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// PATCH /api/admin/registrations/:id —— 报名审核状态（仅管理员）
router.patch('/registrations/:id', adminRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json(err(ErrorCodes.VALIDATION, 'id 非法'));
  const { status } = req.body || {};
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json(err(ErrorCodes.VALIDATION, 'status 取值非法'));
  }
  try {
    const r = await query(`UPDATE registrations SET status=$1, updated_at=now() WHERE id=$2 RETURNING id, status`, [status, id]);
    if (!r.rows.length) return res.status(404).json(err(ErrorCodes.NOT_FOUND, '报名不存在'));
    res.json(ok(r.rows[0]));
  } catch (e) {
    console.error('[admin.reg-patch]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// ===== 活动预约管理 =====

// GET /api/admin/activities/reservations —— 预约名单（按活动分组，含参与期待）
router.get('/activities/reservations', adminRequired, async (req, res) => {
  try {
    const r = await query(
      `SELECT r.id, r.activity_id, a.title, r.user_id, r.name, r.dept, r.note, r.created_at
       FROM activity_reservations r JOIN activities a ON a.id = r.activity_id
       ORDER BY a.kind, a.sort, r.created_at`);
    const groups = new Map();
    for (const row of r.rows) {
      if (!groups.has(row.activity_id)) {
        groups.set(row.activity_id, { activityId: row.activity_id, title: row.title, total: 0, reservations: [] });
      }
      const g = groups.get(row.activity_id);
      g.total++;
      g.reservations.push({ id: row.id, userId: row.user_id, name: row.name, dept: row.dept, note: row.note, createdAt: row.created_at });
    }
    res.json(ok({ activities: [...groups.values()] }));
  } catch (e) {
    console.error('[admin.reservations]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// POST /api/admin/activities/scan-reminders —— 手动跑一轮提醒扫描（测试/应急）
// body: { aheadHours? }（默认读 REMIND_AHEAD_HOURS=24；测试时可放大窗口验证逻辑，重复预约已被去重表拦截）
router.post('/activities/scan-reminders', adminRequired, async (req, res) => {
  const ahead = Number((req.body || {}).aheadHours) || parseInt(process.env.REMIND_AHEAD_HOURS || '24', 10);
  try {
    const events = [];
    const r = await runReminders(lark, { aheadHours: ahead, notify: (tag, msg) => events.push(tag + ': ' + msg) });
    res.json(ok({ ...r, aheadHours: ahead, events }));
  } catch (e) {
    console.error('[admin.scan-reminders]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// ===== 社区管理（契约：posts-api.md）=====

// POST /api/admin/community/posts/:id/pin —— 置顶/取消 + 归类（复用 community 处理器）
router.post('/community/posts/:id/pin', adminRequired, community.pinHandler);

// PUT /api/admin/community/config —— 公告/轮播/分区运营
router.put('/community/config', adminRequired, community.configPutHandler);

module.exports = router;
