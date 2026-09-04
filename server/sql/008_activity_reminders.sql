-- server/sql/008_activity_reminders.sql
-- 活动开始提醒：activities 增 start_at 列（json upcoming[].start_at 同步）
--              + activity_reminders 发送记录（按 预约×提醒类型 去重，一人一活动一次）。
-- 幂等：IF NOT EXISTS / DO NOTHING 语义，可重复执行（run_migrate.js 自动收编）。

ALTER TABLE activities ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ;  -- 活动开始时间；NULL=不提醒（如季度未定档）

CREATE TABLE IF NOT EXISTS activity_reminders (
  id             BIGSERIAL PRIMARY KEY,
  reservation_id INTEGER NOT NULL REFERENCES activity_reservations(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL DEFAULT 'pre_start',   -- 预留多档提醒：pre_start / hour_before …
  channel        TEXT NOT NULL DEFAULT 'feishu',      -- feishu=已送达 | skipped=无有效 open_id 仅站内
  feishu_msg_id  TEXT NOT NULL DEFAULT '',
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_reminder_res_kind UNIQUE (reservation_id, kind)
);
