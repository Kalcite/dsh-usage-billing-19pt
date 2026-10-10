/**
 * 用量数据的导出（CSV / JSON）。
 *
 * 背景：参考实现（npm 上同名插件的 0.9.5）在设置页提供了「导出 CSV（按日）/
 * 导出 CSV（按会话）/ 导出 JSON」三个按钮，指向
 * `/usage-billing?action=export&format=csv&scope=day`。该路由在运行中的实例上
 * **直接返回 HTTP 500**，导出功能因此完全不可用。本模块把这件事重新实现成
 * 一个独立的、有测试覆盖的纯函数层：路由只负责取数与设置响应头。
 *
 * 两个刻意的取舍：
 *
 *   1. **CSV 带 UTF-8 BOM**。否则 Excel 会把中文表头按本地代码页解释成乱码——
 *      这正是「导出后打开是乱码」这类反馈的来源。
 *   2. **CRLF 行尾 + RFC 4180 引号转义**，Excel / LibreOffice / pandas 都能直接读。
 *
 * @module dsh-usage-billing-19pt/src/export
 */

import { modelLabel } from './pricing.js'
import type { RecentCall, UsageOverview } from './ledger.js'

/** 支持的导出格式。 */
export type ExportFormat = 'csv' | 'json'

/** 支持的导出数据集。 */
export type ExportScope = 'day' | 'session' | 'model' | 'hour' | 'recent'

/** 全部合法的 scope，用于路由校验。 */
export const EXPORT_SCOPES: readonly ExportScope[] = ['day', 'session', 'model', 'hour', 'recent']

/** 判断一个字符串是否是合法的 scope。 */
export function isExportScope(value: string): value is ExportScope {
  return (EXPORT_SCOPES as readonly string[]).includes(value)
}

/** 判断一个字符串是否是合法的 format。 */
export function isExportFormat(value: string): value is ExportFormat {
  return value === 'csv' || value === 'json'
}

/** CSV 字段转义（RFC 4180）：含逗号 / 引号 / 换行时用双引号包裹并翻倍内部引号。 */
function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (text === '') return ''
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

/**
 * 把二维表拼成 CSV 文本。
 *
 * 行尾统一 CRLF、结尾带一个换行，并在最前面加 UTF-8 BOM（Excel 需要）。
 *
 * @param rows - 第一行应为表头。
 * @returns 可直接写盘的 CSV 文本。
 */
export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  const body = rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
  return `\ufeff${body}\r\n`
}

/** 时间戳 → ISO 8601（导出用，避免时区歧义）。 */
function iso(ts: number | null): string {
  return ts === null ? '' : new Date(ts).toISOString()
}

/** 数字保留 6 位小数，去掉尾随 0（金额列用）。 */
function money(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return String(Number(value.toFixed(6)))
}

/** scope → 中文表头名（用于 RFC 5987 的 UTF-8 文件名）。 */
const SCOPE_LABELS: Readonly<Record<ExportScope, string>> = {
  day: '按日',
  session: '按会话',
  model: '按模型',
  hour: '按小时',
  recent: '最近调用',
}

/**
 * scope → ASCII 名。
 *
 * `Content-Disposition` 的 `filename=` 只允许 Latin-1：直接塞中文会让 Node 的
 * `setHeader` 抛 `ERR_INVALID_CHAR`，整个导出变成 500。所以 ASCII 回退名一律用
 * 英文，中文名走 `filename*=UTF-8''…`（RFC 5987）。
 */
const SCOPE_SLUGS: Readonly<Record<ExportScope, string>> = {
  day: 'day',
  session: 'session',
  model: 'model',
  hour: 'hour',
  recent: 'recent',
}

/** 数据日期范围（`YYYYMMDD_YYYYMMDD`），无数据时用生成日期。 */
function rangeOf(overview: UsageOverview): string {
  const dates = overview.byDay.map((day) => day.date).sort()
  const compact = (date: string): string => date.replace(/-/g, '')
  const first = dates[0]
  const last = dates[dates.length - 1]
  if (first === undefined || last === undefined) {
    return new Date(overview.generatedAt).toISOString().slice(0, 10).replace(/-/g, '')
  }
  return `${compact(first)}_${compact(last)}`
}

/**
 * 构造某一份数据集的二维表（含表头）。
 * @param overview - 聚合结果。
 * @param scope - 数据集。
 * @returns 可直接交给 {@link toCsv} 的行数组。
 */
