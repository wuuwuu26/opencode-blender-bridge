# OpenCode × Blender Bridge

Drive a real Blender session from OpenCode: look at the viewport, change one thing, look again — then batch, render, audit and export.

**English** | [简体中文](README.zh-CN.md)

- **GUI first.** The agent works against the Blender session you are looking at and gets a frame after every change.
- **Headless fallback.** No GUI? A persistent `blender -b` worker serves the same command surface, frames included.
- **15 tools.** `see`, `do`, `watch`, `plan`, `worker`, `viewport`, `headless`, `job`, `loop`, `txn`, `preset`, `perf`, `opt`, `cmd`, `commands`.
- **56 add-on commands.** Scene, objects, materials, cameras, lights, render, export, audit and performance.
- **Local only.** The bridge listens on `127.0.0.1:9876` and never leaves the machine.

Tested with **Blender 5.2.2 LTS on Windows** and the **OpenCode V2** plugin API (`@opencode/plugin` 2.2.x). Targets Blender 4.2+.

---

## 1. Install

### Step 1 — Blender add-on (required)

1. Download [`assets/addon/opencode_blender_bridge.zip`](assets/addon/opencode_blender_bridge.zip) or the asset from the [latest release](https://github.com/wuuwuu26/opencode-blender-bridge/releases/latest).
2. In Blender: `Edit > Preferences > Add-ons > Install from Disk…`, select the zip.
3. Enable **OpenCode Blender Bridge**.
4. In the 3D viewport press `N`, open the **OpenCode** sidebar and click **Connect**. The add-on auto-starts with Blender by default.

> Do not enable another add-on that serves Blender on port `9876` (for example `MCP for Blender` / `blender_mcp`); they compete for the port. Ordinary modeling, material and render add-ons are unaffected.

### Step 2 — OpenCode plugin

Clone the repository, then add it to `plugins` in your project or global `opencode.json(c)`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "C:/Users/you/Documents/opencode-blender-bridge"
  ]
}
```

Or pass options explicitly:

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

OpenCode reloads configuration automatically. Building from source the first time:

```bash
cd opencode-blender-bridge
npm install
npm run build
```

### Step 3 — Verify

Ask the agent to run:

```text
blender_viewport(op="doctor")
```

The GUI acceptance criterion is `kind=ok`.

- `kind=gui_offline` — Blender is installed but the bridge is not connected: use the N panel **Connect**, or `blender_viewport(op="launch")`.
- `kind=background_only` — the plugin is talking to a headless worker, not a desktop Blender.
- `kind=no_blender` — the executable was not found: set `blenderPath` or `OCBB_BLENDER`.

Headless-only acceptance:

```text
blender_rt_worker(op="start", name="main")
blender_rt_worker(op="see", name="main")
```

A returned frame means the fallback works.

---

## 2. Tools

| Tool | What it does |
| --- | --- |
| `blender_rt_see` | Viewport frame, custom camera angle or full-window screenshot; identical frames are not re-attached |
| `blender_rt_do` | Run Python on Blender's main thread, optionally return a frame |
| `blender_rt_watch` | Sample a time window or frame range and report whether the image changed |
| `blender_rt_plan` | Capability catalog and standard modeling/material/render/export operations |
| `blender_rt_worker` | Persistent headless session: start / exec / see / reset / status / stop / restart / list |
| `blender_viewport` | Status, health, doctor, launch and an advisory write lease |
| `blender_rt_headless` | One-shot `blender -b` script with stdout, structured result and new files |
| `blender_rt_job` | Background long jobs: start / status / result / wait / cancel / list |
| `blender_rt_loop` | Parameter search in one persistent worker, ranked by a metric |
| `blender_rt_txn` | `.blend` snapshots and object transform marks with rollback |
| `blender_rt_preset` | Save, list, apply and export reusable presets |
| `blender_rt_perf` | Render performance diagnosis and fast/balanced/quality profiles |
| `blender_rt_opt` | Report safe merge candidates (merging is explicit) |
| `blender_rt_cmd` | Call any add-on command directly |
| `blender_rt_commands` | List the add-on commands available right now |

### Typical flow

```text
blender_rt_plan(op="catalog")
blender_rt_plan(op="object.create", args={kind:"cube", name:"Body", location:[0,0,1]})
blender_rt_plan(op="material.create", args={name:"BodyMat", base_color:"#3a6ea5", roughness:0.4})
blender_rt_plan(op="material.assign", args={name:"Body", material:"BodyMat"})
blender_rt_see(max_size=720)
blender_rt_txn(op="snapshot", name="before-boolean")
blender_rt_plan(op="export.scene", args={filepath:"out/body.glb"})
```

Modeling goes through `blender_rt_plan`. Use `blender_rt_do` only for edits the standard operations do not cover.

---

## 3. Configuration

| Option | Default | Description |
| --- | --- | --- |
| `port` | `9876` | Add-on port; must match the Blender side |
| `blenderPath` | auto-detect | Blender executable; also `OCBB_BLENDER` / `BLENDER_PATH` |
| `frameMaxSize` | `720` | Default longest edge for `see` |
| `workerTtlMs` | `900000` | Idle timeout for headless sessions |

Environment variables: `OCBB_PORT`, `OCBB_BLENDER`, `OCBB_WORKER_TTL_MS`.

---

## 4. Architecture

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

- Flat JSON protocol: request `{"type": "...", "params": {...}}`, response `{"status":"success","result":...}` or `{"status":"error","message":...}`.
- Every `bpy` call runs on Blender's main thread; the socket only transports requests.
- The headless worker owns the main loop in `blender -b`, so commands and Workbench frames work without a window.
- `see` hashes each frame and skips re-attaching an identical image (`force=true` overrides), saving vision tokens.

---

## 5. Security

- The bridge binds to `127.0.0.1` only and has no authentication. Any local process can connect; never expose it to the internet.
- `blender_rt_do` / `execute_code` run arbitrary Python with your user permissions.
- **Pause AI** in the Blender N panel rejects all write commands while keeping read-only queries available.
- Snapshots write under `.opencode/blender/txn`; they never overwrite a saved `.blend` unless you explicitly call `file.save`.

---

## 6. Development

```bash
npm install
npm run build          # TypeScript → dist
npm run package:addon  # build assets/addon/opencode_blender_bridge.zip
```

Tests:

```bash
# add-on smoke test through a headless worker
blender --background --factory-startup --python assets/worker.py -- \
  --port 51234 --addon-path assets/addon
python tests/smoke.py 51234

# plugin tool layer against the worker/GUI bridge
node tests/plugin-smoke.mjs
```

Layout:

```text
assets/addon/opencode_blender_bridge/   Blender add-on
assets/worker.py                        persistent headless worker entry
assets/launch.py                        launch the GUI with the add-on loaded
assets/headless_wrapper.py              one-shot blender -b wrapper
src/                                    OpenCode plugin
skills/blender-modeling/SKILL.md        bundled modeling skill
```

---

## 7. License and credits

Licensed under the **Apache License 2.0**. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Inspired by and in a few small places adapted from:

- [sixtysevenlf/dsh-blender-plugin](https://github.com/sixtysevenlf/dsh-blender-plugin) (BSD-3-Clause) — GUI-first + headless-fallback workflow, 15-tool surface and flat protocol shape;
- [ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp) (MIT) — Blender socket command pattern and offscreen viewport capture.

Blender is a trademark of the Blender Foundation. This project is not affiliated with or endorsed by the Blender Foundation.
