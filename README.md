# dsh-image-gen

DeepSeek Harness 图片生成插件：通过阿里云百炼（Qwen-Image）为 DSH agent 提供图片生成能力。

为 agent 注册一个 `generate_image` 工具：给定文字描述，调用百炼文生图服务生成图片，
并把图片作为**对话附件**返回（模型可在后续步骤查看）。同时把图片写入 `~/.dsh/image-gen/`
并**自动用系统看图器弹出**，保证"生成即看到"。

> 关于"对话流内联缩略图"：DSH Web UI 目前只把**人手上传**的图片渲染成可点击缩略图，
> 工具/插件返回的图片只显示为工具行文本（产品限制，非本插件问题）。
> 因此本插件用"自动弹出看图器"作为最可靠的即时预览方式；配置 `autoOpen: false` 可关闭。

> 起因：DSH 官方目前没有内置图片生成工具（"完全没办法生成图片"是现状）。
> 本插件用百炼 CLI（`bl`）作为后端，是官方推荐的生态贡献方式（`dsh-plugin` topic）。

## 前置条件

1. 安装 [阿里云百炼 CLI](https://github.com/modelstudioai/cli)（`npm install -g bailian-cli`）并登录：
   ```sh
   bl auth login --config token-plan --api-key <your-api-key>
   bl auth status   # 确认已登录
   ```
2. 确认能出图：
   ```sh
   bl image generate --prompt "a cat" --out-dir ./out
   ```

## 安装

```sh
dsh plugin --profile <name> add github:haimuhaimu/dsh-image-gen
```

GitHub 安装时 pnpm 会拦截 `prepare` 脚本（本插件无构建，脚本仅打印提示）；
如被拦截，按报错提示把包键加入 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds`，再重新 add。

也可以本地安装：

```sh
dsh plugin --profile <name> add ./image-gen
```

## 使用

装好后 agent 会自动获得 `generate_image` 工具，直接对 DSH 说"生成一张……的图片"即可。
工具参数：

| 参数 | 必填 | 说明 |
|------|------|------|
| `prompt` | ✅ | 图片描述（越详细越好：主体、风格、构图、光线） |
| `size` | | 尺寸：比例 `3:4` / `16:9` / `1:1` 或像素 `1024*1024`、`2048*2048`；默认 `1024*1024` |
| `model` | | 模型：默认 `qwen-image-3.0`；可选 `wan2.6-t2i`、`z-image-turbo` 等 |
| `n` | | 生成数量（1-6），默认 1 |
| `negative_prompt` | | 排除的元素 |
| `seed` | | 随机种子，可复现结果 |
| `watermark` | | 是否保留水印，默认 false |

## 配置

`cordis.patch.yml` 的 `config` 块：

```yaml
- id: image-gen
  name: dsh-image-gen
  config:
    blPath: ""      # bl CLI 路径；留空自动查找 PATH 与常见安装位置
    autoOpen: true  # 生成后自动用系统看图器弹出（默认 true）
```

生成的图片持久保存在 `~/.dsh/image-gen/`，可随时手动查看。

Windows 支持 npm 全局安装或项目 `node_modules/.bin` 中的 `bailian-cli`：发现 `bl.cmd` 后，插件读取该安装包的 `bin.bl`，直接用 Node.js 启动，不通过命令解释器。自定义 `blPath` 可指向 `.js` / `.mjs` / `.cjs` 入口或原生可执行文件；其他 `.cmd` / `.bat` 包装脚本会明确报错，不会退回 shell 执行。

## 实现说明

- 工具注册：`ctx.tools.register(defineTool({...}))`（`@deepseek-ai/dsh-tools`）
- 图片保存：`ctx.attachments.saveImage()`（`@deepseek-ai/dsh-attachment`），返回 `ImageAttachmentRef`
- 输出：`output.render` 返回 `[{ type: 'image', attachment: ref }, { type: 'text', ... }]`
- 执行：spawn `bl image generate --output json`，解析 `saved` 路径，读回字节存为附件
- 取消/超时：监听 `exec.signal` 与 10 分钟超时

## 验证

```sh
npm test
npm pack --dry-run
```

CI 使用 Node.js 24，分别在 macOS、Linux 和 Windows 上运行。这组独立 CLI 测试只使用 Node.js 内置模块，无需安装依赖；宿主提供的 peer dependencies 不参与测试。

路径解析测试覆盖 `PATH` 与用户级 npm 目录、同名目录/不可执行文件的跳过，以及可执行符号链接。启动测试会运行本地假 CLI，检查含空格的安装路径，以及提示词中的引号、中文、换行和 shell 特殊字符是否原样传递；Windows 同时覆盖全局 npm 和 `node_modules/.bin` 安装、直接 JavaScript 入口与不受支持的包装脚本。进程测试还检查取消、超时后的实际 CLI 退出，以及已取消的请求不会启动 CLI。

这些测试不会调用付费出图服务，也不等同于 DSH 宿主中的完整图片生成验收。

## 参考

- [官方第一个插件教程](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-tutorial/01-first-plugin.zh.md)
- [官方工具编写规范](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.zh.md)
- [官方打包与安装指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.zh.md)
