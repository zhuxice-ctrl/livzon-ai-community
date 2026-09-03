// server/sql/seed_community.js
// 种子脚本：读 public/data/community.json，把 15 帖 + 嵌套评论 + 公告/轮播/分区灌入社区表。
// 用法: node server/sql/seed_community.js
// 说明：
//   - 幂等：全部按主键 UPSERT（ON CONFLICT DO UPDATE），重复运行不累积、也不会覆盖真实用户新发的帖。
//   - 种子帖 work 卡为演示快照（不在 works 表），直接存 posts.work JSONB，前端零感知。
//   - 种子 time "MM-DD HH:mm" 解析为真实时间戳（跨年取去年），排序/推荐分/显示 round-trip 一致。
//   - 附带：确保开发管理员 users 行存在（open_id=test-dev-openid，role=admin），供 dev-login 验收管理操作。

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DATA_PATH = path.join(__dirname, '..', '..', 'public', 'data', 'community.json');

// "09-01 17:20" → Date（当年；若晚于当前时刻则视为去年）
function parseSeedTime(s, now) {
  const m = /^(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return now;
  let d = new Date(now.getFullYear(), parseInt(m[1], 10) - 1, parseInt(m[2], 10), parseInt(m[3], 10), parseInt(m[4], 10));
  if (d > now) d = new Date(now.getFullYear() - 1, parseInt(m[1], 10) - 1, parseInt(m[2], 10), parseInt(m[3], 10), parseInt(m[4], 10));
  return d;
}

(async () => {
  const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  const posts = raw.posts || [];
  const now = new Date();

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

    // 0) 开发管理员（dev-login 用）：存在则保名升 role，不存在则新建
    await c.query(
      `INSERT INTO users (open_id, name, role) VALUES ('test-dev-openid', '演示管理员', 'admin')
       ON CONFLICT (open_id) DO UPDATE SET role='admin'`);

    // 1) 帖子
    let nPosts = 0, nComments = 0;
    for (const p of posts) {
      const createdAt = parseSeedTime(p.time, now);
      await c.query(
        `INSERT INTO posts (id, user_id, author, dept, text, section, work, images, attachments, pinned, tag, likes, deleted, created_at)
         VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,FALSE,$12)
         ON CONFLICT (id) DO UPDATE SET
           author=$2, dept=$3, text=$4, section=$5, work=$6, images=$7, attachments=$8,
           pinned=$9, tag=$10, likes=$11, created_at=$12`,
        [
          String(p.id), p.author || '', p.dept || '', p.text || '',
          p.section || 'chat',
          p.work ? JSON.stringify(p.work) : null,
          JSON.stringify(p.images || []),
          JSON.stringify(p.attachments || []),
          !!p.pinned, p.tag || null, p.likes || 0, createdAt,
        ]
      );
      nPosts++;

      // 2) 评论：先无父后有父（FK 依赖顺序）
      const flat = [];
      const walk = (arr) => { for (const cm of (arr || [])) { flat.push(cm); } };
      walk(p.comments);
      for (const pass of [0, 1]) {
        for (const cm of flat) {
          const hasParent = !!cm.parent_id;
          if ((pass === 0 && hasParent) || (pass === 1 && !hasParent)) continue;
          await c.query(
            `INSERT INTO comments (id, post_id, parent_id, user_id, author, dept, text, likes, deleted, created_at)
             VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,FALSE,$8)
             ON CONFLICT (id) DO UPDATE SET
               post_id=$2, parent_id=$3, author=$4, dept=$5, text=$6, likes=$7, created_at=$8`,
            [
              String(cm.id), String(p.id), cm.parent_id ? String(cm.parent_id) : null,
              cm.author || '', cm.dept || '', cm.text || '', cm.likes || 0,
              parseSeedTime(cm.time, now),
            ]
          );
          nComments++;
        }
      }
    }

    // 3) config（公告/轮播/分区）单行 upsert
    const cfg = {
      announcement: raw.announcement || null,
      banners: raw.banners || [],
      sections: raw.sections || [],
    };
    await c.query(
      `INSERT INTO community_config (id, data, updated_at) VALUES (1,$1,now())
       ON CONFLICT (id) DO UPDATE SET data=$1, updated_at=now()`,
      [JSON.stringify(cfg)]
    );

    await c.query('COMMIT');
    console.log(`[seed-community] 已灌入 ${nPosts} 帖 / ${nComments} 评论 / config(公告${cfg.announcement ? 1 : 0}条,轮播${cfg.banners.length}张,分区${cfg.sections.length}个)`);
    console.log('[seed-community] 开发管理员: open_id=test-dev-openid（dev-login 默认值）');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('[seed-community] 失败:', e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
