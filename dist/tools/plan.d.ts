import type { Host } from "../host.js";
import { type ToolOutput } from "./common.js";
interface OpDef {
    command: string;
    description: string;
    args: string;
}
export declare function planTool(host: Host): {
    name: string;
    description: string;
    input: Record<string, unknown>;
    execute(input: Record<string, unknown>): Promise<ToolOutput>;
};
export type { OpDef };
