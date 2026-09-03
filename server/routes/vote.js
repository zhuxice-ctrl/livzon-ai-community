// server/routes/vote.js
// 投票：身份防刷（同人同作品唯一）。登录用户同时写 user_id（个人中心等级按此计票）；
// 未登录保留旧口子（x-user-id 头 / voter_id 体），向后兼容不破坏现网。
const express = require('express');
const { query } = require('../db');
const { ok, err, ErrorCodes } = require('../contract');
const { checkRules } = require('../validate');

const router = express.Router();

// 身份：登录会话优先，其次旧请求头/请求体
function voterOf(req) {
  if (req.session && req.session.userId) return { userId: req.session.userId, key: String(req.session.userId) };
  const legacy = (req.headers['x-user-id'] || (req.body && req.body.voter_id) || 'anonymous').toString();
  return { userId: null, key: legacy };
}

// POST /api/vote —— 投票（防重复）
router.post('/', async (req, res) => {
  const { userId, key } = voterOf(req);
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

    // 防重复（唯一键 uq_votes_voter_work 兜底并发）
    const dup = await query(`SELECT id FROM votes WHERE voter_id=$1 AND work_id=$2`, [key, casted.workId]);
    if (dup.rows.length) return res.status(409).json(err(ErrorCodes.CONFLICT, '您已为该作品投过票'));

    const r = await query(
      `INSERT INTO votes (voter_id, activity_id, work_id, user_id) VALUES ($1,$2,$3,$4) RETURNING id`,
      [key, casted.activityId || '', casted.workId, userId]
    );
    res.status(201).json(ok({ voteId: r.rows[0].id }));
  } catch (e) {
    // 并发下的唯一键冲突兜底
    if (e.code === '23505') return res.status(409).json(err(ErrorCodes.CONFLICT, '您已为该作品投过票'));
    console.error('[vote.post]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// GET /api/vote/status?work_id=N —— 单作品投票状态（详情页显示票数 + 是否已投）。无鉴权
router.get('/status', async (req, res) => {
  const workId = Number(req.query.work_id);
  if (Number.isNaN(workId)) return res.status(400).json(err(ErrorCodes.VALIDATION, 'work_id 非法'));
  const { key } = voterOf(req);
  try {
    const c = await query(`SELECT count(*)::int AS cnt FROM votes WHERE work_id=$1`, [workId]);
    const v = await query(`SELECT 1 FROM votes WHERE voter_id=$1 AND work_id=$2 LIMIT 1`, [key, workId]);
    res.json(ok({ workId, count: c.rows[0].cnt, voted: v.rows.length > 0 }));
  } catch (e) {
    console.error('[vote.status]', e);
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
