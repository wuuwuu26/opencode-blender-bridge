import type { Host } from "../host.js";
export declare function buildTools(host: Host): {
    name: string;
    description: string;
    input: Record<string, unknown>;
    execute(input: Record<string, unknown>, context?: {
        sessionID?: string;
    }): Promise<import("./common.js").ToolOutput>;
}[];
