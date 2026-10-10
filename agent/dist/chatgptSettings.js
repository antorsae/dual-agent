/**
 * ChatGPT model settings for the Pro worker.
 *
 * Mirrors Codex instead of hardcoding a model: reads `model`,
 * `model_reasoning_effort` and `service_tier` from $CODEX_HOME/config.toml
 * (tool arguments override them), maps them to ChatGPT's labels using the
 * Codex model catalog cache, and selects them in ChatGPT's model picker.
 */
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { parse } from "smol-toml";
const CODEX_HOME = process.env.CODEX_HOME || join(homedir(), ".codex");
const CONFIG_FILE = join(CODEX_HOME, "config.toml");
const MODEL_CATALOG_FILE = join(CODEX_HOME, "models_cache.json");
// Separators in ChatGPT labels, including the non-breaking hyphen in "GPT‑6".
const SEP = "[\\s\\u2010-\\u2015_-]*";
// ChatGPT's names for config values; the first name is the label.
const EFFORT_NAMES = {
    minimal: ["Minimal"],
    low: ["Light", "Low"],
    medium: ["Medium"],
    high: ["High"],
    xhigh: ["Extra High", "XHigh"],
    max: ["Max"],
    ultra: ["Ultra"],
};
const SPEED_NAMES = {
    default: ["Standard"],
    fast: ["Fast"],
    priority: ["Fast"],
    flex: ["Flex"],
    ultrafast: ["Ultrafast", "Ultra fast"],
};
// Codex accepts "fast" for the catalog's "priority" tier.
const SERVICE_TIER_IDS = { fast: "priority" };
const SETTING_KINDS = ["model", "effort", "speed"];
const PICKER_TRIGGERS = [
    "button[data-testid='model-switcher-dropdown-button']",
    "[data-testid*='model-switcher' i]",
    "button[aria-label*='model' i]",
    "button[aria-label*='reasoning' i]",
    "button:has-text('GPT')",
];
// Open menus and popovers; ChatGPT renders the picker with Radix.
const POPOVERS = "[role='menu'], [role='listbox'], [role='dialog'], [data-radix-popper-content-wrapper]";
const OPTION_ROLES = [
    "menuitemradio",
    "menuitemcheckbox",
    "menuitem",
    "option",
    "radio",
    "switch",
    "tab",
    "button",
];
// The nearest option element containing a label.
const OPTION_ANCESTOR = `xpath=ancestor-or-self::*[${OPTION_ROLES.map((role) => `@role='${role}'`).join(" or ")} or self::button][1]`;
// Controls that may hide a setting's options until clicked.
const REVEAL_PATTERNS = {
    model: ["advanced", "model"],
    effort: ["advanced", "(?:reasoning|effort|thinking)"],
    speed: ["advanced", "speed"],
};
export async function loadChatGptSettings(overrides = {}) {
    const { config, source } = await readCodexConfig();
    const catalog = await readModelCatalog();
    const model = overrides.model || configString(config, "model");
    const effort = overrides.reasoningEffort || configString(config, "model_reasoning_effort");
    const tier = overrides.serviceTier || configString(config, "service_tier");
    const catalogModel = model ? findCatalogModel(catalog, model) : undefined;
    const overridden = Boolean(overrides.model || overrides.reasoningEffort || overrides.serviceTier);
    return {
        model: model ? modelSetting(model, catalogModel) : undefined,
        effort: effort
            ? namedSetting(effort, EFFORT_NAMES[effort.toLowerCase()] ?? [])
            : undefined,
        speed: tier ? namedSetting(tier, speedNames(tier, catalogModel, catalog)) : undefined,
        source: overridden ? `tool arguments + ${source}` : source,
    };
}
export function describeSettings(settings) {
    const parts = [settings.model?.label ?? "ChatGPT's current model"];
    if (settings.effort)
        parts.push(`${settings.effort.label} reasoning`);
    if (settings.speed)
        parts.push(`${settings.speed.label} speed`);
    return `${parts.join(", ")} (from ${settings.source})`;
}
/**
 * Selects the settings in ChatGPT's model picker. Best effort: anything ChatGPT
 * does not offer keeps its current value, and the returned status says which.
 */
