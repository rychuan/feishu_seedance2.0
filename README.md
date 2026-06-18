# Seedance 2.0 视频生成 — 飞书多维表格字段捷径

在飞书多维表格中直接调用火山引擎 Seedance 2.0 视频生成 API，支持**文本 + 图片 + 视频 + 音频**四模态输入，一行代码生成视频。

## 功能特性

- **多模态输入** — 文本提示词 + 图片（首帧/尾帧/参考）+ 视频参考 + 音频参考
- **双模型支持** — Seedance 2.0（标准）和 Seedance 2.0 Fast（极速）
- **丰富参数** — 分辨率（480p~2K）、宽高比（7种）、时长（4~15秒）、音频生成、尾帧返回等
- **附件容错** — 下载失败自动跳过并记录警告，不影响其他素材
- **容错重试** — 任务创建自动重试，轮询渐进式退避 + 连续失败熔断
- **中英双语** — 表单界面支持中文和英文

## 快速开始

### 安装依赖

```bash
npm install
```

> 注意：`@lark-opdev/block-basekit-server-api` 和 `@lark-opdev/block-basekit-cli` 不在公开 npm 搜索中，但可以通过 `package.json` 依赖正常安装。

### 开发调试

```bash
npm start    # 编译 + 启动开发服务器（端口 8080）
```

> **注意**：`npm run dev` 不是开发服务器，它运行 `block-basekit-cli dev:field`，需要 `test/index.ts`。开发调试请用 `npm start`。

### 构建打包

```bash
npm run build   # 生产编译
npm run pack    # 编译 + 打包为 zip
```

### 部署上线

