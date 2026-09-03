// server/routes/my.js
// 个人中心（登录后）：我的飞书账户 / 我的报名 / 我的作品 / 我的等级 / 我的消息
const express = require('express');
const { query } = require('../db');
const { ok, err, ErrorCodes } = require('../contract');
const { checkRules } = require('../validate');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

// GET /api/my/profile —— 当前用户的飞书账户信息
router.get('/profile', async (req, res) => {
  try {
    const r = await query(`SELECT id, open_id, union_id, name, email, department, avatar, role, status, last_login_at
      FROM users WHERE id=$1`, [req.user.id]);
    if (!r.rows.length) return res.status(404).json(err(ErrorCodes.NOT_FOUND, '用户不存在'));
    res.json(ok(r.rows[0]));
  } catch (e) {
    console.error('[my.profile]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// GET /api/my/registrations —— 我的报名记录
router.get('/registrations', async (req, res) => {
  try {
    const r = await query(`SELECT id, name, department, contact, activity, will_share, share_topic, remark, status, created_at
      FROM registrations WHERE user_id=$1 ORDER BY created_at DESC`, [req.user.id]);
    res.json(ok({ registrations: r.rows }));
  } catch (e) {
    console.error('[my.registrations]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// GET /api/my/works —— 我的作品（含审核状态）
router.get('/works', async (req, res) => {
  try {
    const r = await query(`SELECT id, kind, title, author, category, cover, source, status, published, created_at, updated_at
      FROM works WHERE user_id=$1 ORDER BY created_at DESC`, [req.user.id]);
    res.json(ok({ works: r.rows }));
  } catch (e) {
    console.error('[my.works]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// GET /api/my/level —— 我的等级（积分 / LV / 升级进度 / 基础任务）
router.get('/level', async (req, res) => {
  try {
    const [reg, works, approved, votes] = await Promise.all([
      query(`SELECT count(*)::int AS c FROM registrations WHERE user_id=$1`, [req.user.id]),
      query(`SELECT count(*)::int AS c FROM works WHERE user_id=$1`, [req.user.id]),
      query(`SELECT count(*)::int AS c FROM works WHERE user_id=$1 AND status='approved'`, [req.user.id]),
      query(`SELECT count(*)::int AS c FROM votes WHERE user_id=$1`, [req.user.id]),
    ]);
    const nReg = reg.rows[0].c, nWorks = works.rows[0].c, nApproved = approved.rows[0].c, nVotes = votes.rows[0].c;
    const points = nReg * 10 + nWorks * 20 + nApproved * 30 + nVotes * 5;
    const lv = computeLevel(points);
    const tasks = [
      { key: 'reg', label: '完成一次活动报名', points: 10, done: nReg > 0 },
      { key: 'work', label: '上传一件作品', points: 20, done: nWorks > 0 },
      { key: 'approve', label: '作品通过审核', points: 30, done: nApproved > 0 },
      { key: 'vote', label: '参与一次投票', points: 5, done: nVotes > 0 },
    ];
    res.json(ok({
      points, level: lv.level, levelName: lv.levelName,
      levelMin: lv.levelMin, nextLevelMin: lv.nextLevelMin, progress: lv.progress,
      tasks: tasks,
      breakdown: { registrations: nReg, works: nWorks, approved: nApproved, votes: nVotes },
    }));
  } catch (e) {
    console.error('[my.level]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// GET /api/my/messages —— 站内消息（最新 30 条）+ 未读数（顶栏铃铛角标用）
router.get('/messages', async (req, res) => {
  try {
    const [list, unread] = await Promise.all([
      query(`SELECT id, type, title, body, link, read, created_at
             FROM notifications WHERE user_id=$1 ORDER BY created_at DESC, id DESC LIMIT 30`, [req.user.id]),
      query(`SELECT count(*)::int AS c FROM notifications WHERE user_id=$1 AND read=FALSE`, [req.user.id]),
    ]);
    res.json(ok({ messages: list.rows, unread: unread.rows[0].c }));
  } catch (e) {
    console.error('[my.messages]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// POST /api/my/messages/read —— 标记已读：body {id?} 单条；缺省全部
router.post('/messages/read', async (req, res) => {
  const rules = { id: { type: 'number' } };
  const { valid, errors, casted } = checkRules(req.body || {}, rules);
  if (!valid) return res.status(400).json(err(ErrorCodes.VALIDATION, errors.join('；')));
  try {
    const r = casted.id != null
      ? await query(`UPDATE notifications SET read=TRUE WHERE id=$1 AND user_id=$2`, [casted.id, req.user.id])
      : await query(`UPDATE notifications SET read=TRUE WHERE user_id=$1 AND read=FALSE`, [req.user.id]);
    res.json(ok({ updated: r.rowCount }));
  } catch (e) {
    console.error('[my.messages.read]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// 等级阈值（累计积分）：达到阈值即升级
const LEVELS = [
  { level: 1, min: 0, name: '新星社员' },
  { level: 2, min: 50, name: '活跃社员' },
  { level: 3, min: 150, name: '进阶创作者' },
  { level: 4, min: 300, name: '资深创作者' },
  { level: 5, min: 500, name: '社团先锋' },
  { level: 6, min: 800, name: '创新领航员' },
  { level: 7, min: 1200, name: 'AI 大师' },
];

function computeLevel(points) {
  let cur = LEVELS[0];
  let next = LEVELS[1] || null;
  for (let i = 0; i < LEVELS.length; i++) {
    if (points >= LEVELS[i].min) { cur = LEVELS[i]; next = LEVELS[i + 1] || null; }
  }
  let progress = 100;
  if (next) {
    const span = next.min - cur.min;
    progress = Math.min(100, Math.round(((points - cur.min) / span) * 100));
  }
  return { level: cur.level, levelName: cur.name, levelMin: cur.min, nextLevelMin: next ? next.min : null, progress };
}

module.exports = router;
