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
 * @module dsh-usage-billing/src/export
 */
import type { UsageOverview } from './ledger.js';
/** 支持的导出格式。 */
export type ExportFormat = 'csv' | 'json';
/** 支持的导出数据集。 */
export type ExportScope = 'day' | 'session' | 'model' | 'hour' | 'recent';
/** 全部合法的 scope，用于路由校验。 */
export declare const EXPORT_SCOPES: readonly ExportScope[];
/** 判断一个字符串是否是合法的 scope。 */
export declare function isExportScope(value: string): value is ExportScope;
/** 判断一个字符串是否是合法的 format。 */
export declare function isExportFormat(value: string): value is ExportFormat;
/**
 * 把二维表拼成 CSV 文本。
 *
 * 行尾统一 CRLF、结尾带一个换行，并在最前面加 UTF-8 BOM（Excel 需要）。
 *
 * @param rows - 第一行应为表头。
 * @returns 可直接写盘的 CSV 文本。
 */
export declare function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string;
/**
 * 构造某一份数据集的二维表（含表头）。
 * @param overview - 聚合结果。
 * @param scope - 数据集。
 * @returns 可直接交给 {@link toCsv} 的行数组。
 */
export declare function exportRows(overview: UsageOverview, scope: ExportScope): (string | number)[][];
/**
 * 导出的**回退**文件名（纯 ASCII，给 `Content-Disposition: filename=` 用）。
 * @param overview - 聚合结果。
 * @param scope - 数据集。
 * @param format - 格式。
 * @returns 形如 `dsh-usage-day-20260105_20261008.csv` 的文件名。
 */
export declare function exportFilename(overview: UsageOverview, scope: ExportScope, format: ExportFormat): string;
/**
 * 导出的**首选**文件名（含中文，交给 `filename*=UTF-8''…`）。
 * @param overview - 聚合结果。
 * @param scope - 数据集。
 * @param format - 格式。
 * @returns 形如 `dsh-usage-按日-20260105_20261008.csv` 的文件名。
 */
export declare function exportFilenameUtf8(overview: UsageOverview, scope: ExportScope, format: ExportFormat): string;
/**
 * 构造 `Content-Disposition`：ASCII 回退 + RFC 5987 的 UTF-8 名。
 * @param overview - 聚合结果。
 * @param scope - 数据集。
 * @param format - 格式。
 * @returns 可直接 `setHeader` 的头部值（保证全 ASCII，不会抛 ERR_INVALID_CHAR）。
 */
export declare function contentDisposition(overview: UsageOverview, scope: ExportScope, format: ExportFormat): string;
/**
 * 生成导出的响应体。
 * @param overview - 聚合结果。
 * @param scope - 数据集（`json` 格式时忽略，导出完整总览）。
 * @param format - `csv` 或 `json`。
 * @returns 文本内容与 Content-Type。
 */
export declare function renderExport(overview: UsageOverview, scope: ExportScope, format: ExportFormat): {
    body: string;
    contentType: string;
};
