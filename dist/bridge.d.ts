export type BridgeErrorCode = "unreachable" | "timeout" | "addon_error" | "bad_response" | "aborted";
export declare class BridgeError extends Error {
    readonly code: BridgeErrorCode;
    readonly detail?: unknown;
    constructor(code: BridgeErrorCode, message: string, detail?: unknown);
}
export interface BridgeResult<T> {
    result: T;
    ms: number;
}
export interface CallOptions {
    timeoutMs?: number;
    signal?: AbortSignal;
}
export declare class BridgeClient {
    readonly host: string;
    readonly port: number;
    constructor(host: string, port: number);
    call<T = Record<string, unknown>>(type: string, params?: Record<string, unknown>, options?: CallOptions): Promise<BridgeResult<T>>;
    ping(timeoutMs?: number): Promise<boolean>;
    info(timeoutMs?: number): Promise<Record<string, unknown>>;
}
