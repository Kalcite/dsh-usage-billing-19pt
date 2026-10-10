/**
 * 「用量计费」看板面板（浏览器半边）。
 *
 * 与主机半边 `/usage-billing/summary` 返回的 {@link UsageOverview} 对接，
 * 在线重算峰谷费用：主机只负责给出 `byDayHour`（日期 × 小时 × 模型）的原始
 * token，这一层用同一套规则算钱，因此改单价 / 峰谷规则后无需重新读盘就能看到
 * 新账单。
 *
 * 本文件以 CommonJS 片段的形式参与拼接（见 `scripts/build-client.mjs`）：
 * 顶层 `require('react')` 由 shell 的模块表提供，其余一切自包含，
 * 因此不需要任何打包器。
 */

'use strict'

const React = require('react')

const h = React.createElement

/* ---------------------------------------------------------------- 格式化 */

/** 大数字缩写：1.2K / 3.4M / 5.6B。 */
function fmtTokens(n) {
  if (!Number.isFinite(n) || n === 0) return '0'
  const abs = Math.abs(n)
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}

/** 精确保留千分位。 */
function fmtExact(n) {
  if (!Number.isFinite(n)) return '0'
  return n.toLocaleString('en-US')
}

/** 金额；币种由模型决定（DeepSeek 走人民币，其余走美元）。 */
function fmtCost(n, currency) {
  const symbol = currency === 'USD' ? '$' : currency === 'CNY' ? '\u00a5' : ''
  const value = Math.abs(n)
  const digits = value > 0 && value < 0.01 ? 4 : 2
  return symbol + n.toFixed(digits)
}

/** 百分比。 */
function fmtPct(n) {
  return (n * 100).toFixed(1) + '%'
}

/** 字节缩写。 */
function fmtBytes(n) {
  if (!Number.isFinite(n) || n === 0) return '0 B'
  if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + ' MB'
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB'
  return n + ' B'
}

