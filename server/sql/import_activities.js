// server/sql/import_activities.js
// 把 public/data/activities.json 的 current/upcoming/past 活动幂等导入 activities 表。
// 用法: node server/sql/import_activities.js
// 说明：
//   - 幂等：按主键 UPSERT（ON CONFLICT DO UPDATE），可重复执行。
//   - 数据真相现阶段仍是 json（后台管理活动编辑落地前），本脚本为「刷新导入」，重跑以 json 为准。
//   - data 存原对象全量（desc/highlights/stats/artifacts…），读接口原样聚合返回，前端零改动。
//   - 预约外键依赖 activities 行存在，故 GET 读库、reserve 校验都走此表。

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DATA_PATH = path.join(__dirname, '..', '..', 'public', 'data', 'activities.json');

(async () => {
  const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  const client = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pingce',
  });
  await client.connect();
  try {
    let n = 0;
    for (const kind of ['current', 'upcoming', 'past']) {
      const list = raw[kind] || [];
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (!a || !a.id) continue;
        // start_at：JSON 里的 ISO 时间（+08:00）→ TIMESTAMPTZ；缺失/非法为 null（不参与提醒）
        const startAt = a.start_at && !isNaN(Date.parse(a.start_at)) ? new Date(a.start_at) : null;
        await client.query(
          `INSERT INTO activities (id, kind, title, date_label, location, tag, sort, start_at, data, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
           ON CONFLICT (id) DO UPDATE SET
             kind=$2, title=$3, date_label=$4, location=$5, tag=$6, sort=$7, start_at=$8, data=$9, updated_at=now()`,
          [String(a.id), kind, a.name || '', a.dateLabel || '', a.location || '', a.tag || '', i, startAt, JSON.stringify(a)]
        );
        n++;
      }
    }
    console.log(`[import-activities] 已导入/刷新 ${n} 个活动（current/upcoming/past）`);
  } finally {
    await client.end();
  }
})().catch((e) => { console.error('[import-activities] 失败:', e.message); process.exitCode = 1; });