export function exportRows(overview: UsageOverview, scope: ExportScope): (string | number)[][] {
  const rows: (string | number)[][] = []
  if (scope === 'day') {
    rows.push(['日期', '输入', '输出', '缓存读取', '缓存写入', 'tokens', '费用', '高峰费用', '空闲费用'])
    for (const day of overview.byDay) {
      rows.push([
        day.date, day.input, day.output, day.cacheRead, day.cacheWrite,
        day.input + day.output + day.cacheRead + day.cacheWrite,
        money(day.cost), money(day.peakCost), money(day.offPeakCost),
      ])
    }
    return rows
  }

  if (scope === 'session') {
    rows.push([
      '会话ID', '项目', '工作目录', '模型', '输入', '输出', '缓存读取', '缓存写入',
      'tokens', '费用', '首次时间', '末次时间', '日志格式', '压缩字节', '用量事件数',
    ])
    for (const session of overview.bySession) {
      rows.push([
        session.id, session.projectLabel, session.cwd ?? '', session.modelLabels.join(' / '),
        session.input, session.output, session.cacheRead, session.cacheWrite,
        session.input + session.output + session.cacheRead + session.cacheWrite,
        money(session.cost), iso(session.firstTs), iso(session.lastTs),
        session.generation, session.bytes, session.events,
      ])
    }
    return rows
  }

  if (scope === 'model') {
    rows.push(['模型', '展示名', '输入', '输出', '缓存读取', '缓存写入', 'tokens', '费用', '占比', '会话数'])
    for (const model of overview.byModel) {
      rows.push([
        model.model, model.label, model.input, model.output, model.cacheRead, model.cacheWrite,
        model.input + model.output + model.cacheRead + model.cacheWrite,
        money(model.cost), Number((model.share * 100).toFixed(4)) + '%', model.sessions,
      ])
    }
    return rows
  }

  if (scope === 'hour') {
    rows.push(['小时', '输入', '输出', '缓存读取', '缓存写入', 'tokens', '费用', '是否高峰时段'])
    for (const hour of overview.byHour) {
      rows.push([
        `${String(hour.hour).padStart(2, '0')}:00`,
        hour.input, hour.output, hour.cacheRead, hour.cacheWrite,
        hour.input + hour.output + hour.cacheRead + hour.cacheWrite,
        money(hour.cost), hour.peakSlot ? '是' : '否',
      ])
    }
    return rows
  }

  rows.push(['时间', '模型', '会话', '时段', '输入', '输出', '缓存读取', '缓存写入', '费用'])
  for (const call of overview.recent as RecentCall[]) {
    rows.push([
      iso(call.ts), modelLabel(call.model), call.session, call.peak ? '高峰' : '空闲',
      call.input, call.output, call.cacheRead, call.cacheWrite, money(call.cost),
    ])
  }
  return rows
}

/**
 * 导出的**回退**文件名（纯 ASCII，给 `Content-Disposition: filename=` 用）。
 * @param overview - 聚合结果。
 * @param scope - 数据集。
 * @param format - 格式。
 * @returns 形如 `dsh-usage-day-20260105_20261008.csv` 的文件名。
 */
export function exportFilename(overview: UsageOverview, scope: ExportScope, format: ExportFormat): string {
  return `dsh-usage-${SCOPE_SLUGS[scope]}-${rangeOf(overview)}.${format}`
}

/**
 * 导出的**首选**文件名（含中文，交给 `filename*=UTF-8''…`）。
 * @param overview - 聚合结果。
 * @param scope - 数据集。
 * @param format - 格式。
 * @returns 形如 `dsh-usage-按日-20260105_20261008.csv` 的文件名。
 */
export function exportFilenameUtf8(overview: UsageOverview, scope: ExportScope, format: ExportFormat): string {
  return `dsh-usage-${SCOPE_LABELS[scope]}-${rangeOf(overview)}.${format}`
}

/**
 * 构造 `Content-Disposition`：ASCII 回退 + RFC 5987 的 UTF-8 名。
 * @param overview - 聚合结果。
 * @param scope - 数据集。
 * @param format - 格式。
 * @returns 可直接 `setHeader` 的头部值（保证全 ASCII，不会抛 ERR_INVALID_CHAR）。
 */
export function contentDisposition(
  overview: UsageOverview,
  scope: ExportScope,
  format: ExportFormat,
): string {
  const ascii = exportFilename(overview, scope, format)
  const utf8 = exportFilenameUtf8(overview, scope, format)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(utf8)}`
}

/**
 * 生成导出的响应体。
 * @param overview - 聚合结果。
 * @param scope - 数据集（`json` 格式时忽略，导出完整总览）。
 * @param format - `csv` 或 `json`。
 * @returns 文本内容与 Content-Type。
 */
export function renderExport(
  overview: UsageOverview,
  scope: ExportScope,
  format: ExportFormat,
): { body: string; contentType: string } {
  if (format === 'json') {
    return {
      body: JSON.stringify(overview, null, 2),
      contentType: 'application/json; charset=utf-8',
    }
  }
  return {
    body: toCsv(exportRows(overview, scope)),
    contentType: 'text/csv; charset=utf-8',
  }
}
