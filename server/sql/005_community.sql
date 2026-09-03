-- server/sql/005_community.sql
-- 社团社区：posts / comments / 点赞去重表 / config（对齐 docs/api/posts-api.md v3）
-- 幂等：全部 IF NOT EXISTS，可重复运行。数据访问唯一入口仍是 server/db.js。
--
-- 设计说明：
--   - posts.work JSONB 是作品卡「快照」（社区演示作品不在 works 表，避免污染首页巨幕）；
--     posts.work_id 是对 works 的可选外键（真实用户分享本人作品时回填），软删作品不级联删帖，置 NULL。
--   - 点赞用独立去重表（post_likes / comment_likes），既支撑 toggle 又支撑列表的 liked 字段。
--   - created_at 驱动时间显示（服务端格式化为 MM-DD HH:mm）与推荐分时间衰减。

-- ============ posts 帖子表 ============
CREATE TABLE IF NOT EXISTS posts (
  id            TEXT        PRIMARY KEY,               -- p-<base36ts>-<rand>；种子沿用 p11/pp1 等
  user_id       INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  author        TEXT        NOT NULL DEFAULT '',       -- 昵称快照
  dept          TEXT        NOT NULL DEFAULT '',       -- 部门快照
  text          TEXT        NOT NULL DEFAULT '',
  section       TEXT        NOT NULL DEFAULT 'chat',   -- resource/tutorial/qa/chat（featured 为管理侧打标，发帖不接受）
  work_id       INTEGER     REFERENCES works(id) ON DELETE SET NULL,
  work          JSONB,                                 -- 作品卡快照 {kind,title,description,source}；纯文字帖为 NULL
  images        JSONB       NOT NULL DEFAULT '[]'::jsonb,   -- [{url,name}]
  attachments   JSONB       NOT NULL DEFAULT '[]'::jsonb,   -- [{name,url,size}]
  pinned        BOOLEAN     NOT NULL DEFAULT FALSE,
  tag           TEXT,                                  -- featured/tutorial/resource；非置顶为 NULL
  likes         INTEGER     NOT NULL DEFAULT 0,        -- 服务端权威计数
  deleted       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_section ON posts(section);
CREATE INDEX IF NOT EXISTS idx_posts_pinned  ON posts(pinned);
CREATE INDEX IF NOT EXISTS idx_posts_alive   ON posts(deleted) WHERE deleted = FALSE;

-- ============ comments 评论表（无限层级嵌套 v9）============
CREATE TABLE IF NOT EXISTS comments (
  id            TEXT        PRIMARY KEY,               -- c-<base36ts>-<rand>
  post_id       TEXT        NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  parent_id     TEXT        REFERENCES comments(id) ON DELETE SET NULL,  -- 不限层级；父删则子链提升为顶层
  user_id       INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  author        TEXT        NOT NULL DEFAULT '',
  dept          TEXT        NOT NULL DEFAULT '',
  text          TEXT        NOT NULL DEFAULT '',
  likes         INTEGER     NOT NULL DEFAULT 0,
  deleted       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comments_post   ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);

-- ============ 点赞去重（toggle 与 liked 字段的依据）============
CREATE TABLE IF NOT EXISTS post_likes (
  post_id   TEXT        NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id   INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE TABLE IF NOT EXISTS comment_likes (
  comment_id TEXT        NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);

-- ============ community_config 公告/轮播/分区（单行）============
CREATE TABLE IF NOT EXISTS community_config (
  id          INTEGER     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data        JSONB       NOT NULL DEFAULT '{}'::jsonb,   -- {announcement, banners, sections}
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
