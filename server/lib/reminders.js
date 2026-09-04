// server/lib/reminders.js
// 活动开始提醒：扫描「即将开始且未提醒」的预约，飞书单聊推送 + 站内通知，按 预约×类型 去重。
// 横切约定：db 唯一数据入口 / 复用 lark-client 发飞书 / 失败优雅降级（记 skipped，不阻断其它）。
// 依赖：activities.start_at（非空才参与）、activity_reservations、users.open_id、activity_reminders。
const { query } = require('../db');

// 待提醒查询：upcoming 且 start_at 在窗口 [now, now+aheadHours] 内，且该预约尚无 pre_start 记录。
async function findDueReminders(aheadHours) {
  const r = await query(
    `SELECT res.id AS reservation_id, res.user_id, u.open_id, u.name,
            a.id AS activity_id, a.title, a.date_label, a.location, a.start_at
       FROM activity_reservations res
       JOIN activities a ON a.id = res.activity_id
       JOIN users u ON u.id = res.user_id
      WHERE a.kind = 'upcoming'
        AND a.start_at IS NOT NULL
        AND a.start_at > now()
        AND a.start_at <= now() + ($1 || ' hours')::interval
        AND NOT EXISTS (
          SELECT 1 FROM activity_reminders m
           WHERE m.reservation_id = res.id AND m.kind = 'pre_start'
        )
      ORDER BY a.start_at, res.id`,
    [String(aheadHours)]
  );
  return r.rows;
}

function fmtStart(d) {
  const t = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getMonth() + 1}月${t.getDate()}日 ${p(t.getHours())}:${p(t.getMinutes())}`;
}

// 执行一轮提醒扫描。lark=LarkClient 实例；aheadHours=提前多久提醒；notify=日志回调。
async function runReminders(lark, { aheadHours = 24, notify = () => {} } = {}) {
  let due;
  try {
    due = await findDueReminders(aheadHours);
  } catch (e) {
    notify('reminder-scan-error', e.message);
    return { scanned: 0, sent: 0, skipped: 0, error: e.message };
  }
  let sent = 0, skipped = 0;
  for (const row of due) {
    const when = fmtStart(row.start_at);
    const text =
      `【丽珠 AI 社团】活动提醒\r\n` +
      `「${row.title}」将于 ${when}${row.location ? '（' + row.location + '）' : ''} 开始。\r\n` +
      `你已预约，记得准时参加。`;
    // 飞书单聊：仅真实 open_id（ou_）才发；否则记 skipped 但仍落站内通知。
    let channel = 'skipped';
    let msgId = '';
    const realOpenId = /^ou_/.test(String(row.open_id || ''));
    if (realOpenId) {
      const res = await lark.sendTextToUser(row.open_id, text);
      if (res.ok) { channel = 'feishu'; msgId = res.messageId || ''; }
      else { notify('reminder-send-fail', row.activity_id + ' ' + row.user_id + ' ' + res.error); skipped++; continue; }
    }
    try {
      await query(
        `INSERT INTO activity_reminders (reservation_id, kind, channel, feishu_msg_id)
         VALUES ($1,'pre_start',$2,$3) ON CONFLICT (reservation_id, kind) DO NOTHING`,
        [row.reservation_id, channel, msgId]);
      // 站内通知（无论飞书是否送达都补一条，保证用户站内可见）
      await query(
        `INSERT INTO notifications (user_id, type, title, body, link) VALUES ($1,'system',$2,$3,'#activities')`,
        [row.user_id, '活动即将开始提醒', `「${row.title}」将于 ${when} 开始${row.location ? ' · ' + row.location : ''}。`]);
      if (channel === 'feishu') sent++; else skipped++;
      notify('reminder-sent', row.activity_id + ' → user ' + row.user_id + ' via ' + channel);
    } catch (e) {
      notify('reminder-write-fail', e.message);
    }
  }
  return { scanned: due.length, sent, skipped };
}

module.exports = { runReminders, findDueReminders };
