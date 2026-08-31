// server/routes/my.js
// 个人中心（登录后）：我的飞书账户 / 我的报名 / 我的作品
const express = require('express');
const { query } = require('../db');
const { ok, err, ErrorCodes } = require('../contract');
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

module.exports = router;