/** 时间戳 → `MM/DD HH:mm`。 */
function fmtTime(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return '—'
  const d = new Date(ts)
  const p = (v) => String(v).padStart(2, '0')
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 时长。 */
function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const minutes = Math.floor(ms / 60000)
  if (minutes < 60) return `${minutes} 分钟`
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`
}

/** 模型展示名（主机已给出 label，这里只做兜底）。 */
function modelLabel(row) {
  return row && row.label ? row.label : (row && row.model) || '未知模型'
}

/** 该模型的计价币种。 */
function currencyOf(modelId) {
  return typeof modelId === 'string' && modelId.indexOf('deepseek') === 0 ? 'CNY' : 'USD'
}

/* ------------------------------------------------------------ 计费（同构） */

const DEFAULT_PRICE = { inputPerM: 3, outputPerM: 9, cacheReadPerM: 0.1, cacheWritePerM: 3 }

function priceOfModel(model, pricing) {
  const models = (pricing && pricing.models) || {}
  return models[model] || models._default || DEFAULT_PRICE
}

function inPeakSlot(hour, pricing) {
  const slots = (pricing && pricing.peakSlots) || []
  return slots.some((s) => hour >= s.start && hour < s.end)
}

function weekendRelaxActive(date, pricing) {
  if (!pricing || !pricing.weekendRelax) return false
  const from = pricing.weekendRelaxFrom
  if (!from) return true
  return date >= from
}

/** 该日期是否落在法定节假日区间内。 */
function isHoliday(date, pricing) {
  const ranges = (pricing && pricing.calendar && pricing.calendar.holidays) || []
  return ranges.some((r) => date >= r.from && date <= r.to)
}

/** 该日期是否为调休上班日。 */
function isMakeupWorkday(date, pricing) {
  const days = (pricing && pricing.calendar && pricing.calendar.makeupWorkdays) || []
  return days.indexOf(date) !== -1
}

/**
 * 当天的计费性质。优先级：**节日 > 调休 > 周末 > 工作日**。
 *
 * `kind` 只用于**展示**（行标签 / 徽标）。`makeup` 与 `weekend` 在计费上是同一档
 * （都走「周末全天空闲」），见 {@link isWeekendKind}。
 *
 * 必须与主机侧 `src/pricing.ts` 的 `isPeakAt` 完全同构，否则界面重算出的金额会
 * 与主机不一致（`scripts/check-client-logic.mjs` 会逐维度比对来守住这一点）。
 */
function dayKind(date, weekday, pricing) {
  if (isHoliday(date, pricing)) return 'holiday'
  if (isMakeupWorkday(date, pricing)) return 'makeup'
  if (weekday === 0 || weekday === 6) return 'weekend'
  return 'weekday'
}

/** 是否属于「周末口径」（周六周日，含调休上班的周末）。与主机侧同名函数同构。 */
function isWeekendKind(kind) {
  return kind === 'weekend' || kind === 'makeup'
}

function isPeakAt(date, weekday, hour, pricing) {
  const kind = dayKind(date, weekday, pricing)
  if (kind === 'holiday') return false
  // 调休上班的周末**仍按周末**：全天计空闲价，不按工作日分峰谷。
  if (isWeekendKind(kind) && weekendRelaxActive(date, pricing)) return false
  return inPeakSlot(hour, pricing)
}

/**
 * 某一天是否全天按空闲价（用于热力图绿框与说明文字）。与主机 `dayRelaxReason` 同构。
 * @param date - `YYYY-MM-DD`。
 * @param weekday - 0 = 周日。
 * @param pricing - 当前规则。
 * @returns 全天空闲为 true。
 */
function dayAllDayOffPeak(date, weekday, pricing) {
  const kind = dayKind(date, weekday, pricing)
  return kind === 'holiday' || (isWeekendKind(kind) && weekendRelaxActive(date, pricing))
}

/** 一个日期×小时桶在「全高峰」口径下的费用。 */
function baselineCostOfBucket(bucket, pricing) {
  let cost = 0
  for (const model of Object.keys(bucket.models || {})) {
    const t = bucket.models[model]
    const p = priceOfModel(model, pricing)
    cost += (t.input * p.inputPerM + t.output * p.outputPerM
      + t.cacheRead * p.cacheReadPerM + t.cacheWrite * p.cacheWritePerM) / 1e6
  }
  return cost
}

/** 一个日期×小时桶的实际费用（含峰谷系数）。 */
function costOfBucket(bucket, pricing) {
  const multiplier = isPeakAt(bucket.date, bucket.weekday, bucket.hour, pricing)
    ? 1
    : (pricing && typeof pricing.offPeakMultiplier === 'number' ? pricing.offPeakMultiplier : 0.5)
  return baselineCostOfBucket(bucket, pricing) * multiplier
}

function bucketTokens(b) {
  return b.input + b.output + b.cacheRead + b.cacheWrite
}

/**
 * 用当前规则重算全部账单。
 *
 * 账单只能按 `byDayHour` 重算：只有这一层同时带 `date` / `weekday` / `hour`
 * 和按模型拆分的 token，才能正确套用峰谷与周末规则。
 */
function recompute(overview, pricing) {
  const buckets = overview.byDayHour || []
  let total = 0
  let peakCost = 0
  let offPeakCost = 0
  let baseline = 0
  let peakTokens = 0
  let offPeakTokens = 0
  const dayCost = new Map()
  const modelCost = new Map()

  for (const bucket of buckets) {
    const cost = costOfBucket(bucket, pricing)
    const base = baselineCostOfBucket(bucket, pricing)
    const peak = isPeakAt(bucket.date, bucket.weekday, bucket.hour, pricing)
    const tokens = bucketTokens(bucket)

    total += cost
    baseline += base
    if (peak) { peakCost += cost; peakTokens += tokens } else { offPeakCost += cost; offPeakTokens += tokens }
    dayCost.set(bucket.date, (dayCost.get(bucket.date) || 0) + cost)

    const multiplier = peak ? 1 : (pricing && typeof pricing.offPeakMultiplier === 'number' ? pricing.offPeakMultiplier : 0.5)
    for (const model of Object.keys(bucket.models || {})) {
      const t = bucket.models[model]
      const p = priceOfModel(model, pricing)
      const raw = (t.input * p.inputPerM + t.output * p.outputPerM
        + t.cacheRead * p.cacheReadPerM + t.cacheWrite * p.cacheWritePerM) / 1e6
      modelCost.set(model, (modelCost.get(model) || 0) + raw * multiplier)
    }
  }

  const tokenTotal = peakTokens + offPeakTokens
  return {
    total,
    peakCost,
    offPeakCost,
    baseline,
    savings: Math.max(0, baseline - total),
    peakShare: tokenTotal > 0 ? peakTokens / tokenTotal : 0,
    dayCost,
    modelCost,
  }
}

/** 单会话的实时费用（用会话自己的 dayHour）。 */
function sessionCost(session, pricing) {
  if (!session.dayHour || session.dayHour.length === 0) return session.cost || 0
  let sum = 0
  for (const bucket of session.dayHour) sum += costOfBucket(bucket, pricing)
  return sum
}

/* -------------------------------------------------------------- 小部件 */

function Card(props) {
  return h('div', { className: 'ub-card' },
    h('span', { className: 'ub-card-l' }, props.label),
    h('span', { className: 'ub-card-v' + (props.tone ? ' ' + props.tone : '') }, props.value),
  )
}

function Section(props) {
  return h('section', { className: 'ub-sec' },
    h('h3', { className: 'ub-sec-t' }, props.title),
    props.children,
  )
}

/**
 * Token 构成饼图（conic-gradient）+ 图例。
 *
 * 单价列按**实际计价的单价档**显示：给了 `props.model` 就用该模型的单价，否则用
 * `_default`。早期版本无论桶里是什么模型都拿 `_default` 的单价显示，多模型分别
 * 计价时图例是错的。
 */
function CompositionPie(props) {
  const pricing = props.pricing
  const models = (pricing && pricing.models) || {}
  const tierModel = props.model && models[props.model] ? props.model : '_default'
  const tier = priceOfModel(tierModel, pricing)
  const items = [
    { key: 'cacheRead', label: '缓存命中输入', value: props.cacheRead, price: tier.cacheReadPerM },
    { key: 'input', label: '输入（未命中）', value: props.input, price: tier.inputPerM },
    { key: 'output', label: '输出', value: props.output, price: tier.outputPerM },
    { key: 'cacheWrite', label: '缓存写入', value: props.cacheWrite, price: tier.cacheWritePerM },
  ]
  const colors = {
    cacheRead: 'var(--dsw-alias-brand-primary,#7c9cff)',
    input: 'var(--dsw-alias-state-warning-primary,#e0a33e)',
    output: 'var(--dsw-alias-state-success-primary,#4caf82)',
    cacheWrite: 'var(--dsw-alias-state-error-primary,#f2a1a1)',
  }
  const total = items.reduce((s, i) => s + (i.value || 0), 0)
  const shown = items.filter((i) => i.value > 0)

  if (total === 0) return h('p', { className: 'ub-hint' }, '暂无用量数据。')

  let acc = 0
  const stops = shown.map((i) => {
    const start = (acc / total) * 100
    acc += i.value
    const end = (acc / total) * 100
    return `${colors[i.key]} ${start}% ${end}%`
  }).join(', ')

  const tierLabel = tierModel === '_default' ? '默认档' : modelLabel({ model: tierModel, label: undefined })

  return h('div', { className: 'ub-pie-w' },
    h('div', { className: 'ub-pie', style: { background: `conic-gradient(${stops})` } },
      h('div', { className: 'ub-pie-hole' },
        h('span', { className: 'ub-pie-n' }, fmtTokens(total)),
        h('span', { className: 'ub-pie-s' }, '总 tokens'),
      ),
    ),
    h('div', { className: 'ub-legend' },
      shown.map((i) => h('div', { key: i.key, className: 'ub-leg-row' },
        h('span', { className: 'ub-dot', style: { background: colors[i.key] } }),
        h('span', { className: 'ub-ell' }, i.label),
        h('span', { className: 'ub-leg-v' }, fmtTokens(i.value) + ' · ' + fmtPct(i.value / total)),
        h('span', { className: 'ub-leg-p' }, '¥' + i.price + '/M'),
      )),
      h('p', { className: 'ub-hint' }, `单价档：${tierLabel}`),
    ),
  )
}

/** 逐日柱状图。 */
function DayBars(props) {
  const days = (props.days || []).slice(-30)
  const cost = props.dayCost
  const currency = props.currency
  const max = Math.max(1, ...days.map((d) => d.input + d.output))
  return h('div', { className: 'ub-bars' },
    days.map((d) => {
      const value = d.input + d.output
      const height = value > 0 ? Math.max(3, (value / max) * 118) : 1
      const c = cost.get(d.date)
      const title = `${d.date}\n输入 ${fmtExact(d.input)} · 输出 ${fmtExact(d.output)}\n缓存读 ${fmtExact(d.cacheRead)}\n费用 ${c === undefined ? fmtCost(d.cost, currency) : fmtCost(c, currency)}`
      return h('div', { key: d.date, className: 'ub-bar-c', title },
        h('div', { className: 'ub-bar', style: { height } }),
        h('span', { className: 'ub-bar-x' }, d.date.slice(8)),
      )
    }),
  )
}

/**
 * 24 小时分布的刻度。小时列很窄（24 列），把每个数字都塞在柱下会互相挤，
 * 因此只标 4 个主刻度，用百分比定位对齐到整点边界。
 * @param props.count - 列数（24）。
 * @param props.every - 每几小时一个刻度。
 * @returns 刻度条。
 */
function HourAxis(props) {
  const count = props.count || 24
  const every = props.every || 6
  const pct = (hour) => ((hour + 0.5) / count) * 100
  const labels = []
  for (let hour = 0; hour < count; hour += every) {
    labels.push({ hour, left: pct(hour) })
  }
  labels.push({ hour: count, left: 100, edge: 'end' })

  return h('div', { className: 'ub-axis' },
    labels.map((l) => h('span', {
      key: l.hour,
      className: 'ub-axis-l' + (l.edge === 'end' ? ' ub-axis-l-end' : ''),
      style: l.edge === 'end' ? { left: '100%' } : { left: l.left + '%' },
    }, String(l.hour).padStart(2, '0'))),
  )
}

/**
 * 24 小时分布（高峰时段高亮）。
 *
 * 柱子与刻度分成两行：柱子只占满自己的列（`flex:1`），刻度单独一条对齐轴，
 * 与逐日柱状图一致——这样高峰/空闲柱高不会因刻度文字的有无而错位。
 */
function HourBars(props) {
  const hours = props.hours || []
  const pricing = props.pricing
  const currency = props.currency
  const max = Math.max(1, ...hours.map((x) => x.input + x.output + x.cacheRead + x.cacheWrite))
  return h('div', null,
    h('div', { className: 'ub-bars' },
      hours.map((x) => {
        const peak = inPeakSlot(x.hour, pricing)
        const tokens = x.input + x.output + x.cacheRead + x.cacheWrite
        const height = tokens > 0 ? Math.max(3, (tokens / max) * 118) : 1
        const title = `${String(x.hour).padStart(2, '0')}:00 · ${peak ? '高峰时段' : '空闲时段'}\n总 ${fmtExact(tokens)}\n费用 ${fmtCost(x.cost, currency)}`
        return h('div', { key: x.hour, className: 'ub-bar-c', title },
          h('div', { className: 'ub-bar' + (peak ? ' peak' : ''), style: { height } }),
        )
      }),
    ),
    h(HourAxis, { count: hours.length || 24, every: 6 }),
  )
}

/** 把连续日期补全成 `YYYY-MM-DD` 序列（含端点）。 */
function dateRange(from, to) {
  const out = []
  const start = new Date(from + 'T00:00:00')
  const end = new Date(to + 'T00:00:00')
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  return out
}

/** 有数据的日期（升序）。 */
function activeDatesOf(overview) {
  return [...new Set((overview.byDayHour || []).map((b) => b.date))].sort()
}

/**
 * 热力图的时间窗。返回窗口大小与右端点在「有数据日期」列表里的索引，以及 setter。
 *
 * 两个刻意的设计：
 *
 * 1. **状态里存的是「请求值」，不夹回**。首帧数据还没到（`total === 0`），若此时
 *    按 `total` 夹一次，请求的 30 天会被压成 1 天并永久留在 state 里——后面数据到了
 *    也回不去（我实测踩过：窗口卡在「1 天」）。夹回只在渲染期做。
 * 2. **右端用相对锚点**，不存绝对索引。用户没动过滑块时，右端应始终跟着「最新
 *    一天」走；存绝对索引会让「最新」停在数据第一次到达的那一天。
 *
 * @param dates - 有数据的日期（升序）。
 * @param initial - 可选初始值 `{ size, end }`（自测用；界面不传）。
 * @returns `{ size, end, setSize, setEnd, slice, from, total }`。
 */
function useHeatWindow(dates, initial) {
  const total = dates.length
  const maxSize = Math.max(1, total)
  const maxEnd = Math.max(0, total - 1)
  const clamp = (v, lo, hi) => Math.min(Math.max(lo, v), hi)

  // size：`null` = 跟随默认（30 天，上限为全部）
  const [sizeRaw, setSizeRaw] = React.useState(() =>
    initial && Number.isFinite(initial.size) ? initial.size : null)
  // end：`null` = 跟随最新；数字 = 用户手动选定的右端
  const [endRaw, setEndRaw] = React.useState(() =>
    initial && Number.isFinite(initial.end) ? initial.end : null)

  const size = sizeRaw === null ? Math.min(30, maxSize) : clamp(sizeRaw, 1, maxSize)
  const end = endRaw === null ? maxEnd : clamp(endRaw, 0, maxEnd)
  const from = Math.max(0, end - size + 1)

  const setSize = (next) => setSizeRaw(clamp(next, 1, maxSize))
  const setEnd = (next) => setEndRaw(clamp(next, 0, maxEnd))
  return { size, end, setSize, setEnd, slice: dates.slice(from, end + 1), from, total }
}

/**
 * 热力图的时间窗控件：预设 + 窗口大小 + 右端点。
 *
 * 逐日柱状图只画 30 天，但热力图能一屏放下更多；更早的时段靠这里的滑块平移查看。
 * 右端点用日期标签显示，避免用户对着裸索引猜。
 */
function HeatWindow(props) {
  const dates = props.dates
  const win = props.win
  if (dates.length <= 1) return null

  const label = (i) => (dates[i] === undefined ? '' : dates[i].slice(5).replace('-', '/'))
  const presets = [30, 90, 180]
  const shown = win.slice

  return h('div', { className: 'ub-win' },
    h('div', { className: 'ub-win-row' },
      h('span', { className: 'ub-win-lbl' }, '时段'),
      h('button', {
        type: 'button',
        className: 'ub-btn ub-btn-sm',
        onClick: () => { win.setSize(Math.min(30, dates.length)); win.setEnd(dates.length - 1) },
      }, '最近 30 天'),
      presets.slice(1).map((n) => h('button', {
        key: n,
        type: 'button',
        className: 'ub-btn ub-btn-sm',
        onClick: () => { win.setSize(Math.min(n, dates.length)); win.setEnd(dates.length - 1) },
      }, `最近 ${n} 天`)),
      h('button', {
        type: 'button',
        className: 'ub-btn ub-btn-sm',
        onClick: () => win.setSize(dates.length),
      }, `全部（${dates.length} 天）`),
      h('span', { className: 'ub-win-val' },
        `${shown.length} 天 · ${shown[0] || '—'} → ${shown[shown.length - 1] || '—'}`),
    ),
    h('label', { className: 'ub-win-row' },
      h('span', { className: 'ub-win-lbl' }, '窗口'),
      h('input', {
        type: 'range', min: 1, max: dates.length, step: 1, value: win.size,
        className: 'ub-range',
        onChange: (e) => win.setSize(Number(e.target.value)),
      }),
      h('span', { className: 'ub-win-num' }, `${win.size} 天`),
    ),
    h('label', { className: 'ub-win-row' },
      h('span', { className: 'ub-win-lbl' }, '右端'),
      h('input', {
        type: 'range', min: 0, max: Math.max(0, dates.length - 1), step: 1, value: win.end,
        className: 'ub-range',
        onChange: (e) => win.setEnd(Number(e.target.value)),
      }),
      h('span', { className: 'ub-win-num' }, label(win.end)),
    ),
  )
}

/** 日期 × 小时消耗热力（窗口由滑块决定）。 */
function DayHourHeatmap(props) {
  const buckets = props.buckets || []
  const pricing = props.pricing
  const currency = props.currency
  const map = new Map()
  let max = 1
  for (const b of buckets) {
    map.set(b.date + '|' + b.hour, b)
    max = Math.max(max, bucketTokens(b))
  }
  // `dates` 由调用方裁好窗口后传入；缺省回落到「近 30 个有数据的日期」。
  const dates = props.dates || [...new Set(buckets.map((b) => b.date))].sort().slice(-30)
  const WK = ['日', '一', '二', '三', '四', '五', '六']

  return h('div', null,
    h('div', { className: 'ub-heat' },
      dates.map((date) => {
        const wd = new Date(date + 'T00:00:00').getDay()
        const kind = dayKind(date, wd, pricing)
        // 行标签按当天性质着色/标注：节假日、调休上班、普通周末各不相同。
        const rowCls = kind === 'holiday' ? ' hol' : kind === 'makeup' ? ' mu' : kind === 'weekend' ? ' wk' : ''
        const tag = kind === 'holiday' ? ' 🎉假期' : kind === 'makeup' ? ' 💼调休上班' : ''
        const dayWord = kind === 'holiday'
          ? '法定节假日（全天空闲）'
          : kind === 'makeup'
            ? (weekendRelaxActive(date, pricing) ? '调休上班的周末（全天按空闲价）' : '调休上班的周末（周末规则未生效，仍分峰谷）')
            : kind === 'weekend'
              ? (weekendRelaxActive(date, pricing) ? '周末（全天空闲）' : '周末（仍分峰谷）')
              : '工作日'
        const allDayOffPeak = dayAllDayOffPeak(date, wd, pricing)
        return h('div', { key: date, className: 'ub-heat-r' },
          h('span', { className: 'ub-heat-l' + rowCls, title: dayWord },
            date.slice(5).replace('-', '/') + ' 周' + WK[wd] + tag),
          Array.from({ length: 24 }, (_, hour) => {
            const b = map.get(date + '|' + hour)
            const value = b ? bucketTokens(b) : 0
            const level = value > 0 ? Math.min(4, Math.ceil((value / max) * 4)) : 0
            const peak = isPeakAt(date, wd, hour, pricing)
            const cls = 'ub-cell l' + level + (peak ? ' peak' : '') + (allDayOffPeak ? ' wk' : '')
            const title = b
              ? `${date} ${String(hour).padStart(2, '0')}:00 周${WK[wd]} · ${dayWord} · ${peak ? '高峰' : '空闲'}\n输入 ${fmtExact(b.input)} · 输出 ${fmtExact(b.output)}\n缓存读 ${fmtExact(b.cacheRead)}\n费用 ${fmtCost(costOfBucket(b, pricing), currency)}`
              : `${date} ${String(hour).padStart(2, '0')}:00 · ${dayWord}`
            return h('div', { key: hour, className: cls, title })
          }),
        )
      }),
    ),
    h('div', { className: 'ub-hl' },
      h('span', null, '少'),
      [0, 1, 2, 3, 4].map((l) => h('span', { key: l, className: 'ub-cell l' + l })),
      h('span', null, '多'),
      h('span', { className: 'ub-pill' }, '描边 = 高峰时段'),
      h('span', { className: 'ub-pill' }, '绿框 = 全天按空闲价（周末或法定节假日）'),
      h('span', { className: 'ub-pill' }, '🎉假期 全天按空闲价'),
      h('span', { className: 'ub-pill' }, '💼调休上班的周末 同样全天按空闲价'),
    ),
  )
}

/**
 * GitHub 风格年度热力图。
 *
 * 分档阈值按**当前窗口内**的数据重算，否则放大到某一段时间后整片都会是同一档。
 */
function YearHeatmap(props) {
  const byDay = props.byDay || []
  const currency = props.currency
  const map = new Map(byDay.map((d) => [d.date, d]))

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const to = props.to || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const from = props.from || (() => {
    const start = new Date(today)
    start.setDate(start.getDate() - 364)
    return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
  })()

  const allDates = dateRange(from, to)
  // 分档只看窗口内的数据，跨度大时整片同色的问题因此消失。
  const values = allDates
    .map((key) => map.get(key))
    .filter(Boolean)
    .map((d) => d.input + d.output)
    .sort((a, b) => a - b)
  const quantile = (p) => values[Math.min(values.length - 1, Math.floor(values.length * p))] || 0
  const t1 = quantile(0.25) || 1
  const t2 = quantile(0.5) || 1
  const t3 = quantile(0.75) || 1

  const weeks = []
  let week = []
  for (const key of allDates) {
    const day = map.get(key)
    const total = day ? day.input + day.output : 0
    let level = 0
    if (total > 0) level = total > t3 ? 4 : total > t2 ? 3 : total > t1 ? 2 : 1
    const title = day
      ? `${key}\n输入 ${fmtExact(day.input)} · 输出 ${fmtExact(day.output)}\n费用 ${fmtCost(day.cost, currency)}`
      : key
    week.push({ key, level, title })
    if (week.length === 7) { weeks.push(week); week = [] }
  }
  if (week.length > 0) weeks.push(week)

  return h('div', null,
    h('div', { className: 'ub-hm' },
      weeks.map((w, wi) => h('div', { key: wi, className: 'ub-hm-c' },
        w.map((c) => h('div', { key: c.key, className: 'ub-cell l' + c.level, title: c.title })),
      )),
    ),
    h('div', { className: 'ub-hl' },
      h('span', null, '少'),
      [0, 1, 2, 3, 4].map((l) => h('span', { key: l, className: 'ub-cell l' + l })),
      h('span', null, '多'),
      h('span', { className: 'ub-pill' }, `${allDates.length} 天 · ${from} → ${to}`),
    ),
  )
}

/* ------------------------------------------------------------------ 面板 */

/* ------------------------------------------------- 卡片目录与「显示哪些」 */

/**
 * 主界面卡片的可选目录。
 *
 * 用户点「卡片显示」即可勾选要看哪几项，选择记在 localStorage 里（不经过主机，
 * 因此不需要给插件加任何写入路由）。全部取消即「什么都不显示」。
 */
const CARD_CATALOG = [
  { key: 'totalCost', label: '累计消费额', hint: '全部会话的峰谷实时费用' },
  { key: 'totalTokens', label: '累计 token 用量', hint: '输入 + 输出 + 缓存读 + 缓存写' },
  { key: 'todayCost', label: '今日消费金额', hint: '按统计时区的「今天」' },
  { key: 'todayTokens', label: '今日 token 用量', hint: '按统计时区的「今天」' },
  { key: 'byModel', label: '按模型拆分', hint: '每个模型的 token 与费用' },
  { key: 'cacheRead', label: '缓存读取', hint: '命中缓存的输入 token' },
  { key: 'sessions', label: '会话数', hint: '有用量的会话个数' },
  { key: 'activeDays', label: '活跃天数', hint: '有用量的天数' },
  { key: 'savings', label: '相对全高峰节省', hint: '空闲时段省下的钱' },
  { key: 'peakShare', label: '高峰 token 占比', hint: '高峰时段用掉的 token 比例' },
]

/** 卡片选择的存储键。 */
const CARD_STORAGE_KEY = 'dsh-usage-billing-19pt.cards'

/** 默认显示的四张卡。 */
const DEFAULT_CARD_KEYS = ['totalCost', 'totalTokens', 'todayCost', 'todayTokens']

/** 目录里全部合法的卡片 key。 */
const CARD_KEYS = CARD_CATALOG.map((card) => card.key)

/** 读取卡片选择；localStorage 缺失 / 损坏时回落到默认。 */
function readCardSelection() {
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) return DEFAULT_CARD_KEYS.slice()
    const raw = localStorage.getItem(CARD_STORAGE_KEY)
    if (raw === null) return DEFAULT_CARD_KEYS.slice()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_CARD_KEYS.slice()
    // 过滤掉目录里已不存在的 key，避免旧版本的选择让卡片凭空消失。
    return parsed.filter((key) => typeof key === 'string' && CARD_KEYS.indexOf(key) !== -1)
  } catch {
    return DEFAULT_CARD_KEYS.slice()
  }
}

/** 保存卡片选择（失败无所谓，只影响本机下次打开的便利性）。 */
function writeCardSelection(keys) {
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) return
    localStorage.setItem(CARD_STORAGE_KEY, JSON.stringify(keys))
  } catch {
    // 忽略：隐私模式 / 配额满都可能抛。
  }
}

/* ------------------------------------------------------------ 今日与汇总 */

/** 某个时间戳在指定时区下的 `YYYY-MM-DD`。 */
function dateKeyInZone(ts, timezone) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      ...(timezone ? { timeZone: timezone } : {}),
      year: 'numeric', month: '2-digit', day: '2-digit',
    })
    const parts = formatter.formatToParts(new Date(ts))
    let year = '', month = '', day = ''
    for (const part of parts) {
      if (part.type === 'year') year = part.value
      else if (part.type === 'month') month = part.value
      else if (part.type === 'day') day = part.value
    }
    if (year !== '' && month !== '' && day !== '') return `${year}-${month}-${day}`
  } catch {
    // 时区名非法：回落到本地时区。
  }
  const fallback = new Date(ts)
  return `${fallback.getFullYear()}-${String(fallback.getMonth() + 1).padStart(2, '0')}-${String(fallback.getDate()).padStart(2, '0')}`
}

/**
 * 「今天」在统计时区下的 `YYYY-MM-DD`。
 * @param timezone - IANA 时区名；缺省用本地时区。
 * @returns 今天的日期键。
 */
function todayKeyInZone(timezone) {
  return dateKeyInZone(Date.now(), timezone)
}

/**
 * 汇总一组日期×小时桶：token、费用、全高峰口径，以及按模型拆开的 token / 费用。
 * @param buckets - `byDayHour` 的子集。
 * @param pricing - 当前规则。
 * @returns 汇总结果。
 */
function summarizeBuckets(buckets, pricing) {
  let tokens = 0
  let cost = 0
  let baseline = 0
  const modelTokens = new Map()
  const modelCost = new Map()

  for (const bucket of buckets) {
    const base = baselineCostOfBucket(bucket, pricing)
    const multiplier = isPeakAt(bucket.date, bucket.weekday, bucket.hour, pricing)
      ? 1
      : (pricing && typeof pricing.offPeakMultiplier === 'number' ? pricing.offPeakMultiplier : 0.5)
    tokens += bucketTokens(bucket)
    cost += base * multiplier
    baseline += base
    for (const model of Object.keys(bucket.models || {})) {
      const t = bucket.models[model]
      const p = priceOfModel(model, pricing)
      const raw = (t.input * p.inputPerM + t.output * p.outputPerM
        + t.cacheRead * p.cacheReadPerM + t.cacheWrite * p.cacheWritePerM) / 1e6
      modelTokens.set(model, (modelTokens.get(model) || 0) + t.input + t.output + t.cacheRead + t.cacheWrite)
      modelCost.set(model, (modelCost.get(model) || 0) + raw * multiplier)
    }
  }
  return { tokens, cost, baseline, modelTokens, modelCost }
}

/* ------------------------------------------------- 本日消费时段分布 */

/** 时区下的星期（0 = 周日）。 */
const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/**
 * 某个时间戳在指定时区下的星期（0 = 周日）。
 * @param ts - epoch 毫秒。
 * @param timezone - IANA 时区名；缺省用本地时区。
 * @returns 0-6。
 */
function weekdayInZone(ts, timezone) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      ...(timezone ? { timeZone: timezone } : {}),
      weekday: 'short',
    })
    for (const part of formatter.formatToParts(new Date(ts))) {
      if (part.type === 'weekday') {
        const index = WEEKDAY_INDEX[part.value]
        if (typeof index === 'number') return index
      }
    }
  } catch {
    // 时区名非法：回落到本地时区。
  }
  return new Date(ts).getDay()
}

/**
 * 把「某一天」的日期×小时桶汇总成 24 条时段数据（纯函数，便于单测）。
 *
 * 费用按每个桶的峰谷系数算：桶自带 `date` / `weekday` / `hour`，因此
 * 节假日、周末、调休周末都能正确落到「全天空闲」。
 *
 * @param buckets - `overview.byDayHour`。
 * @param date - 目标日期（统计时区下的 `YYYY-MM-DD`）。
 * @param fallbackWeekday - 当天没有任何桶时使用的星期。
 * @param pricing - 当前规则。
 * @returns `{ hours, weekday }`，`hours` 固定 24 条。
 */
function summarizeTodayHours(buckets, date, fallbackWeekday, pricing) {
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, cost: 0, tokens: 0, peak: false }))
  let weekday = fallbackWeekday
  for (const bucket of buckets || []) {
    if (bucket.date !== date) continue
    weekday = bucket.weekday
    hours[bucket.hour].cost += costOfBucket(bucket, pricing)
    hours[bucket.hour].tokens += bucketTokens(bucket)
  }
  for (const row of hours) row.peak = isPeakAt(date, weekday, row.hour, pricing)
  return { hours, weekday }
}

/**
 * 本日消费时段分布：今天 24 个小时各自的**费用**（高峰时段高亮）。
 * @param props.hours / props.currency
 * @returns 柱状图 + 独立刻度行。
 */
function TodayCostBars(props) {
  const hours = props.hours || []
  const currency = props.currency
  const max = hours.reduce((m, x) => Math.max(m, x.cost), 0)
  const scale = max > 0 ? max : 1
  return h('div', null,
    h('div', { className: 'ub-bars' },
      hours.map((x) => {
        const height = x.cost > 0 ? Math.max(3, (x.cost / scale) * 118) : 1
        const title = `${String(x.hour).padStart(2, '0')}:00 · ${x.peak ? '高峰时段' : '空闲时段'}`
          + `\n费用 ${fmtCost(x.cost, currency)}\n总 ${fmtExact(x.tokens)} tokens`
        return h('div', { key: x.hour, className: 'ub-bar-c', title },
          h('div', { className: 'ub-bar' + (x.peak ? ' peak' : ''), style: { height } }),
        )
      }),
    ),
    h(HourAxis, { count: hours.length || 24, every: 6 }),
  )
}

/* ------------------------------------------------------ 分页（8 行滑块） */

/** 每个列表一页显示多少行。 */
const PAGE_SIZE = 8

/**
 * 分页的纯计算部分（夹回在这里做，便于单测）。
 * @param total - 总行数。
 * @param size - 每页行数（<= 0 时用 {@link PAGE_SIZE}）。
 * @param pageRaw - 请求的页号（可能越界）。
 * @returns `{ page, pages, from, to, size }`，`from` 为起始下标、`to` 为结束下标（不含）。
 */
function pagerState(total, size, pageRaw) {
  const perPage = size > 0 ? size : PAGE_SIZE
  const pages = Math.max(1, Math.ceil(total / perPage))
  const page = Math.min(Math.max(0, pageRaw), pages - 1)
  const from = page * perPage
  const to = Math.min(total, from + perPage)
  return { page, pages, from, to, size: perPage }
}

/**
 * 列表分页状态。夹回在渲染期做，避免数据还没到就把请求值压死
 * （与 `useHeatWindow` 同一个坑）。
 * @param total - 总行数。
 * @param perPage - 每页行数。
 * @returns `{ page, pages, setPage, from, to, size }`。
 */
function usePager(total, perPage) {
  const [pageRaw, setPageRaw] = React.useState(0)
  const state = pagerState(total, perPage, pageRaw)
  const setPage = (next) => setPageRaw(Math.min(Math.max(0, next), state.pages - 1))
  return { page: state.page, pages: state.pages, setPage, from: state.from, to: state.to, size: state.size }
}

/**
 * 滑块式分页控件：范围输入 + 上下页。
 * @param props.total / props.pager / props.noun / props.ariaLabel
 * @returns 分页条。
 */
function Pager(props) {
  const total = props.total || 0
  const pager = props.pager
  const noun = props.noun || '行'

  if (total === 0 || pager.pages <= 1) {
    return h('div', { className: 'ub-pager' },
      h('span', { className: 'ub-pager-info' },
        total === 0 ? '暂无数据' : `共 ${total} ${noun} · 每次最多 ${pager.size} 行`),
    )
  }

  return h('div', { className: 'ub-pager' },
    h('button', {
      type: 'button',
      className: 'ub-btn ub-btn-sm',
      disabled: pager.page === 0,
      onClick: () => pager.setPage(pager.page - 1),
    }, '‹ 上一页'),
    h('input', {
      type: 'range',
      className: 'ub-range ub-pager-range',
      min: 1,
      max: pager.pages,
      step: 1,
      value: pager.page + 1,
      'aria-label': props.ariaLabel || '翻页',
      onChange: (event) => pager.setPage(Number(event.target.value) - 1),
    }),
    h('button', {
      type: 'button',
      className: 'ub-btn ub-btn-sm',
      disabled: pager.page >= pager.pages - 1,
      onClick: () => pager.setPage(pager.page + 1),
    }, '下一页 ›'),
    h('span', { className: 'ub-pager-info' },
      `第 ${pager.page + 1}/${pager.pages} 页 · ${pager.from + 1}–${pager.to} / 共 ${total} ${noun}`),
  )
}

/**
 * 条形列表（对齐参考实现的「Top N」观感：标题 + 数值 + 比例条）。
 * @param props.rows - `{ key, title, value, pct, warn }`。
 * @returns 列表。
 */
function BarRows(props) {
  const rows = props.rows || []
  if (rows.length === 0) return h('p', { className: 'ub-hint' }, props.empty || '暂无数据')
  return h('div', { className: 'ub-rows' },
    rows.map((row) => h('div', { key: row.key, className: 'ub-row' },
      h('div', { className: 'ub-row-head' },
        h('span', { className: 'ub-row-title', title: row.title }, row.title),
        h('span', { className: 'ub-row-value' }, row.value),
      ),
      h('div', { className: 'ub-track' },
        h('div', {
          className: 'ub-fill' + (row.warn ? ' warn' : ''),
          style: { width: Math.max(1, Math.round(row.pct * 100)) + '%' },
        }),
      ),
    )),
  )
}

/**
 * 导出一个 URL（用隐藏 `<a download>`，文件名由服务端 Content-Disposition 给出）。
 * @param url - 导出地址。
 */
function download(url) {
  try {
    if (typeof document === 'undefined' || document === null || document.body === null) return
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = ''
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } catch {
    // 下载失败不该让面板崩掉。
  }
}

/* ------------------------------------------------------------------ 卡片 */

/**
 * 单张统计卡（样式对齐参考实现：细边框 + 分层底色 + 8px 圆角，无阴影）。
 * @param props.label / props.value / props.sub / props.accent / props.children
 * @returns 卡片。
 */
function Card(props) {
  const derived = props.children !== undefined && props.children !== null
    ? props.children
    : h('div', { className: 'ub-card-value' + (props.accent ? ' ub-cost' : ''), title: props.value }, props.value)
  return h('div', { className: 'ub-card' + (props.wide ? ' wide' : '') },
    h('div', { className: 'ub-card-label' }, props.label),
    derived,
    props.sub ? h('div', { className: 'ub-card-sub', title: props.sub }, props.sub) : null,
  )
}

/**
 * 一张卡片的内容（按 key 分派）。
 * @param props.cardKey / props.ctx
 * @returns 卡片。
 */
function StatCard(props) {
  const cardKey = props.cardKey
  const ctx = props.ctx
  const overview = ctx.overview
  const t = overview.totals
  const billing = ctx.billing
  const today = ctx.today

  if (cardKey === 'totalCost') {
    return h(Card, {
      label: '累计消费额', value: fmtCost(billing.total, 'CNY'), accent: true,
      sub: `全高峰 ${fmtCost(billing.baseline, 'CNY')} · 省 ${fmtCost(billing.savings, 'CNY')}`,
    })
  }
  if (cardKey === 'totalTokens') {
    return h(Card, {
      label: '累计 token 用量', value: fmtTokens(t.tokens),
      sub: `输入 ${fmtTokens(t.input)} / 输出 ${fmtTokens(t.output)}`,
    })
  }
  if (cardKey === 'todayCost') {
    return h(Card, {
      label: '今日消费金额', value: fmtCost(today.cost, 'CNY'), accent: true,
      sub: `${today.date} · 全高峰 ${fmtCost(today.baseline, 'CNY')}`,
    })
  }
  if (cardKey === 'todayTokens') {
    return h(Card, {
      label: '今日 token 用量', value: fmtTokens(today.tokens),
      sub: today.buckets > 0 ? `${today.date} · ${today.buckets} 个小时段` : `${today.date} · 暂无用量`,
    })
  }
  if (cardKey === 'cacheRead') {
    return h(Card, {
      label: '缓存读取', value: fmtTokens(t.cacheRead),
      sub: `写入 ${fmtTokens(t.cacheWrite)} · 占总 ${fmtPct(t.tokens > 0 ? t.cacheRead / t.tokens : 0)}`,
    })
  }
  if (cardKey === 'sessions') {
    return h(Card, { label: '会话数', value: String(t.sessions), sub: `活跃 ${t.activeDays} 天` })
  }
  if (cardKey === 'activeDays') {
    return h(Card, { label: '活跃天数', value: String(t.activeDays), sub: `会话 ${t.sessions} 个` })
  }
  if (cardKey === 'savings') {
    return h(Card, {
      label: '相对全高峰节省', value: fmtCost(billing.savings, 'CNY'), accent: true,
      sub: `高峰 ${fmtCost(billing.peakCost, 'CNY')} / 空闲 ${fmtCost(billing.offPeakCost, 'CNY')}`,
    })
  }
  if (cardKey === 'peakShare') {
    return h(Card, {
      label: '高峰 token 占比', value: fmtPct(billing.peakShare),
      sub: '剩余为按空闲价计费的 token',
    })
  }

  // byModel：一张跨两列的卡，逐模型列出 token 与费用。
  const models = (overview.byModel || []).slice(0, 5)
  return h(Card, {
    label: '按模型拆分（前 5）', wide: true,
    value: `${overview.byModel.length} 个模型`,
    sub: '完整清单见下方「模型构成」',
    children: h('div', { className: 'ub-card-models' },
      models.length === 0
        ? h('span', { className: 'ub-hint' }, '暂无数据')
        : models.map((model) => {
          const cost = billing.modelCost.get(model.model)
          return h('div', { key: model.model, className: 'ub-card-model' },
            h('span', { className: 'ub-ell', title: model.model }, modelLabel(model)),
            h('span', { className: 'ub-card-model-num' },
              fmtTokens(model.input + model.output + model.cacheRead + model.cacheWrite)),
            h('span', { className: 'ub-card-model-cost' },
              fmtCost(cost === undefined ? model.cost : cost, currencyOf(model.model))),
          )
        }),
    ),
  })
}

/**
 * 卡片区 + 「显示哪些卡片」勾选器。
 * @param props.ctx / props.selection / props.onToggle / props.onReset / props.onClear
 * @returns 卡片区。
 */
function CardBoard(props) {
  const selection = props.selection
  const ctx = props.ctx

  const board = selection.length === 0
    ? h('p', { className: 'ub-hint' },
      '已隐藏全部卡片。展开下面的「卡片显示」可重新勾选；数据与下方各分析区块不受影响。')
    : h('div', { className: 'ub-stats-row' },
      selection.map((key) => h(StatCard, { key, cardKey: key, ctx })))

  return h('div', { className: 'ub-sec' },
    board,
    h('details', { className: 'ub-details' },
      h('summary', null, `卡片显示（已选 ${selection.length}/${CARD_CATALOG.length}）`),
      h('div', { className: 'ub-picker' },
        CARD_CATALOG.map((card) => h('label', {
          key: card.key,
          className: 'ub-check',
          title: card.hint,
        },
          h('input', {
            type: 'checkbox',
            checked: selection.indexOf(card.key) !== -1,
            onChange: () => props.onToggle(card.key),
          }),
          h('span', null, card.label),
        )),
      ),
      h('div', { className: 'ub-picker-actions' },
        h('button', { type: 'button', className: 'ub-btn ub-btn-sm', onClick: () => props.onReset() }, '恢复默认'),
        h('button', { type: 'button', className: 'ub-btn ub-btn-sm', onClick: () => props.onClear() }, '全不显示'),
      ),
      h('p', { className: 'ub-hint' },
        '选择记在本机浏览器里（localStorage），不经过主机，因此插件仍然没有任何写入路由。'),
    ),
  )
}

/* ------------------------------------------------------ 三个列表（滑块） */

/**
 * 「按会话统计」：按**最后活动时间**降序，可折叠，每页最多 8 行。
 * @param props.rows / props.pricing / props.pager
 * @returns 区块。
 */
function SessionActivitySection(props) {
  const rows = props.rows
  const pager = props.pager
  const pageRows = rows.slice(pager.from, pager.to)

  return h('details', { className: 'ub-details', open: true },
    h('summary', null,
      `按会话统计（共 ${rows.length} 个 · 按最后活动排序 · 每次最多 ${pager.size} 行）`),
    h('div', { className: 'ub-table ub-table-tight' },
      h('div', { className: 'ub-tr h ub-r-sess' },
        h('span', null, '项目 / 会话'), h('span', null, '最后活动'),
        h('span', null, '输入'), h('span', null, '输出'), h('span', null, '缓存读'),
        h('span', null, '费用'), h('span', null, ''),
      ),
      pageRows.length === 0
        ? h('div', { className: 'ub-tr' }, h('span', { className: 'ub-hint' }, '暂无数据'))
        : pageRows.map((session) => {
          const cost = sessionCost(session, props.pricing)
          const open = props.expanded === session.id
          return h('div', { key: session.id },
            h('div', { className: 'ub-tr ub-r-sess hover' },
              h('span', { className: 'ub-ell', title: session.cwd || session.project },
                session.projectLabel + ' · ' + session.id.slice(0, 8)),
              h('span', null, fmtTime(session.lastTs)),
              h('span', null, fmtTokens(session.input)),
              h('span', null, fmtTokens(session.output)),
              h('span', null, fmtTokens(session.cacheRead)),
              h('span', { className: cost > 5 ? 'warn' : '' }, fmtCost(cost, props.currency || 'CNY')),
              h('span', null,
                h('button', {
                  type: 'button',
                  className: 'ub-btn ub-btn-sm',
                  onClick: () => props.onToggle(session.id),
                }, open ? '收起' : '分析'),
              ),
            ),
            open
              ? h(SessionDetail, {
                session,
                pricing: props.pricing,
                currency: props.currency || 'CNY',
                maxCost: props.maxCost,
              })
              : null,
          )
        }),
    ),
    h(Pager, { total: rows.length, pager, noun: '个会话', ariaLabel: '按会话统计翻页' }),
  )
}

/**
 * 「按会话消费」：按费用降序的条形列表，每页最多 8 行。
 * @param props.rows / props.pricing / props.pager
 * @returns 区块。
 */
function SessionCostSection(props) {
  const rows = props.rows
  const pager = props.pager
  const pageRows = rows.slice(pager.from, pager.to)
  let maxCost = 0
  for (const row of rows) maxCost = Math.max(maxCost, sessionCost(row, props.pricing))

  return h('div', { className: 'ub-sec' },
    h('h3', { className: 'ub-sec-t' },
      `按会话消费（共 ${rows.length} 个 · 每次最多 ${pager.size} 行）`),
    h(BarRows, {
      empty: '暂无数据',
      rows: pageRows.map((row) => {
        const cost = sessionCost(row, props.pricing)
        return {
          key: row.id,
          title: `${row.projectLabel} · ${row.id.slice(0, 8)}`,
          value: `${fmtCost(cost, 'CNY')} · ${row.events} 次 · 输入 ${fmtTokens(row.input)} / 输出 ${fmtTokens(row.output)}`,
          pct: maxCost > 0 ? cost / maxCost : 0,
        }
      }),
    }),
    h(Pager, { total: rows.length, pager, noun: '个会话', ariaLabel: '按会话消费翻页' }),
  )
}

/**
 * 「最近调用」：来自主机侧的 `overview.recent`（最新的 200 条），每页最多 8 行。
 * @param props.recent / props.pager
 * @returns 区块。
 */
function RecentCallsSection(props) {
  const rows = props.recent
  const pager = props.pager
  const pageRows = rows.slice(pager.from, pager.to)

  return h('div', { className: 'ub-sec' },
    h('h3', { className: 'ub-sec-t' },
      `最近调用（共 ${rows.length} 条 · 按时间倒序 · 每次最多 ${pager.size} 行）`),
    h('div', { className: 'ub-table ub-table-tight' },
      h('div', { className: 'ub-tr h ub-r-recent' },
        h('span', null, '时间'), h('span', null, '模型'), h('span', null, '时段'),
        h('span', null, '输入'), h('span', null, '输出'), h('span', null, '缓存读'), h('span', null, '费用'),
      ),
      pageRows.length === 0
        ? h('div', { className: 'ub-tr' }, h('span', { className: 'ub-hint' }, '暂无调用记录'))
        : pageRows.map((call, index) => h('div', {
          key: String(call.ts) + '-' + call.model + '-' + index,
          className: 'ub-tr ub-r-recent',
        },
          h('span', null, fmtTime(call.ts)),
          h('span', { className: 'ub-ell', title: call.session }, modelLabel({ model: call.model })),
          h('span', null, call.peak ? '高峰' : '空闲'),
          h('span', null, fmtTokens(call.input)),
          h('span', null, fmtTokens(call.output)),
          h('span', null, fmtTokens(call.cacheRead)),
          h('span', null, fmtCost(call.cost, 'CNY')),
        )),
    ),
    h(Pager, { total: rows.length, pager, noun: '条调用', ariaLabel: '最近调用翻页' }),
  )
}

/**
 * 主面板组件 —— 作为 `main` 槽里由侧栏导航选中的整页，不是设置小节。
 *
 * `main` 槽的 owner 调用是 `renderSlot('main', {}, { entryKey })`，**不传任何
 * owner props**；业务数据全部由注册方自己的 `inject` face 送进来。本页不需要
 * 任何来自 ctx 的东西（数据走自己的 HTTP 路由），因此 inject 返回空对象即可，
 * 组件也不再接收 `ctx`。
 */
function UsagePanel(props) {
  const [state, setState] = React.useState({ status: 'loading', overview: null, error: null, fetchedAt: 0, source: null, calendar: null })
  const [expanded, setExpanded] = React.useState(null)
  const [refreshing, setRefreshing] = React.useState(false)

  const load = React.useCallback(async (force) => {
    setRefreshing(true)
    try {
      const url = '/usage-billing/summary' + (force ? '?refresh=1' : '')
      const res = await fetch(url, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok || !body || body.ok !== true) {
        throw new Error((body && body.error) || `HTTP ${res.status}`)
      }
      setState({
        status: 'ready',
        overview: body.overview,
        error: null,
        fetchedAt: Date.now(),
        // `source` 由主机告诉我们这次是读缓存还是真扫描；`calendar` 是日历覆盖情况。
        source: typeof body.source === 'string' ? body.source : null,
        calendar: body.calendar || null,
      })
    } catch (error) {
      setState((prev) => ({
        status: prev.overview ? 'ready' : 'error',
        overview: prev.overview,
        error: error instanceof Error ? error.message : String(error),
        fetchedAt: prev.fetchedAt,
        source: prev.source,
        calendar: prev.calendar,
      }))
    } finally {
      setRefreshing(false)
    }
  }, [])

  React.useEffect(() => { void load(false) }, [load])

  const overview = state.overview

  const pricing = overview ? overview.pricing : null
  const billing = React.useMemo(
    () => (overview ? recompute(overview, pricing) : null),
    [overview, pricing],
  )

  // 热力图的时间窗。Hook 必须在任何提前 return 之前调用（Rules of Hooks），
  // 因此即使在 loading / error 分支下也照常求值。
  const heatDates = React.useMemo(
    () => (overview ? activeDatesOf(overview) : []),
    [overview],
  )
  const heatWin = useHeatWindow(heatDates, props && props.initialWindow)

  // 主界面卡片的可选显示项（记在本机 localStorage，不经过主机）。
  const [cards, setCards] = React.useState(() => readCardSelection())
  const toggleCard = (key) => setCards((prev) => {
    const chosen = prev.indexOf(key) === -1 ? prev.concat([key]) : prev.filter((item) => item !== key)
    // 按目录顺序归一，这样勾选先后不会改变卡片的排列。
    const ordered = CARD_KEYS.filter((item) => chosen.indexOf(item) !== -1)
    writeCardSelection(ordered)
    return ordered
  })
  const resetCards = () => {
    const next = DEFAULT_CARD_KEYS.slice()
    writeCardSelection(next)
    setCards(next)
  }
  const clearCards = () => {
    writeCardSelection([])
    setCards([])
  }

  // 「今日」汇总：按统计时区求今天的日期，再只取今天的日期×小时桶。
  const todayStats = React.useMemo(() => {
    const buckets = overview ? (overview.byDayHour || []) : []
    const date = todayKeyInZone(pricing ? pricing.timezone : undefined)
    const todayBuckets = buckets.filter((bucket) => bucket.date === date)
    const summary = summarizeBuckets(todayBuckets, pricing)
    return {
      date,
      buckets: todayBuckets.length,
      tokens: summary.tokens,
      cost: summary.cost,
      baseline: summary.baseline,
    }
  }, [overview, pricing])

  // 「本日消费时段分布」的数据：今天 24 个小时各自的费用与 token。
  const todayHours = React.useMemo(() => {
    const buckets = overview ? (overview.byDayHour || []) : []
    const fallbackWeekday = weekdayInZone(Date.now(), pricing ? pricing.timezone : undefined)
    return summarizeTodayHours(buckets, todayStats.date, fallbackWeekday, pricing).hours
  }, [overview, pricing, todayStats.date])

  // 三个列表的数据源与分页（都在提前 return 之前求值，遵守 Rules of Hooks）。
  const byActivity = React.useMemo(() => {
    const sessions = overview ? (overview.bySession || []) : []
    return sessions.slice().sort((left, right) => (right.lastTs || 0) - (left.lastTs || 0))
  }, [overview])
  const byCost = React.useMemo(() => {
    const sessions = overview ? (overview.bySession || []) : []
    return sessions.slice().sort((left, right) => sessionCost(right, pricing) - sessionCost(left, pricing))
  }, [overview, pricing])
  const recentCalls = React.useMemo(
    () => (overview && overview.recent ? overview.recent : []),
    [overview],
  )

  const activityPager = usePager(byActivity.length, PAGE_SIZE)
  const costPager = usePager(byCost.length, PAGE_SIZE)
  const recentPager = usePager(recentCalls.length, PAGE_SIZE)

  if (state.status === 'loading' && !overview) {
    return h('div', { className: 'ub-page' },
      h('div', { className: 'ub-page-head' },
        h('h1', { className: 'ub-page-title' }, '用量计费'),
      ),
      h('div', { className: 'ub-loading' }, '正在读取用量…（首次需扫描全部会话日志，之后走缓存秒开）'),
    )
  }

  const fromCache = state.source === 'cache'
  const head = h('div', { className: 'ub-head' },
    h('div', { className: 'ub-title' },
      h('h2', null, '用量计费'),
      h('p', { className: 'ub-sub' },
        overview
          ? `数据源 ${overview.home} · 读取 ${overview.scan.logsRead} 个日志（${fmtBytes(overview.scan.bytes)}，扫描耗时 ${overview.scan.elapsedMs} ms）`
          : '数据源未知'),
      state.fetchedAt
        ? h('p', { className: 'ub-sub' },
          fromCache
            ? `本次来自缓存（数据未变化），加载于 ${fmtTime(state.fetchedAt)}`
            : `本次为全量扫描（缓存已更新），加载于 ${fmtTime(state.fetchedAt)}`)
        : null,
    ),
    h('div', { className: 'ub-actions' },
      h('button', {
        type: 'button',
        className: 'ub-btn',
        disabled: refreshing,
        onClick: () => { void load(true) },
        title: '跳过缓存，重新读取全部会话日志并更新缓存',
      }, refreshing ? '扫描中…' : '再次扫描'),
      h('button', {
        type: 'button',
        className: 'ub-btn',
        onClick: () => download('/usage-billing/export?format=csv&scope=day'),
        title: '导出按日统计（CSV，带 BOM，Excel 可直接打开）',
      }, '导出 CSV（按日）'),
      h('button', {
        type: 'button',
        className: 'ub-btn',
        onClick: () => download('/usage-billing/export?format=csv&scope=session'),
        title: '导出按会话统计（CSV）',
      }, '导出 CSV（按会话）'),
      h('button', {
        type: 'button',
        className: 'ub-btn',
        onClick: () => download('/usage-billing/export?format=csv&scope=recent'),
        title: '导出最近调用（CSV）',
      }, '导出 CSV（最近调用）'),
      h('button', {
        type: 'button',
        className: 'ub-btn',
        onClick: () => download('/usage-billing/export?format=json'),
        title: '导出完整聚合结果（JSON，含当前计费规则）',
      }, '导出 JSON'),
    ),
  )

  if (state.status === 'error' && !overview) {
    return h('div', { className: 'ub-page' }, head,
      h('div', { className: 'ub-err' }, '读取用量失败：' + state.error),
      h('p', { className: 'ub-hint' },
        '请确认插件主机半边已加载（设置 → 插件），以及当前 profile 能读到会话目录。'),
    )
  }

  const t = overview.totals
  const currency = 'CNY'
  const peakText = (pricing.peakSlots || []).map((s) => `${s.start}:00-${s.end}:00`).join(' / ') || '未设置'
  const maxSessionCost = Math.max(0.01, ...overview.bySession.map((s) => sessionCost(s, pricing)))
  const last30 = (overview.byDay || []).slice(-30).reverse()

  // 日历覆盖提示：内置数据只到某一年，之后需要用户补充，这里明确告知。
  const cov = state.calendar
  const calendarText = cov
    ? `${(cov.years || []).join('、')} 年`
      + (cov.lastDate ? `（最后一个假期至 ${cov.lastDate}）` : '')
      + ((cov.conflicts || []).length > 0 ? ` ⚠ 有 ${cov.conflicts.length} 天同时被标为假期与调休` : '')
    : '—'

  return h('div', { className: 'ub-page' },
    head,

    state.error ? h('div', { className: 'ub-err' }, '刷新失败（显示上次结果）：' + state.error) : null,

    // ---- 概览卡片（显示项可自选）----
    h(CardBoard, {
      ctx: { overview, billing, today: todayStats },
      selection: cards,
      onToggle: toggleCard,
      onReset: resetCards,
      onClear: clearCards,
    }),

    // ---- 本日消费时段分布 ----
    h(Section, { title: '本日消费时段分布' },
      h('p', { className: 'ub-hint' },
        `${todayStats.date}（${pricing.timezone || '本地时区'}） · 合计 ${fmtCost(todayStats.cost, currency)}`
        + ` · 高峰时段 ${peakText}`
        + (todayStats.buckets > 0 ? ` · 覆盖 ${todayStats.buckets} 个小时段` : '')),
      h(TodayCostBars, { hours: todayHours, currency }),
      todayStats.buckets === 0
        ? h('p', { className: 'ub-hint' },
          '今天还没有用量。这里按统计时区的「今天」计算（刚过零点、或当天尚未调用模型时会是空的）。')
        : null,
    ),

    // ---- 构成 + 峰谷账单 ----
    h('div', { className: 'ub-cols' },
      h(Section, { title: 'Token 构成' },
        h(CompositionPie, {
          input: t.input, output: t.output, cacheRead: t.cacheRead, cacheWrite: t.cacheWrite, pricing,
        }),
      ),
      h(Section, { title: '峰谷账单（随单价规则实时重算）' },
        h('div', { className: 'ub-bill' },
          h('div', { className: 'ub-bill-c peak' },
            h('span', { className: 'ub-bill-l' }, '高峰费用'),
            h('span', { className: 'ub-bill-v' }, fmtCost(billing.peakCost, currency)),
          ),
          h('div', { className: 'ub-bill-c off' },
            h('span', { className: 'ub-bill-l' }, '空闲费用'),
            h('span', { className: 'ub-bill-v' }, fmtCost(billing.offPeakCost, currency)),
          ),
          h('div', { className: 'ub-bill-c save' },
            h('span', { className: 'ub-bill-l' }, '相对全高峰节省'),
            h('span', { className: 'ub-bill-v' }, fmtCost(billing.savings, currency)),
          ),
          h('div', { className: 'ub-bill-c' },
            h('span', { className: 'ub-bill-l' }, '高峰 token 占比'),
            h('span', { className: 'ub-bill-v' }, fmtPct(billing.peakShare)),
          ),
        ),
        h('p', { className: 'ub-hint' },
          `高峰：${peakText}（北京时间） · 空闲 = 高峰 × ${pricing.offPeakMultiplier}`,
          h('br'),
          pricing.weekendRelax
            ? (pricing.weekendRelaxFrom
              ? `周末全天空闲自 ${pricing.weekendRelaxFrom} 起生效（此前周末仍分峰谷）`
              : '周末全天空闲（始终生效）')
            : '周末区分峰谷',
          h('br'),
          '改单价 / 峰谷规则：设置 → 插件 → dsh-usage-billing-19pt。',        ),
      ),
    ),

    // ---- 模型构成 ----
    h(Section, { title: '模型构成（多模型分别计价）' },
      h('div', { className: 'ub-table' },
        h('div', { className: 'ub-tr h ub-r-model' },
          h('span', null, '模型'), h('span', null, 'tokens'), h('span', null, '费用'), h('span', null, '占比'),
        ),
        overview.byModel.length === 0
          ? h('div', { className: 'ub-tr' }, h('span', { className: 'ub-hint' }, '暂无数据'))
          : overview.byModel.map((m) => {
            const cost = billing.modelCost.get(m.model)
            const cur = currencyOf(m.model)
            return h('div', { key: m.model, className: 'ub-tr ub-r-model hover' },
              h('span', { className: 'ub-ell', title: m.model }, modelLabel(m)),
              h('span', null, fmtTokens(m.input + m.output + m.cacheRead + m.cacheWrite)),
              h('span', null, fmtCost(cost === undefined ? m.cost : cost, cur)),
              h('span', null, fmtPct(m.share)),
            )
          }),
      ),
      h('p', { className: 'ub-hint' },
        '「占比」按全部 token 计。历史日志里的模型 id 与当前目录可能不同，两者都在默认单价表中。'),
    ),

    // ---- 30 天柱状图 ----
    h(Section, { title: '最近 30 天消耗（输入 + 输出）' },
      overview.byDay.length === 0
        ? h('p', { className: 'ub-hint' }, '暂无数据')
        : h(DayBars, { days: overview.byDay, dayCost: billing.dayCost, currency }),
    ),

    // ---- 24 小时分布 ----
    h(Section, { title: '24 小时消耗分布（高峰时段高亮）' },
      h(HourBars, { hours: overview.byHour, pricing, currency }),
    ),

    // ---- 日期 × 小时热力（窗口由滑块控制） ----
    h(Section, { title: '日期 × 小时 消耗热力' },
      overview.byDayHour.length === 0
        ? h('p', { className: 'ub-hint' }, '暂无数据')
        : h('div', null,
          h(HeatWindow, { dates: heatDates, win: heatWin }),
          h(DayHourHeatmap, {
            buckets: overview.byDayHour,
            pricing,
            currency,
            dates: heatWin.slice,
          }),
        ),
    ),

    // ---- 年度热力图（同样受滑块控制，与上图共用窗口） ----
    h(Section, { title: 'Token 消耗热力图' },
      overview.byDay.length === 0
        ? h('p', { className: 'ub-hint' }, '暂无数据')
        : h(YearHeatmap, {
          byDay: overview.byDay,
          currency,
          from: heatWin.slice[0] || undefined,
          to: heatWin.slice[heatWin.slice.length - 1] || undefined,
        }),
    ),

    // ---- 按日明细 ----
    h(Section, { title: '最近 30 天明细' },
      h('div', { className: 'ub-table' },
        h('div', { className: 'ub-tr h ub-r-day' },
          h('span', null, '日期'), h('span', null, '输入'), h('span', null, '输出'), h('span', null, '缓存读'), h('span', null, '费用'),
        ),
        last30.map((d) => {
          const cost = billing.dayCost.get(d.date)
          const value = cost === undefined ? d.cost : cost
          return h('div', { key: d.date, className: 'ub-tr ub-r-day' + (value > 5 ? ' warn' : '') },
            h('span', null, d.date),
            h('span', null, fmtTokens(d.input)),
            h('span', null, fmtTokens(d.output)),
            h('span', null, fmtTokens(d.cacheRead)),
            h('span', null, fmtCost(value, currency)),
          )
        }),
      ),
    ),

    // ---- 按会话消费（Top，滑块分页）----
    h(SessionCostSection, { rows: byCost, pricing, pager: costPager }),

    // ---- 按会话统计（按最后活动排序，可折叠，滑块分页）----
    h(SessionActivitySection, {
      rows: byActivity,
      pricing,
      pager: activityPager,
      expanded,
      currency,
      maxCost: maxSessionCost,
      onToggle: (id) => setExpanded(expanded === id ? null : id),
    }),

    // ---- 最近调用（滑块分页）----
    h(RecentCallsSection, { recent: recentCalls, pager: recentPager }),

    // ---- 扫描信息 ----
    h(Section, { title: '扫描信息' },
      h('dl', { className: 'ub-kv' },
        h('dt', null, '数据目录'), h('dd', null, overview.home),
        h('dt', null, '会话目录 / 日志'), h('dd', null, `${overview.scan.sessionDirs} / ${overview.scan.logsRead}`),
        h('dt', null, '读取失败 / 缺日志'), h('dd', null, `${overview.scan.logsFailed} / ${overview.scan.logsMissing}`),
        h('dt', null, '日志格式分布'), h('dd', null, Object.keys(overview.scan.generations).sort()
          .map((g) => `gen${g}×${overview.scan.generations[g]}`).join('  ')),
        h('dt', null, '压缩体积 / 耗时'), h('dd', null, `${fmtBytes(overview.scan.bytes)} / ${overview.scan.elapsedMs} ms`),
        h('dt', null, '去重合并的采样'), h('dd', null, fmtExact(t.duplicateSamples)),
        h('dt', null, '本次取数'), h('dd', null, fromCache ? '缓存（数据未变化）' : '全量扫描'),
        h('dt', null, '节假日日历覆盖'), h('dd', null, calendarText),
      ),
      h('p', { className: 'ub-hint' },
        '同一 (轮次, 步) 的用量只计一次。旧格式（gen 0）会把同一份用量同时写在流式行与消息行上，',
        '按空白解析会正好翻倍；本插件按 (turn, step) 归一，同一份用量只算一次。'),
      h('p', { className: 'ub-hint' },
        '计费口径：中国法定节假日全天按空闲价；周六周日（含调休上班的周末）在周末规则生效后同样全天按空闲价；其余工作日按高峰时段。',
        '「再次扫描」会跳过缓存重新读取全部会话日志并更新缓存。'),
      overview.scan.timelessSamples > 0
        ? h('p', { className: 'ub-hint' },
          `有 ${fmtExact(overview.scan.timelessSamples)} 条用量采样在日志里没有时间戳，无法归入时段、也无法计价，因此未计入任何统计（含总费用与总量）。`)
        : null,
    ),

    // 作者署名：刻意做小做淡，放在整页最下面。
    h('p', { className: 'ub-credit' }, '作者 @1999Pt'),
  )
}

/** 单个会话的展开详情。 */
function SessionDetail(props) {
  const s = props.session
  const pricing = props.pricing
  const currency = props.currency

  const bill = React.useMemo(() => {
    let peak = 0
    let off = 0
    let baseline = 0
    for (const bucket of s.dayHour || []) {
      const cost = costOfBucket(bucket, pricing)
      if (isPeakAt(bucket.date, bucket.weekday, bucket.hour, pricing)) peak += cost
      else off += cost
      baseline += baselineCostOfBucket(bucket, pricing)
    }
    return { peak, off, total: peak + off, savings: Math.max(0, baseline - (peak + off)) }
  }, [s, pricing])

  const hours = React.useMemo(() => {
    const out = Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0 }))
    for (const bucket of s.dayHour || []) out[bucket.hour].total += bucketTokens(bucket)
    return out
  }, [s])

  const max = Math.max(1, ...hours.map((x) => x.total))
  const duration = s.firstTs && s.lastTs ? s.lastTs - s.firstTs : 0

  // 该会话费用最高的模型：饼图图例用它那一档单价，而不是一律用 _default。
  const topModel = React.useMemo(() => {
    const cost = new Map()
    for (const bucket of s.dayHour || []) {
      for (const model of Object.keys(bucket.models || {})) {
        const tokens = bucket.models[model]
        const price = priceOfModel(model, pricing)
        const raw = (tokens.input * price.inputPerM + tokens.output * price.outputPerM
          + tokens.cacheRead * price.cacheReadPerM + tokens.cacheWrite * price.cacheWritePerM) / 1e6
        cost.set(model, (cost.get(model) || 0) + raw)
      }
    }
    let best = null
    let bestCost = -1
    for (const [model, value] of cost) {
      if (value > bestCost) { bestCost = value; best = model }
    }
    return best
  }, [s, pricing])

  return h('div', { className: 'ub-detail' },
    h('div', { className: 'ub-cols' },
      h('div', null,
        h(CompositionPie, {
          input: s.input, output: s.output, cacheRead: s.cacheRead, cacheWrite: s.cacheWrite,
          pricing, model: topModel,
        }),
      ),
      h('div', null,
        h('div', { className: 'ub-bill' },
          h('div', { className: 'ub-bill-c peak' },
            h('span', { className: 'ub-bill-l' }, '高峰费用'),
            h('span', { className: 'ub-bill-v' }, fmtCost(bill.peak, currency)),
          ),
          h('div', { className: 'ub-bill-c off' },
            h('span', { className: 'ub-bill-l' }, '空闲费用'),
            h('span', { className: 'ub-bill-v' }, fmtCost(bill.off, currency)),
          ),
          h('div', { className: 'ub-bill-c save' },
            h('span', { className: 'ub-bill-l' }, '合计（峰谷）'),
            h('span', { className: 'ub-bill-v' }, fmtCost(bill.total, currency)),
          ),
          h('div', { className: 'ub-bill-c' },
            h('span', { className: 'ub-bill-l' }, '相对全高峰节省'),
            h('span', { className: 'ub-bill-v' }, fmtCost(bill.savings, currency)),
          ),
        ),
        h('dl', { className: 'ub-kv', style: { marginTop: 10 } },
          h('dt', null, '工作目录'), h('dd', { className: 'ub-ell', title: s.cwd || '' }, s.cwd || '—'),
          h('dt', null, '用量事件'), h('dd', null, fmtExact(s.events)),
          h('dt', null, '时长'), h('dd', null, fmtDuration(duration)),
          h('dt', null, '时间'), h('dd', null, `${fmtTime(s.firstTs)} → ${fmtTime(s.lastTs)}`),
          h('dt', null, '日志格式 / 体积'), h('dd', null, `gen ${s.generation} / ${fmtBytes(s.bytes)}`),
        ),
      ),
    ),
    h('div', { className: 'ub-sec', style: { marginTop: 12 } },
      h('h3', { className: 'ub-sec-t' }, '本会话 24 小时分布'),
      h('div', { className: 'ub-bars', style: { height: 100 } },
        hours.map((x) => {
          const peak = inPeakSlot(x.hour, pricing)
          return h('div', { key: x.hour, className: 'ub-bar-c', title: `${String(x.hour).padStart(2, '0')}:00 · ${peak ? '高峰' : '空闲'} · ${fmtExact(x.total)}` },
            h('div', { className: 'ub-bar' + (peak ? ' peak' : ''), style: { height: x.total > 0 ? Math.max(3, (x.total / max) * 88) : 1 } }),
          )
        }),
      ),
    ),
  )
}

/**
 * 模块导出面。
 *
 * 本文件会作为 IIFE 片段拼进 `lib/client.js`，导出通过**函数返回值**交出去
 * （而不是 `exports.X = …` 赋值），这样拼装脚本无需解析赋值语句，也躲开了
 * 模板字符串里换行 / 分号的歧义。`panelInternals` 只用于自测，不参与界面。
 */
return {
  UsagePanel,
  panelInternals: {
    fmtTokens, fmtExact, fmtCost, fmtPct, fmtBytes, fmtTime, fmtDuration,
    priceOfModel, inPeakSlot, weekendRelaxActive, isPeakAt,
    isHoliday, isMakeupWorkday, dayKind, isWeekendKind, dayAllDayOffPeak,
    baselineCostOfBucket, costOfBucket, bucketTokens, recompute, sessionCost,
    dateRange, activeDatesOf, useHeatWindow,
    // 新增：卡片自选、今日汇总、8 行滑块分页（都导出以便自测）
    CARD_CATALOG, CARD_KEYS, DEFAULT_CARD_KEYS, CARD_STORAGE_KEY,
    readCardSelection, writeCardSelection,
    dateKeyInZone, todayKeyInZone, summarizeBuckets, PAGE_SIZE, usePager, pagerState,
    weekdayInZone, summarizeTodayHours,
  },
}
