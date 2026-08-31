// server/sql/seed.js
// 种子脚本：读 public/data/works.json 的现有 28 件作品，灌入 works 表。
// 用法: node server/sql/seed.js
// 说明：
//   - 这是「标准数据入口」——将来换正式作品集，改 works.json 后重跑即可
//   - 幂等：先清空 works 表再插入，重复运行不累积

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

(async () => {
  const dataPath = path.join(__dirname, '..', '..', 'public', 'data', 'works.json');
  const raw = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  const session = raw.session || '第 01 期';
  const works = raw.works || [];

  const c = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pingce',
  });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query('DELETE FROM works');
    for (const w of works) {
      const detail = w.detail || {};
      await c.query(
        `INSERT INTO works
           (kind, title, author, category, description, cover, source, session, detail, status, published)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'approved',true)`,
        [
          inferKind(w.category),
          w.title,
          w.author,
          w.category,
          w.desc || '',
          w.cover || '',
          detail.source || '',
          session,
          JSON.stringify(w.detail || {}),
        ]
      );
    }
    await c.query('COMMIT');
    console.log(`[seed] 已灌入 ${works.length} 件作品（session=${session}）`);
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('[seed] 失败:', e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();

function inferKind(category) {
  const c = category || '';
  if (/视频/.test(c)) return 'video';
  if (/3D/.test(c)) return '3d';
  if (/可视化|BI|工具|工作流/.test(c)) return 'tool';
  if (/原型/.test(c)) return 'app';
  return 'image';
}
