import { type ChildProcessWithoutNullStreams } from "node:child_process";
import { BridgeClient } from "./bridge.js";
export interface WorkerOptions {
    blender: () => string | undefined;
    dataDir: string;
    ttlMs: number;
}
export interface WorkerSession {
    name: string;
    port: number;
    pid?: number;
    child: ChildProcessWithoutNullStreams;
    client: BridgeClient;
    startedAt: number;
    lastUsed: number;
    busy: boolean;
    blender: string;
    file?: string;
    stderr: string;
    ready: boolean;
}
export interface WorkerStartOptions {
    name?: string;
    blender?: string;
    file?: string;
    engine?: string;
    warmup?: boolean;
    timeoutMs?: number;
}
export interface WorkerViewOptions {
    max_size?: number;
    from?: string | [number, number, number];
    look_at?: string | [number, number, number];
    lens?: number;
    ortho?: boolean;
    view_size?: string;
    filepath: string;
}
export declare class WorkerManager {
    private readonly sessions;
    private readonly queues;
    private readonly options;
    private readonly reaper;
    constructor(options: WorkerOptions);
    has(name: string): boolean;
    list(): Array<Record<string, unknown>>;
    start(options?: WorkerStartOptions): Promise<Record<string, unknown>>;
    private queue;
    exec(name: string, code: string | undefined, options?: {
        file?: string;
        timeoutMs?: number;
        blender?: string;
        signal?: AbortSignal;
    }): Promise<Record<string, unknown>>;
    see(name: string, options: WorkerViewOptions & {
        blender?: string;
        signal?: AbortSignal;
    }): Promise<Record<string, unknown>>;
    reset(name: string, blender?: string): Promise<Record<string, unknown>>;
    status(name?: string, blender?: string): Promise<Record<string, unknown>>;
    stop(name: string): Promise<Record<string, unknown>>;
    stopAll(): Promise<void>;
    private ensure;
    private reap;
}
