# 活动大厅官网子页面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将活动大厅纳入官网 React 子页面体系，复用导航与底栏，并让标题掉落字落到底栏顶部。

**Architecture:** `App` 统一渲染 `SiteNav`、当前页面主体和 `SiteFooter`；`ActivitiesSection` 负责活动 API 数据与浅色内容。导航由 `handleNavigate` 切换，不再跳转独立活动 HTML。物理标题在活动主体内维护文档坐标，地面由底栏 DOM 上沿计算。

**Tech Stack:** React UMD 预编译 JavaScript、原生 CSS、浏览器 DOM/RAF、Express 静态服务。

---

### Task 1: 恢复官网壳层导航路由

**Files:**
- Modify: `public/app.js:1879-1889`

- [x] 将 `handleNavigate` 中的 `activities` 分支改为 `setPage("activities")`，移除到 `activities.html` 的硬跳转。
- [x] 保留 report 的独立页面跳转和其他页面状态切换逻辑。
- [x] 确认 `SiteNav` 读取当前 `page` 后把活动大厅标记为 active。

### Task 2: 将活动主体接入统一页面壳层

**Files:**
- Modify: `public/app.js:531-700, 1888-1918`

- [x] 调整 `ActivitiesSection` 返回结构，使其只负责活动内容 section，不再创建独立页面级导航/返回首页控件。
- [x] 保留 `/api/activities` 加载、活动焦点、近期排期、往期回顾、类型和参加方式内容。
- [x] 在活动 section 内保留浅色背景与当前排版，确保外层 `App` 的 `SiteNav`/`SiteFooter` 可见且不被覆盖。
- [x] 通过统一导航的“加入社团”入口进入报名流程，避免回到旧独立页。

### Task 3: 修正掉落标题的文档坐标和底栏地面

**Files:**
- Modify: `public/app.js` 活动标题样式与物理逻辑区域

- [x] 将字符位置统一存储为文档坐标 `worldY`，渲染时使用 `worldY - window.scrollY`。
- [x] 滚动期间不重置速度、角速度或碰撞状态。
- [x] 通过 `document.querySelector('.site-footer')` 计算底栏顶部，并提供文档高度回退。
- [x] 增加字符到达地面后的速度阈值与轻微阻尼，避免在底栏上持续抖动。
- [x] 保留点击掉落和 `prefers-reduced-motion` 行为。
- [x] 在主标题上方保留对白气泡装饰，文字水平/垂直居中；气泡不加入物理 body 列表。

### Task 4: 回归验证

**Files:**
- Test: `public/app.js`
- Verify: `http://127.0.0.1:8787/`

- [x] 运行 `node --check public/app.js`，无语法错误。
- [x] 验证首页、活动 API 和旧兼容入口均返回 200。
- [x] 确认活动路由仍由 `App` 子页面渲染，导航 active 状态由 `page` 驱动。
