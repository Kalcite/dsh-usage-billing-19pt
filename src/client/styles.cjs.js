/**
 * 面板样式（内联注入）。
 *
 * DSH 的官方 `tsdown` 预设用 lightningcss 处理 `*.module.css` 并把编译结果做成
 * 带 hash 的类名映射；本包不依赖那套未发布的预设，改为把一段普通 CSS 在
 * factory 首次执行时插进 `<head>`，类名手工加 `ub-` 前缀避免与页面冲突。
 *
 * ## 视觉口径
 *
 * 卡片 / 表格 / 按钮的观感对齐 npm 上同名插件（0.9.5）的 `usg-*` 设计：
 *
 *   - 卡片 = 1px `--dsw-alias-border-l1` 边框 + `--dsw-alias-bg-layer-2` 底色 +
 *     8px 圆角 + `10px 12px` 内边距，**没有阴影、没有 hover 位移**；
 *   - 金额用蓝色 `#60a5fa` 强调；进度 / 比例条是 8px 高、4px 圆角、1px 描边的槽；
 *   - 统计卡是固定列网格（4 列，≤640px 降为 2 列），不是 auto-fit。
 *
 * 颜色优先走 DSH 主题变量（并保留一层旧变量名与硬编码兜底），因此跟随明/暗主题。
 *
 * @module dsh-usage-billing/src/client/styles
 */

'use strict'

/** style 标签的唯一标识，保证热重载时不会重复注入。 */
const STYLE_TAG_ID = 'dsh-usage-billing/panel.css'

