// server/sql/run_migrate.js
// 读取 schema.sql 并在连接库上执行建表。
// 用法: node server/sql/run_migrate.js

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { query, close } = require('../db');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  try {
    await query(sql);
    console.log('[migrate] schema 建表成功');
  } catch (e) {
    console.error('[migrate] 失败:', e.message);
    process.exitCode = 1;
  } finally {
    await close();
  }
})();
