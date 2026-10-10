# dsh-usage-billing-19pt

DeepSeek Harness 的**用量与计费**插件。扫描会话日志统计 Token 消耗，按多模型单价与峰谷时段实时算钱，并把账单做成一个看板挂进 DSH **左侧主导航栏**。

移植自 `dsh-launcher-webui` 启动器的内嵌用量插件（`server/usage.mjs` + `src/components/UsageCard.tsx`），并修正了其中两个真实存在的缺陷（见[与原实现的差异](#与原实现的差异)）。

零运行时依赖：`dependencies` 为空，只声明 `peerDependencies`，由 DSH 进程满足。

---

## 它做什么

在左侧主导航栏新增一个 **「用量计费」** 条目（与「插件」「定时任务」同级），点开即占据中间主列，包含：

| 模块 | 内容 |
| --- | --- |
| 概览卡片 | **显示项可自选**（累计消费额 / 累计 token / 今日消费额 / 今日 token / 按模型拆分 / 缓存读取 / 会话数 / 活跃天数 / 相对全高峰节省 / 高峰占比，也可以**一张都不显示**）；选择记在本机 localStorage |
| 本日消费时段分布 | **今日 24 个小时各自的费用**柱状图，高峰时段高亮、刻度独立一行；顶部给出今日合计与高峰时段定义 |
| Token 构成 | 缓存命中输入 / 未命中输入 / 输出 / 缓存写入的占比饼图，含各桶单价（单价按实际计价档，不再一律显示 `_default`） |
| 峰谷账单 | 高峰费用、空闲费用、相对全高峰节省、高峰 token 占比 |
| 模型构成 | 每个模型的 token 与费用（多模型分别计价） |
| 最近 30 天消耗 | 按日柱状图 + 明细表 |
| 24 小时分布 | 跨全部日期的按时段柱状图，高峰时段高亮；刻度单独一行对齐（`00/06/12/18/24`） |
| 日期 × 小时热力 | 日期 × 24 小时，描边标出高峰、绿框标出周末全天空闲；**可用滑块改窗口大小并平移查看更早时段** |
| 年度热力图 | GitHub 风格热力，与上面的热力图**共用同一个时间窗**（分档按窗口内数据重算，放大后不会整片同色） |
| 按会话消费 | 按费用降序的条形列表，**滑块分页、每次最多 8 行** |
| 按会话统计 | 按**最后活动时间**降序的会话表，**可折叠**，**滑块分页、每次最多 8 行**；可展开看单会话的饼图、峰谷账单、时长与 24 小时分布 |
| 最近调用 | 主机侧保留的最近 200 次调用（时间 / 模型 / 时段 / token / 费用），**滑块分页、每次最多 8 行** |
| 扫描信息 | 数据目录、读取日志数、格式分布、压缩体积与耗时、无时间戳采样数 |
| 导出 | 右上角一键导出 **CSV（按日 / 按会话 / 最近调用）** 与 **JSON**；CSV 带 UTF-8 BOM，Excel 打开中文不乱码 |

计时窗口控件提供三个预设（最近 30 / 90 / 180 天）与「全部」，外加两个滑块：
**窗口**（看多少天）与**右端**（看到哪一天），因此可以回看任意历史时段。
右端在未手动调整时始终跟随最新一天。

计费规则（单价、峰谷时段、周末规则、时区）全部可在 **设置 → 插件 → dsh-usage-billing-19pt** 里实时修改——那些字段都是 schemastery 的 `.volatile()` 字段，由 Loader 写回 profile patch，改完立刻重算，不需要重启。

> 作者 **@1999Pt**（设置页表单最下方，以及看板底部都有署名）。

---

## 安装

> ⚠️ **注意 npm 上的同名包不是本仓库。** `dsh plugin add dsh-usage-billing` 装到的是
> **另一套插件**（0.9.5，维护者 `ohmyrika`）——它监听 `llm/stream`、带预算/余额/双语，
> 与本仓库代码没有共同来源，而且同样注册 `/usage-billing` 路由。**两者不要同时装。**
> 本仓库的代码请按下面的「从源码 / 本地目录」或「从本仓库的 git 地址」安装。

### 从本仓库的 git 地址

```bash
# 桌面端
dsh plugin --profile desktop add "github:Kalcite/dsh-usage-billing-19pt"
# Web profile
dsh plugin --profile web add "github:Kalcite/dsh-usage-billing-19pt"
```

### 从 npm（仅当你把本包发布到自己的包名之后）

```bash
dsh plugin --profile web add <你的包名>
```

把 `web` 换成你实际使用的 profile 名。这类命令会：

1. 用 pnpm 把包装进该 profile 的 `node_modules`；
2. 把它写进 profile `package.json` 的 `dependencies`；
3. 因为包声明了 `dsh.bundle.patch`，把它追加进 `dsh.profile.bundles`，于是它的 `cordis.patch.yml` 会在下次启动时被合并——**不需要手改任何 profile 文件**。

装完重启 DSH，左栏导航里点 **「用量计费」**（若只在「设置 → 用量统计」里出现，那装到的是
0.9.5，不是本仓库）。

### 从源码 / 本地目录

```bash
git clone https://github.com/Kalcite/dsh-usage-billing-19pt dsh-usage-billing-19pt
cd dsh-usage-billing-19pt
pnpm install
pnpm run build          # 生成 lib/client.js 与 lib/*.js
dsh plugin --profile web add "file:$PWD"
```

`lib/` 是**必须预先构建并随包发布**的：DSH 不会替第三方插件构建任何代码，客户端模块系统只读取 `exports["./client"]` 指到的现成文件。

### 卸载

```bash
dsh plugin --profile web remove dsh-usage-billing-19pt
```

> 卸载前若你做过开发用的**目录联接**，请先让 profile 指向真实目录再卸载：带联接做递归
> 删除有跟随联接删掉源码树的风险。

### 验证装好了

```bash
# 主机半边：应返回 {"ok":true,...}
curl http://127.0.0.1:3080/usage-billing/health

# 客户端产物：应返回 200 与一段 JS
curl -I 'http://127.0.0.1:3080/plugins/??dsh-usage-billing-19pt/client.js&rev=0'
```

第二条的**地址形状很关键**：DSH 的客户端模块系统用**组合查询**寻址插件资源
（`/plugins/??<id>/client.js&rev=<hash>`），**不是** `/plugins/<id>/client.js`。
后者必然 404——那只是路径形状不对，不代表插件有问题。真实地址可以在页面控制台里读：

```js
window.__DSH_BOOT__.entries.find(e => e.id === 'dsh-usage-billing-19pt')
```

主机半边的自检也可用仓库自带的命令行报告（不依赖客户端插件系统）：

```bash
node bin/usage-report.mjs --port 3080
```

> 客户端插件路由由 `@deepseek-ai/dsh-client-modules` 注册，Web profile 会挂载它。
> 若某个精简装配缺了这一行，则**所有**客户端插件（含 DSH 自带）的 bundle 都会
> 404，本插件界面不会出现；此时主机半边与上面的命令行报告仍然可用。

---

## 桌面端与网页端

**两端的代码是同一套，但需要分别装、分别重启。**

| | 宿主半边（取数 / 计费） | 界面半边（导航栏 + 看板） |
| --- | --- | --- |
| Web profile（`dsh web`） | ✅ 已在 3080 实测 | ✅ 已实测渲染 |
| 桌面端（Electron） | ✅ 已在 19387 实测（`/usage-billing/health` 返回 200） | ⚠️ 结构上可用，未实测 |

为什么说桌面端结构上可用：桌面端就是**把完整的 DSH Web 应用包在 Electron 里**——

- 它把应用 HTTP 请求（含插件产物路由 `/plugins/*`）转发给受认证的 Host
  （`apps/desktop/src/web-document.ts` 的 `forwardWebRequest`，其中
  `PLUGIN_BUNDLE_PATH = /^\/plugins\//` 专门处理产物响应头）；
- 打包产物里**确实包含**客户端插件系统与我要用的那几个槽位——实测
  `resources/app.asar` 内有 `dsh-client-modules`、`dsh-client-ui-layout`、
  `dsh-client-ui-sidebar`、`dsh-client-ui-slots`。

**但桌面端要单独装一次**，而且装完要**完全退出并重开**桌面应用（profile 的 bundle
列表只在启动时组装）：

```bash
dsh plugin --profile desktop add dsh-usage-billing-19pt
```

桌面 profile 由 Electron 独占，CLI 会拒绝直接启动/导出它（`profile "desktop" is
managed exclusively by the Electron application`）——上面这条是 Desktop 自带的命令运行时
（`resources/runtime/cli/bin/dsh.cmd`），可以在桌面应用关闭时管理插件。

> ⚠️ **开发时最容易踩的坑**：`dsh plugin add` 装进来的是 pnpm 的**内容寻址快照**
> （硬链接），不是指向你工作目录的链接。所以你在工作区重新 `build` 之后，profile 里
> 那一份**不会跟着变**，宿主仍读旧产物——症状是「明明改好了、验证也过了，界面却没变化」。
> 开发时请把 profile 的 `node_modules/<包名>` 换成指向工作区的目录联接（junction），
> 或者改完后重跑一次 `add`。


所有字段都有默认值，**不配置即可用**（默认即 DeepSeek 官方定价）。要自定义，写进 profile 的 `cordis.patch.yml`：

```yaml
- id: usage-billing
  name: 'dsh-usage-billing-19pt'
  config:
    offPeakMultiplier: 0.5          # 空闲价 = 高峰价 × 该系数
    peakSlots:                      # 高峰时段（北京时间整点，含 start 不含 end）
      - { start: 9, end: 12 }
      - { start: 14, end: 18 }
    weekendRelax: true              # 周末全天空闲
    weekendRelaxFrom: '2026-08-23'  # 该日期 00:00 起生效；留空 = 始终生效
    # timezone: 'Asia/Shanghai'     # 统计时区；留空 = Asia/Shanghai（默认，见下）
    # home: 'C:\Users\you\.dsh'     # 会话数据目录；留空 = $DSH_HOME
    models:
      deepseek-flash:      { inputPerM: 3, outputPerM: 9,  cacheReadPerM: 0.1, cacheWritePerM: 3 }
      deepseek-v4-pro:     { inputPerM: 9, outputPerM: 27, cacheReadPerM: 0.3, cacheWritePerM: 9 }
      deepseek-v4-flash:   { inputPerM: 3, outputPerM: 9,  cacheReadPerM: 0.1, cacheWritePerM: 3 }
      _default:            { inputPerM: 3, outputPerM: 9,  cacheReadPerM: 0.1, cacheWritePerM: 3 }
```

> **注意**：`ctx.settings` 的命名空间是 Loader 的**行 id**（这里是 `usage-billing`），不是包名。所以在设置页保存单价后，写回的是 `id: usage-billing` 这一行。请不要改动这个 id，否则已保存的价格会失配。

### 默认单价

默认表取自 DeepSeek 官方定价文档（人民币 / 百万 token，高峰价）：

| 模型 id | 输入（未命中） | 输出 | 输入（命中） | 缓存写入 |
| --- | --- | --- | --- | --- |
| `deepseek-flash` | 3 | 9 | 0.1 | 3 |
| `deepseek-v4-pro` | 9 | 27 | 0.3 | 9 |
| `deepseek-v4-flash`（历史 id） | 3 | 9 | 0.1 | 3 |
| `deepseek-v4-flash-vision-exp` | 3 | 9 | 0.1 | 3 |
| `_default`（兜底） | 3 | 9 | 0.1 | 3 |

`deepseek-flash` 是当前 DSH 模型目录里的 id，`deepseek-v4-flash` 出现在较早的会话日志中，两者都保留、单价相同。未列出的模型走 `_default`。

### 峰谷规则

判定**优先级从高到低**：法定节假日 → 调休上班日 → 周末 → 工作日（这个顺序决定「当天被
叫作什么」，用于界面标注）。**计费上只有两档**：法定节假日与周末（**含调休上班的周末**）
全天按空闲价，其余工作日按高峰时段。

- 高峰时段默认 **09:00–12:00、14:00–18:00（北京时间）**，含起点不含终点。
- 空闲价 = 高峰价 × `offPeakMultiplier`（默认 0.5）。
- **法定节假日：全天按空闲价**。包括落在工作日里的假期（例如 2026-10-01 周四、10-02 周五），
  也包括调休连休期间的所有日期。这一条**不受 `weekendRelax` 开关影响**——春节、国庆的
  折扣语义与「周末打折」无关。
- **调休上班的周末（即所有周末）：全天按空闲价**。例如 2026-09-20 周日、2026-10-10 周六
  虽然是「上班日」，但 DeepSeek 的周末优惠看的是**周六 / 周日**本身：调休只改变「哪一天是
  休息日」，不改变「周末是空闲时段」这条定价事实。`weekendRelaxFrom` 门槛对它同样成立
  （2026-08-23 之前的调休周末仍分峰谷）。
- **普通周末（周六 / 周日）全天按空闲价**，自 `weekendRelaxFrom`（默认 `2026-08-23`）
  当日 00:00 起生效；该日期之前的周末仍区分峰谷时段。
- 单日费用按 **每个「日期 × 小时 × 模型」桶**独立判定峰谷，因此跨越时段边界的用量会被正确拆分。

#### 时区：默认北京时间，而不是运行环境本地时区

高峰时段是**按北京时间定义的整点**，所以「日期 / 星期 / 小时」也必须在北京时间下求解。
默认时区因此是 **`Asia/Shanghai`**（`timezone` 留空即用默认）。

> ⚠️ 早期版本把 `timezone` 留空并回落到 `Date` 的本地时区。机器时区为 UTC 时，北京
> 09:00 会被读成 01:00 而按**空闲价**计费——账单静默算错，`TZ=UTC` 下测试套件也会挂
> 2 个用例。现在默认固定为北京，`TZ=UTC` / `TZ=America/New_York` 下 106 个用例全绿。

如果你的工作时段本来就不在北京时间，显式配置 `timezone` 即可（例如 `Europe/Berlin`），
此时峰谷时段按该时区的整点解释。

### 节假日日历

内置 **2026 年**放假安排，逐条转录自官方通知：
[国务院办公厅关于2026年部分节假日安排的通知](https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm)
（国办发明电〔2025〕7号）。

| 假期 | 放假 | 调休上班 |
| --- | --- | --- |
| 元旦 | 01-01 → 01-03 | 01-04 |
| 春节 | 02-15 → 02-23 | 02-14、02-28 |
| 清明节 | 04-04 → 04-06 | — |
| 劳动节 | 05-01 → 05-05 | 05-09 |
| 端午节 | 06-19 → 06-21 | — |
| 中秋节 | 09-25 → 09-27 | — |
| 国庆节 | 10-01 → 10-07 | 09-20、10-10 |

> ⚠️ **后续年份需要你自己补**。国务院每年 11 月左右公布次年安排，内置数据因此有个明确的
> 截止点（看板上「扫描信息 → 节假日日历覆盖」会显示覆盖到哪一年）。未覆盖的年份会**静默
> 退回「只看周六周日」**的老行为，所以到期后请补上：

```yaml
- id: usage-billing
  name: 'dsh-usage-billing-19pt'
  config:
    extraHolidays:                       # 叠加在内置数据之上，不会覆盖内置
      - { name: 元旦, from: '2027-01-01', to: '2027-01-03' }
    extraMakeupWorkdays:                 # 这些日期按工作日分峰谷
      - '2027-01-04'
```

费用公式：

```
桶费用 = Σ_模型 (输入×inputPerM + 输出×outputPerM + 缓存读×cacheReadPerM + 缓存写×cacheWritePerM) / 1e6 × 峰谷系数
峰谷系数 = 高峰 ? 1 : offPeakMultiplier
```

---

## 缓存

扫描全部会话日志要解压几十 MB。**实测数字**（`check-ledger.mjs`，16 个日志 / 14.6 MB 压缩）：

| 阶段 | 耗时 |
| --- | --- |
| 目录遍历 `listSessionLogs` | 4 ms |
| 读文件 | 8 ms |
| zstd 逐帧解压（约 7000 帧） | 263 ms |
| 解析（`indexOf` 扫行 + JSON.parse） | 约 180 ms |
| **全量扫描合计** | **约 450–650 ms**（随日志库大小线性增长） |
| 之后打开（校验指纹 + 读缓存） | **~5 ms**（约 100×） |

> 早期文档写的「约 5 秒」与这台机器不符，已按实测校正。逐帧解压无法合并成一次调用：
> Node 的 `zstdDecompressSync` 与 `createZstdDecompress` 对拼接帧**都只返回第一帧**
> （实测 24 字节只出 8 字节），所以按帧循环是必需的。

**命中条件**：会话日志的*指纹*（日志数量 + 总字节数 + 最新 mtime）与*计费规则*都没变。
指纹只需遍历目录取 stat（实测 4 ms），不读内容、不解压。

- **「再次扫描」按钮**（看板右上角）跳过缓存，重新读取全部日志并更新缓存——这就是「更新」的入口。
- 面板顶部会显示本次是**缓存**还是**全量扫描**，以及加载时间。
- 缓存放在系统临时目录（`%TEMP%/dsh-usage-billing-19pt/overview-<数据目录哈希>.json`），
  按数据目录区分；它是纯派生数据，**删掉只是重扫一次**，任何损坏/权限问题都会自动退回扫描。
- 改了单价或峰谷规则会让缓存自然失效（计费规则参与缓存键），无需手动清理。

---

## 数据来源

会话日志位于 `$DSH_HOME/sessions/<projectKey>/<sessionId>/`：

- `session.jsonl.zstd` —— **generation 0**（最早格式）
- `session.v2.jsonl.zstd` / `session.v3.jsonl.zstd` —— **generation 2 / 3**
- `session.v4.jsonl.zstd` —— **generation 4**（当前格式）

同一会话目录里可能残留多个代号的文件，读取时取**代号最高**者（同代号优先 `.zstd`）。每个文件是由**多个带校验和的 zstd 帧**首尾拼接而成（DSH 这样追加写入而不重写整个文件），因此没有帧长度索引，必须先扫帧再逐帧解压。

Token 记账有两种载体：

- **generation 4**：只有 `assistant/message` 行的 `data.usage`。
- **generation 0**：`assistant/chunk` 行（`data.chunk.type === 'usage'`）与紧随其后的 `assistant/message` 行携带**同一份**用量。

> 实测这台机器的会话库是 **generation 2 / 3 / 4，没有 generation 0**：`(turn, step)`
> 去重因此一次都没触发（`duplicateSamples` 恒为 0）。去重逻辑仍然保留——它是对旧格式
> 的正确性保障，只是当前数据里不再出现。判定载体与代号无关，所以 gen 2 / 3 也按同一
> 套规则解析。

模型归因按可靠性排序：`data.message.source.model` → 最近的 `request/context.data.model` → 最近的 `request/header.data.header.config.model` → `unknown`。

### 时间戳缺失的采样

少数情况下日志里的 usage 行没有 `time` 字段。这类采样**无法归入「日期 × 小时」，也就无法
判定峰谷、无法计价**，因此一律不计入任何统计（含总量与总费用），只在「扫描信息」里单独
显示条数。这样「输入 tokens」卡片与「总费用」卡片永远同源——早期版本把它们算进总量却算不
进费用，两张卡片口径不一致。

---

## 与原实现的差异

相对启动器里的内嵌用量插件，本插件修正了两处真实缺陷，并做了一点加固。两处都经过实测验证。

### 1. 旧格式日志的用量被算成 2 倍（已修正）

参考实现按行判断：

```js
if (chunk && chunk.type === 'usage' && chunk.usage) u = chunk.usage;   // assistant/chunk 走这里
else if (j?.data?.usage && typeof j.data.usage === 'object') u = j.data.usage;  // 兄弟行 assistant/message 走这里
```

generation 0 的同一份用量因此被计两次。实测本机全部 generation 0 会话，**朴素解析 / 去重后的比值恒为 2.000**：

| 会话 | 朴素累加（输入） | 去重后（输入） | 比值 |
| --- | --- | --- | --- |
| 会话 1 | 243,390 | 121,695 | 2.000 |
| 会话 2 | 116,520 | 58,260 | 2.000 |
| 会话 3 | 161,358 | 80,679 | 2.000 |
| 会话 4 | 284,674 | 142,337 | 2.000 |
| 会话 5 | 148,340 | 74,170 | 2.000 |

本插件按 **`(turn, step)`** 归一：同一步的多个采样只保留最后一个（`assistant/message` 是最终的完整采样），于是既修掉双计，又保留了「重试后取最终值」的正确语义。

> 这意味着本插件对历史（generation 0）会话的费用**低于**启动器显示的数字——低的那一半才是真实用量。

### 2. 当前格式（generation 4）的日志被整个漏掉（已修正）

参考实现的文件名正则只认到 `.v2`：

```js
/^session(?:\.v(\d+))?\.jsonl(?:\.zstd)?$/   // 这个其实不设上限
// 但同一仓库的注释与实际取舍按 v0/v1/v2 编写，v4 从未被考虑
```

本机实测：21 个会话目录中 **5 个已经是 `session.v4.jsonl.zstd`**，在旧口径下完全不计入。本插件用不设上限的代号匹配，并优先选最高代号。

### 3. 加固

- **时区显式化**：日期 / 星期 / 小时用 `Intl.DateTimeFormat` 在指定时区下求解，而不是 `Date#getHours()`。后者读运行环境本地时区，会让同一份日志在服务端与浏览器上算出不同的峰谷归属。
- **坏帧与坏行容错**：单个解压失败的帧或个别损坏的 JSON 行不会让整个会话从统计里消失。
- **零依赖**：不引入打包器、不引入第三方运行时依赖；客户端产物按官方格式手工生成。

> 关于损坏帧的边界：DSH 自己的 `scanZstdFrames` 在遇到非法帧头 / 保留位 / 保留块类型时**直接抛错**，只对「尾部被截断的最后一个帧」提供恢复（`decompressZstdPrefix`）。追加写的日志正常情况下不会有中间空洞，所以本插件与 DSH 保持一致：中段损坏等价于「此后不可读」。这一点有测试覆盖。

---

## 实现说明

### 主机半边（Node）

`src/index.ts` 是插件主体：

- 导出 `name` / `inject` / `Config` / `apply`；
- `Config` 的每个字段都是 `.volatile()`，因此可在设置页实时编辑并由 Loader 持久化；
- 注册一条只读路由 `/usage-billing/*`：

| 路径 | 说明 |
| --- | --- |
| `GET /usage-billing/summary` | 完整聚合结果（`?refresh=1` 跳过缓存，`?home=` 指定数据目录） |
| `GET /usage-billing/pricing` | 当前生效的计费规则 |
| `GET /usage-billing/export` | 导出：`?format=csv\|json&scope=day\|session\|model\|hour\|recent`，带 `Content-Disposition` |
| `GET /usage-billing/health` | 路由与数据目录自检 |

路由套了一层**浏览器信任围栏**（回环地址，或部署声明的 `webRuntime.trustedHosts`），避免同一局域网内的其它来源读到本机用量。没有任何写入路径。

`?home=` 与 `?refresh=1` 都只是**参数校验后**才使用；`/export` 对非法 `format` / `scope`
返回 400（不是 500）。导出文件名同时给出 ASCII 回退名与 RFC 5987 的 `filename*=UTF-8''…`：
`Content-Disposition` 的头部值只允许 Latin-1，直接塞中文会让 Node 的 `setHeader` 抛
`ERR_INVALID_CHAR`，整个导出变成 500——参考实现（0.9.5）的导出路由正是这样挂掉的。

聚合结果按 `日期 × 小时 × 模型`（`byDayHour`）作为唯一能正确套用峰谷与周末规则的粒度；浏览器半边拿到这一层后自行重算金额，因此改单价后无需重新读盘。

### 浏览器半边（Web）

`src/client/` 下的模块由 `scripts/build-client.mjs` 拼成 `lib/client.js`。

DSH 的官方客户端打包预设（`packages/client/tsdown.client.ts`）**不在任何已发布的 npm 包里**，官方文档明确要求仓库外的包自行复现该构建（`docs/cookbook/adding-a-settings-card.md`）。本包在浏览器侧只有几个模块、唯一的外部依赖是 shell 已共享进模块表的 `react`，因此不引入打包器，直接拼接源码并套上官方预设的 banner / footer：

```js
window.__ModuleLoader__.load({
  id: "dsh-usage-billing-19pt",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    /* 源码 */
    return module.exports;
  } });
```

构建脚本会静态校验：任何 `require()` 都必须能由模块表回答（基线外部依赖或 `dsh.client.external`），并且不出现跨插件的 `@deepseek-ai/*` **值**引用。

浏览器半边通过 `ctx.slots.inject('main', …)`（主列面板）与
`ctx.slots.inject('sidebar.panellist', …)`（左栏导航行）贡献界面，两者的 id 相同
（`usage-billing`），点击导航行即 `layout.selectPanel('usage-billing')`。
只注入 `slots`，数据全部走自己的 HTTP 路由。

---

## 与 npm 上同名插件的差异

npm 上的 `dsh-usage-billing`（0.9.5，维护者 `ohmyrika`）是**另一套完全不同的实现**：它监听
`llm/stream`、把统计写进 `.dsh-usage-billing.json`，带预算告警 / 官方余额拉取 / 中英双语 /
`usage_billing` 动态工具，界面是「侧边栏卡片 + 弹窗 + 设置页 → 用量统计」。本包是**扫日志**的实现
（读 `$DSH_HOME/sessions` 下的 zstd 会话日志），看板挂在左侧主导航栏。

### 命名：包名带 `-19pt`，但有两处刻意不变

| 名字 | 值 | 说明 |
| --- | --- | --- |
| 包名 | `dsh-usage-billing-19pt` | 与 npm 上那套同名插件彻底分开。它同时是**客户端模块 id**（`window.__ModuleLoader__.load({ id })`），由构建脚本从 `package.json` 的 `name` 自动取用，因此改名只需改一处 |
| patch 行 `name` | `dsh-usage-billing-19pt` | 必须与包名一致，DSH 才能按名字装载这一行 |
| patch 行 `id` | **`usage-billing`（不变）** | 它是 `ctx.settings` 的命名空间。改了会让已保存的单价 / 峰谷规则失配 |
| HTTP 路由前缀 | **`/usage-billing`（不变）** | 这是 URL 路径而不是包名。改它要同时动 `ROUTE_PREFIX`、浏览器半边的取数地址与 `bin/usage-report.mjs`，会让既有书签与脚本失效——需要的话说一声 |
| localStorage 键 | `dsh-usage-billing-19pt.cards` | 卡片显示项的偏好，换名后需要重新勾一次 |
| 缓存目录 | `%TEMP%/dsh-usage-billing-19pt/` | 换名后首次打开会重扫一次（约半秒），之后照旧走缓存 |

> ⚠️ 路由前缀仍然是 `/usage-billing`，所以本插件与 0.9.5 **依然不能同时安装**。

> 🔁 **改名后要清一次旧的依赖项。** profile 的 `dependencies` 是按**包名**记录的，包名不同
> 不会自动覆盖：如果那里还留着 `dsh-usage-billing`（0.9.5，或本包改名前的记录），请先
> `dsh plugin --profile <profile> remove dsh-usage-billing`，再装 `dsh-usage-billing-19pt`。

两者只是重名，代码没有共同来源。本包借鉴了它的**卡片视觉口径**（1px 细边框 + 分层底色 +
8px 圆角、金额蓝 `#60a5fa`、8px 比例条），并修掉了它导出路由的故障：

| | 0.9.5 | 本包 |
| --- | --- | --- |
| 取数 | 监听 `llm/stream` + 首次回填 | 扫会话日志 + 磁盘缓存 |
| 导出 | `GET /usage-billing?action=export&format=csv&scope=day` —— **本机实测返回 HTTP 500，导出完全不可用** | `GET /usage-billing/export?format=csv&scope=day`，有测试覆盖 |
| 预算 / 余额 / 双语 / 动态工具 | 有 | 无（不在本包范围内） |

> ⚠️ 因此**两份不要同时装**：两者都会注册 `/usage-billing` 前缀路由，并且**换装本包后
> `usage_billing` 动态工具会消失**（那是 0.9.5 提供的，本包不提供）。

### 本轮修复（v1.0.0）

1. **时区默认改为 `Asia/Shanghai`**。此前留空会回落到运行环境本地时区，机器时区为 UTC 时
   北京 09:00 被当成 01:00 按空闲价计费（静默算错），`TZ=UTC` 下测试套件挂 2 个用例。
2. **无时间戳的采样不再破坏口径**。以前它们计入总量却不计入费用，导致「输入 tokens」与
   「总费用」两张卡片不同源；现在一律不计入任何统计，只单独计数并在扫描信息里显示。
3. **导出可用**（见上表），并补上 UTF-8 BOM、CRLF、RFC 4180 转义与 RFC 5987 文件名。
4. **`?home=` 真的生效**。命令行 `node bin/usage-report.mjs --home <dir>` 以前拼了查询参数但
   路由根本不读，属于静默失效。
5. **行扫描用 `indexOf` 取代逐字符 `charCodeAt`**（13.7 MB 文本 25 ms → 1 ms，全量扫描
   600+ ms → 454 ms）。
6. **`listSessionLogs` 用 `withFileTypes`**，去掉每个会话目录多余的 2 次 `statSync`。
7. **看板参考实现的卡片样式重建**，并新增：卡片显示项可自选、三个列表改 8 行滑块分页
   （按会话统计按最后活动排序且可折叠）、最近调用列表、导出按钮、作者署名。
8. **计费口径纠正：调休上班的周末改为全天按空闲价**。此前把调休周末当工作日分峰谷，与
   「周末全天优惠」不符——它会把 2026-09-20、2026-10-10 这两个「要上班的周末」按高峰价
   计费，账单偏高。`weekendRelaxFrom` 门槛保持不变。
9. **新增「本日消费时段分布」图**：今日 24 小时的费用柱状图（高峰高亮 + 独立刻度行 +
   今日合计）。

> 计费口径这一条会**改变历史数字**：2026 年的 6 个调休上班日（01-04、02-14、02-28、05-09、
> 09-20、10-10）里，落在 `weekendRelaxFrom` 之后的 09-20 与 10-10 的费用会下降。缓存键含
> 计费规则指纹，因此改动后会自动失效并重算，不需要手动清缓存。

---

## 开发

```bash
pnpm install
pnpm run typecheck      # tsc --noEmit
pnpm run build:client   # 只重建 lib/client.js
pnpm run build          # 客户端产物 + tsc
pnpm test               # 113 个用例，含真实 cordis + webserver 的集成测试
pnpm run verify         # 测试 + 客户端产物契约检查 + 真实会话库对账
```

`pnpm test` 刻意不使用 `node --test <dir>`：内置 runner 会为每个测试文件 spawn 子进程，在受限环境（Windows 沙箱、部分 CI token）里会被拒绝并报 `spawn EPERM`。测试入口改为在当前进程内逐个 import 测试文件，因此任何环境都能直接跑。

### 测试覆盖

- `tests/pricing.test.mjs` —— 单价兜底与合并、峰谷边界（含起点不含终点）、周末规则生效日期、跨时区日期/小时分解、金额公式。
- `tests/parse.test.mjs` —— 文件名选版（含 v4 与不设上限的代号）、zstd 多帧扫描与坏帧容错、`(turn, step)` 去重、模型归因优先级、损坏行容错、CRLF。
- `tests/cache.test.mjs` —— 指纹随数量/字节/mtime 变化、缓存命中与失效、原子替换、损坏容错、端到端二次读取。
- `tests/holidays.test.mjs` —— 2026 年放假安排逐条对账、节假日/调休/周末的优先级与金额。
- `tests/host-route.test.mjs` —— 把插件挂进真实 cordis + 真实 `dsh-host-webserver`，用合成的压缩会话库验证路由、计费数字、配置热更新、信任围栏、卸载时路由释放，以及 **`/export` 真的能导出**（BOM、`Content-Disposition`、非法参数 400）与 **`?home=` 真的生效**。
- `tests/panel-render.test.mjs` —— 在 jsdom 里真正挂载看板，验证九个区块、24 小时刻度独立成行、热力时间窗、图标、槽位注册顺序、三个列表的 8 行滑块。
- `tests/dashboard.test.mjs` —— 默认时区为北京（`TZ=UTC` 回归）、调休周末与法定节假日全天按空闲价、客户端与主机口径同构、无时间戳采样不进统计、`recent` 有界且峰谷正确、CSV/JSON 导出与文件名、卡片自选与 localStorage、分页夹回、今日汇总与本日时段分布与整体重算同口径。

---

## 兼容性

- Node：`^22.19.0 || >=24.0.0`（与 DSH 一致；同步 zstd 解压自 Node 22.19 起可用，缺失时自动退回异步路径）。
- `peerDependencies`：`@deepseek-ai/cordis` ^4.0.4、`@deepseek-ai/dsh-host-webserver` ^0.2.0-rc.1、`@deepseek-ai/schemastery` ^3.18.4。
- 若 DSH 版本升级导致 peer 范围不匹配，插件会在加载时被拦下，需要按提示授予一次版本豁免。

## 许可

MIT
