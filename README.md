# gpttest.icu · GPT 降智检测站

让模型画一只骑自行车的鹈鹕，以关键词采样和动画对比进行娱乐性观察。本站与 OpenAI 无关，结论不代表模型真实能力。

- 浏览器直连用户填写的 Responses API 中转站，`reasoning.effort` 固定为 `low`。
- 请求格式参照 Codex CLI `0.153.0`：消息数组、`store: false`、加密推理内容请求、会话缓存键及客户端元数据。
- 地址与 API Key 仅存在于检测页面内存；不持久化、不发送给本站 API、不做服务器代理。
- 快速测试采集前 N 个非空段落或字符上限，达到条件立即断流；默认 3 段 / 2000 字符。
- 快速测试后三种结果均可选择完整测试，实时安全预览并与参考画作对比；一次流程上报一条匿名事件。
- 作品支持完整测试上传、粘贴或文件上传，审核后公开；提供双榜、分页、筛选、搜索及去重点赞。

本地需求验收记录与截图不随源码发布；验证方式见下文。

## 本地开发

需要 Node.js **22.13+**（推荐当前 Node 22 LTS 补丁版）、npm。

```bash
# 终端 1：设置自己的管理密码后启动 API
cd server
npm ci
ADMIN_PASSWORD='替换为你的管理密码' npm run dev

# 终端 2：前端，http://localhost:5173
cd web
npm ci
npm run dev

# 可选终端 3：本地模拟中转站
node scripts/mock-relay.mjs
```

页面中填写 `http://localhost:9797/v1` 与任意测试 Key，然后拉取模型。`gpt-6astra-dumbed`、`gpt-6astra-normal`、`gpt-6astra-mystery` 分别模拟三种结论。模拟端点不消耗真实模型额度。

管理后台位于 `/admin`。未设置密码或仍使用 `change-me-please` 时禁止登录。根目录 `.env` 是 Docker Compose 的配置来源，本地 `npm run dev` 需像上例一样显式注入环境变量。

## 自动化验证

```bash
# 采样、判定、SSE、净化和快照校验
cd server
npm test
npm run build

# 浏览器/API 验收（首次需安装 Chromium）
cd ../web
npx playwright install chromium
npm run build
npm run test:e2e
```

端到端测试自动启动独立 API（18787）、前端（15173）和模拟中转站（19797），使用系统临时目录下的独立 SQLite 数据库，不使用开发数据库。失败时保存 trace 与截图，报告位于 `web/playwright-report/`。验收截图中的作品与统计来自测试数据。

## Docker 部署

```bash
cp .env.example .env
# 编辑 .env，将 ADMIN_PASSWORD 换成自己的密码

docker compose up -d --build
# http://服务器IP:8787
```

SQLite 数据位于宿主机 `./data/`，重建容器后保留。环境变量包括 `ADMIN_PASSWORD`、`PORT`、`DB_PATH`、`TRUST_PROXY`。

启用域名 HTTPS：把域名指向服务器，取消 `docker-compose.yml` 中 Caddy 服务的注释，并将 `TRUST_PROXY=1`。应限制外部直接访问应用端口，仅让受信任反代访问；默认直接访问模式使用 `TRUST_PROXY=0`。`Caddyfile` 提供 `gpttest.icu` 配置示例。

## 判定与隐私边界

- 采样保留原始空白，字符上限按累计文本计算；第三段未遇换行时继续等待，直到流正常结束或上限触发。
- 同一关键词多次命中重复计分，不区分大小写；分数相等或零命中为“无法判断”。
- 快速测试完成后，三种结果均等待用户结束、重测、离页或完整测试结束再上报，一次流程只计一次。完整测试失败/手动停止也标记为进行了完整测试。快速测试未形成判定的取消/失败不计数。
- 上报字段严格限制为 `{ verdict, ran_full }`；离页使用 `keepalive`。网络中断或浏览器被强制结束时，上报仍可能丢失；没有添加额外身份字段或后台重试队列。
- 模型调用不携带本站 Cookie，不跟随重定向，不发送 Referrer。中转站需要支持 CORS；失败时提供直连排错提示。
- 中转站的 CORS `Access-Control-Allow-Headers` 需允许 `authorization, content-type, originator, version, session-id, thread-id, x-client-request-id, x-codex-window-id`。模型列表也携带 `originator` 和 `version`。
- 快速测试与后续完整测试共用内存中的会话 ID、线程 ID、窗口 ID 和 `prompt_cache_key`；每次请求使用新的 `turn_id`，重新检测生成新的一组身份。安装 ID 为本流程临时值，不读取本站匿名 ID，不持久化这些元数据。
- 请求失败时页面完整展示 HTTP 状态、可读取的请求 ID 等诊断响应头、原始响应正文或流式错误事件，长内容不截断，HTML 按纯文本显示。浏览器因 CORS 或网络异常未提供响应时，显示原始异常及原因，不推测不可读取的响应内容。
- 浏览器匿名 UUID、昵称和已点赞作品可保存在 localStorage。禁用存储时降级为页面内存。

