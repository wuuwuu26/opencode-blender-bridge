# OpenCode × Blender Bridge

让 OpenCode 直接驱动一个真实的 Blender 会话：看视口、改一步、再看一眼，并能无头批处理、渲染、审计和导出。

[English](README.md) | **简体中文**

- **GUI 优先**：Agent 操作你正在看的那个 Blender 场景，每次改完立刻回一帧。
- **无头可用**：没有 GUI 时自动降级到常驻 `blender -b` worker，视口帧仍然在。
- **15 个工具**：`see / do / watch / plan / worker / viewport / headless / job / loop / txn / preset / perf / opt / cmd / commands`。
- **56 个 add-on 命令**：场景、对象、材质、相机、灯光、渲染、导出、审计、性能。
- **只走本机回环**：监听 `127.0.0.1:9876`，不经过任何云服务。

已在 **Blender 5.2.2 LTS / Windows** 和 **OpenCode V2** 插件 API（`@opencode/plugin` 2.2.x）上测试；目标兼容 Blender 4.2+。

---

## 1. 安装

### 第一步：安装 Blender 插件（必须先做）

1. 下载 [`assets/addon/opencode_blender_bridge.zip`](assets/addon/opencode_blender_bridge.zip)，或从 [最新 Release](https://github.com/wuuwuu26/opencode-blender-bridge/releases/latest) 下载。
2. Blender → `Edit > Preferences > Add-ons > Install from Disk…`，选择 zip。
3. 勾选 **OpenCode Blender Bridge**。
4. 在 3D 视口按 `N`，打开 **OpenCode** 侧栏，点 **Connect**。插件默认会随 Blender 自动启动。

> 不要同时启用其他在 `9876` 端口提供 Blender 桥的插件（例如 `MCP for Blender` / `blender_mcp`），它们会抢端口。普通建模、材质、渲染插件不受影响。

### 第二步：安装 OpenCode 插件

克隆本仓库，然后在项目或全局 `opencode.json(c)` 的 `plugins` 中加入路径：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "C:/Users/you/Documents/opencode-blender-bridge"
  ]
}
```

也可以使用对象形式传配置：

```jsonc
{
  "plugins": [
    {
      "package": "C:/Users/you/Documents/opencode-blender-bridge",
      "options": {
        "port": 9876,
        "blenderPath": "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe",
        "frameMaxSize": 720,
        "workerTtlMs": 900000
      }
    }
  ]
}
```

保存后 OpenCode 会自动重载配置。第一次从源码使用先构建一次：

```bash
cd opencode-blender-bridge
npm install
npm run build
```

### 第三步：验收

让 Agent 调用：

```text
blender_viewport(op="doctor")
```

**唯一的 GUI 验收标准**是返回 `kind=ok`。

- `kind=gui_offline`：Blender 已安装但桥没连上 → 在 Blender 的 N 面板点 Connect，或运行 `blender_viewport(op="launch")`。
- `kind=background_only`：当前连的是无头 worker，不是桌面 Blender。
- `kind=no_blender`：找不到 Blender 可执行文件 → 设置 `blenderPath` 或环境变量 `OCBB_BLENDER`。

只有无头环境时：

```text
blender_rt_worker(op="start", name="main")
blender_rt_worker(op="see", name="main")
```

能返回一帧即成功。

---

## 2. 工具

| 工具 | 作用 |
| --- | --- |
| `blender_rt_see` | 视口帧 / 自定义视角帧 / 整窗截图；同画面默认不重复附图 |
| `blender_rt_do` | 在 Blender 主线程执行 Python，可选立刻回一帧 |
| `blender_rt_watch` | 按时间或帧范围采样，判断画面有没有变化 |
| `blender_rt_plan` | 能力目录 + 标准建模、材质、渲染、导出操作 |
| `blender_rt_worker` | 常驻无头会话：start / exec / see / reset / status / stop / restart / list |
| `blender_viewport` | 状态、健康检查、doctor、启动 Blender、写入租约 |
| `blender_rt_headless` | 一次性 `blender -b` 脚本，返回 stdout、结构化结果和新产物 |
| `blender_rt_job` | 后台长任务：start / status / result / wait / cancel / list |
| `blender_rt_loop` | 在同一个无头会话里做参数搜索并按指标排序 |
| `blender_rt_txn` | `.blend` 快照与对象变换标记 / 回滚 |
| `blender_rt_preset` | 保存、列出、应用、导出参数预设 |
| `blender_rt_perf` | 渲染性能诊断与 fast/balanced/quality 配置 |
| `blender_rt_opt` | 查找可安全合并的对象（只报告，合并需显式调用） |
| `blender_rt_cmd` | 直接调用任意 add-on 命令 |
| `blender_rt_commands` | 列出当前可用的 add-on 命令 |

### 常用流程

```text
blender_rt_plan(op="catalog")
blender_rt_plan(op="object.create", args={kind:"cube", name:"Body", location:[0,0,1]})
blender_rt_plan(op="material.create", args={name:"BodyMat", base_color:"#3a6ea5", roughness:0.4})
blender_rt_plan(op="material.assign", args={name:"Body", material:"BodyMat"})
blender_rt_see(max_size=720)
blender_rt_txn(op="snapshot", name="before-boolean")
blender_rt_plan(op="export.scene", args={filepath:"out/body.glb"})
```

模型操作全部走 `blender_rt_plan`；只有标准操作覆盖不到的编辑才用 `blender_rt_do`。

---

## 3. 配置

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `port` | `9876` | add-on 监听端口，需与 Blender 侧一致 |
| `blenderPath` | 自动检测 | Blender 可执行文件；也可用 `OCBB_BLENDER` / `BLENDER_PATH` |
| `frameMaxSize` | `720` | `see` 默认最长边像素 |
| `workerTtlMs` | `900000` | 无头会话空闲回收时间 |

环境变量：`OCBB_PORT`、`OCBB_BLENDER`、`OCBB_WORKER_TTL_MS`。

---

## 4. 架构

```text
OpenCode server
  └─ plugin (TypeScript, @opencode/plugin)
       ├─ 15 tools
       ├─ BridgeClient ── TCP 127.0.0.1:9876 ── Blender add-on (Python)
       │                                          └─ main-thread command queue
       ├─ WorkerManager ── blender -b worker.py ── same command surface
       ├─ JobManager / headless runner
       └─ .opencode/blender/{runs,jobs,presets.json,txn}
