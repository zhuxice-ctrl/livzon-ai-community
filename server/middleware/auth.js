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
function adminRequired(req, res, next) {
  if (req.session && req.session.role === 'admin') {
    req.user = { id: req.session.userId, role: req.session.role, name: req.session.name };
    return next();
  }
  return res.status(403).json(err(ErrorCodes.PERMISSION, '仅管理员可操作'));
}

module.exports = { authRequired, adminRequired };
