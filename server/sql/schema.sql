-- server/sql/schema.sql
-- 丽珠 AI 创新平台 —— PostgreSQL 初始表结构
-- 原则：结构按真实需求设计；JSONB 用于半结构化内容（detail/team/process 等）
--       future 扩展（作品类型/资源/投票/登录）留字段，不建冗余表。

-- ============ works 作品表 ============
-- 覆盖现有 28 件 + 未来上传的作品
CREATE TABLE IF NOT EXISTS works (
  id            SERIAL PRIMARY KEY,
  -- 作品类型：图片/视频/3D/工具/小程序/skill/mcp/源码 等（上传时选择）
  kind          TEXT        NOT NULL DEFAULT 'image',
  title         TEXT        NOT NULL,
  author        TEXT        NOT NULL DEFAULT '',
  category      TEXT        NOT NULL DEFAULT '',
  description   TEXT        NOT NULL DEFAULT '',
  cover         TEXT        NOT NULL DEFAULT '',
  -- 来源（如「AI 训练营 · 第 3 期 · 2026-05」）
  source        TEXT        NOT NULL DEFAULT '',
  -- 期数归属
  session       TEXT        NOT NULL DEFAULT '',
  -- 详情结构（theme / team[] / process[] / link 等），JSONB 保留原始扩展能力
  detail        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- 审核状态：pending / approved / rejected
  status        TEXT        NOT NULL DEFAULT 'pending',
  -- 是否公开展示（审核通过才 true）
  published     BOOLEAN     NOT NULL DEFAULT FALSE,
  -- 创建者（登录 mock 完成后关联用户，当前为空）
  created_by    TEXT        NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ users 用户表（登录 mock）============
-- 身份：member(普通) / admin(管理员)；真实飞书 SSO 后补 open_id/部门
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  open_id       TEXT        NOT NULL DEFAULT '',
  name          TEXT        NOT NULL DEFAULT '',
  email         TEXT        NOT NULL DEFAULT '',
  department    TEXT        NOT NULL DEFAULT '',
  role          TEXT        NOT NULL DEFAULT 'member',   -- member / admin
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 索引：公开读按 category / status 查询
CREATE INDEX IF NOT EXISTS idx_works_status    ON works(status);
CREATE INDEX IF NOT EXISTS idx_works_category  ON works(category);
CREATE INDEX IF NOT EXISTS idx_works_kind      ON works(kind);

-- ============ registrations 报名表 ============
-- 报名第一落点：全集团报名数据经我们（PG）。审核状态由管理员处理。
CREATE TABLE IF NOT EXISTS registrations (
  id            SERIAL PRIMARY KEY,
  name          TEXT        NOT NULL,
  department    TEXT        NOT NULL DEFAULT '',
  contact       TEXT        NOT NULL DEFAULT '',
  activity      TEXT        NOT NULL,
  will_share    BOOLEAN     NOT NULL DEFAULT FALSE,
  share_topic   TEXT        NOT NULL DEFAULT '',
  remark        TEXT        NOT NULL DEFAULT '',
  -- 审核状态：pending / approved / rejected
  status        TEXT        NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reg_status ON registrations(status);
CREATE INDEX IF NOT EXISTS idx_reg_activity ON registrations(activity);

-- ============ votes 投票表 ============
-- 投票防重复：同一 用户 + 作品 + 活动 唯一
CREATE TABLE IF NOT EXISTS votes (
  id            SERIAL PRIMARY KEY,
  voter_id      TEXT        NOT NULL DEFAULT '',   -- 登录 mock 后为 open_id/用户标识
  activity_id   TEXT        NOT NULL DEFAULT '',
  work_id       INTEGER     NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 同一人同一作品只能投一次（identity 防刷）
CREATE UNIQUE INDEX IF NOT EXISTS uq_votes_voter_work ON votes(voter_id, work_id);
CREATE INDEX IF NOT EXISTS idx_votes_work ON votes(work_id);

-- ============ artifacts 作品资源/制品表 ============
-- 视频 / 小程序包 / skill / mcp / 源码等制品的上传、版本、下载记录
CREATE TABLE IF NOT EXISTS artifacts (
  id            SERIAL PRIMARY KEY,
  work_id       INTEGER     NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  kind          TEXT        NOT NULL,               -- video/miniprogram/skill/mcp/source/file
  filename      TEXT        NOT NULL DEFAULT '',    -- 原始文件名
  version       TEXT        NOT NULL DEFAULT 'v1',  -- 版本号
  size          BIGINT      NOT NULL DEFAULT 0,     -- 字节
  storage_url   TEXT        NOT NULL DEFAULT '',    -- 存储地址/路径（对象存储后接）
  checksum      TEXT        NOT NULL DEFAULT '',    -- 校验值
  downloads     INTEGER     NOT NULL DEFAULT 0,     -- 下载次数
  guide         TEXT        NOT NULL DEFAULT '',    -- 本地调用/使用指引
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_artifacts_work ON artifacts(work_id);