```

- 扁平 JSON 协议：请求 `{"type": "...", "params": {...}}`，响应 `{"status":"success","result":...}` 或 `{"status":"error","message":...}`。
- 所有 `bpy` 调用都在 Blender 主线程执行；socket 只负责收发。
- 无头 worker 在 `blender -b` 里自己跑主循环，所以没有窗口也能稳定执行命令和出 Workbench 帧。
- `see` 会计算图片哈希；画面没变就不重复附图（`force=true` 可强制重发），节省视觉 token。

---

## 5. 安全

- 桥只绑定 `127.0.0.1`，没有鉴权；本机上任何进程都能连接。不要把它暴露到公网。
- `blender_rt_do` / `execute_code` 等价于在 Blender 里执行任意 Python，权限就是你的用户权限。
- 在 Blender 的 N 面板里勾选 **Pause AI** 会拒绝所有写命令，只读查询仍然可用。
- 快照只写 `.opencode/blender/txn`，不会覆盖你已保存的 `.blend`，除非显式调用 `file.save`。

---

## 6. 开发

```bash
npm install
npm run build          # TypeScript → dist
npm run package:addon  # 生成 assets/addon/opencode_blender_bridge.zip
```

测试：

```bash
# 用 Blender 无头 worker 跑 add-on 冒烟测试
blender --background --factory-startup --python assets/worker.py -- \
  --port 51234 --addon-path assets/addon
python tests/smoke.py 51234

# 插件工具层冒烟测试（需要上面 worker 在 51234，或 GUI 桥）
node tests/plugin-smoke.mjs
```

文件结构：

```text
assets/addon/opencode_blender_bridge/   Blender add-on
assets/worker.py                        无头常驻 worker 入口
assets/launch.py                        启动 GUI 并加载插件
assets/headless_wrapper.py              一次性 blender -b 包装器
src/                                    OpenCode 插件
skills/blender-modeling/SKILL.md        随插件加载的建模 skill
```

---

## 7. 许可与致谢

本项目以 **Apache License 2.0** 发布，见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。

思路与部分实现参考：

- [sixtysevenlf/dsh-blender-plugin](https://github.com/sixtysevenlf/dsh-blender-plugin)（BSD-3-Clause）— GUI 优先 + 无头降级的工作流、15 个工具面和扁平协议形态；
- [ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp)（MIT）— Blender 侧 socket 命令模式与离屏视口截图思路。

Blender 是 Blender Foundation 的商标，本项目与 Blender Foundation 无隶属关系。
