# 对话内联缩略图任务进展

> 目标：让工具生成的图片（generate_image / read_image 返回的 image 附件）在 DSH 对话 UI 渲染为内联可点击缩略图。

## 已确认的事实（调研结论）

1. **UI 渲染规则**（`ui-conversation/conversation-nodes/message.ts`）：
   - 仅 `source.kind === 'user'`（人手上传）→ 用户气泡 + `ImageGallery` 缩略图 + `ImageLightbox` 放大。
   - `source.kind === 'plugin'` → 折叠 context 行（纯文本），无缩略图。
2. **工具行渲染**：`ui-tool` 注册 `conversation.chat.node` key=`tool-call` → `ToolCallTree`；
   原子视图走 **`tool.call.toolview` 按工具名 key 插槽**（参考 `toolviews/read-row.tsx` 的 `readToolview`）。
3. **toolview 契约**（`ui-tool/contract/slots.ts`）：props = `ToolCallOwnerProps`
   `{ callId, toolName, block, cwd, openFile, inspect }`。**不含 imageLoader / session**。
4. **图片加载**：`Session.readAttachment(attachmentId)` → `{ attachment, data: Uint8Array }`
   （`runtime/contract/session.ts`）。对话里 `loadImage` 由 conversation owner 传入 ChatView，
   并下传到 ChatNodeSeat，但 **toolview 拿不到**。
5. **client 插件协议**：`window.__ModuleLoader__.load({ id, factory })`，`require` 注入
   `dsh.client.inject` 列出的模块（参考 dsh-devquest / dsh-tool-vision 的 client.js）。

## 候选方案（按优先级）

- **方案 1（client 插件，toolview）**：为 `generate_image`/`read_image` 注册 toolview，
  从 `block.content` 提取 image 附件，用 `ImageGallery`/`MessageImage` 渲染。
  难点：imageLoader 需当前会话 `readAttachment`。需找到在 toolview React 树内可访问的
  session context/hook（待查：web-react session-provider / conversation context 是否可注入）。
- **方案 2（client 插件，覆盖 tool-call 节点渲染器）**：注册自己的 `conversation.chat.node`
  key=`tool-call`，能拿到 `loadImage`，但会替换默认工具树，风险高。
- **方案 3（改源码）**：修改 `ui-tool` ToolCallTree/toolview 契约，把 `loadImage` 透传给 toolview，
  或直接在 ToolRow 渲染 image 附件。需 `pnpm build` 源码并从源码运行验证。

## 下一步

1. 查 client 插件能否在 toolview 内通过 React context 拿到 session（方案 1 可行性）。
2. 可行 → 写 client 插件；不可行 → 评估方案 2/3。
3. 安装到桌面版 profile，重启验证（视觉确认需用户）。

---

## Round 1（已实施，待用户重启验证）

**结论：方案 1 可行，且比 toolview 更干净** —— 改用「自定义 Conversation Node + 渲染器」。

关键依据：
- `ChatNodeSeat` 的 owner props **包含 `loadImage`**，并随 `renderSlot('conversation.chat.node', routedOwner, …)` 传给节点渲染器
  （`ui-conversation/chat/ChatNodeSeat.tsx` L25-48）。因此自定义节点渲染器能直接拿到图片加载器，无需 session context。
- 参考 `dsh-tool-vision`：client 插件用 `ctx.conversationEvents.register(nodeDef)` +
  `ctx.slots.register({name:'conversation.chat.node', key:<kind>}, Component)`。

实现（`client.js`，已随 0.2.0 推送并装入桌面版 profile）：
- nodeDef `image-gen-thumb`：`match` 仅读当前 `tool/result` 事件，提取
  `data.message.content[0].content` 中 `{type:'image',attachment}` 引用；`buildViewNode` 输出 chat 节点。
- 渲染器 `ImageThumbNode`：用 owner 的 `props.loadImage` + 官方 `ImageGallery`
  （`@deepseek-ai/dsh-client-ui-attachment`）渲染缩略图，点击放大（ImageLightbox）。
