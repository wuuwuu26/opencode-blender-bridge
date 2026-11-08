import path from "node:path";
import { BridgeClient } from "./bridge.js";
import { findBlender } from "./blender.js";
import { resolveConfig } from "./config.js";
import { JobManager } from "./jobs.js";
import { WorkerManager } from "./worker.js";
import { ensureDir, projectKey, tempRoot } from "./util.js";
export function createHost(projectDir, options) {
    const config = resolveConfig(options);
    const dataDir = ensureDir(path.join(projectDir, ".opencode", "blender"));
    const framesDir = ensureDir(path.join(tempRoot(), projectKey(projectDir), "frames"));
    const txnsDir = ensureDir(path.join(dataDir, "txn"));
    let probe;
    const host = {
        config,
        bridge: new BridgeClient(config.host, config.port),
        projectDir,
        dataDir,
        framesDir,
        txnsDir,
        presetsFile: path.join(dataDir, "presets.json"),
        lastFrames: new Map(),
        workers: undefined,
        jobs: undefined,
        blenderProbe() {
            if (!probe)
                probe = findBlender(config.blenderPath);
            return probe;
        },
        blenderPath() {
            return host.blenderProbe().path;
        },
    };
    host.workers = new WorkerManager({ blender: () => host.blenderPath(), dataDir, ttlMs: config.workerTtlMs });
    host.jobs = new JobManager({ blenderPath: () => host.blenderPath(), dataDir });
    return host;
}
