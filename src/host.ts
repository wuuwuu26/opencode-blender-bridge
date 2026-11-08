import path from "node:path"
import { BridgeClient } from "./bridge.js"
import { findBlender, type BlenderProbe } from "./blender.js"
import { resolveConfig, type BridgeConfig } from "./config.js"
import { JobManager } from "./jobs.js"
import { WorkerManager } from "./worker.js"
import { AttaBridge } from "./atta.js"
import { ensureDir, projectKey, tempRoot } from "./util.js"

export interface Host {
  config: BridgeConfig
  bridge: BridgeClient
  workers: WorkerManager
  jobs: JobManager
  atta: AttaBridge
  projectDir: string
  dataDir: string
  framesDir: string
  txnsDir: string
  presetsFile: string
  lastFrames: Map<string, string>
  blenderProbe(): BlenderProbe
  blenderPath(): string | undefined
}

export function createHost(projectDir: string, options: unknown): Host {
  const config = resolveConfig(options)
  const dataDir = ensureDir(path.join(projectDir, ".opencode", "blender"))
  const framesDir = ensureDir(path.join(tempRoot(), projectKey(projectDir), "frames"))
  const txnsDir = ensureDir(path.join(dataDir, "txn"))
  let probe: BlenderProbe | undefined

  const host: Host = {
    config,
    bridge: new BridgeClient(config.host, config.port),
    projectDir,
    dataDir,
    framesDir,
    txnsDir,
    presetsFile: path.join(dataDir, "presets.json"),
    lastFrames: new Map(),
    workers: undefined as unknown as WorkerManager,
    jobs: undefined as unknown as JobManager,
    atta: undefined as unknown as AttaBridge,
    blenderProbe() {
      if (!probe) probe = findBlender(config.blenderPath)
      return probe
    },
    blenderPath() {
      return host.blenderProbe().path
    },
  }
  host.workers = new WorkerManager({ blender: () => host.blenderPath(), dataDir, ttlMs: config.workerTtlMs })
  host.jobs = new JobManager({ blenderPath: () => host.blenderPath(), dataDir })
  host.atta = new AttaBridge(host)
  return host
}
