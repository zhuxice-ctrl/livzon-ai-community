// server/middleware/auth.js
// 登录鉴权中间件：需先经 express-session，无登录态返回 401
const { err, ErrorCodes } = require('../contract');

function authRequired(req, res, next) {
  if (req.session && req.session.userId) {
    req.user = { id: req.session.userId, role: req.session.role, name: req.session.name };
    return next();
  }
  return res.status(401).json(err(ErrorCodes.AUTH, '请先登录'));
}

// 管理员鉴权
// 以 session 的真实 role 为准（飞书/dev-login 登录后写入）。
// 过渡：非生产环境下兼容旧 x-user-role 请求头（admin.html 是内网调试工具）；生产关闭。
function adminRequired(req, res, next) {
  const nonProd = process.env.NODE_ENV !== 'production';
  const sessionAdmin = req.session && req.session.role === 'admin';
  const headerAdmin = nonProd && String(req.headers['x-user-role'] || '').toLowerCase() === 'admin';
  if (sessionAdmin || headerAdmin) {
    req.user = { id: (req.session && req.session.userId) || 0, role: 'admin', name: (req.session && req.session.name) || '管理员' };
    return next();
  }
  return res.status(403).json(err(ErrorCodes.PERMISSION, '仅管理员可操作'));
}

module.exports = { authRequired, adminRequired };
