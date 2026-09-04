// server/lib/admins.js
// 管理员白名单：env ADMIN_OPEN_IDS（逗号分隔的飞书 open_id）。
// 约定「只升不降」：登录时命中白名单 → 提升为 admin；不在名单的既有 admin 不被自动降级
//（降级/授权显式走 seed_admin.js 或直接改库），避免误锁管理员、也避免误提权。
function adminOpenIdSet() {
  return new Set(
    String(process.env.ADMIN_OPEN_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function isAdminOpenId(openId) {
  return adminOpenIdSet().has(String(openId || ''));
}

// 登录 upsert 用：给定当前角色，返回登录后应生效角色（只升不降）
function roleAfterLogin(openId, currentRole) {
  return isAdminOpenId(openId) ? 'admin' : (currentRole || 'member');
}

module.exports = { adminOpenIdSet, isAdminOpenId, roleAfterLogin };
