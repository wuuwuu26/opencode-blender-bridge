import { type HeadlessArgs, type HeadlessHandle, type HeadlessResult } from "./headless.js";
export type JobStatus = "running" | "done" | "failed" | "timeout" | "cancelled";
export interface JobRecord {
    id: string;
    status: JobStatus;
    startedAt: number;
    finishedAt?: number;
    runDir: string;
    resultPath: string;
    stdoutPath: string;
    stderrPath: string;
    pid?: number;
    exitCode?: number | null;
    error?: string;
    args: HeadlessArgs;
    handle?: HeadlessHandle;
    result?: HeadlessResult;
    promise?: Promise<HeadlessResult>;
}
export interface JobHost {
    blenderPath: () => string | undefined;
    dataDir: string;
}
export declare class JobManager {
    private readonly host;
    private readonly jobs;
    constructor(host: JobHost);
    start(args: HeadlessArgs, label?: string): JobRecord;
    get(id: string): JobRecord | undefined;
    list(): Array<Record<string, unknown>>;
    wait(id: string, seconds: number): Promise<JobRecord | undefined>;
    cancel(id: string): Promise<JobRecord | undefined>;
    summary(job: JobRecord): string;
    shutdown(): Promise<void>;
    cancelAll(): Promise<void>;
    private persist;
}
