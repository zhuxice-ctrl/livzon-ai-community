// server/routes/vote.js
// 投票：登录后投票（mock 下 voter_id 从请求头/体传入），身份防刷（同人同作品唯一）
const express = require('express');
const { query } = require('../db');
const { ok, err, ErrorCodes } = require('../contract');
const { checkRules } = require('../validate');

const router = express.Router();

// mock 身份：真实登录后改为从 session/jwt 解析
function voterOf(req) {
  return (req.headers['x-user-id'] || req.body.voter_id || sessionVoter(req) || 'anonymous').toString();
}
function sessionVoter(req) { return ''; } // 预留：接入真实登录后从此取

// POST /api/vote —— 投票（防重复）
router.post('/', async (req, res) => {
  const voterId = voterOf(req);
  const rules = {
    workId: { required: true, type: 'number' },
    activityId: { type: 'string', max: 60 },
  };
  const { valid, errors, casted } = checkRules(req.body || {}, rules);
  if (!valid) return res.status(400).json(err(ErrorCodes.VALIDATION, errors.join('；')));

  try {
    // 校验作品存在
    const w = await query(`SELECT id FROM works WHERE id=$1 AND published=true`, [casted.workId]);
    if (!w.rows.length) return res.status(404).json(err(ErrorCodes.NOT_FOUND, '作品不存在或未发布'));

    // 防重复
    const dup = await query(`SELECT id FROM votes WHERE voter_id=$1 AND work_id=$2`, [voterId, casted.workId]);
    if (dup.rows.length) return res.status(409).json(err(ErrorCodes.CONFLICT, '您已为该作品投过票'));

    const r = await query(
      `INSERT INTO votes (voter_id, activity_id, work_id) VALUES ($1,$2,$3) RETURNING id`,
      [voterId, casted.activityId || '', casted.workId]
    );
    res.status(201).json(ok({ voteId: r.rows[0].id }));
  } catch (e) {
    // 并发下的唯一键冲突兜底
    if (e.code === '23505') return res.status(409).json(err(ErrorCodes.CONFLICT, '您已为该作品投过票'));
    console.error('[vote.post]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// GET /api/vote/results —— 投票统计（作品排名）
router.get('/results', async (req, res) => {
  try {
    const r = await query(
      `SELECT w.id, w.title, w.author, v.cnt
       FROM (SELECT work_id, count(*) cnt FROM votes GROUP BY work_id) v
       JOIN works w ON w.id = v.work_id
       ORDER BY v.cnt DESC`
    );
    res.json(ok({ results: r.rows }));
  } catch (e) {
    console.error('[vote.results]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

module.exports = router;
