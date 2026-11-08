export interface BlenderProbe {
    path?: string;
    version?: string;
    source?: string;
    error?: string;
}
export declare function findBlender(configured?: string): BlenderProbe;
export declare function blenderVersion(executable: string, timeoutMs?: number): Promise<string | undefined>;
export declare function waitForPort(port: number, timeoutMs?: number, signal?: AbortSignal): Promise<boolean>;
export declare function freePort(): Promise<number>;
