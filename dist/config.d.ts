export interface BridgeConfig {
    host: string;
    port: number;
    blenderPath?: string;
    frameMaxSize: number;
    workerTtlMs: number;
}
export declare const PLUGIN_ID = "opencode.blender-bridge";
export declare const PLUGIN_VERSION = "0.1.1";
export declare const DEFAULT_PORT = 9876;
export declare const ADDON_PROTOCOL_VERSION = 1;
export declare function resolveConfig(options: unknown): BridgeConfig;
