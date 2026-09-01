# 活动大厅丰富 · 交接指令（给 aily）

> 分支：`feat/activities-enrich`（基于 main `52cfb96` 拉出，工作目录 `.worktrees/activities-enrich`）
> 目标：在不破坏现有物理引擎的前提下，丰富活动大厅的内容与交互。
> 只改前端渲染层（`public/app.js` 的 `ActivitiesSection` + 可选 `public/data/activities.json`），**不要动后端接口**。

---

## 一、红线（请勿触碰）

1. **不要动物理引擎**：标题「玩出来的 AI」的字符掉落 / 互撞 / 抓取投掷 / 视口跟随地面 / 重置按钮 / 点击空白提示——这段逻辑已被验证过（字符钉死、无互撞、无跟随曾出过事故），请**原样保留**。
2. **不要删改 `__PINGCE_SEG_*` 标记**：这些是文件分块边界，删除会破坏该文件的编辑工具链。
3. **不要整体重写 `ActivitiesSection`**：基于现有 innerHTML 渲染结构做**增量**修改。
4. **不要改后端接口**：数据从 `/api/activities`（GET 列表）与 `/api/activities/:id`（单条回顾）读取，字段见下文。
5. **不要动 `public/app.js` 里其他区块**（作品墙 `CurvedWall`、首页、个人中心 `MySection`、导航）——只改活动大厅 `ActivitiesSection`。

## 二、数据接口（只读，勿改）

`GET /api/activities` 返回结构（`{ ok, data }`）：

```json
{
  "ok": true,
  "data": {
    "intro": "…",
    "motto": "…",
    "current": [ { "id","name","status","date","dateLabel","location","tag","desc","highlights[]","color","signup" } ],
    "upcoming": [ { "id","name","status","date","dateLabel","location","tag","desc","highlights[]","color" } ],
    "past": [ { "id","name","status","dateLabel","date","location","tag","summary","stats{}","artifacts[]","color" } ],
    "types": [ { "id","name","tagline","cadence","format","suitableFor" } ]
  }
}
```

- `current`（本月焦点，至多 1 条）、`upcoming`（即将）、`past`（往期回顾）、`types`（常设活动类型）。
- 单条回顾：`GET /api/activities/:id`。

## 三、本期要做（3 项，增量、数据驱动）

### 1. 顶部「活动统计条」区（新增，放在 hero 下方、本月焦点上方）
从 `page.past[*].stats` 汇总，展示 3-4 个 KPI，让人一眼看到社团成长：

| KPI | 取值方式 |
|-----|---------|
| 已办场次 | `past.length` |
| 累计参与 | 遍历 `past[*].stats.participants / speakers / teams` 求和（该值未投则跳过） |
| 沉淀作品 | 遍历 `past[*].stats.works / mvp / inWall / production` 求和（未投则跳过） |
| 活动类型 | `types.length` |

样式可参考现有 `.my-kpi` / `.past-stat` 轻量卡片，浅色主题、白底、圆角 `#1a1a1f` 数字 + 灰色标签。

### 2. 本月焦点卡加「去报名」按钮
- `current[0].signup` 已有值（如 `/upload.html`），在该卡右下角加一个主 CTA 按钮「去报名」。
- 未登录点击 → 引导登录；已登录 → 跳 `signup` 地址；`signup` 为空则显示「联系群内报名」禁用态。

### 3. 「接下来」卡片加「报名 / 预约」按钮
- 每张 `upcoming` 卡片底部加一个次级按钮「报名 / 预约」。
- 点击行为与焦点一致（未登录→登录，已登录→跳报名）。
- 保持卡片 hover 上浮、彩色左侧条等现有样式不变。

## 四、风格与规范

- 跟随现有浅色主题：`#f8f8f6` 背景、白卡片、1px `rgba(0,0,0,0.06)` 边框、`Noto Serif SC` 标题、`JetBrains Mono` 数字、主色 `#2568d8 → #173f8f` 渐变。
- 新元素沿用 `.act-*` 前缀的类名，避免污染其它区块。（如需，可在 `ActivitiesSection` 的 `<style>` 内追加 CSS，不要在外面加全局样式。）
- 中文文案统一、报错兜底（如 `past` 为空时统计条显示「—」）。

## 五、验收清单

- [ ] 顶部统计条正确显示（有数据时数字对、无 past 时不报错）
- [ ] 本月焦点「去报名」按钮：未登录→跳登录页；已登录→跳对应报名地址
- [ ] 「接下来」每卡「报名 / 预约」按钮可点，行为一致
- [ ] 物理引擎标题依旧正常（点击掉落、拖拽、重置、视口跟随），未受影响
- [ ] `node --check public/app.js` 通过，浏览器无 console 报错
- [ ] 未删改任何 `__PINGCE_SEG_*` 标记

## 六、交付方式

- 在本分支（`feat/activities-enrich`）直接提交，commit message 用 `feat(activities): …` 格式。
- 完成后告知，由主线侧合并到 `main`。

---

*指令版本：v1 · 基于 main 52cfb96。*
