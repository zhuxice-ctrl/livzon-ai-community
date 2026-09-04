// server/lib/pg-session-store.js
// 轻量 PostgreSQL session store（不引 connect-pg-simple，复用 db.js 唯一数据入口）。
// 目的：登录态持久化——服务重启不再全员掉线、OAuth 回调跨重启仍可校验 state。
// 契约：sessions(sid PK, sess JSONB, expire BIGINT epoch-ms)——见 sql/009_sessions.sql。
const { Store } = require('express-session');
const { query } = require('../db');

class PgSessionStore extends Store {
  constructor(opts = {}) {
    super();
    // 兜底 TTL（无 cookie.maxAge 时用），默认 7 天
    this.defaultTtlMs = opts.ttlMs || 1000 * 60 * 60 * 24 * 7;
    // 定期回收过期 session（unref 不阻止进程退出）
    this._timer = setInterval(() => { this._reap(); }, 15 * 60 * 1000);
    if (this._timer.unref) this._timer.unref();
  }

  _expireOf(sess) {
    const maxAge = sess && sess.cookie && typeof sess.cookie.maxAge === 'number'
      ? sess.cookie.maxAge : this.defaultTtlMs;
    return Date.now() + Math.max(maxAge, 60_000);
  }

  async _reap() {
    try { await query('DELETE FROM sessions WHERE expire <= $1', [Date.now()]); }
    catch (_) { /* 回收失败不致命 */ }
  }

  get(sid, cb) {
    query('SELECT sess FROM sessions WHERE sid = $1', [sid])
      .then((r) => {
        if (!r.rows.length) return cb(null, null);
        let sess = r.rows[0].sess;
        if (typeof sess === 'string') { try { sess = JSON.parse(sess); } catch (_) { sess = null; } }
        // 命中已过期的行：视为不存在并顺手删
        if (sess && sess.cookie && sess.cookie.expires && new Date(sess.cookie.expires).getTime() <= Date.now()) {
          this.destroy(sid, () => {});
          return cb(null, null);
        }
        cb(null, sess || null);
      })
      .catch((e) => cb(e));
  }

  set(sid, sess, cb) {
    const expire = this._expireOf(sess);
    query(
      `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
      [sid, JSON.stringify(sess), expire],
    ).then(() => { if (cb) cb(null); }).catch((e) => { if (cb) cb(e); });
  }

  destroy(sid, cb) {
    query('DELETE FROM sessions WHERE sid = $1', [sid])
      .then(() => { if (cb) cb(null); }).catch((e) => { if (cb) cb(e); });
  }

  touch(sid, sess, cb) {
    const expire = this._expireOf(sess);
    query('UPDATE sessions SET expire = $2 WHERE sid = $1', [sid, expire])
      .then(() => { if (cb) cb(null); }).catch((e) => { if (cb) cb(e); });
  }
}

module.exports = { PgSessionStore };
