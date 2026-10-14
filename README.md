# ShiroBot 市场清单

本仓库维护 ShiroBot 插件和 Adapter 市场的公开元数据。`list.json` 与 `adapters.json` 是独立的可信源清单；生成文件由脚本根据源清单及 GitHub Release 元数据生成。

现有插件宿主继续固定读取 v1 插件 URL，Adapter 使用独立的 v1 URL。兼容要求从发布产物的 SDK / Model ABI 与目标框架自动生成；源清单不填写兼容版本。仓库中的清单与工具使用 MIT License；各项目源码和 Release 资产继续适用其各自声明的许可证。

## 仓库文件

- `list.json`：schemaVersion 1 的源清单，人工评审和合并入口。
- `schema/list.v1.schema.json`：源清单 JSON Schema。
- `scripts/build-market.mjs`：使用 Node.js 24 下载并校验资产；配合 .NET 10 静态元数据读取器生成兼容信息。
- `dist/marketplace.v1.json`：供客户端读取的生成清单。
- `dist/marketplace.v1.json.sha256`：生成清单的 SHA-256；每个插件资产另有独立的 `asset.digest`。
- `adapters.json`：schemaVersion 1 的 Adapter 源清单；初始时允许 `adapters` 为空。
- `schema/adapters.v1.schema.json`：Adapter 源清单 JSON Schema。
- `dist/adapters.v1.json`：供 Adapter 宿主固定读取的生成清单。
- `dist/adapters.v1.json.sha256`：Adapter 生成清单的 SHA-256。

## 贡献条目

1. Fork 本仓库并只在 `list.json` 或 `adapters.json` 中新增或修改对应条目，不要手工编辑 `dist/`。
2. 确认插件仓库公开可访问，且使用规范的 `https://github.com/OWNER/REPOSITORY` 地址。
3. 在 GitHub Release 中发布插件资产，并让 `release.assetPattern` 在最新非 draft Release 中只匹配一个已上传文件。
4. 使用 Node.js 24 和 .NET 10 SDK 运行 `node scripts/build-market.mjs --validate-only`。
5. 提交 PR，并在说明中写明条目用途、许可证和 Release 资产名称；兼容要求由发布产物自动提取。

PR 校验会检查 Schema、未知字段、ID 和仓库唯一性、GitHub URL、最新非 draft Release 及匹配资产，但不会写入 `dist/`。Adapter 清单可为空。尚处于孵化阶段且没有 Release 的项目可以设置 `release.required` 为 `false`；这类条目会通过校验，并在生成清单中得到明确的非健康状态。

## 插件条目示例

把下面的对象加入 `list.json` 的 `plugins` 数组，替换名称、作者、仓库和资产文件名后提交 PR。兼容要求由发布 DLL 自动生成。

```json
{
  "id": "hello-plugin",
  "kind": "plugin",
  "name": "HelloPlugin",
  "description": "回复 ping 命令的示例插件。",
  "category": "utility",
  "authors": [{ "name": "Your Name", "url": "https://github.com/YOUR_NAME" }],
  "repository": "https://github.com/YOUR_NAME/HelloPlugin",
  "license": "MIT",
  "release": { "required": true, "assetPattern": "HelloPlugin.zip" },
  "deprecated": false
}
```

## 字段说明

- `id`：市场内稳定且唯一的小写 kebab-case ID；发布后不应随意修改。
- `kind`：`list.json` 中必须为 `plugin`；`adapters.json` 中必须为 `adapter`。
- `name`：面向用户的插件名称。
- `description`：简短说明插件用途和主要能力。
- `category`：小写 kebab-case 分类，例如 `ai`、`example`、`media`、`utility`。
- `authors`：至少一个作者对象；`name` 必填，`url` 可选且必须使用 HTTPS。
- `repository`：唯一、公开、无 `.git` 后缀的 GitHub HTTPS 仓库地址。
- `license`：建议填写 SPDX 标识或表达式。无法确认时使用 `NOASSERTION`，这不代表获得了使用授权。
- 源清单不填写 `compatibility`；兼容信息统一从最新 Release 的 DLL 引用和目标框架自动提取。
- 输出 `compatibility.abi`：从 Release DLL 的程序集引用读取 SDK / Model ABI；同名引用取最高版本，跨主版本冲突标为未知。
- 输出 `compatibility.frameworks`：发布 DLL 的目标框架列表；唯一目标框架转换为 `compatibility.framework`，例如 `net10.0`。
- 输出 `compatibility.status`：`verified` 表示元数据读取完整，不代表通过运行测试；缺少 SDK ABI 或目标框架、损坏、超时等情况为 `unknown`。
- 输出 `compatibility.shirobot` 为 `unknown`：ABI 不能换算成宿主产品版本范围。客户端按 SDK / Model ABI 判断兼容性，扫描失败时明确显示未知。
- `release.required`：为 `true` 时，无 Release、无匹配资产或匹配不唯一都会使校验失败；为 `false` 时生成健康状态而不是失败。
- `release.assetPattern`：Release 文件名 glob，仅支持 `*` 和 `?`，不得包含目录。推荐使用精确文件名。
- `deprecated`：插件是否已弃用；为 `true` 时必须填写 `deprecationReason`。

