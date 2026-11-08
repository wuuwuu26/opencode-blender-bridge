import type { Host } from "../host.js";
import { type ToolOutput } from "./common.js";
export declare function cadTool(host: Host): {
    name: string;
    description: string;
    input: Record<string, unknown>;
    execute(input: Record<string, unknown>, context?: {
        signal?: AbortSignal;
        sessionID?: string;
    }): Promise<ToolOutput>;
};
