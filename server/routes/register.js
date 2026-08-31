// server/routes/register.js
// 报名：公开提交，第一落点 PostgreSQL（真写库）
// 降级：PG 失败时回退到飞书/JSONL（保留原 lark-client 通道），保证不丢报名
const express = require('express');
const fs = require('fs');
const path = require('path');
const { query } = require('../db');
const { ok, err, ErrorCodes } = require('../contract');
const { checkRules } = require('../validate');

const router = express.Router();

// 降级落点：与原有 JSONL 一致
const FALLBACK_PATH = path.join(__dirname, '..', '..', 'logs', 'registration_fallback.jsonl');

// 允许的报名活动（与原有页面保持一致）
const ACTIVITIES = ['AI 训练营', '技术沙龙', '项目实战', '内部分享'];

// POST /api/register —— 报名提交（严格校验，写 PG）
router.post('/', async (req, res) => {
  const rules = {
    name:       { required: true, type: 'string', max: 50 },
    contact:    { required: true, type: 'string', max: 50 },
    activity:   { required: true, type: 'string', enum: ACTIVITIES },
    department: { type: 'string', max: 100 },
    willShare:  { type: 'boolean' },
    shareTopic: { type: 'string', max: 200 },
    remark:     { type: 'string', max: 500 },
  };
  const { valid, errors, casted } = checkRules(req.body || {}, rules);
  if (!valid) return res.status(400).json(err(ErrorCodes.VALIDATION, errors.join('；')));

  const activity = casted.activity;
  const willShare = !!casted.willShare;

  try {
    const r = await query(
      `INSERT INTO registrations (name, department, contact, activity, will_share, share_topic, remark)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, status, created_at`,
      [
        casted.name, casted.department || '', casted.contact, activity,
        willShare, casted.shareTopic || '', casted.remark || '',
      ]
    );
    res.status(201).json(ok({
      recordId: r.rows[0].id,
      status: r.rows[0].status,
      createdAt: r.rows[0].created_at,
    }, { message: '报名成功，我们已收到您的报名信息' }));
  } catch (e) {
    // PG 失败 → 降级写到 JSONL（不丢数据）
    console.error('[register.pg-fallback]', e.message);
    try {
      appendFallback({
        name: casted.name, department: casted.department || '', contact: casted.contact,
        activity, willShare, shareTopic: casted.shareTopic || '', remark: casted.remark || '',
      });
      return res.status(200).json(ok({ mode: 'fallback', degraded: true, message: '报名已暂存，管理员稍后会同步到名单' }));
    } catch (e2) {
      console.error('[register.fallback-fail]', e2.message);
      res.status(502).json(err(ErrorCodes.INTERNAL, '报名写入失败，请稍后重试'));
    }
  }
});

function appendFallback(formData) {
  const dir = path.dirname(FALLBACK_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), reason: 'pg_error', formData }) + '\n';
  fs.appendFileSync(FALLBACK_PATH, line, 'utf-8');
}

module.exports = router;
