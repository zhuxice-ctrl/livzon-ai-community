// server/lark-client.js
// 飞书开放平台 API 客户端
// - 缓存 tenant_access_token（有效期 2h）
// - 写报名记录到 Bitable（失败时降级到本地 JSON）
// - 机器人单聊发消息 sendTextToUser（活动提醒等；仅需 app 凭证，不依赖 Bitable 配置）

const fs = require('fs');
const path = require('path');

const LARK_HOST = 'https://open.feishu.cn';

class LarkClient {
  constructor(env) {
    this.appId = env.LARK_APP_ID;
    this.appSecret = env.LARK_APP_SECRET;
    this.appToken = env.LARK_BITABLE_APP_TOKEN;
    this.tableId = env.LARK_BITABLE_TABLE_ID;
    this.fallbackEnabled = env.LOCAL_FALLBACK === '1' || env.LOCAL_FALLBACK === 'true';
    this.fallbackPath = path.join(__dirname, '..', 'logs', 'registration_fallback.jsonl');
    this._tokenCache = null;
    this._tokenExpireAt = 0;
  }

  isConfigured() {
    return !!(this.appId && this.appSecret && this.appToken && this.tableId);
  }

  async getTenantAccessToken() {
    if (this._tokenCache && Date.now() < this._tokenExpireAt - 60_000) {
      return this._tokenCache;
    }
    const url = `${LARK_HOST}/open-apis/auth/v3/tenant_access_token/internal`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: this.appId,
        app_secret: this.appSecret,
      }),
    });
    const data = await resp.json();
    if (data.code !== 0) {
      throw new Error(`tenant_access_token 失败: code=${data.code} msg=${data.msg}`);
    }
    this._tokenCache = data.tenant_access_token;
    this._tokenExpireAt = Date.now() + (data.expire - 200) * 1000;
    return this._tokenCache;
  }

  /**
   * 把报名数据写入飞书 Bitable
   * @param {object} formData { 姓名, 部门, 联系方式, 报名活动, 是否愿意分享, 分享方向, 备注 }
   * @returns {Promise<{ok: boolean, mode: string, recordId?: string, error?: string}>}
   */
  async addRegistration(formData) {
    if (!this.isConfigured()) {
      return this._fallback(formData, 'lark_credentials_missing');
    }

    let token;
    try {
      token = await this.getTenantAccessToken();
    } catch (e) {
      return this._fallback(formData, 'token_error: ' + e.message);
    }

    const url = `${LARK_HOST}/open-apis/bitable/v1/apps/${this.appToken}/tables/${this.tableId}/records`;
    const fields = {
      '姓名': formData.name || '',
      '部门': formData.department || '',
      '联系方式': String(formData.contact || ''),
      '报名活动': formData.activity || '',
      '是否愿意分享': !!formData.willShare,
      '分享方向': formData.shareTopic || '',
      '备注': formData.remark || '',
    };

    let resp, data;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ fields }),
      });
      data = await resp.json();
    } catch (e) {
      return this._fallback(formData, 'network_error: ' + e.message);
    }

    if (data.code !== 0) {
      return this._fallback(formData, `bitable_error: code=${data.code} msg=${data.msg}`);
    }

    return {
      ok: true,
      mode: 'lark',
      recordId: data.data?.record?.record_id,
    };
  }

  /**
   * 机器人给单个用户发飞书私聊文本消息（im:message:send_as_bot）
   * @param {string} openId 用户 open_id（ou_ 开头）
   * @param {string} text 消息正文
   * @returns {Promise<{ok: boolean, messageId?: string, error?: string}>}
   */
  async sendTextToUser(openId, text) {
    return this._imSend(openId, 'text', JSON.stringify({ text: String(text || '') }));
  }

  /**
   * 机器人给单个用户发飞书交互卡片（im:message:send_as_bot）
   * @param {string} openId ou_ 开头的用户 open_id
   * @param {object} card 飞书卡片 JSON（header + elements）
   * @returns {Promise<{ok, messageId?, error?}>}
   */
  async sendCardToUser(openId, card) {
    return this._imSend(openId, 'interactive', JSON.stringify(card));
  }

  async _imSend(openId, msgType, content) {
    if (!(this.appId && this.appSecret)) return { ok: false, error: 'app_credentials_missing' };
    if (!/^ou_/.test(String(openId || ''))) return { ok: false, error: 'invalid_open_id' };
    try {
      const token = await this.getTenantAccessToken();
      const resp = await fetch(`${LARK_HOST}/open-apis/im/v1/messages?receive_id_type=open_id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ receive_id: openId, msg_type: msgType, content }),
      });
      const data = await resp.json();
      if (data.code !== 0) return { ok: false, error: `im_error: code=${data.code} msg=${data.msg || data.error_description || ''}` };
      return { ok: true, messageId: data.data && data.data.message_id };
    } catch (e) {
      return { ok: false, error: 'network_error: ' + e.message };
    }
  }

  _fallback(formData, reason) {
    if (!this.fallbackEnabled) {
      return { ok: false, mode: 'failed', error: reason };
    }
    try {
      const dir = path.dirname(this.fallbackPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        reason,
        formData,
      }) + '\n';
      fs.appendFileSync(this.fallbackPath, line, 'utf-8');
      return { ok: true, mode: 'fallback', reason };
    } catch (e) {
      return { ok: false, mode: 'failed', error: 'fallback_write_error: ' + e.message };
    }
  }

  /**
   * 读取全部报名记录（供数据报表使用）
   * @param {number} limit 最多读取条数
   * @returns {Promise<{ok: boolean, mode?: string, records: Array<object>}>}
   */
  async listRegistrations(limit = 200) {
    if (!this.isConfigured()) {
      return { ok: false, mode: 'unconfigured', records: [] };
    }
    try {
      const token = await this.getTenantAccessToken();
      const url = `${LARK_HOST}/open-apis/bitable/v1/apps/${this.appToken}/tables/${this.tableId}/records/search`;
      const all = [];
      let pageToken;
      do {
        const body = { page_size: 100 };
        if (pageToken) body.page_token = pageToken;
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });
        const data = await resp.json();
        if (data.code !== 0) {
          return { ok: false, mode: `bitable_error: ${data.code} ${data.msg}`, records: [] };
        }
        for (const it of (data.data && data.data.items) || []) {
          const f = it.fields || {};
          all.push({
            name: fieldText(f['姓名']),
            department: fieldText(f['部门']),
            contact: fieldText(f['联系方式']),
            activity: fieldText(f['报名活动']),
            willShare: f['是否愿意分享'] === true,
            shareTopic: fieldText(f['分享方向']),
            ts: it.created_time ? new Date(it.created_time * 1000).toISOString() : null,
            origin: 'lark',
          });
        }
        pageToken = (data.data && data.data.has_more) ? data.data.page_token : undefined;
      } while (pageToken && all.length < limit);
      return { ok: true, records: all };
    } catch (e) {
      return { ok: false, mode: 'error: ' + e.message, records: [] };
    }
  }
}

// Bitable 字段值 → 文本（search API 文本字段返回分段数组）
function fieldText(v) {
  if (v == null) return '';
  if (Array.isArray(v)) {
    return v.map(x => (typeof x === 'object' && x !== null) ? (x.text || x.link || '') : String(x)).join('');
  }
  if (typeof v === 'object') return v.text || v.link || '';
  return String(v);
}

module.exports = { LarkClient };
