// server/routes/auth.js
// 飞书 SSO 登录：授权跳转 → 回调换 token → 拉用户信息 → upsert users → 建 session
const express = require('express');
const crypto = require('crypto');
const { query } = require('../db');
const { ok, err, ErrorCodes } = require('../contract');
const { roleAfterLogin } = require('../lib/admins');

const router = express.Router();

const FEISHU_HOST = 'https://open.feishu.cn';

const APP_ID = process.env.LARK_APP_ID;
const APP_SECRET = process.env.LARK_APP_SECRET;
const REDIRECT = process.env.LARK_LOGIN_REDIRECT_URI || 'http://127.0.0.1:8787/api/auth/callback';
// 新版「网页应用」登录流程：authorize 不传 scope（scope 概念已取消，20043 即旧调用报错）。
// 仅当显式配置 LARK_LOGIN_SCOPE 才附加（兼容老式 scope 授权应用）。
const SCOPE = process.env.LARK_LOGIN_SCOPE || '';

// GET /api/auth/feishu —— 登录入口：跳转到飞书授权（state 存 session 防 CSRF）
router.get('/feishu', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.authState = state;
  let url = `${FEISHU_HOST}/open-apis/authen/v1/authorize?app_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT)}&state=${state}`;
  if (SCOPE) url += `&scope=${encodeURIComponent(SCOPE)}`;
  res.redirect(url);
});

// GET /api/auth/callback —— 用户授权后回调
router.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) {
    return res.redirect('/#login-error=no-code');
  }
  // CSRF：回调 state 必须与发起时一致（一次有效，验后即清）
  if (!state || !req.session.authState || state !== req.session.authState) {
    return res.redirect('/#login-error=state-mismatch');
  }
  delete req.session.authState;
  try {
    const token = await exchangeToken(code);
    const accessToken = token.access_token;
    const userInfo = await fetchUserInfo(accessToken);
    const user = await upsertUser(userInfo, token);
    // 建立 session（匿名函数里访问 req.session）
    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.name = user.name;
    req.session.save(() => {
      res.redirect('/#my');
    });
  } catch (e) {
    console.error('[auth.callback]', e.message);
    res.redirect('/#login-error=' + encodeURIComponent(e.message));
  }
});

// GET /api/auth/logout —— 退出登录
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// GET /api/auth/dev-login ——【仅本地开发】按 open_id 模拟登录，用于验收个人中心
// 安全：仅当 ALLOW_DEV_LOGIN=1（或非 production）时可用；生产环境必须显式关闭
router.get('/dev-login', async (req, res) => {
  const allow = process.env.ALLOW_DEV_LOGIN === '1' || process.env.NODE_ENV !== 'production';
  if (!allow) return res.status(403).json(err(ErrorCodes.PERMISSION, '开发登录已关闭'));
  const openId = req.query.openId || 'test-dev-openid';
  try {
    const r = await query(`SELECT id, name, role FROM users WHERE open_id=$1`, [openId]);
    if (!r.rows.length) return res.status(404).json(err(ErrorCodes.NOT_FOUND, '用户不存在'));
    const u = r.rows[0];
    req.session.userId = u.id;
    req.session.role = u.role;
    req.session.name = u.name;
    req.session.save(() => res.json(ok({ userId: u.id, name: u.name, role: u.role })));
  } catch (e) {
    res.status(500).json(err(ErrorCodes.INTERNAL, e.message));
  }
});

// GET /api/auth/me —— 当前登录身份（供前端判断）
router.get('/me', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json(ok(null, { authenticated: false }));
  }
  res.json(ok({
    userId: req.session.userId,
    name: req.session.name,
    role: req.session.role,
  }, { authenticated: true }));
});

// 用 code 换 user_access_token
async function exchangeToken(code) {
  const resp = await fetch(`${FEISHU_HOST}/open-apis/authen/v2/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: APP_ID,
      client_secret: APP_SECRET,
      code,
      // 飞书 v2 要求：换 token 必须回传与授权时一致的 redirect_uri，缺失报 20063
      redirect_uri: REDIRECT,
    }),
  });
  const data = await resp.json();
  if (data.code !== 0) {
    // 飞书 v2 token 错误明细在 error_description（如 20003/invalid_grant）；一并带出便于闭环排查
    throw new Error(`换取 access_token 失败: ${data.code} ${data.error_description || data.msg || JSON.stringify(data).slice(0, 160)}`);
  }
  return data.data || data;
}

// 拉取用户信息
async function fetchUserInfo(accessToken) {
  const resp = await fetch(`${FEISHU_HOST}/open-apis/authen/v1/user_info`, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`获取用户信息失败: ${data.code} ${data.msg}`);
  }
  return data.data || data;
}

// upsert 用户到 users 表（open_id 唯一）
async function upsertUser(info, token) {
  const now = new Date();
  const openId = info.open_id || info.openid || '';
  const name = info.name || '';
  const email = info.email || '';
  const dept = (info.department_ids && info.department_ids[0]) || '';
  const avatar = (info.avatar_url || info.avatar || '');
  const unionId = info.union_id || '';

  // 先查已存在
  const exist = await query(`SELECT id, role FROM users WHERE open_id=$1`, [openId]);
  let user;
  if (exist.rows.length) {
    // 登录即刷新角色（只升不降：命中白名单→admin，否则维持原角色）
    const newRole = roleAfterLogin(openId, exist.rows[0].role);
    const r = await query(
      `UPDATE users SET name=$1, email=$2, department=$3, avatar=$4, union_id=$5, access_token=$6, token_expire=$7, last_login_at=$8, role=$9
       WHERE open_id=$10 RETURNING id, name, role, department`,
      [name, email, dept, avatar, unionId, '', null, now, newRole, openId]
    );
    user = r.rows[0];
  } else {
    const r = await query(
      `INSERT INTO users (open_id, name, email, department, avatar, union_id, role, last_login_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, name, role, department`,
      [openId, name, email, dept, avatar, unionId, roleAfterLogin(openId, 'member'), now]
    );
    user = r.rows[0];
  }
  return user;
}

module.exports = router;