1. 运行 `npm run pack`，生成 `output/output_*.zip`
2. 登录[飞书开放平台](https://open.feishu.cn/) → 多维表格字段捷径 → 上传 zip 包

## 参数说明

| 参数 | 说明 | 默认值 |
|------|------|--------|
| API Key | 火山引擎 API Key（必填） | — |
| 提示词列 | 选择表格中的文本列作为提示词（必填） | — |
| 图片列 1 | 首帧/参考图（自动分配角色） | — |
| 图片列 2 | 尾帧/参考图（可选） | — |
| 视频列 | 运动/运镜参考视频 | — |
| 音频列 | 音频风格参考 | — |
| 模型 | Seedance 2.0 或 Seedance 2.0 Fast | Seedance 2.0 |
| 分辨率 | 480p / 720p / 1080p / 2K | 1080p |
| 宽高比 | 16:9 / 9:16 / 4:3 / 3:4 / 21:9 / 1:1 / adaptive | 16:9 |
| 视频时长 | 4~15 秒 | 5秒 |
| 生成音频 | 是否生成原生音频 | 否 |
| 返回尾帧 | 生成尾帧图片（可用于续接视频） | 否 |
| 水印 | 是否添加水印 | 否 |
| 固定摄像头 | 保持镜头不动 | 否 |
| 服务等级 | default（在线推理）/ flex（离线推理，约半价） | default |
| 随机种子 | -1 为随机 | -1 |

### 图片角色自动分配规则

- 第 1 张 → `first_frame`（首帧）
- 第 2 张 → `last_frame`（尾帧）
- 第 3~9 张 → `reference`（参考图）

## 架构设计

```
用户在表格行触发 → execute() 执行
  ├── 参数规范化（SingleSelect 值格式统一）
  ├── validateParams() 校验
  ├── createVideoTask()
  │     ├── buildContent() — 下载附件、编码/上传、构建多模态内容数组
  │     ├── buildRequestBody() — 组装顶层参数
  │     └── POST 创建任务（自动重试，最多 3 次）
  ├── pollTask() — 渐进式轮询（10s→15s→20s，最多 120 次）
  └── 返回结果（视频 URL + 元信息）
```

### 文件结构

```
src/
├── index.ts           # 入口：表单定义 + execute() 主逻辑
├── constants.ts       # API 地址、模型 ID、选项配置、域名白名单
├── types.ts           # TypeScript 类型定义
├── api/
│   └── createTask.ts  # 参数校验、内容构建、请求组装、任务创建（含重试）
└── utils/
    ├── fetch.ts       # context.fetch 封装（兼容非标准 Response、密钥脱敏）
    ├── media.ts       # 图片 base64 编码、视频/音频上传临时托管
    ├── poll.ts        # 任务轮询（渐进式退避 + 连续失败/未识别状态熔断）
    └── logger.ts      # 结构化调试日志
```

### 媒体处理管道

| 类型 | 处理方式 | API 传参 | 限制 |
|------|---------|---------|------|
| 文本 | 直接拼接 | `text` 字段 | 必填，≤4000 字 |
| 图片 | 下载 → base64 | `data:image/...;base64,...` | ≤9 张，单张 ≤10MB |
| 视频 | 下载 → 上传临时托管 → 公网 URL | `https://...` | ≤3 段，单段 ≤100MB |
| 音频 | 下载 → 上传临时托管 → 公网 URL | `https://...` | ≤3 段，单段 ≤100MB |

## Seedance 2.0 API 参考

| 接口 | 方法 | 路径 |
|------|------|------|
| 创建任务 | POST | `/api/v3/contents/generations/tasks` |
| 查询任务 | GET | `/api/v3/contents/generations/tasks/{task_id}` |

- **Base URL**: `https://ark.cn-beijing.volces.com`
- **认证**: `Authorization: Bearer {API_KEY}`
- **模型**: `doubao-seedance-2-0-260128`（标准）/ `doubao-seedance-2-0-fast-260128`（极速）

## 付费与权益

项目已预留权益检查接口，支持接入飞书付费方案：

```typescript
const isNeedPayPack = context?.isNeedPayPack === true;
const hasQuota = context?.hasQuota === true;
if (isNeedPayPack && !hasQuota) {
  return { code: FieldCode.Success as const, data: '⚠️ 请先购买会员包后再使用' };
}
```

推荐使用飞书**增值包**模式（按次计费），详细设计方案见 [`docs/付费插件与权益设计.md`](docs/付费插件与权益设计.md)。

## 常见问题

### 表格单元格显示为空

检查以下几点：
1. 提示词列是否有内容（空提示词会跳过执行）
2. API Key 是否正确
3. 查看飞书开放平台日志获取详细错误信息

### context.fetch 返回异常

飞书 FaaS 的 `context.fetch` 不是标准 `Response` 对象，本项目已做三级兼容回退（`.buffer()` → `.arrayBuffer()` → `.text()`）。

## 注意事项

1. **数据安全** — 视频和音频附件会上传到第三方临时托管服务（litterbox.catbox.moe）以获取公网 URL，文件有效期 72 小时。请勿上传包含敏感信息的内容。
2. **API Key 安全** — API Key 以明文形式存储在字段捷径配置中，请确保表格访问权限设置合理。
3. **视频 URL 有效期** — Seedance API 返回的视频 URL 24 小时内有效，请及时下载。
4. **任务记录保留** — API 任务记录保留 7 天。
5. **执行超时** — 轮询最长约 30 分钟，超时后需到火山引擎控制台查看任务状态。
6. **域名白名单** — 项目已配置 `ark.cn-beijing.volces.com`、`internal-api-drive-stream.feishu.cn`、`litterbox.catbox.moe` 三个域名。
7. **无 ffmpeg** — 飞书 FaaS 沙箱不提供 ffmpeg，超尺寸视频/音频会被拒绝并提示用户。
8. **分辨率上限** — Seedance 2.0 API 最高支持 2K（2560×1440），不支持 4K。

## 技术栈

- **运行环境**: 飞书多维表格字段捷径 FaaS（Node.js）
- **SDK**: `@lark-opdev/block-basekit-server-api` v1.0.6
- **CLI**: `@lark-opdev/block-basekit-cli` v1.0.5
- **API**: 火山引擎 Seedance 2.0 视频生成 API

## License

MIT
