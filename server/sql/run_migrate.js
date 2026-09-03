// server/sql/run_migrate.js
// 读取 sql/ 目录下所有 *.sql，按「schema.sql 基线 → 增量迁移(004_*, 005_*…)」顺序执行。
// 所有脚本均写成幂等（IF NOT EXISTS / ADD COLUMN IF NOT EXISTS），可重复运行。
// 用法: node server/sql/run_migrate.js

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { query, close } = require('../db');

// 基线在前，增量按文件名升序（数字前缀天然有序；ASCII 下数字 < 字母，故 schema 必须置顶）
function migrateOrder(files) {
  const base = files.includes('schema.sql') ? ['schema.sql'] : [];
  const rest = files.filter((f) => f !== 'schema.sql').sort();
  return base.concat(rest);
}

(async () => {
  const files = migrateOrder(fs.readdirSync(__dirname).filter((f) => f.endsWith('.sql')));
  try {
    for (const f of files) {
      const sql = fs.readFileSync(path.join(__dirname, f), 'utf-8');
      await query(sql);
      console.log(`[migrate] ${f} 执行成功`);
    }
    console.log(`[migrate] 共 ${files.length} 个脚本建表/迁移成功`);
  } catch (e) {
    console.error('[migrate] 失败:', e.message);
    process.exitCode = 1;
  } finally {
    await close();
  }
})();
