# Changelog

## 0.1.0 — Unreleased

- 新增面向 YesImBot 的 DeepSeek 官方 Search / Fetch 联网插件 `koishi-plugin-aka-yib-web-search`（`inject = ['yesimbot']`）。
- 新增独立 DeepSeek Search / Fetch 客户端（`DeepSeekSearchClient`）与 Koishi 服务 `ctx.akaYibWebSearch`。
- 新增跨模型兼容工具 Schema（`vercel.ai.schema` 契约，兼容 Gemini / OpenAI / DeepSeek / Claude）与 YesImBot `ChannelPlugin` 桥接（`web_search` / `web_fetch`）。
- 新增可选 `websearch` / `webfetch` 权限控制命令，统一使用 `h.text()` 转义外部网页文本防止 Satori 元素注入。
- 支持 Unicode 码点安全截断、URL 合法性与内嵌凭证校验、黑名单过滤、规范化去重、评分过滤、正文截断、OpenAI 兼容错误解析及可取消指数退避重试。
- 输出 CJS / ESM / `.d.ts` / `.d.mts` 双格式构建产物，零新增第三方运行时依赖，并通过 Vitest 单元测试与本地 Koishi 冒烟验证。版本保持 `0.1.0`，尚未发布。
