-- server/sql/004_auth.sql
-- 用户体系 + 飞书 SSO 登录：增量迁移（不动已有数据）
-- 用 ALTER TABLE 追加列，避免重建表丢数据。

-- ===== users：补飞书登录字段 =====
ALTER TABLE users ADD COLUMN IF NOT EXISTS union_id     TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar        TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status        TEXT NOT NULL DEFAULT 'active';      -- active / disabled
ALTER TABLE users ADD COLUMN IF NOT EXISTS access_token  TEXT NOT NULL DEFAULT '';           -- 本次登录的 user_access_token（飞书）
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_expire  TIMESTAMPTZ;                          -- access_token 过期时间
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- open_id 唯一（飞书 SSO 的稳定标识）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_users_open_id') THEN
    ALTER TABLE users ADD CONSTRAINT uq_users_open_id UNIQUE (open_id);
  END IF;
END $$;

-- ===== works：关联创建用户 =====
ALTER TABLE works ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_works_user ON works(user_id);

-- ===== registrations：关联报名用户 =====
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_reg_user ON registrations(user_id);

-- ===== votes：改用 user_id 关联（原 voter_id 保留兼容） =====
ALTER TABLE votes ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_votes_user ON votes(user_id);
