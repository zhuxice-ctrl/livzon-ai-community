// server/sql/seed_admin.js
// 存量管理员提权/降权脚本（新登录由 admins.js 白名单自动"只升不降"，此脚本处理既有账号 + 显式降权）。
// 用法:
//   node server/sql/seed_admin.js                     # 按 env ADMIN_OPEN_IDS 提升所有已注册命中者
//   node server/sql/seed_admin.js --promote ou_xxx     # 提升指定 open_id（需已登录过一次入库）
//   node server/sql/seed_admin.js --demote ou_xxx      # 降为 member
//   node server/sql/seed_admin.js --list               # 列出全部用户 id/open_id/name/role
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Client } = require('pg');
const { adminOpenIdSet } = require('../lib/admins');

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf('--' + name); return i > -1 ? (argv[i + 1] || '') : ''; };

(async () => {
  const client = new Client({
    host: process.env.DB_HOST || '127.0.0.1', port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'pingce',
  });
  await client.connect();
  try {
    if (argv.includes('--list')) {
      const r = await client.query('SELECT id, open_id, name, department, role, last_login_at FROM users ORDER BY id');
      console.log(r.rows.map(u => `${u.id}  ${u.role.padEnd(7)}  ${(u.open_id||'-').padEnd(34)}  ${u.name}${u.department ? ' (' + u.department + ')' : ''}`).join('\n') || '(无用户)');
      return;
    }
    const promote = flag('promote'), demote = flag('demote');
    if (promote || demote) {
      const openId = promote || demote;
      const role = promote ? 'admin' : 'member';
      const r = await client.query('UPDATE users SET role=$1 WHERE open_id=$2 RETURNING id, name, role', [role, openId]);
      if (!r.rows.length) { console.log(`未找到 open_id=${openId} 的用户（该用户需先用飞书登录过一次入库）`); process.exitCode = 1; }
      else console.log(`已置 role=${role}:`, r.rows[0]);
      return;
    }
    const ids = [...adminOpenIdSet()];
    if (!ids.length) { console.log('ADMIN_OPEN_IDS 为空：未提升任何人。请在 .env 配置或 --promote <open_id>'); return; }
    const r = await client.query('UPDATE users SET role=$1 WHERE open_id = ANY($2::text[]) RETURNING id, name, open_id', ['admin', ids]);
    console.log(`按白名单提升 ${r.rows.length} 人为 admin：`, r.rows.map(x => x.name || x.open_id).join(', '));
    const missing = ids.filter(o => !r.rows.some(x => x.open_id === o));
    if (missing.length) console.log('（以下 open_id 在白名单但尚未入库，登录一次后自动提权）:', missing.join(', '));
  } finally {
    await client.end();
  }
})().catch((e) => { console.error('[seed-admin] 失败:', e.message); process.exitCode = 1; });
