// server/routes/work-comments.js
// 作品评论：列表 / 发评论（无限层级）/ 点赞 / 软删。契约风格对齐社区帖子评论。
// 横切约定：contract 信封 / db 唯一数据入口 / validate 松紧校验 / middleware-auth 鉴权
// 复用 lib/community-core 的 genId/fmtTime/userSnapshot/likeToggleSQL。
const express = require('express');
const { query } = require('../db');
const { ok, err, ErrorCodes } = require('../contract');
const { checkRules } = require('../validate');
const { authRequired } = require('../middleware/auth');
const { genId, fmtTime, userSnapshot, likeToggleSQL } = require('../lib/community-core');

const router = express.Router();

// GET /api/work-comments?work_id=N —— 某作品的扁平全层级评论（前端组树）。无鉴权
router.get('/', async (req, res) => {
  const workId = Number(req.query.work_id);
  if (Number.isNaN(workId)) return res.status(400).json(err(ErrorCodes.VALIDATION, 'work_id 非法'));
  const me = (req.session && req.session.userId) || null;
  try {
    const r = await query(
      `SELECT c.*, EXISTS(SELECT 1 FROM work_comment_likes cl WHERE cl.comment_id = c.id AND cl.user_id = $2) AS liked
       FROM work_comments c
       WHERE c.work_id = $1 AND c.deleted = FALSE
       ORDER BY c.created_at ASC, c.id ASC LIMIT 500`,
      [workId, me]);
    const comments = r.rows.map((c) => ({
      id: c.id, work_id: c.work_id, parent_id: c.parent_id || null,
      author: c.author, dept: c.dept || '', text: c.text,
      time: fmtTime(c.created_at), likes: c.likes | 0, liked: !!c.liked,
    }));
    res.json(ok({ comments }));
  } catch (e) {
    console.error('[work-comments.get]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// POST /api/work-comments —— 发评论/回复（要求登录；parent 不限层级）
// body: { work_id, content, parent_id? }
router.post('/', authRequired, async (req, res) => {
  const rules = {
    work_id:   { required: true, type: 'number' },
    content:   { required: true, type: 'string', max: 500 },
    parent_id: { type: 'string', max: 64 },
  };
  const { valid, errors, casted } = checkRules(req.body || {}, rules);
  if (!valid) return res.status(400).json(err(ErrorCodes.VALIDATION, errors.join('；')));
  try {
    const w = await query('SELECT id FROM works WHERE id=$1 AND published=true', [casted.work_id]);
    if (!w.rows.length) return res.status(404).json(err(ErrorCodes.NOT_FOUND, '作品不存在或未发布'));
    if (casted.parent_id) {
      const par = await query('SELECT id FROM work_comments WHERE id=$1 AND work_id=$2 AND deleted=FALSE',
        [casted.parent_id, casted.work_id]);
      if (!par.rows.length) return res.status(400).json(err(ErrorCodes.VALIDATION, '回复的评论不存在'));
    }
    const snap = await userSnapshot(req);
    const id = genId('wc');
    const r = await query(
      `INSERT INTO work_comments (id, work_id, parent_id, user_id, author, dept, text, likes, deleted, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,0,FALSE,now()) RETURNING *`,
      [id, casted.work_id, casted.parent_id || null, req.session.userId, snap.name, snap.dept, casted.content]);
    const c = r.rows[0];
    res.status(201).json(ok({ comment: {
      id: c.id, work_id: c.work_id, parent_id: c.parent_id || null,
      author: c.author, dept: c.dept || '', text: c.text,
      time: fmtTime(c.created_at), likes: 0,
    } }));
  } catch (e) {
    console.error('[work-comments.post]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// POST /api/work-comments/:id/like —— 点赞 toggle（要求登录）
router.post('/:id/like', authRequired, async (req, res) => {
  try {
    const c = await query('SELECT id FROM work_comments WHERE id=$1 AND deleted=FALSE', [String(req.params.id)]);
    if (!c.rows.length) return res.status(404).json(err(ErrorCodes.NOT_FOUND, '评论不存在'));
    const r = await query(likeToggleSQL('work_comment_likes', 'comment_id', 'work_comments'),
      [String(req.params.id), req.session.userId]);
    res.json(ok({ likes: r.rows[0].likes, liked: !!r.rows[0].liked }));
  } catch (e) {
    console.error('[work-comments.like]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// DELETE /api/work-comments/:id —— 软删（本人或管理员）
router.delete('/:id', authRequired, async (req, res) => {
  const me = req.session.userId;
  const isAdmin = req.session.role === 'admin';
  try {
    const r = await query('SELECT user_id FROM work_comments WHERE id=$1 AND deleted=FALSE', [String(req.params.id)]);
    if (!r.rows.length) return res.status(404).json(err(ErrorCodes.NOT_FOUND, '评论不存在'));
    if (!isAdmin && r.rows[0].user_id !== me) return res.status(403).json(err(ErrorCodes.PERMISSION, '只能删除自己的评论'));
    await query('UPDATE work_comments SET deleted=TRUE WHERE id=$1', [String(req.params.id)]);
    res.json(ok({}));
  } catch (e) {
    console.error('[work-comments.delete]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

module.exports = router;
