// server/routes/works.js
// 作品路由：公开读 + 上传写（真写库）
const express = require('express');
const { query } = require('../db');
const { ok, err, ErrorCodes } = require('../contract');
const { checkRules } = require('../validate');

const router = express.Router();

// 列字段（不含详情大对象，减少传输；详情单查时带出）
const LIST_FIELDS = `id, kind, title, author, category, description, cover, source, session, status, published, created_at`;

// POST /api/works —— 上传新作品（严格校验，真写库）
router.post('/', async (req, res) => {
  const rules = {
    title:        { required: true, type: 'string', max: 100 },
    author:       { required: true, type: 'string', max: 60 },
    kind:         { required: true, type: 'string', enum: ['image','video','3d','tool','app','skill','mcp','source'] },
    category:     { type: 'string', max: 40 },
    description:  { type: 'string', max: 2000 },
    cover:        { type: 'string', max: 300 },
    source:       { type: 'string', max: 200 },
    link:         { type: 'string', max: 1000 },
    detail:       { type: 'object' },
  };
  const { valid, errors, casted } = checkRules(req.body || {}, rules);
  if (!valid) return res.status(400).json(err(ErrorCodes.VALIDATION, errors.join('；')));

  const detail = {
    ...(casted.detail || {}),
    link: casted.link || '',
    source: casted.source || '',
  };
  delete casted.link;

  try {
    const r = await query(
      `INSERT INTO works (kind, title, author, category, description, cover, source, detail, status, published, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',false,$9)
       RETURNING ${LIST_FIELDS}`,
      [
        casted.kind,
        casted.title,
        casted.author,
        casted.category || '',
        casted.description || '',
        casted.cover || '',
        casted.source || '',
        JSON.stringify(detail),
        casted.author,
      ]
    );
    res.status(201).json(ok(r.rows[0]));
  } catch (e) {
    console.error('[works.post]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// GET /api/works —— 公开作品列表（审核通过且公开）
router.get('/', async (req, res) => {
  try {
    const r = await query(
      `SELECT ${LIST_FIELDS} FROM works WHERE status='approved' AND published=true ORDER BY id`
    );
    res.json(ok({ works: r.rows }));
  } catch (e) {
    console.error('[works.get]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// GET /api/works/:id —— 单件作品（含 detail）
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json(err(ErrorCodes.VALIDATION, 'id 非法'));
  try {
    const r = await query(`SELECT * FROM works WHERE id=$1`, [id]);
    if (!r.rows.length) return res.status(404).json(err(ErrorCodes.NOT_FOUND, '作品不存在'));
    res.json(ok(r.rows[0]));
  } catch (e) {
    console.error('[works.one]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

module.exports = router;
