// server/validate.js
// 轻量入参校验，分「松 / 紧」两档
//   - 松（loose）：公开展示/页面跳转类，只做必填与基础类型兜底
//   - 紧（strict）：登录鉴权/写操作/后台/敏感字段，严格校验长度、枚举、格式
// 目的：满足"契约分松紧，该严的地方严"，同时不过度设计。

// 简单校验器：对每个字段声明 { required, type, max, enum, regex }
// 返回 { valid: boolean, errors: <string[]>, casted: <净化后的对象> }

function checkRules(body, rules) {
  const errors = [];
  const casted = {};
  for (const [field, rule] of Object.entries(rules)) {
    let val = body[field];
    if (val == null || val === '') {
      if (rule.required) errors.push(`缺少必填字段：${field}`);
      if (!rule.required) continue;
    } else {
      if (rule.type === 'string') {
        if (typeof val !== 'string') { errors.push(`字段 ${field} 应为字符串`); continue; }
        val = val.trim();
        if (rule.max && val.length > rule.max) errors.push(`字段 ${field} 过长（上限 ${rule.max}）`);
      } else if (rule.type === 'boolean') {
        val = val === true || val === 'true' || val === 1;
      } else if (rule.type === 'number') {
        val = Number(val);
        if (Number.isNaN(val)) { errors.push(`字段 ${field} 应为数字`); continue; }
      }
      if (rule.enum && !rule.enum.includes(val)) {
        errors.push(`字段 ${field} 取值非法：${val}`);
      }
      if (rule.regex && !rule.regex.test(val)) {
        errors.push(`字段 ${field} 格式不合法`);
      }
      casted[field] = val;
    }
  }
  return { valid: errors.length === 0, errors, casted };
}

module.exports = { checkRules };
