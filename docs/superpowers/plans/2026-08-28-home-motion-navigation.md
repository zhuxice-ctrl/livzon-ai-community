# 首页动效与导航优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让首页作品墙无断带、流畅循环，并在首屏之后展示五个站内入口卡片。

**Architecture:** 继续使用 `public/app.js` 的 React 预编译产物。将每行作品轨道与动画范围对齐为两个等长副本，移除滚动位置驱动的 Hero 重渲染；新入口带调用现有 `handleNavigate`，不改变后端或数据格式。

**Tech Stack:** React 18 UMD、浏览器 CSS transform 动画、Express 静态服务。

---

### Task 1: 修复作品墙轨道与渲染负载

**Files:**
- Modify: `F:/pingce/public/app.js:244-357`
- Modify: `F:/pingce/public/app.js:2127-2133`

- [ ] **Step 1: 建立当前行为基线**

Run: `node --check F:/pingce/public/app.js`

Expected: exit code `0`。

- [ ] **Step 2: 将每行作品从三份改为两份等长副本**

Replace the row data construction with:

```js
const repeated = [...rowImages, ...rowImages];
```

Set the animated row style to include GPU compositing:

```js
animation: `marquee${direction === "left" ? "Left" : "Right"} ${duration}s linear infinite`,
willChange: "transform"
```

Keep `animationPlayState` set to `"running"` so hovering never pauses the wall.

- [ ] **Step 3: 对齐循环终点到一个完整副本**

Replace the keyframes with:

```css
@keyframes marqueeLeft {
  from { transform: translate3d(0, 0, 0); }
  to { transform: translate3d(-50%, 0, 0); }
}
@keyframes marqueeRight {
  from { transform: translate3d(-50%, 0, 0); }
  to { transform: translate3d(0, 0, 0); }
}
```

- [ ] **Step 4: 延迟非首屏图片解码**

Add the following attributes to the `WallTile` image element:

```js
loading: "lazy",
decoding: "async",
```

- [ ] **Step 5: 验证语法**

Run: `node --check F:/pingce/public/app.js`

Expected: exit code `0`。

### Task 2: 移除滚动造成的首页重复重渲染并收紧首屏

**Files:**
- Modify: `F:/pingce/public/app.js:359-535`
- Modify: `F:/pingce/public/app.js:1981-2022`

- [ ] **Step 1: 让 HeroSection 不再接收滚动状态**

Change the signature to:

```js
var HeroSection = ({ onWorkClick }) => {
```

Use fixed values for the hero layers instead of deriving `progress`, `wallOpacity`, or `titleY` from scroll position.

- [ ] **Step 2: 收紧首屏空间**

Set Hero section layout to:

```js
minHeight: "auto",
padding: "0 0 72px",
```

Set the header to:

```js
paddingTop: 112,
marginBottom: 32,
```

Set the stats block to `marginTop: 64` and remove scroll-derived opacity. Preserve existing copy and visual style.

- [ ] **Step 3: 删除 App 的 scrollY state listener**

Remove the `scrollY` state and the `window.addEventListener("scroll", ...)` effect. Set light-mode by page only:

```js
const lightMode = page !== "home";
```

Render Hero without a scroll prop:

```js
React.createElement(HeroSection, { onWorkClick: handleWorkClick })
```

- [ ] **Step 4: 验证语法与首页加载**

Run: `node --check F:/pingce/public/app.js`

Expected: exit code `0`。

Open `http://127.0.0.1:8787/`, wait three seconds, and confirm the 28 work images appear with no console errors.

### Task 3: 新增首页五入口卡片带

**Files:**
- Modify: `F:/pingce/public/app.js:2141-2022`
- Modify: `F:/pingce/public/app.js:2027-2139`

- [ ] **Step 1: 新增 HomeEntryRail 组件**

Add a component before `HomeHighlights` with this data:

```js
const entries = [
  { key: "home", number: "01", label: "作品巨幕", note: "28 件获奖作品，持续展映" },
  { key: "activities", number: "02", label: "活动大厅", note: "沙龙、黑客松与创作赛" },
  { key: "community", number: "03", label: "社团社区", note: "课程、知识库与精选作品" },
  { key: "about", number: "04", label: "关于我们", note: "了解社团与活动方式" },
  { key: "report", number: "05", label: "数据报表", note: "查看作品与报名数据" }
];
```

Render a dark section headed `EXPLORE · 社团入口` and map entries to clickable cards that call `onNavigate(entry.key)`.

- [ ] **Step 2: 添加入口带布局与交互样式**

Use `display: grid`, desktop `gridTemplateColumns: "repeat(5, 1fr)"`, 16px gaps, and a 1px translucent border. On hover, move the card upward 4px and brighten its border. Avoid image assets or new dependencies.

- [ ] **Step 3: 插入首页内容顺序**

Change the home fragment order to:

```js
React.createElement(HeroSection, { onWorkClick: handleWorkClick }),
React.createElement(HomeEntryRail, { onNavigate: handleNavigate }),
React.createElement(HomeHighlights, { onNavigate: handleNavigate })
```

- [ ] **Step 4: 添加手机断点**

In the existing `@media (max-width: 768px)` block, set `.home-entry-grid` to `grid-template-columns: 1fr !important;` and ensure its container padding is `48px 20px`.

- [ ] **Step 5: 验证导航**

Open the homepage, scroll to the entry rail, and click each of the five cards. Confirm home resets to the wall, report opens `report.html`, and the other three cards render their current pages.

### Task 4: 浏览器回归验证

**Files:**
- Test: `http://127.0.0.1:8787/`

- [ ] **Step 1: 验证无缝与悬停**

Observe each animation direction across one full loop boundary. Hover a visible card and confirm its title, category, author, and summary appear while its horizontal position continues changing.

- [ ] **Step 2: 验证性能保护与响应式**

Confirm wall image elements have `loading="lazy"` and `decoding="async"`. Test a 390px wide viewport; confirm no horizontal overflow and the entry cards display in one column.

- [ ] **Step 3: 验证控制台与语法**

Run: `node --check F:/pingce/public/app.js`

Expected: exit code `0`.

Read browser console errors after navigation. Expected: no new errors from `app.js`.

- [ ] **Step 4: Commit if repository metadata is later available**

Run: `git -C F:/pingce status --short`

Expected: current workspace has no `.git`; record the implementation without attempting a commit.
