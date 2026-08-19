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

## 实现说明

- 工具注册：`ctx.tools.register(defineTool({...}))`（`@deepseek-ai/dsh-tools`）
- 图片保存：`ctx.attachments.saveImage()`（`@deepseek-ai/dsh-attachment`），返回 `ImageAttachmentRef`
- 输出：`output.render` 返回 `[{ type: 'image', attachment: ref }, { type: 'text', ... }]`
- 执行：spawn `bl image generate --output json`，解析 `saved` 路径，读回字节存为附件
- 取消/超时：监听 `exec.signal` 与 10 分钟超时

## 参考

- [官方第一个插件教程](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-tutorial/01-first-plugin.zh.md)
- [官方工具编写规范](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.zh.md)
- [官方打包与安装指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.zh.md)
