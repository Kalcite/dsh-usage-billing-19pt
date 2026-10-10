// 新增能力的自测：主界面卡片自选、今日汇总、8 行滑块分页、导出，以及
// 「时区默认」与「无时间戳采样」两处正确性修复。
//
// 客户端部分直接求值 `src/client/panel.cjs.js`（它是以 `return {...}` 交出导出面
// 的 IIFE 函数体），因此不需要打包、也不需要浏览器。
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { zstdCompressSync } from 'node:zlib'

import {
  DEFAULT_PRICING,
  dayKind,
  dayRelaxReason,
  isPeakAt,
  isWeekendKind,
  localParts,
  resolvePricing,
} from '../lib/pricing.js'
import { usageOverview } from '../lib/ledger.js'
import { contentDisposition, exportFilename, exportFilenameUtf8, exportRows, renderExport, toCsv } from '../lib/export.js'

/* ============================================================ 时区默认 */

test('默认统计时区是 Asia/Shanghai，而不是运行环境本地时区', () => {
  assert.equal(DEFAULT_PRICING.timezone, 'Asia/Shanghai', '默认规则必须带北京时区')
  assert.equal(resolvePricing().timezone, 'Asia/Shanghai', '归一化后必须有确定时区')
  assert.equal(resolvePricing(null).timezone, 'Asia/Shanghai')
  assert.equal(resolvePricing({}).timezone, 'Asia/Shanghai')
  // 留空（配置里的默认值）同样回落到北京，而不是本地时区
  assert.equal(resolvePricing({ timezone: '' }).timezone, 'Asia/Shanghai', '留空应回落默认')
  // 显式指定仍然生效
  assert.equal(resolvePricing({ timezone: 'UTC' }).timezone, 'UTC')
})

test('同一时间戳在默认规则下按北京时间判定峰谷（回归：TZ=UTC 曾算错）', () => {
  // 2026-01-05 01:00 UTC == 北京 09:00（周一高峰）
  const atBeijingNine = Date.UTC(2026, 0, 5, 1, 0, 0)
  const pricing = resolvePricing()
  const parts = localParts(atBeijingNine, pricing.timezone)
  assert.equal(parts.date, '2026-01-05')
  assert.equal(parts.hour, 9)
  assert.equal(parts.weekday, 1)
  assert.equal(
    isPeakAt(parts.date, parts.weekday, parts.hour, pricing),
    true,
    '北京时间 09:00 必须判为高峰（若落到本地时区，TZ=UTC 时会变成 01:00 空闲）',
  )
})

/* ================================================== 无时间戳采样的一致性 */

const ROOT = mkdtempSync(join(tmpdir(), 'dsh-ub-dash-'))
const HOME = join(ROOT, 'home')

/** 写一份合成 gen 4 会话日志。 */
function writeSession(project, sid, rows) {
  const dir = join(HOME, 'sessions', project, sid)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.v4.jsonl.zstd'), zstdCompressSync(Buffer.from(rows.join(''))))
}

const line = (obj) => JSON.stringify(obj) + '\n'

