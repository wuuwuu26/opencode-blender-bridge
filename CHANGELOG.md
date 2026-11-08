# Changelog

## 0.1.0 — 2026-11-08

First public release.

- Blender add-on `opencode_blender_bridge` (56 commands) with an auto-start TCP
  bridge on `127.0.0.1:9876`, N-panel Connect / Pause AI controls, viewport and
  custom-camera frames, scene/object/material/render/export/audit operations.
- OpenCode V2 server plugin with 15 tools: `blender_rt_see`, `blender_rt_do`,
  `blender_rt_watch`, `blender_rt_plan`, `blender_rt_worker`, `blender_viewport`,
  `blender_rt_headless`, `blender_rt_job`, `blender_rt_loop`, `blender_rt_txn`,
  `blender_rt_preset`, `blender_rt_perf`, `blender_rt_opt`, `blender_rt_cmd`,
  `blender_rt_commands`.
- GUI-first workflow with automatic headless worker fallback, persistent
  sessions, one-shot headless runs, background jobs and parameter search.
- Frame deduplication, scene audit, transform marks, .blend snapshots, presets,
  performance profiles and merge-candidate reporting.
- Bundled `blender-modeling` skill and `/blender` status command.
- Tested with Blender 5.2.2 LTS on Windows; targets Blender 4.2+.
