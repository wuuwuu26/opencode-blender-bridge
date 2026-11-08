import type { Host } from "../host.js";
import { type ToolOutput } from "./common.js";
export declare function viewportTool(host: Host): {
    name: string;
    description: string;
    input: Record<string, unknown>;
    execute(input: Record<string, unknown>, context?: {
        sessionID?: string;
    }): Promise<ToolOutput>;
};
