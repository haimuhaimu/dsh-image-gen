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
