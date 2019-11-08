import { PNG } from "pngjs";
import chai, { expect } from "chai";
import { Suite, Context, Test } from "mocha";
import selenium, { By, WebDriver } from "selenium-webdriver";
import { CreeveyStories, isDefined, Test as CreeveyTest } from "../../types";
import { shouldSkip } from "../../utils";
import { createHash } from "crypto";

async function hideBrowserScroll(browser: WebDriver) {
  const HideScrollStyles = `
html {
  overflow: -moz-scrollbars-none !important;
  -ms-overflow-style: none !important;
}
html::-webkit-scrollbar {
  width: 0 !important;
  height: 0 !important;
}
`;
  // @ts-ignore
  await browser.executeScript(function(stylesheet) {
    var style = document.createElement("style");
    var textnode = document.createTextNode(stylesheet);
    style.setAttribute("type", "text/css");
    style.appendChild(textnode);
    document.head.appendChild(style);
    // @ts-ignore
    window.__CREEVEY_RESTORE_SCROLL__ = function() {
      if (document.head.contains(style)) {
        document.head.removeChild(style);
      }
      // @ts-ignore
      delete window.__CREEVEY_RESTORE_SCROLL__;
    };
  }, HideScrollStyles);

  return () =>
    browser.executeScript(function() {
      // @ts-ignore
      if (window.__CREEVEY_RESTORE_SCROLL__) {
        // @ts-ignore
        window.__CREEVEY_RESTORE_SCROLL__();
      }
    });
}

async function takeCompositeScreenshot(
  browser: WebDriver,
  windowSize: { width: number; height: number },
  elementRect: DOMRect
) {
  const screens = [];
  const cols = Math.ceil(elementRect.width / windowSize.width);
  const rows = Math.ceil(elementRect.height / windowSize.height);
  const isFitHorizontally = windowSize.width >= elementRect.width + elementRect.left;
  const isFitVertically = windowSize.height >= elementRect.height + elementRect.top;
  const xOffset = isFitHorizontally ? elementRect.left : Math.max(0, cols * windowSize.width - elementRect.width);
  const yOffset = isFitVertically ? elementRect.top : Math.max(0, rows * windowSize.height - elementRect.height);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const dx = Math.min(windowSize.width * col + elementRect.left, Math.max(0, elementRect.right - windowSize.width));
      const dy = Math.min(
        windowSize.height * row + elementRect.top,
        Math.max(0, elementRect.bottom - windowSize.height)
      );
      await browser.executeScript(
        // @ts-ignore
        function(x, y) {
          window.scrollTo(x, y);
        },
        dx,
        dy
      );
      screens.push(await browser.takeScreenshot());
    }
  }

  const images = screens.map(s => Buffer.from(s, "base64")).map(b => PNG.sync.read(b));
  const compositeImage = new PNG({ width: elementRect.width, height: elementRect.height });

  for (let y = 0; y < elementRect.height; y += 1) {
    for (let x = 0; x < elementRect.width; x += 1) {
      const col = Math.floor(x / windowSize.width);
      const row = Math.floor(y / windowSize.height);
      const isLastCol = cols - col == 1;
      const isLastRow = rows - row == 1;
      const i = (y * elementRect.width + x) * 4;
      const j =
        ((y % windowSize.height) * windowSize.width + (x % windowSize.width)) * 4 +
        (isLastRow ? yOffset * windowSize.width * 4 : 0) +
        (isLastCol ? xOffset * 4 : 0);
      const image = images[row * cols + col];
      compositeImage.data[i + 0] = image.data[j + 0];
      compositeImage.data[i + 1] = image.data[j + 1];
      compositeImage.data[i + 2] = image.data[j + 2];
      compositeImage.data[i + 3] = image.data[j + 3];
    }
  }
  return PNG.sync.write(compositeImage).toString("base64");
}

