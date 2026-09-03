// server/lib/community-core.js
// 社区/作品评论共用工具：id 生成、时间格式化、发帖人快照、点赞 toggle SQL。
// 从 routes/community.js 抽出，供 community.js 与 work-comments.js 复用，避免复制。
const crypto = require('crypto');
const { query } = require('../db');

// 时序可排序 id：<prefix>-<base36 毫秒>-<随机>
function genId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
}

// created_at → 前端 time 格式（MM-DD HH:mm；1 分钟内为「刚刚」）
function fmtTime(d) {
  const t = new Date(d);
  if (Date.now() - t.getTime() < 60000) return '刚刚';
  const p = (n) => String(n).padStart(2, '0');
  return p(t.getMonth() + 1) + '-' + p(t.getDate()) + ' ' + p(t.getHours()) + ':' + p(t.getMinutes());
}

// 发帖人快照：昵称取 session，部门回查 users 表
async function userSnapshot(req) {
  let dept = '';
  try {
    const r = await query('SELECT department FROM users WHERE id=$1', [req.session.userId]);
    dept = (r.rows[0] && r.rows[0].department) || '';
  } catch (_) { /* 松：快照缺部门不阻断写操作 */ }
  return { name: req.session.name || '同学', dept };
}

// 点赞 toggle：曾赞过→删记录并 -1；未赞过→插记录并 +1。CTE 一次往返，天然事务。
// 返回 {likes, liked}（liked=操作后是否为已赞态）。
function likeToggleSQL(table, subjectCol, fkTable) {
  return `
    WITH was AS (SELECT 1 AS x FROM ${table} WHERE ${subjectCol}=$1 AND user_id=$2),
    del AS (DELETE FROM ${table} WHERE ${subjectCol}=$1 AND user_id=$2 AND EXISTS(SELECT 1 FROM was)),
    ins AS (INSERT INTO ${table} (${subjectCol}, user_id) SELECT $1,$2 WHERE NOT EXISTS(SELECT 1 FROM was)
            ON CONFLICT DO NOTHING),
    upd AS (UPDATE ${fkTable} SET likes = likes + (CASE WHEN EXISTS(SELECT 1 FROM was) THEN -1 ELSE 1 END)
            WHERE id = $1 RETURNING likes)
    SELECT u.likes, (SELECT count(*) FROM was) = 0 AS liked FROM upd u`;
}

module.exports = { genId, fmtTime, userSnapshot, likeToggleSQL };