export async function applyChatGptSettings(page, settings, screenshotFile) {
    const kinds = SETTING_KINDS.filter((kind) => settings[kind]);
    if (kinds.length === 0) {
        return `no model settings in ${settings.source}; kept ChatGPT's current selection`;
    }
    const results = [];
    let trigger;
    let missing = false;
    for (const kind of kinds) {
        const setting = settings[kind];
        const picker = await openPicker(page);
        if (!picker) {
            results.push("could not open the model picker; kept ChatGPT's current selection");
            missing = true;
            await page.screenshot({ path: screenshotFile }).catch(() => undefined);
            break;
        }
        trigger = picker.trigger ?? trigger;
        const outcome = await selectIn(picker.popovers, setting.pattern, REVEAL_PATTERNS[kind], trigger);
        if (!outcome || outcome === "selection unconfirmed") {
            missing = true;
            await page.screenshot({ path: screenshotFile }).catch(() => undefined);
        }
        results.push(`${setting.label}: ${outcome ?? "not offered"}`);
    }
    await page.keyboard.press("Escape").catch(() => undefined);
    const shown = trigger
        ? (await trigger.innerText({ timeout: 1000 }).catch(() => "")).replace(/\s+/g, " ").trim()
        : "";
    if (shown)
        results.push(`picker shows "${shown}"`);
    if (missing)
        results.push(`screenshot: ${screenshotFile}`);
    return results.join("; ");
}
async function readCodexConfig() {
    try {
        return { config: parse(await readFile(CONFIG_FILE, "utf-8")), source: CONFIG_FILE };
    }
    catch (err) {
        const reason = err.code === "ENOENT"
            ? "not found"
            : (err instanceof Error ? err.message : String(err)).split("\n")[0];
        return { config: {}, source: `${CONFIG_FILE} (${reason})` };
    }
}
async function readModelCatalog() {
    try {
        const cache = JSON.parse(await readFile(MODEL_CATALOG_FILE, "utf-8"));
        return Array.isArray(cache.models) ? cache.models : [];
    }
    catch {
        return [];
    }
}
function configString(config, key) {
    const value = config[key];
    return typeof value === "string" ? value.trim() : "";
}
function normalize(name) {
    return name.trim().toLowerCase().replace(/[\s‐-―_-]+/g, "-");
}
function humanize(value) {
    return value.replace(/\bgpt\b|\b[a-z]/gi, (match) => match.toUpperCase());
}
function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function findCatalogModel(catalog, model) {
    const wanted = normalize(model);
    return catalog.find((entry) => (entry.slug && normalize(entry.slug) === wanted) ||
        (entry.display_name && normalize(entry.display_name) === wanted));
}
function modelSetting(model, catalogModel) {
    const slug = catalogModel?.slug ?? normalize(model);
    return {
        value: slug,
        label: catalogModel?.display_name ?? humanize(model),
        pattern: modelPattern(slug),
    };
}
// ChatGPT may drop the "GPT" prefix and the version, e.g. "Astra" for
// gpt-6-astra, so those words are optional unless nothing else is left.
function modelPattern(slug) {
    const words = slug.split("-").filter(Boolean);
    const isOptional = (word) => word === "gpt" || /^\d/.test(word);
    const hasRequired = words.some((word) => !isOptional(word));
    return words
        .map((word, i) => {
        const part = escapeRegExp(word) + (i < words.length - 1 ? SEP : "");
        return hasRequired && isOptional(word) ? `(?:${part})?` : part;
    })
        .join("");
}
function namedSetting(value, names) {
    const labels = names.length > 0 ? names : [humanize(value)];
    const alternatives = labels.map((name) => name.split(/\s+/).map(escapeRegExp).join(SEP));
    return { value, label: labels[0], pattern: `(?:${alternatives.join("|")})` };
}
function speedNames(tier, catalogModel, catalog) {
    const key = tier.toLowerCase();
    const id = SERVICE_TIER_IDS[key] ?? key;
    const catalogName = [catalogModel, ...catalog]
        .flatMap((entry) => entry?.service_tiers ?? [])
        .find((entry) => entry.id === id)?.name;
    const names = [catalogName, ...(SPEED_NAMES[key] ?? [])];
    return [...new Set(names.filter((name) => Boolean(name)))];
}
async function openPicker(page) {
    const popovers = page.locator(POPOVERS);
    if ((await popovers.filter({ visible: true }).count()) > 0) {
        return { popovers };
    }
    for (const selector of PICKER_TRIGGERS) {
        const trigger = page.locator(selector).filter({ visible: true }).first();
        try {
            await trigger.click({ timeout: 2500 });
            await popovers.filter({ visible: true }).first().waitFor({ timeout: 2500 });
            return { popovers, trigger };
        }
        catch {
            await page.keyboard.press("Escape").catch(() => undefined);
        }
    }
    return null;
}
async function selectIn(popovers, pattern, reveals, trigger) {
    const outcome = await clickOption(popovers, pattern, { trigger });
    if (outcome)
        return outcome;
    for (const reveal of reveals) {
        if (!(await clickOption(popovers, reveal, { verify: false })))
            continue;
        const revealed = await clickOption(popovers, pattern, { trigger });
        if (revealed)
            return revealed;
    }
    return null;
}
async function clickOption(scope, pattern, { verify = true, trigger } = {}) {
    const exact = new RegExp(`^\\W*${pattern}\\W*$`, "i");
    const prefix = new RegExp(`^\\W*${pattern}\\b`, "i");
    // Prefer the element whose whole text is the label, acting on its option:
    // accessible names can run label and description together ("MaxMaximum…").
    const label = scope.getByText(exact);
    const candidates = [
        label.locator(OPTION_ANCESTOR),
        ...OPTION_ROLES.map((role) => scope.getByRole(role, { name: prefix, includeHidden: true })),
    ];
    for (const candidate of candidates) {
        for (const option of await candidate.all()) {
            if (!(await option.isVisible()) || (await isDisabled(option)))
                continue;
            if (await isSelected(option))
                return "already selected";
            const before = trigger ? await pickerText(trigger) : "";
            try {
                await option.click({ timeout: 2500 });
                await option.page().waitForTimeout(500);
            }
            catch {
                // Detached or covered; try the next candidate.
                continue;
            }
            if (!verify)
                return "opened";
            if (await isSelected(option))
                return "selected";
            // Some pickers remove the option on selection and show the value only
            // in the trigger. A click alone is not evidence that a setting changed.
            const after = trigger ? await pickerText(trigger) : "";
            if (after !== before && new RegExp(`(?:^|\\W)${pattern}(?:\\W|$)`, "i").test(after)) {
                return "selected";
            }
            return "selection unconfirmed";
        }
    }
    return null;
}
async function isSelected(option) {
    return option.evaluateAll((elements) => elements.some((element) => ["aria-checked", "aria-selected", "aria-pressed"].some((attribute) => element.getAttribute(attribute) === "true") || element.getAttribute("data-state") === "checked" || element.matches(":checked")));
}
async function isDisabled(option) {
    return option.evaluateAll((elements) => elements.some((element) => element.closest(":disabled, [disabled], [aria-disabled='true'], [data-disabled]:not([data-disabled='false'])") !== null));
}
async function pickerText(trigger) {
    return (await trigger.innerText({ timeout: 1000 }).catch(() => ""))
        .replace(/\s+/g, " ").trim();
}