async function takeScreenshot(browser: WebDriver, captureElement?: string) {
  if (!captureElement) return browser.takeScreenshot();

  const restoreScroll = await hideBrowserScroll(browser);
  const { elementRect, windowSize } = await browser.executeScript(function(selector: string) {
    return {
      elementRect: document.querySelector(selector)!.getBoundingClientRect(),
      windowSize: { width: window.innerWidth, height: window.innerHeight }
    };
  }, captureElement);

  const isFitIntoViewport =
    elementRect.width + elementRect.left <= windowSize.width &&
    elementRect.height + elementRect.top <= windowSize.height;

  const screenshot = await (isFitIntoViewport
    ? browser.findElement(By.css(captureElement)).takeScreenshot()
    : takeCompositeScreenshot(browser, windowSize, elementRect));

  await restoreScroll();

  return screenshot;
}

function storyTestFabric(captureElement?: string) {
  return async function storyTest(this: Context) {
    const screenshot = await takeScreenshot(this.browser, captureElement);
    await expect(screenshot).to.matchImage();
  };
}

function findOrCreateSuite(name: string, parent: Suite): Suite {
  const suite = parent.suites.find(({ title }) => title == name) || new Suite(name, parent.ctx);
  if (!suite.parent) {
    suite.parent = parent;
    parent.addSuite(suite);
  }
  return suite;
}

function createTest(name: string, fn: (this: Context) => void, skip: string | boolean): Test {
  const test = new Test(name, skip ? undefined : fn);
  test.pending = Boolean(skip);
  // NOTE Can't define skip reason in mocha https://github.com/mochajs/mocha/issues/2026
  test.skipReason = skip;

  return test;
}

function createCreeveyTest(testPath: string[], skip: string | boolean): CreeveyTest {
  const testId = createHash("sha1")
    .update(testPath.join("/"))
    .digest("hex");
  return {
    id: testId,
    path: testPath,
    retries: 0,
    skip
  };
}

export function convertStories(
  rootSuite: Suite,
  browserName: string,
  stories: CreeveyStories
): Partial<{ [id: string]: CreeveyTest }> {
  const creeveyTests: { [id: string]: CreeveyTest } = {};

  Object.values(stories)
    .filter(isDefined)
    .forEach(story => {
      const { skip, captureElement, _seleniumTests: tests, __filename } = story.params || {};
      const skipReason = skip ? shouldSkip(story.name, browserName, skip) : false;
      const kindSuite = findOrCreateSuite(story.kind, rootSuite);

      // typeof tests === "undefined" => rootSuite -> kindSuite -> storyTest -> [browsers.png]
      // typeof tests === "function"  => rootSuite -> kindSuite -> storyTest -> browser -> [images.png]
      // typeof tests === "object"    => rootSuite -> kindSuite -> storySuite -> test -> [browsers.png]
      // typeof tests === "object"    => rootSuite -> kindSuite -> storySuite -> test -> browser -> [images.png]

      if (!tests) {
        const test = createCreeveyTest([browserName, story.name, story.kind], skipReason);
        creeveyTests[test.id] = test;
        kindSuite.addTest(createTest(story.name, storyTestFabric(captureElement), skipReason));
        return;
      }

      const storySuite = findOrCreateSuite(story.name, kindSuite);

      // TODO params from storybook 3.x - 5.x
      // TODO Check if test already exists

      // @ts-ignore
      console.log(__filename);

      let parsedTests: { [name: string]: (this: Context) => void } = {};
      try {
        // @ts-ignore
        parsedTests = eval(`(${tests})`)(selenium, chai);
      } catch (_) {
        // NOTE tests maybe stringified as shorthand object method
        parsedTests = eval(`({${tests}})`)._seleniumTests(selenium, chai);
      }

      Object.entries(parsedTests).forEach(([testName, testFn]) => {
        const test = createCreeveyTest([browserName, testName, story.name, story.kind], skipReason);
        creeveyTests[test.id] = test;

        storySuite.addTest(createTest(testName, testFn, skipReason));
      });
    });

  return creeveyTests;
}
