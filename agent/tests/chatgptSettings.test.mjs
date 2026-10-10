import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { applyChatGptSettings } from "../dist/chatgptSettings.js";

const settings = {
  effort: { value: "max", label: "Max", pattern: "(?:Max)" },
  source: "test",
};
let browser;
let artifacts;

before(async () => {
  artifacts = await mkdtemp(join(tmpdir(), "dual-agent-picker-"));
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  if (artifacts) await rm(artifacts, { recursive: true, force: true });
});

async function fixture(t, options) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.setContent([
    '<script>window.clicks = 0;</script>',
    '<button id="picker" data-testid="model-switcher-dropdown-button"',
    ' onclick="document.getElementById(\'menu\').hidden = false">High</button>',
    '<div id="menu" role="menu" hidden>',
    options,
    "</div>",
  ].join("\n"));
  const screenshot = join(artifacts, t.name + ".png");
  return {
    page,
    screenshot,
    apply: () => applyChatGptSettings(page, settings, screenshot),
  };
}

for (const [name, options] of [
  ["aria-disabled option", '<div role="menuitemradio" aria-disabled="true" onclick="window.clicks++"><span>Max</span></div>'],
  ["disabled button", '<button disabled onclick="window.clicks++"><span>Max</span></button>'],
  ["disabled ancestor", '<div data-disabled><button onclick="window.clicks++"><span>Max</span></button></div>'],
]) {
  test("skips " + name, async (t) => {
    const { page, apply, screenshot } = await fixture(t, options);
    assert.match(await apply(), /Max: not offered/);
    assert.equal(await page.evaluate(() => window.clicks), 0);
    assert.ok((await stat(screenshot)).size > 0);
  });
}

test("selects an enabled match after a disabled duplicate", async (t) => {
  const { page, apply } = await fixture(t, [
    '<div role="menuitemradio" aria-disabled="true"><span>Max</span></div>',
    '<button aria-pressed="false" onclick="window.clicks++; this.setAttribute(\'aria-pressed\', \'true\')"><span>Max</span></button>',
  ].join("\n"));
  assert.match(await apply(), /Max: selected/);
  assert.equal(await page.evaluate(() => window.clicks), 1);
  assert.equal(await page.locator("[aria-pressed]").getAttribute("aria-pressed"), "true");
});

test("does not click an already selected option", async (t) => {
  const { page, apply } = await fixture(t,
    '<button aria-pressed="true" onclick="window.clicks++"><span>Max</span></button>'
  );
  assert.match(await apply(), /Max: already selected/);
  assert.equal(await page.evaluate(() => window.clicks), 0);
});

test("reports an inert click as unconfirmed", async (t) => {
  const { page, apply, screenshot } = await fixture(t,
    '<button aria-pressed="false" onclick="window.clicks++"><span>Max</span></button>'
  );
  assert.match(await apply(), /Max: selection unconfirmed/);
  assert.equal(await page.evaluate(() => window.clicks), 1);
  assert.equal(await page.locator("[aria-pressed]").getAttribute("aria-pressed"), "false");
  assert.ok((await stat(screenshot)).size > 0);
});

test("confirms checked state after the menu is hidden", async (t) => {
  const { page, apply } = await fixture(t,
    '<button aria-pressed="false" onclick="this.setAttribute(\'aria-pressed\', \'true\'); document.getElementById(\'menu\').hidden = true"><span>Max</span></button>'
  );
  assert.match(await apply(), /Max: selected/);
  assert.equal(await page.locator("[aria-pressed]").getAttribute("aria-pressed"), "true");
});

test("confirms a changed trigger when selection removes the menu", async (t) => {
  const { page, apply } = await fixture(t,
    '<button onclick="document.getElementById(\'picker\').textContent = \'Max\'; document.getElementById(\'menu\').remove()"><span>Max</span></button>'
  );
  assert.match(await apply(), /Max: selected/);
  assert.equal(await page.locator("#picker").innerText(), "Max");
});

test("opens Advanced before selecting a setting", async (t) => {
  const { page, apply } = await fixture(t, [
    '<button onclick="document.getElementById(\'advanced\').hidden = false">Advanced</button>',
    '<div id="advanced" hidden><button aria-pressed="false" onclick="this.setAttribute(\'aria-pressed\', \'true\')"><span>Max</span></button></div>',
  ].join("\n"));
  assert.match(await apply(), /Max: selected/);
  assert.equal(await page.locator("[aria-pressed]").getAttribute("aria-pressed"), "true");
});

test("does not treat a plain text label as a selectable option", async (t) => {
  const { page, apply } = await fixture(t, '<span onclick="window.clicks++">Max</span>');
  assert.match(await apply(), /Max: not offered/);
  assert.equal(await page.evaluate(() => window.clicks), 0);
});
