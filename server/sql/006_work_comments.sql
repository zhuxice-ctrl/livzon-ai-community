-- server/sql/006_work_comments.sql
-- 作品评论区：work_comments / work_comment_likes（对齐首页作品详情投票+评论需求）
-- 幂等：全部 IF NOT EXISTS，可重复运行。数据访问唯一入口仍是 server/db.js。
--
-- 设计说明：
--   - 与社区帖子评论（comments）分表：作品评论挂在 works 上、帖子评论挂在 posts 上，语义独立、互不污染。
--   - 结构与 comments 对齐（无限层级嵌套、软删、点赞去重表），复用同一套前端评论引擎。
--   - work_id 引用真实 works.id（ON DELETE CASCADE：删作品连带删评论）；帖子评论的 parent 删则提升为顶层。

-- ============ work_comments 作品评论表（无限层级嵌套）============
CREATE TABLE IF NOT EXISTS work_comments (
  id            TEXT        PRIMARY KEY,               -- wc-<base36ts>-<rand>
  work_id       INTEGER     NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  parent_id     TEXT        REFERENCES work_comments(id) ON DELETE SET NULL,  -- 不限层级；父删则子链提升为顶层
  user_id       INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  author        TEXT        NOT NULL DEFAULT '',       -- 昵称快照
  dept          TEXT        NOT NULL DEFAULT '',       -- 部门快照
  text          TEXT        NOT NULL DEFAULT '',
  likes         INTEGER     NOT NULL DEFAULT 0,        -- 服务端权威计数
  deleted       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wc_work   ON work_comments(work_id);
CREATE INDEX IF NOT EXISTS idx_wc_parent ON work_comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_wc_alive  ON work_comments(deleted) WHERE deleted = FALSE;

-- ============ 作品评论点赞去重（toggle 与 liked 字段的依据）============
CREATE TABLE IF NOT EXISTS work_comment_likes (
  comment_id TEXT        NOT NULL REFERENCES work_comments(id) ON DELETE CASCADE,
  user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);
