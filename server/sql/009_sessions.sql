-- server/sql/009_sessions.sql
-- session 持久化到 PG：修复 memory store「服务重启全员掉线 + 登录中途重启即 state-mismatch」。
-- 表结构与 connect-pg-simple 惯例一致（sid 主键 / sess JSON / expire 毫秒时间戳），不引新依赖，store 自实现。
-- 幂等：IF NOT EXISTS，可重复执行（run_migrate.js 自动收编）。

CREATE TABLE IF NOT EXISTS sessions (
  sid    TEXT PRIMARY KEY,          -- 签名 session id（cookie 里的原值）
  sess   JSONB NOT NULL,            -- session 对象
  expire BIGINT NOT NULL            -- 过期时刻（epoch 毫秒，由 store 维护）
);
CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);