/** 一条带时间戳的 assistant/message（gen 4 的唯一记账载体）。 */
function message(turn, step, time, inputTokens, model) {
  return line({
    type: 'assistant/message',
    seq: step,
    time,
    data: {
      turn,
      step,
      usage: { inputTokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      message: { role: 'assistant', content: [], source: { kind: 'model', provider: 'p', model } },
    },
  })
}

before(() => {
  writeSession('--tmp-dash--', 'session-timed', [
    line({ type: 'session', version: 4, id: 'session-timed', cwd: '/tmp/dash' }),
    message(1, 1, Date.UTC(2026, 0, 5, 1, 0, 0), 1_000_000, 'deepseek-flash'), // 北京 09:00 高峰
    message(2, 2, Date.UTC(2026, 0, 5, 5, 0, 0), 2_000_000, 'deepseek-flash'), // 北京 13:00 空闲
    // 没有 time 字段：无法归入时段、无法计价
    line({
      type: 'assistant/message',
      seq: 9,
      data: {
        turn: 9,
        step: 9,
        usage: { inputTokens: 777_000, outputTokens: 0 },
        message: { role: 'assistant', content: [], source: { kind: 'model', provider: 'p', model: 'deepseek-flash' } },
      },
    }),
  ])
})

after(() => {
  rmSync(ROOT, { recursive: true, force: true })
})

test('无时间戳的采样不计入任何统计，只单独计数', async () => {
  const overview = await usageOverview({ home: HOME, pricing: resolvePricing() })
  const t = overview.totals

  assert.equal(overview.scan.timelessSamples, 1, '应记录 1 条无时间戳采样')
  // 有 3 条采样，但只有 2 条带时间戳：777K 那一条既不进总量也不进费用
  assert.equal(t.input, 3_000_000, '无时间戳的 777K 不应计入输入总量')
  assert.equal(t.tokens, 3_000_000, 'tokens 与 input 同源')
  assert.ok(Math.abs(t.cost - 6) < 1e-9, `费用应为 3 + 3 = 6，实际 ${t.cost}`)
  assert.ok(Math.abs(t.baselineCost - 9) < 1e-9, '全高峰口径应为 9')

  // 关键一致性：totals 与日期×小时桶求和必须相等（以前会不等）
  const bucketCost = overview.byDayHour.reduce((sum, bucket) => {
    const base = Object.keys(bucket.models).reduce((acc, model) => {
      const tokens = bucket.models[model]
      const price = overview.pricing.models[model] || overview.pricing.models._default
      return acc + (tokens.input * price.inputPerM + tokens.output * price.outputPerM
        + tokens.cacheRead * price.cacheReadPerM + tokens.cacheWrite * price.cacheWritePerM) / 1e6
    }, 0)
    const peak = isPeakAt(bucket.date, bucket.weekday, bucket.hour, overview.pricing)
    return sum + base * (peak ? 1 : overview.pricing.offPeakMultiplier)
  }, 0)
  assert.ok(Math.abs(bucketCost - t.cost) < 1e-9, 'totals.cost 必须等于计费桶之和')

  const byDaySum = overview.byDay.reduce((sum, day) => sum + day.cost, 0)
  assert.ok(Math.abs(byDaySum - t.cost) < 1e-9, '按日求和也必须等于 totals.cost')
})

test('「最近调用」按时间倒序、有界，且每次调用的峰谷与费用正确', async () => {
  const overview = await usageOverview({ home: HOME, pricing: resolvePricing() })
  const recent = overview.recent

  assert.equal(recent.length, 2, '只有 2 条带时间戳的调用')
  assert.ok(recent[0].ts > recent[1].ts, '必须按时间倒序（最新在前）')
  assert.equal(recent[0].model, 'deepseek-flash')
  assert.equal(recent[0].session, 'session-timed')

  // 09:00 那条是高峰（×1），13:00 那条是空闲（×0.5）
  const peakCall = recent.find((call) => call.peak)
  const offCall = recent.find((call) => !call.peak)
  assert.ok(peakCall && offCall, '应各有一条高峰与空闲调用')
  assert.ok(Math.abs(peakCall.cost - 3) < 1e-9, `高峰调用费用应为 3，实际 ${peakCall.cost}`)
  assert.ok(Math.abs(offCall.cost - 3) < 1e-9, `空闲调用费用应为 3（6 × 0.5），实际 ${offCall.cost}`)
})

/* ============================================================== 导出 */

test('CSV 带 UTF-8 BOM、CRLF 行尾，并按 RFC 4180 转义', () => {
  const csv = toCsv([['a', 'b'], ['含,逗号', '含"引号'], ['换\n行', '']])
  assert.ok(csv.startsWith('\ufeff'), 'Excel 需要 BOM 才不会把中文表头读成乱码')
  assert.ok(csv.includes('\r\n'), '行尾应为 CRLF')
  assert.ok(csv.includes('"含,逗号"'), '含逗号的字段必须加引号')
  assert.ok(csv.includes('"含""引号"'), '内部引号必须翻倍')
  assert.ok(csv.includes('"换\n行"'), '含换行的字段必须加引号')
  assert.ok(csv.endsWith('\r\n'), '结尾应有一个换行')
})

test('各数据集都能导出，表头与文件名符合预期', async () => {
  const overview = await usageOverview({ home: HOME, pricing: resolvePricing() })

  const dayRows = exportRows(overview, 'day')
  assert.deepEqual(dayRows[0].slice(0, 3), ['日期', '输入', '输出'])
  assert.equal(dayRows.length, overview.byDay.length + 1, '数据行数应等于天数')

  const sessionRows = exportRows(overview, 'session')
  assert.equal(sessionRows[0][0], '会话ID')
  assert.equal(sessionRows.length, overview.bySession.length + 1)

  const recentRows = exportRows(overview, 'recent')
  assert.equal(recentRows[0][0], '时间')
  assert.equal(recentRows.length, overview.recent.length + 1)

  const csv = renderExport(overview, 'day', 'csv')
  assert.equal(csv.contentType, 'text/csv; charset=utf-8')
  assert.ok(csv.body.startsWith('\ufeff'))

  const json = renderExport(overview, 'day', 'json')
  assert.equal(json.contentType, 'application/json; charset=utf-8')
  const parsed = JSON.parse(json.body)
  assert.ok(parsed.totals && parsed.pricing, 'JSON 导出应含完整总览与计费规则')

  const name = exportFilename(overview, 'day', 'csv')
  assert.match(name, /^dsh-usage-day-\d{8}_\d{8}\.csv$/, `回退文件名应为纯 ASCII：${name}`)
  // 中文名走 RFC 5987 的 filename*，因此头部值必须全 ASCII（否则 Node setHeader 抛错）
  const disposition = contentDisposition(overview, 'day', 'csv')
  assert.match(disposition, /^attachment; filename="dsh-usage-day-/)
  assert.ok(disposition.includes("filename*=UTF-8''"), '应带 RFC 5987 的 filename*')
  // eslint-disable-next-line no-control-regex
  assert.ok(!/[^\x20-\x7e]/.test(disposition), 'Content-Disposition 必须是纯 ASCII')
  assert.ok(
    decodeURIComponent(disposition.split("filename*=UTF-8''")[1]) === exportFilenameUtf8(overview, 'day', 'csv'),
    'filename* 解出来后应是中文文件名',
  )
})

/* ============================================ 客户端面板内部逻辑（纯函数） */

const require = createRequire(import.meta.url)
const reactStub = {
  createElement: () => ({}),
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
}

/** 一个最小的 localStorage 实现，用来验证卡片选择的往返。 */
const storage = new Map()
const localStorageStub = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => { storage.set(key, String(value)) },
  removeItem: (key) => { storage.delete(key) },
}

const panelSource = readFileSync(new URL('../src/client/panel.cjs.js', import.meta.url), 'utf8')
const wrapped = `(function (require) {\n${panelSource.replace(/^'use strict'\s*$/m, '')}\n})`
const panelFactory = vm.runInNewContext(wrapped, { console, localStorage: localStorageStub }, { filename: 'panel.cjs.js' })
const panelModule = panelFactory((spec) => {
  if (spec === 'react') return reactStub
  throw new Error(`panel requires ${spec}`)
})
const panel = panelModule.panelInternals

test('卡片目录里含用户点名的可选项，默认为四张卡', () => {
  const keys = panel.CARD_CATALOG.map((card) => card.key)
  for (const key of ['totalCost', 'totalTokens', 'todayCost', 'todayTokens', 'byModel']) {
    assert.ok(keys.includes(key), `卡片目录缺少 ${key}`)
  }
  assert.deepEqual(
    [...panel.DEFAULT_CARD_KEYS],
    ['totalCost', 'totalTokens', 'todayCost', 'todayTokens'],
  )
  for (const key of panel.DEFAULT_CARD_KEYS) {
    assert.ok(keys.includes(key), `默认卡片 ${key} 必须在目录里`)
  }
})

test('卡片选择记在 localStorage，忽略目录外的旧 key', () => {
  // 注意：面板模块在 vm 里求值，它返回的数组原型来自另一个 realm，因此必须先
  // 展开成宿主数组再比较（否则 deepStrictEqual 会因为原型不同而失败）。
  assert.deepEqual(
    [...panel.readCardSelection()],
    [...panel.DEFAULT_CARD_KEYS],
    '没有存储时应回落到默认',
  )

  panel.writeCardSelection(['byModel', 'totalCost', 'not-a-card'])
  assert.deepEqual([...panel.readCardSelection()], ['byModel', 'totalCost'], '应过滤掉目录外的 key')

  panel.writeCardSelection([])
  assert.deepEqual([...panel.readCardSelection()], [], '空数组表示「什么都不显示」')

  // 损坏内容不应抛，直接回落默认
  localStorageStub.setItem(panel.CARD_STORAGE_KEY, '{not json')
  assert.deepEqual([...panel.readCardSelection()], [...panel.DEFAULT_CARD_KEYS])
  localStorageStub.removeItem(panel.CARD_STORAGE_KEY)
})

test('分页是每次 8 行，越界会夹回', () => {
  assert.equal(panel.PAGE_SIZE, 8)

  const first = panel.pagerState(20, 8, 0)
  assert.deepEqual(
    { pages: first.pages, from: first.from, to: first.to },
    { pages: 3, from: 0, to: 8 },
  )
  assert.deepEqual(
    (({ from, to }) => ({ from, to }))(panel.pagerState(20, 8, 1)),
    { from: 8, to: 16 },
  )
  assert.deepEqual(
    (({ from, to }) => ({ from, to }))(panel.pagerState(20, 8, 2)),
    { from: 16, to: 20 },
  )
  // 越界夹回：页号过大回到最后一页，负数回到第一页
  assert.equal(panel.pagerState(20, 8, 99).page, 2)
  assert.equal(panel.pagerState(20, 8, -5).page, 0)
  // 无数据时也要有 1 页、区间为空，不能除出 NaN
  const empty = panel.pagerState(0, 8, 0)
  assert.deepEqual({ pages: empty.pages, from: empty.from, to: empty.to }, { pages: 1, from: 0, to: 0 })
  // size <= 0 回落到默认 8
  assert.equal(panel.pagerState(20, 0, 0).size, 8)
})

test('今日日期与汇总按统计时区求解', () => {
  // 2026-01-05 17:00 UTC == 北京 2026-01-06 01:00（跨日）
  const ts = Date.UTC(2026, 0, 5, 17, 0, 0)
  assert.equal(panel.dateKeyInZone(ts, 'Asia/Shanghai'), '2026-01-06')
  assert.equal(panel.dateKeyInZone(ts, 'UTC'), '2026-01-05')
  assert.equal(panel.todayKeyInZone('Asia/Shanghai'), panel.dateKeyInZone(Date.now(), 'Asia/Shanghai'))
  // 非法时区名不应抛
  assert.match(panel.dateKeyInZone(ts, 'Not/AZone'), /^\d{4}-\d{2}-\d{2}$/)
})

test('summarizeBuckets 与 recompute 的口径一致', () => {
  const pricing = resolvePricing()
  const buckets = [
    { date: '2026-01-05', weekday: 1, hour: 9, input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, models: { 'deepseek-flash': { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 } }, cost: 0 },
    { date: '2026-01-05', weekday: 1, hour: 13, input: 2_000_000, output: 0, cacheRead: 0, cacheWrite: 0, models: { 'deepseek-flash': { input: 2_000_000, output: 0, cacheRead: 0, cacheWrite: 0 } }, cost: 0 },
  ]
  const summary = panel.summarizeBuckets(buckets, pricing)
  const billing = panel.recompute({ byDayHour: buckets, pricing }, pricing)

  assert.equal(summary.tokens, 3_000_000)
  assert.ok(Math.abs(summary.cost - billing.total) < 1e-12, '今日汇总与整体重算必须同口径')
  assert.ok(Math.abs(summary.baseline - billing.baseline) < 1e-12)
  assert.ok(Math.abs(summary.cost - 6) < 1e-12, `应为 3（高峰）+ 3（空闲 ×0.5），实际 ${summary.cost}`)
  assert.ok(Math.abs(summary.modelCost.get('deepseek-flash') - 6) < 1e-12, '按模型拆分的费用也应一致')
})

/* ======================================== 调休周末口径 + 本日时段分布 */

test('调休上班的周末（所有周末）全天按空闲时段计费', () => {
  const pricing = resolvePricing()
  // 2026-10-10 周六（调休上班）、2026-09-20 周日（调休上班）
  assert.equal(dayKind('2026-10-10', 6, pricing.calendar), 'makeup', 'kind 仍用于展示')
  assert.equal(isWeekendKind('makeup'), true, '调休日属于周末口径')
  assert.equal(isWeekendKind('weekend'), true)
  assert.equal(isWeekendKind('weekday'), false)
  assert.equal(isWeekendKind('holiday'), false)

  // 高峰时段内也按空闲价计
  assert.equal(isPeakAt('2026-10-10', 6, 10, pricing), false, '调休周末 10:00 应空闲')
  assert.equal(isPeakAt('2026-10-10', 6, 15, pricing), false, '调休周末 15:00 应空闲')
  assert.equal(isPeakAt('2026-09-20', 0, 10, pricing), false, '调休周末 10:00 应空闲')
  assert.deepEqual(dayRelaxReason('2026-10-10', 6, pricing), { kind: 'makeup', allDayOffPeak: true })
})

test('中国法定节假日全天按空闲时段计费（不受周末开关影响）', () => {
  const pricing = resolvePricing()
  for (const hour of [0, 9, 10, 15, 18, 23]) {
    assert.equal(isPeakAt('2026-10-01', 4, hour, pricing), false, `国庆 ${hour}:00 应空闲`)
  }
  const noWeekendRelax = resolvePricing({ weekendRelax: false })
  assert.equal(isPeakAt('2026-10-01', 4, 10, noWeekendRelax), false, '关掉周末规则后假期仍空闲')
  assert.equal(isPeakAt('2026-10-10', 6, 10, noWeekendRelax), true, '关掉周末规则后调休周末恢复分峰谷')
})

test('客户端与主机侧的调休周末口径一致（同构回归）', () => {
  const pricing = resolvePricing()
  for (const pair of [['2026-10-10', 6], ['2026-09-20', 0], ['2026-10-12', 1], ['2026-10-01', 4]]) {
    for (const hour of [10, 13, 15]) {
      assert.equal(
        panel.isPeakAt(pair[0], pair[1], hour, pricing),
        isPeakAt(pair[0], pair[1], hour, pricing),
        `客户端与主机在 ${pair[0]} ${hour}:00 判定不一致`,
      )
    }
  }
})

test('weekdayInZone 按统计时区给出星期', () => {
  // 2026-01-05 01:00 UTC == 北京 周一 09:00
  assert.equal(panel.weekdayInZone(Date.UTC(2026, 0, 5, 1, 0, 0), 'Asia/Shanghai'), 1)
  // 同一天 17:00 UTC == 北京周二 01:00（跨日）
  assert.equal(panel.weekdayInZone(Date.UTC(2026, 0, 5, 17, 0, 0), 'Asia/Shanghai'), 2)
  assert.equal(panel.weekdayInZone(Date.UTC(2026, 0, 5, 17, 0, 0), 'UTC'), 1)
  // 非法时区不应抛
  assert.ok(panel.weekdayInZone(Date.now(), 'Not/AZone') >= 0)
})

test('本日时段汇总：固定 24 条、只取当天、费用按峰谷口径', () => {
  const pricing = resolvePricing()
  const bucket = (date, weekday, hour, input) => ({
    date, weekday, hour, input, output: 0, cacheRead: 0, cacheWrite: 0,
    models: { 'deepseek-flash': { input, output: 0, cacheRead: 0, cacheWrite: 0 } },
    cost: 0,
  })
  const buckets = [
    bucket('2026-10-10', 6, 10, 1_000_000), // 调休周六 10:00 → 空闲 1.5
    bucket('2026-10-12', 1, 10, 1_000_000), // 工作日 10:00 → 高峰 3（不该计入 10-10）
  ]

  const result = panel.summarizeTodayHours(buckets, '2026-10-10', 0, pricing)
  assert.equal(result.hours.length, 24, '固定 24 条')
  assert.equal(result.weekday, 6, '有当天桶时取桶里的星期')
  assert.ok(
    Math.abs(result.hours[10].cost - 1.5) < 1e-12,
    `调休周末 10:00 应为 1.5，实际 ${result.hours[10].cost}`,
  )
  assert.equal(result.hours[10].peak, false, '调休周末该小时为空闲')
  assert.equal(result.hours[10].tokens, 1_000_000)
  const total = result.hours.reduce((sum, row) => sum + row.cost, 0)
  assert.ok(Math.abs(total - 1.5) < 1e-12, '只应计入当天的桶')
  assert.equal(result.hours[9].cost, 0, '没有数据的时段为 0')

  // 空数据：仍有 24 条、全为 0，且不抛
  const empty = panel.summarizeTodayHours([], '2026-10-10', 6, pricing)
  assert.equal(empty.hours.length, 24)
  assert.equal(empty.hours.reduce((sum, row) => sum + row.cost, 0), 0)
  assert.equal(empty.weekday, 6, '没有当天桶时用传入的星期兜底')
})
