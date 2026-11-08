import type { Host } from "./host.js";
export interface AttaLocation {
    python: string;
    version: string;
    source: string;
}
export interface AttaError {
    code?: string;
    message?: string;
    path?: string;
    fix?: string;
    [key: string]: unknown;
}
export interface AttaEnvelope {
    ok: boolean;
    tool?: string;
    data?: unknown;
    error?: AttaError | null;
    ms?: number;
}
export interface AttaStatus {
    available: boolean;
    python?: string;
    version?: string;
    source?: string;
    home: string;
    blender?: string;
    repo: string;
    error?: string;
}
export declare class AttaBridge {
    private readonly host;
    private cached?;
    private lastError?;
    constructor(host: Host);
    get home(): string;
    get venvDir(): string;
    private candidates;
    detect(force?: boolean): AttaLocation | undefined;
    status(force?: boolean): AttaStatus;
    env(): NodeJS.ProcessEnv;
    call(tool: string, args?: Record<string, unknown>, options?: {
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<AttaEnvelope>;
    setup(input?: {
        python?: string;
        source?: string;
        reset?: boolean;
        timeoutMs?: number;
    }): Promise<Record<string, unknown>>;
    images(data: unknown, max?: number): string[];
    deliverFiles(data: unknown, extensions?: string[]): string[];
}
export declare function formatAttaEnvelope(envelope: AttaEnvelope, maxChars?: number): string;