- `package.json` 增加 `exports['./client']`、`dsh.client{platform:web,inject:[react,@deepseek-ai/dsh-client-ui-attachment]}`、files 含 client.js。

状态：已 commit/push（2fae44c），已 remove+add 重装到 `~/.dsh/profiles/desktop`，
确认安装包含 client.js 与 client manifest。

**待办（下一轮 / 用户反馈后）**：
1. 用户重启 DSH Desktop，生成或 read_image 一张图，确认对话流出现可点击缩略图。
2. 若不出现：查 `~/Library/Application Support/DSH Desktop/logs/*.error.log` 的 client 加载错误；
   重点核对 `require('@deepseek-ai/dsh-client-ui-attachment')` 是否对 client 插件可用、
   `conversationEvents` 是否可注入、渲染器是否收到 `loadImage`。

---

## Round 2（运行时可行性核验）

1. **require 可行性确认**：client bundle 的 externals = `PLATFORM_MODULES`
   （`packages/client/web/src/platform.ts`），其中包含 `react` 与
   `@deepseek-ai/dsh-client-ui-attachment` → `client.js` 的两个 require 都能解析。
2. **`conversationEvents` 可注入**：dsh-tool-vision 已用 `inject:['conversationEvents']`
   + `ctx.conversationEvents.register(nodeDef)`，同款机制。
3. **桌面版已于 ~17:56 重启**（main log `run 1787133380388`，晚于重装）。
   重启后 error log **无 dsh-image-gen / client 相关错误**；仅存与本项目无关的
   旧插件 `dsh-xueqiu`（"harness is not defined"，13:20 起即存在）报错。
   → host 插件与 client bundle 均加载成功（无抛错）。
4. 重启后会话历史回放时，新的 `image-gen-thumb` 节点会匹配此前 read_image /
   generate_image 的 tool/result 事件并渲染缩略图 → 用户现在打开对话即应可见。

**待用户视觉确认**：打开对话，检查早前生成的奥德赛/特洛伊图的工具行下方是否出现
可点击缩略图（点击放大）。若仍不出现，下一轮排查渲染器是否收到 `loadImage`、
节点是否进入 chat snapshot（可用 `session.history`/projection 调试）。

---

## Round 3（真实事件级验证）

- 会话 `c9200f9e` 日志含 2 条带 image 的 `tool/result`（奥德赛/特洛伊两次 read_image）。
- 用 `client.js` 同款 `attachmentsOf`/match 逻辑跑真实事件：
  提取 1 个附件（sha256 id、image/png、1024x1024），match id=callId 稳定
  → **节点会生成并渲染 ImageGallery（YES）**。
- 综合 R1-R3 证据链：require 可解析（PLATFORM_MODULES）✓、conversationEvents 可注入 ✓、
  ChatNodeSeat 向节点渲染器传 `loadImage` ✓、真实事件可提取附件 ✓、重启后无 client 报错 ✓。
- 唯一未闭环：浏览器内视觉确认（需用户打开对话查看缩略图）。

结论：实现已端到端自洽；等待用户视觉反馈即可收尾。若用户反馈"仍无缩略图"，
下一步用 `session.history`/projection 或 web replay 测试排查节点是否进入 chat snapshot。

---

## Round 4（浏览器加载链路排查）

- 桌面 web 的 `__DSH_BOOT__` 不在 HTTP root 内联（注入于 Electron renderer），curl 无法直接
  枚举 client 行；`dsh-host-plugin-inventory` 只管 host 插件，不含 client bundle 列表。
- client bundle 的浏览器加载由 desktop main/web boot 从 profile 已解析 bundle 的
  `dsh.client` manifest 收集（dsh-devquest/dsh-tool-vision 等第三方插件均以此机制生效，
  我们的包结构与其一致：exports['./client'] + dsh.client{platform:web}）。
- 结论：服务端证据链完整；浏览器端加载与渲染无法在本环境内观测，**必须用户肉眼确认**。
- 若下轮仍无用户反馈且需收尾，按 blocked 处理并说明"等待用户重启后视觉确认"。