Adapter 额外字段：

- `platform`：Adapter 面向的平台 ID，使用小写 kebab-case。
- `protocol`：Adapter 实现的协议 ID，使用小写 kebab-case。
- `compatibility`、`repository`、`release` 和健康/资产输出契约与插件完全相同。

## 发布资产要求

生成脚本通过 GitHub API 查找按发布时间最新的非 draft、非 prerelease Release。Release 必须包含一个状态为 `uploaded` 且匹配 `assetPattern` 的资产，且资产不得超过 100 MiB。匹配成功后，生成清单会记录：

- Release tag 作为 `version`；
- `publishedAt` 和 Release 页面 URL；
- 资产名称、HTTPS 下载 URL、字节大小和 SHA-256 摘要；
- GitHub 提供的资产下载次数。

`release.required=false` 时可能出现 `no-release`、`asset-missing` 或 `asset-ambiguous`；正常条目状态为 `available`。GitHub API 无法访问、仓库不存在或响应数据无效仍会明确报错，因为此时无法安全地区分“未发布”和“校验失败”。

## 本地构建

```bash
node scripts/build-market.mjs --validate-only
node scripts/build-market.mjs
```

脚本读取 `GITHUB_TOKEN` 或 `GH_TOKEN` 以提高 GitHub API 限额；令牌只需要公开仓库读取能力。未提供令牌时使用 GitHub 匿名 API。插件和 Adapter 共用默认 8 路并发，可通过 `MARKET_CONCURRENCY` 设置 1–16。GitHub 提供 SHA-256 且缓存命中时跳过资产下载和解析，否则下载验证；读取器仅在需要时编译一次。解析超时或失败不会缓存，允许下次重试。只有解析后的市场内容发生变化时才更新 `generatedAt`，因此定时任务不会产生纯时间戳变更。

## 自动化

- 插件清单 PR 使用 `pull_request_target`，但只检出基准分支上的受信任脚本，再单独读取 PR 的 `list.json`；工作流权限为只读，绝不检出或执行贡献者修改的代码。
- 每日 UTC 02:17、`main` 任一源清单变更及手动触发时刷新 `dist/`。
- 有变化时，工作流只使用 `main` 上的受信任脚本生成文件，并更新只承载分发结果的 `automation/refresh-marketplace` 分支。宿主可固定读取 `https://raw.githubusercontent.com/ShirokaProject/awesome-shirobot/automation/refresh-marketplace/dist/marketplace.v1.json` 或 `https://raw.githubusercontent.com/ShirokaProject/awesome-shirobot/automation/refresh-marketplace/dist/adapters.v1.json`，因此不依赖 bot PR 的人工合并。

## 安全边界

- 收录仅表示元数据通过格式和发布检查，不代表 ShirokaProject 审计、认可或担保插件代码。
- 构建脚本下载每个条目最新正式 Release 的匹配资产，计算并核对 SHA-256，再使用 PEReader 静态读取元数据，绝不加载或执行插件代码。下载及 ZIP 总展开大小限 100 MiB，ZIP 限 1000 个条目，不向磁盘解压文件路径，解析进程限时 30 秒。
- 解析结果按 SHA-256 缓存。下载和解析在只读 Action job 中完成，发布 job 仅接收生成的 JSON，不处理插件二进制。
- `marketplace.v1.json.sha256` 验证市场 JSON；每项 `asset.digest` 验证对应 DLL/ZIP。摘要本身仍依赖本仓库评审和 GitHub 账户安全，不能替代代码审计或签名。
- 市场客户端必须把名称、描述、URL 和其他贡献者字段视为不可信输入，避免执行其中内容，并在下载前再次检查 HTTPS、主机名、文件大小及用户授权。
- 插件可能访问网络、文件和机器人权限；安装前应检查仓库、许可证、Release 来源和插件所需权限。

## License

本仓库的清单元数据、Schema、文档和构建脚本采用 MIT License，以便客户端、镜像和其他目录服务自由复用；这不会改变任何已收录插件的许可证。
