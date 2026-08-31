// server/routes/admin.js
// 管理后台（登录 mock 对应）：作品列表 + 审核/发布。
// 当前登录为 mock，未做强鉴权；已预留 x-user-role 请求头作为身份标识口子，
// 后续接入真实登录鉴权只需补充中间件。

const express = require('express');
const { query } = require('../db');
const { ok, err, ErrorCodes } = require('../contract');

const router = express.Router();

const FIELDS = `id, kind, title, author, category, description, cover, source, session, status, published, created_at`;

// 简单身份判断（mock）：默认 admin，实际以后接入
function roleOf(req) {
  return (req.headers['x-user-role'] || 'admin').toLowerCase();
}

// GET /api/admin/works —— 全部作品（含待审核）
router.get('/works', async (req, res) => {
  const role = roleOf(req);
  try {
    let rows;
    if (role === 'admin') {
      const r = await query(`SELECT ${FIELDS} FROM works ORDER BY id`);
      rows = r.rows;
    } else {
      // 普通登录(会员)：只看已发布
      const r = await query(`SELECT ${FIELDS} FROM works WHERE published=true ORDER BY id`);
      rows = r.rows;
    }
    res.json(ok({ role, works: rows }));
  } catch (e) {
    console.error('[admin.works]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// PATCH /api/admin/works/:id —— 更新审核状态 / 发布
router.patch('/works/:id', async (req, res) => {
  const role = roleOf(req);
  if (role !== 'admin') {
    return res.status(403).json(err(ErrorCodes.PERMISSION, '仅管理员可操作'));
  }
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

// GET /api/admin/registrations —— 报名列表（管理员看全部；普通登录看自己的，mock 下全看）
router.get('/registrations', async (req, res) => {
  const role = roleOf(req);
  try {
    const r = await query(`SELECT id, name, department, contact, activity, will_share, share_topic, remark, status, created_at
      FROM registrations ORDER BY created_at DESC`);
    res.json(ok({ role, registrations: r.rows }));
  } catch (e) {
    console.error('[admin.registrations]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// PATCH /api/admin/registrations/:id —— 报名审核状态
router.patch('/registrations/:id', async (req, res) => {
  const role = roleOf(req);
  if (role !== 'admin') return res.status(403).json(err(ErrorCodes.PERMISSION, '仅管理员可操作'));
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

module.exports = router;
