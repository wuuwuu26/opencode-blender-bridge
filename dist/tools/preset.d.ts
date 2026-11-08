import type { Host } from "../host.js";
import { type ToolOutput } from "./common.js";
export interface Preset {
    name: string;
    kind: "render" | "camera" | "material" | "view" | "object";
    data: Record<string, unknown>;
    at?: number;
    note?: string;
    builtin?: boolean;
}
export declare function presetTool(host: Host): {
    name: string;
    description: string;
    input: Record<string, unknown>;
    execute(input: Record<string, unknown>): Promise<ToolOutput>;
};
