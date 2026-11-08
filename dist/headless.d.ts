import { type ChildProcessWithoutNullStreams } from "node:child_process";
export interface HeadlessArgs {
    script?: string;
    script_file?: string;
    file?: string;
    outdir?: string;
    timeout_ms?: number;
    engine?: string;
    args?: string;
    workdir?: string;
    factory_startup?: boolean;
    env?: Record<string, string>;
    shots?: Array<Record<string, unknown>>;
    hard_exit?: boolean;
    include_noise?: boolean;
}
export interface HeadlessPayload {
    ok: boolean;
    result?: unknown;
    stdout?: string;
    stderr?: string;
    error?: string | null;
    traceback?: string | null;
    files?: Array<{
        name: string;
        path: string;
        bytes: number;
    }>;
    shots?: Array<{
        name: string;
        filepath: string;
        info: unknown;
    }>;
    wall_ms?: number;
}
export interface HeadlessResult {
    ok: boolean;
    exitCode: number | null;
    timedOut: boolean;
    runDir: string;
    resultPath: string;
    stdoutPath: string;
    stderrPath: string;
    payload: HeadlessPayload;
    stdoutTail: string;
    stderrTail: string;
}
export interface HeadlessHandle {
    runDir: string;
    resultPath: string;
    stdoutPath: string;
    stderrPath: string;
    child: ChildProcessWithoutNullStreams;
    startedAt: number;
    done: Promise<HeadlessResult>;
}
export interface HeadlessHost {
    blenderPath?: string;
    dataDir: string;
}
export declare function startHeadless(host: HeadlessHost, args: HeadlessArgs, options?: {
    signal?: AbortSignal;
    runId?: string;
}): HeadlessHandle;
export declare function listFiles(dir: string, includeNoise?: boolean): Array<{
    name: string;
    path: string;
    bytes: number;
}>;
export declare function summarizeHeadless(result: HeadlessResult): string;
