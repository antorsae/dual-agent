/**
 * ChatGPT model settings for the Pro worker.
 *
 * Mirrors Codex instead of hardcoding a model: reads `model`,
 * `model_reasoning_effort` and `service_tier` from $CODEX_HOME/config.toml
 * (tool arguments override them), maps them to ChatGPT's labels using the
 * Codex model catalog cache, and selects them in ChatGPT's model picker.
 */
import type { Page } from "playwright";
export interface Setting {
    /** Value from config.toml or the tool call, e.g. "max". */
    value: string;
    /** Label ChatGPT shows, e.g. "Max". */
    label: string;
    /** Regex source matching ChatGPT's names for this value. */
    pattern: string;
}
export interface ChatGptSettings {
    model?: Setting;
    effort?: Setting;
    speed?: Setting;
    /** Where the settings came from. */
    source: string;
}
export interface SettingOverrides {
    model?: string;
    reasoningEffort?: string;
    serviceTier?: string;
}
export declare function loadChatGptSettings(overrides?: SettingOverrides): Promise<ChatGptSettings>;
export declare function describeSettings(settings: ChatGptSettings): string;
/**
 * Selects the settings in ChatGPT's model picker. Best effort: anything ChatGPT
 * does not offer keeps its current value, and the returned status says which.
 */
export declare function applyChatGptSettings(page: Page, settings: ChatGptSettings, screenshotFile: string): Promise<string>;
