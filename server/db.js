// server/db.js
// PostgreSQL 连接池（唯一接触数据库的层）
// 依赖：dotenv 已由 server.js 加载，这里直接读 process.env

const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      host: process.env.DB_HOST || '127.0.0.1',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'pingce',
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { query, close, getPool };