## 预览安全与提示词来源

所有预览均使用 `sandbox=""` iframe，不允许脚本、同源权限、表单或弹窗。前后端共享净化策略：DOMPurify 解析 HTML/SVG，CSS Tree 检查 CSS；移除事件、外链、危险命名空间及可能改变链接的动画属性，保留安全的 CSS / SMIL。CSP 禁止脚本、网络资源、表单和 base URL。

原始参考文件保留在根目录。发布用参考样本保持原有画面，将 JavaScript 动画改为 CSS / SMIL，并针对小容器隐藏内部标题与页脚；该版本同时打包进前端和服务端。后台可替换参考样本。

Codex 提示词使用 `openai/codex` 提交 `963009737fc6e7d45ca5cb37d63107b8be368eda` 的完整 `gpt-5.1-codex-max_prompt.md`，原样打包。来源、SHA-256 与许可证保存在 `server/src/assets/`。这是固定的公开 CLI 提示词快照，并非 GPT-6Astra 专属提示词；本站不执行 Codex CLI 工具，也不宣称复刻其运行时。此范围对应需求 4.2 对“模拟 Codex”的定义。

请求协议参照官方 [`rust-v0.153.0` 的请求构造代码](https://github.com/openai/codex/blob/rust-v0.153.0/codex-rs/core/src/client.rs#L984-L1031)及该版本的会话元数据、请求头实现，集中在 `web/src/lib/codex.ts`。发送 `originator: codex_cli_rs`、`version: 0.153.0`。网页没有工具执行循环，因此沿用原网页请求的无工具方式，省略 `tools`、`tool_choice`、`parallel_tool_calls`；不发送空工具列表或声明网页无法执行的 CLI 工具。曾加入的空工具配置出现了用户报告的 `Tools must be a list` 兼容性回归，现已撤回；具体中转转换原因仍需该端点验证。不编造本地工作区或终端元数据。模型相关的可选参数（如推理摘要和文本详细度）未强行添加，仍使用后台配置的提示词。

浏览器的 HTTP/SSE 请求无法完整复刻原生 CLI：Chrome 会[忽略 fetch 的 User-Agent 覆盖](https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_request_header)，网页也受 CORS 限制。因此不设置虚假的 `User-Agent` 覆盖，不保证通过所有中转站的 CLI 身份校验。协议兼容调整也不能消除中转站负载上限或上游错误。

管理会话采用 HttpOnly、SameSite=Strict Cookie；HTTPS 反代启用 Secure。管理写入检查同源与 JSON 格式，登录使用恒定时间比较、失败延迟和频控。公开写入同样限流，上传按 UTF-8 字节限制为 2MB。

## 目录

- `web/`：React + Vite，浏览器检测、展示和管理界面。
- `server/`：Hono + SQLite，配置、统计、作品、审核和管理会话。
- `server/src/sanitize-policy.ts`：前后端共用的净化规则。
- `scripts/`：模拟中转站与核心单元测试。
- `THIRD_PARTY_NOTICES.md`：第三方资源来源与许可证。

已识别的旧默认提示词与参考样本会自动迁移，管理员改过的配置保持原值。旧版管理员浏览器令牌不再有效，需要重新登录。

### 人工判断与聊天记录

完整测试结束后可选择「已降智 / 正常未降智 / 无法判断」。人工反馈单独保存到 `test_feedback`，同一次测试重新选择会更新原记录，不增加检测次数；管理概览可查看人工判断分布和自动结论对比。

上传作品必须手动选择判断，并附带完整聊天记录。本页测试会自动附带每次请求的提示词、收到的完整模型文本（含快速采样及重试）和完成状态；自定义上传需粘贴聊天记录。作品保存人工结论、自动结论和聊天记录，管理员审核时可查看，审核通过后在作品详情公开。聊天记录上限 8MB，不包含请求凭据或端点地址；旧作品显示「未附带聊天记录」。数据库新增字段和反馈表会在启动时自动迁移。

## 许可证

本项目原创代码采用 [MIT License](LICENSE)，Copyright (c) 2026 iwyxdxl。
第三方提示词及依赖保留各自许可证，不因本项目采用 MIT 而变更；详见
[第三方声明](THIRD_PARTY_NOTICES.md)。
