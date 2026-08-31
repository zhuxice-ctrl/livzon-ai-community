// server/routes/artifact.js
// 作品资源/制品：上传（mock 登记元数据）、列表、下载计数、详情
// 真实对象存储后接：storage_url 现为占位，上传当前 mock（只登记记录）
const express = require('express');
const { query } = require('../db');
const { ok, err, ErrorCodes } = require('../contract');
const { checkRules } = require('../validate');

const router = express.Router();

const KINDS = ['video', 'miniprogram', 'skill', 'mcp', 'source', 'file'];

// POST /api/artifacts —— 登记/上传一个制品（mock：仅写元数据）
router.post('/', async (req, res) => {
  const rules = {
    workId:   { required: true, type: 'number' },
    kind:     { required: true, type: 'string', enum: KINDS },
    filename: { type: 'string', max: 255 },
    version:  { type: 'string', max: 40 },
    size:     { type: 'number' },
    storageUrl: { type: 'string', max: 1000 },
    guide:    { type: 'string', max: 4000 },
    checksum: { type: 'string', max: 128 },
  };
  const { valid, errors, casted } = checkRules(req.body || {}, rules);
  if (!valid) return res.status(400).json(err(ErrorCodes.VALIDATION, errors.join('；')));

  try {
    const w = await query(`SELECT id FROM works WHERE id=$1`, [casted.workId]);
    if (!w.rows.length) return res.status(404).json(err(ErrorCodes.NOT_FOUND, '作品不存在'));

    const storageUrl = casted.storageUrl || '';
    const size = casted.size || 0;
    // mock：无真实文件上传时，用占位 storage_url 标识待接
    const mockUrl = storageUrl || `placeholder://works/${casted.workId}/${casted.filename || 'file'}`;

    const r = await query(
      `INSERT INTO artifacts (work_id, kind, filename, version, size, storage_url, checksum, guide)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, work_id, kind, filename, version, size, storage_url, guide, created_at`,
      [casted.workId, casted.kind, casted.filename || '', casted.version || 'v1', size,
       mockUrl, casted.checksum || '', casted.guide || '']
    );
    res.status(201).json(ok(r.rows[0]));
  } catch (e) {
    console.error('[artifact.post]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// GET /api/artifacts?work_id= —— 某作品的资源列表
router.get('/', async (req, res) => {
  const workId = Number(req.query.work_id);
  if (Number.isNaN(workId)) return res.status(400).json(err(ErrorCodes.VALIDATION, 'work_id 非法'));
  try {
    const r = await query(`SELECT id, kind, filename, version, size, storage_url, checksum, guide, downloads, created_at
      FROM artifacts WHERE work_id=$1 ORDER BY created_at DESC`, [workId]);
    res.json(ok({ artifacts: r.rows }));
  } catch (e) {
    console.error('[artifact.list]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// GET /api/artifacts/:id —— 单个资源详情（含下载入口）
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json(err(ErrorCodes.VALIDATION, 'id 非法'));
  try {
    const r = await query(`SELECT * FROM artifacts WHERE id=$1`, [id]);
    if (!r.rows.length) return res.status(404).json(err(ErrorCodes.NOT_FOUND, '资源不存在'));
    res.json(ok(r.rows[0]));
  } catch (e) {
    console.error('[artifact.one]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// PATCH /api/artifacts/:id/download —— 下载计数 + 返回下载地址
router.patch('/:id/download', async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json(err(ErrorCodes.VALIDATION, 'id 非法'));
  try {
    const r = await query(`UPDATE artifacts SET downloads=downloads+1 WHERE id=$1 RETURNING id, storage_url, downloads, version`, [id]);
    if (!r.rows.length) return res.status(404).json(err(ErrorCodes.NOT_FOUND, '资源不存在'));
    res.json(ok(r.rows[0]));
  } catch (e) {
    console.error('[artifact.dl]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

module.exports = router;
