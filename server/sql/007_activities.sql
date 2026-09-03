-- server/sql/007_activities.sql
-- 活动预约闭环：activities 落库（data 存原 JSONB，读接口同构返回、前端零改动）
--              + activity_reservations（预约，飞书登录身份 UNIQUE 幂等）
--              + notifications（站内消息中心：预约确认/审核结果等）
-- 幂等：全部 IF NOT EXISTS / ON CONFLICT 安全，可重复执行（run_migrate.js 自动收编）。

-- ===== 活动表（来源 public/data/activities.json，import_activities.js 导入）=====
CREATE TABLE IF NOT EXISTS activities (
  id          TEXT PRIMARY KEY,                  -- 沿用 json 的 id（prompt-camp-3 / viber-salon-2 …）
  kind        TEXT NOT NULL DEFAULT 'upcoming',  -- current / upcoming / past
  title       TEXT NOT NULL DEFAULT '',
  date_label  TEXT NOT NULL DEFAULT '',
  location    TEXT NOT NULL DEFAULT '',
  tag         TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0,        -- 原数组序（读接口按此聚合还原顺序）
  data        JSONB NOT NULL DEFAULT '{}',       -- 完整原对象（desc/highlights/stats/artifacts…）
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_act_kind ON activities(kind, sort);

-- ===== 预约表（身份唯一来源 = 飞书登录态 user_id；姓名/部门为快照冗余供名单导出）=====
CREATE TABLE IF NOT EXISTS activity_reservations (
  id           SERIAL PRIMARY KEY,
  activity_id  TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL DEFAULT '',
  dept         TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',         -- 参与期待（选填 ≤500）
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_res_user_activity UNIQUE (user_id, activity_id)  -- 一人一活动一次，重复提交幂等
);
CREATE INDEX IF NOT EXISTS idx_res_activity ON activity_reservations(activity_id);

-- ===== 站内消息中心（预约确认/未来审核结果/活动提醒统一落这里；飞书单聊为 Phase 2）=====
CREATE TABLE IF NOT EXISTS notifications (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL DEFAULT 'system',    -- reserve / system / review
  title       TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  link        TEXT NOT NULL DEFAULT '',          -- 站内锚点（如 #activities）
  read        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_unread ON notifications(user_id) WHERE read = FALSE;