/** 面板样式文本。 */
const PANEL_CSS = `
/* 整页容器：作为 main 槽里的一个面板挂载，自己滚动。
   这里顺带定义本插件的设计令牌，后代一律复用，避免每条规则都写一长串兜底。 */
.ub-page{display:flex;flex-direction:column;gap:14px;font-size:13px;
  padding:18px 22px 36px;overflow-y:auto;height:100%;box-sizing:border-box;
  color:var(--dsw-alias-text-primary,var(--dsw-alias-label-primary,inherit));
  --ub-border:var(--dsw-alias-border-l1,var(--dsw-alias-border-secondary,rgba(127,127,127,.25)));
  --ub-border-soft:color-mix(in srgb,var(--ub-border) 60%,transparent);
  --ub-surface:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));
  --ub-surface-3:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.16));
  --ub-label-1:var(--dsw-alias-label-primary,var(--dsw-alias-text-primary,inherit));
  --ub-label-2:var(--dsw-alias-label-secondary,rgba(127,127,127,.78));
  --ub-accent:#60a5fa;
  --ub-ok:var(--dsw-alias-state-success-primary,#34d399);
  --ub-warn:var(--dsw-alias-state-warning-primary,#f59e0b);
  --ub-over:var(--dsw-alias-state-error-primary,#ef4444)}
.ub-page-title{margin:0 0 2px;font-size:17px;font-weight:600;letter-spacing:.2px}
.ub-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.ub-title{display:flex;flex-direction:column;gap:2px}
.ub-title h2{margin:0;font-size:15px;font-weight:600}
.ub-sub{margin:0;font-size:12px;color:var(--ub-label-2);word-break:break-all}
.ub-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}

/* 按钮：对齐参考实现的 .usg-btn（细描边、透明底、6px 圆角）。 */
.ub-btn{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;font:inherit;font-size:12px;cursor:pointer;
  color:var(--ub-label-1);background:transparent;border:1px solid var(--ub-border);border-radius:6px}
.ub-btn:hover{background:var(--ub-surface)}
.ub-btn:disabled{opacity:.55;cursor:default}
.ub-btn-sm{padding:2px 8px;font-size:11px}
.ub-err{padding:8px 10px;border-radius:6px;font-size:12px;
  color:var(--ub-over);border:1px solid var(--ub-over)}
.ub-hint{margin:0;font-size:11.5px;color:var(--ub-label-2);line-height:1.6}
.ub-credit{margin:6px 0 0;font-size:10.5px;opacity:.45;text-align:right;letter-spacing:.3px}

/* ---- 统计卡片网格 ---- */
.ub-stats-row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.ub-card{padding:10px 12px;border:1px solid var(--ub-border);border-radius:8px;background:var(--ub-surface);
  display:flex;flex-direction:column;gap:2px;min-width:0}
.ub-card.wide{grid-column:span 2}
.ub-card-label{font-size:12px;color:var(--ub-label-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ub-card-value{font-weight:700;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  font-variant-numeric:tabular-nums}
.ub-card-value.ub-cost{color:var(--ub-accent);font-size:18px}
.ub-card-sub{font-size:11px;color:var(--ub-label-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ub-card-models{display:flex;flex-direction:column;gap:3px;margin-top:2px}
.ub-card-model{display:grid;grid-template-columns:1fr auto auto;gap:8px;font-size:11.5px;align-items:baseline}
.ub-card-model-num{font-variant-numeric:tabular-nums;color:var(--ub-label-2)}
.ub-card-model-cost{font-variant-numeric:tabular-nums;color:var(--ub-accent);font-weight:600}

/* 卡片勾选器 */
.ub-picker{display:flex;flex-wrap:wrap;gap:4px 14px;padding:8px 10px;margin-top:6px;
  border:1px solid var(--ub-border);border-radius:8px;background:var(--ub-surface)}
.ub-check{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;cursor:pointer;color:var(--ub-label-2)}
.ub-check input{cursor:pointer;accent-color:var(--ub-accent)}
.ub-picker-actions{display:flex;gap:6px;margin-top:6px}

/* ---- 可折叠区块（对齐 usg-pricing 的 details/summary 用法） ---- */
.ub-details{margin:0}
.ub-details>summary{cursor:pointer;font-size:12.5px;font-weight:600;color:var(--ub-label-1);
  padding:5px 2px;list-style:none;display:flex;align-items:center;gap:6px}
.ub-details>summary::-webkit-details-marker{display:none}
.ub-details>summary::before{content:'▸';font-size:10px;color:var(--ub-label-2);transition:transform .15s}
.ub-details[open]>summary::before{transform:rotate(90deg)}

.ub-sec{display:flex;flex-direction:column;gap:10px}
.ub-sec-t{margin:0;font-size:12.5px;font-weight:600;display:flex;align-items:center;gap:6px;color:var(--ub-label-1)}
.ub-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
.ub-bill{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}
.ub-bill-c{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border-radius:8px;
  background:var(--ub-surface);border-left:3px solid var(--ub-border)}
.ub-bill-c.peak{border-left-color:var(--ub-warn)}
.ub-bill-c.off{border-left-color:var(--ub-accent)}
.ub-bill-c.save{border-left-color:var(--ub-ok)}
.ub-bill-l{font-size:11px;color:var(--ub-label-2)}
.ub-bill-v{font-size:14px;font-weight:600;font-variant-numeric:tabular-nums}

/* ---- 饼图 + 图例 ---- */
.ub-pie-w{display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.ub-pie{position:relative;width:132px;height:132px;border-radius:50%;flex:0 0 auto}
.ub-pie-hole{position:absolute;inset:26px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:var(--dsw-alias-bg-base,var(--dsw-alias-bg-layer-1,#17171c))}
.ub-pie-n{font-size:14px;font-weight:600;font-variant-numeric:tabular-nums}
.ub-pie-s{font-size:10px;color:var(--ub-label-2)}
.ub-legend{display:flex;flex-direction:column;gap:5px;min-width:216px;flex:1}
.ub-leg-row{display:grid;grid-template-columns:9px 1fr auto auto;gap:8px;align-items:center;font-size:12px}
.ub-dot{width:9px;height:9px;border-radius:2px;flex:0 0 auto}
.ub-leg-v,.ub-leg-p{font-variant-numeric:tabular-nums;color:var(--ub-label-2);font-size:11.5px}

/* ---- 柱状图 ---- */
.ub-bars{display:flex;align-items:flex-end;gap:2px;height:132px;padding-top:4px}
.ub-bar-c{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:3px;min-width:0}
.ub-bar{width:100%;border-radius:2px 2px 0 0;background:var(--ub-accent);min-height:1px}
.ub-bar.peak{background:var(--ub-warn)}
.ub-bar-x{font-size:9px;color:var(--ub-label-2);white-space:nowrap;line-height:1}
/* 24 小时的刻度是独立一行：柱子只占满自己的列，刻度用百分比对齐到整点边界，
   这样高峰/空闲柱高不会因为刻度文字的有无而错位。 */
.ub-axis{position:relative;height:14px;margin-top:2px}
.ub-axis-l{position:absolute;top:0;transform:translateX(-50%);font-size:9px;color:var(--ub-label-2);white-space:nowrap}
.ub-axis-l-end{transform:translateX(-100%)}

/* ---- 比例条列表（按会话消费 / Top N 观感） ---- */
.ub-rows{display:flex;flex-direction:column;gap:8px}
.ub-row{display:flex;flex-direction:column;gap:3px}
.ub-row-head{display:flex;justify-content:space-between;gap:10px;align-items:baseline;font-size:12px}
.ub-row-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ub-row-value{color:var(--ub-label-2);white-space:nowrap;font-variant-numeric:tabular-nums;font-size:11.5px}
.ub-track{height:8px;border-radius:4px;background:var(--ub-surface);border:1px solid var(--ub-border);overflow:hidden}
.ub-fill{height:100%;border-radius:4px;background:var(--ub-accent);opacity:.85}
.ub-fill.warn{background:var(--ub-warn);opacity:1}

/* ---- 时间窗 / 分页滑块 ---- */
.ub-win{display:flex;flex-direction:column;gap:6px;padding:8px 10px;margin-bottom:8px;border-radius:8px;
  background:var(--ub-surface);border:1px solid var(--ub-border)}
.ub-win-row{display:flex;align-items:center;gap:8px;font-size:11.5px;flex-wrap:wrap}
.ub-win-lbl{color:var(--ub-label-2);min-width:32px}
.ub-win-val{color:var(--ub-label-2);margin-left:auto;font-variant-numeric:tabular-nums}
.ub-win-num{color:var(--ub-label-2);min-width:62px;text-align:right;font-variant-numeric:tabular-nums}
.ub-range{flex:1;min-width:120px;height:16px;accent-color:var(--ub-accent);cursor:pointer}
.ub-pager{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11.5px;
  padding:6px 8px;border:1px solid var(--ub-border);border-radius:8px;background:var(--ub-surface)}
.ub-pager-range{max-width:260px}
.ub-pager-info{color:var(--ub-label-2);font-variant-numeric:tabular-nums;white-space:nowrap}

/* ---- 表格 ---- */
.ub-table{display:flex;flex-direction:column;border-radius:8px;overflow:hidden;
  border:1px solid var(--ub-border)}
.ub-table-tight{font-size:12px}
.ub-tr{display:grid;gap:8px;padding:6px 10px;font-size:12px;align-items:center;font-variant-numeric:tabular-nums}
.ub-tr+.ub-tr{border-top:1px solid var(--ub-border-soft)}
.ub-tr.h{font-size:11px;color:var(--ub-label-2);background:var(--ub-surface)}
.ub-tr.hover:hover{background:var(--ub-surface)}
.ub-tr.warn,.warn{color:var(--ub-warn)}
.ub-r-day{grid-template-columns:1fr 1fr 1fr 1fr 1fr}
.ub-r-model{grid-template-columns:1.6fr 1fr 1fr 1fr}
.ub-r-sess{grid-template-columns:2fr 1.4fr 1fr 1fr 1fr 1fr auto}
.ub-r-recent{grid-template-columns:1.1fr 1.6fr .8fr 1fr 1fr 1fr 1fr}
.ub-ell{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ---- 日期×小时热力 ---- */
.ub-heat{display:flex;flex-direction:column;gap:3px;overflow-x:auto;padding-bottom:4px}
.ub-heat-r{display:flex;gap:2px;align-items:center}
.ub-heat-l{width:96px;flex:0 0 auto;font-size:10px;color:var(--ub-label-2);white-space:nowrap}
.ub-heat-l.wk{color:var(--ub-warn);opacity:.95}
.ub-heat-l.hol{color:var(--ub-ok);opacity:.95}
.ub-heat-l.mu{color:var(--ub-accent);opacity:.95}
.ub-cell{width:15px;height:13px;border-radius:2px;flex:0 0 auto;background:var(--ub-surface)}
.ub-cell.l1{background:color-mix(in srgb,var(--ub-accent) 30%,transparent)}
.ub-cell.l2{background:color-mix(in srgb,var(--ub-accent) 55%,transparent)}
.ub-cell.l3{background:color-mix(in srgb,var(--ub-accent) 80%,transparent)}
.ub-cell.l4{background:var(--ub-accent)}
.ub-cell.peak{outline:1px solid var(--ub-warn);outline-offset:-1px}
.ub-cell.wk{box-shadow:inset 0 0 0 1px var(--ub-ok)}
.ub-hl{display:flex;gap:4px;align-items:center;flex-wrap:wrap;font-size:10.5px;color:var(--ub-label-2)}
.ub-hm{display:flex;gap:2px;overflow-x:auto;padding-bottom:4px}
.ub-hm-c{display:flex;flex-direction:column;gap:2px}

/* ---- 键值表 / 会话详情 ---- */
.ub-kv{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:12px}
.ub-kv dt{color:var(--ub-label-2)}
.ub-kv dd{margin:0;font-variant-numeric:tabular-nums;text-align:right}
.ub-detail{padding:10px 12px;background:var(--ub-surface);
  border-top:1px solid var(--ub-border-soft)}
.ub-loading{padding:24px;text-align:center;color:var(--ub-label-2);font-size:12.5px}
.ub-pill{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:10px;font-size:10.5px;
  background:var(--ub-surface-3)}

@media (max-width:640px){
  .ub-stats-row{grid-template-columns:repeat(2,1fr)}
  .ub-card.wide{grid-column:span 2}
}
`

return { STYLE_TAG_ID, PANEL_CSS }
