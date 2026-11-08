import { BridgeClient } from "./bridge.js";
import { type BlenderProbe } from "./blender.js";
import { type BridgeConfig } from "./config.js";
import { JobManager } from "./jobs.js";
import { WorkerManager } from "./worker.js";
export interface Host {
    config: BridgeConfig;
    bridge: BridgeClient;
    workers: WorkerManager;
    jobs: JobManager;
    projectDir: string;
    dataDir: string;
    framesDir: string;
    txnsDir: string;
    presetsFile: string;
    lastFrames: Map<string, string>;
    blenderProbe(): BlenderProbe;
    blenderPath(): string | undefined;
}
export declare function createHost(projectDir: string, options: unknown): Host;
