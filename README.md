# koishi-plugin-aka-yib-web-search

面向 **YesImBot** 的独立联网搜索与网页正文读取插件，基于 DeepSeek 官方 Search / Fetch API（`POST /v1/tools/search` 与 `POST /v1/tools/fetch`）。

- 强依赖 `yesimbot` 服务（`inject = ['yesimbot']`），向 YesImBot 注册跨模型兼容（Gemini / OpenAI / DeepSeek / Claude）的 `web_search` 与 `web_fetch` 工具。
- 同时暴露 Koishi 服务 `ctx.akaYibWebSearch`（`search(input, signal?)`、`fetch(input, signal?)`），供同实例内扩展调用。
- 提供可选的 `websearch` / `webfetch` 管理员指令，输出使用 `h.text()` 逐字转义，避免外部网页文本触发 Satori 元素注入。
- 仅依赖 `koishi` peer dependency 与 Node.js 20+ 原生 `fetch`，不依赖 SearXNG、Tavily 或 MCP。

## 安装

```sh
npm i koishi-plugin-aka-yib-web-search
```

## 配置说明

在 Koishi 插件配置页启用 `aka-yib-web-search`（需先启用 YesImBot），并填写 DeepSeek API Key：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `apiKey` | `""`（secret） | DeepSeek API Key |
| `baseUrl` | `https://api.deepseek.com` | 可信 DeepSeek API Base URL（不带 `/v1`） |
| `defaultLimit` | `5` | 默认搜索条数（1–50） |
| `maxLimit` | `10` | 单次最大搜索条数（1–50） |
| `defaultNeedContent` | `false` | 搜索默认是否包含网页正文 |
| `localization` | `""` | 可选本地化 IP |
| `minRerankScore` | `0` | 最低 `rerank_score` 过滤阈值（0 不过滤；正数会同时滤除缺评分项） |
| `maxSearchContentChars` | `3000` | 单条搜索结果 `content` 最大 Unicode 字符数 |
| `maxFetchChars` | `12000` | `fetch` 返回 Markdown 正文最大 Unicode 字符数 |
| `timeoutMs` | `15000` | 单次请求超时（毫秒） |
| `maxRetries` | `2` | 对 `408`/`429`/`5xx`/网络异常/超时的额外重试次数 |
| `blacklist` | `[]` | URL 正则黑名单（空项或非法正则会告警并忽略） |
| `yesimbotEnabled` | `true` | 是否向 YesImBot 注册 `web_search` 与 `web_fetch` |
| `enableCommands` | `true` | 是否启用 `websearch` / `webfetch` 指令 |
| `commandAuthority` | `3` | 指令最低权限等级 |

## 指令用法

- `websearch <query>`：联网搜索，返回标题、URL 与摘要
- `websearch -n 3 -c <query>`：最多返回 3 条并包含截断后的网页正文（`--content` 等价于 `-c`）
- `webfetch <url>`：读取指定 HTTP/HTTPS 网页的 Markdown 正文

## 服务调用示例

```ts
const result = await ctx.akaYibWebSearch.search({ query: 'Koishi', count: 3 })
if (result.ok) {
  console.log(result.results)
} else {
  console.log(result.error.code, result.error.retryable, result.error.message)
}
```

所有方法均返回 `ok` 判别联合，不向调用方抛出未捕获网络异常。API Key 不写入日志。

## 行为与安全边界

- `query` 与 `ori_question` 自动去首尾空白并按 Unicode 码点安全截断至 128 字符。
- `fetch` 仅接受不含内嵌账号密码、含主机名且编码前后长度均不超过 8192 字符的 HTTP/HTTPS URL。
- 仅对 HTTP `408`、`429`、`5xx`、网络异常及超时指数退避重试（遵循 `Retry-After`，上限 30 秒）；`400`/`401`/`402`/`403`/`404`/`413` 绝不重试；外部 `AbortSignal` 取消时立即停止。
- DeepSeek 独立 Search / Fetch API 为付费接口（仅成功且非空响应计费），当前不支持图片搜索。

## 开发与发布

```sh
pnpm typecheck
pnpm build
pnpm test
```

发布由工作区根 `./push.sh aka-yib-web-search` 手动触发。
