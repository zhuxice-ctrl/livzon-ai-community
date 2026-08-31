// server/contract.js
// 统一接口契约：响应信封 + 错误码
// 数据契约源真相（与前端约定）。所有 API 返回统一结构：
//   成功: { ok: true,  data: <payload> }
//   失败: { ok: false, error: { code: <枚举>, message: <人类可读> } }
//
// 设计原则：
//   - 前端只依赖这一种信封，不各自解析
//   - 错误码集中枚举，便于前端/后端/后台统一处理
//   - "松"接口（普通展示）可省略严格校验；"紧"接口（鉴权/写操作）必须走严格校验

const ErrorCodes = Object.freeze({
  VALIDATION: 'VALIDATION',   // 入参不合法
  NOT_FOUND: 'NOT_FOUND',     // 资源不存在
  AUTH: 'AUTH',               // 未登录 / 身份未知
  PERMISSION: 'PERMISSION',   // 有身份但无权限
  CONFLICT: 'CONFLICT',       // 冲突（如重复提交/重复投票）
  RATE_LIMIT: 'RATE_LIMIT',   // 频率限制
  INTERNAL: 'INTERNAL',       // 服务内部错误
  MOCK_UNAVAILABLE: 'MOCK_UNAVAILABLE', // 真实通道未接（mock 提示）
});

// 成功响应
function ok(data, extra) {
  return { ok: true, data: data == null ? null : data, ...(extra || {}) };
}

// 失败响应（规范化）
function err(code, message, extra) {
  return { ok: false, error: { code, message: message || defaultMessage(code) }, ...(extra || {}) };
}

function defaultMessage(code) {
  return {
    VALIDATION: '参数不合法',
    NOT_FOUND: '资源不存在',
    AUTH: '请先登录',
    PERMISSION: '无权限操作',
    CONFLICT: '操作冲突',
    RATE_LIMIT: '操作过于频繁',
    INTERNAL: '服务内部错误',
    MOCK_UNAVAILABLE: '真实通道未接通',
  }[code] || '未知错误';
}

module.exports = { ErrorCodes, ok, err };
