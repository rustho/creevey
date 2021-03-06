import https from 'https';
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { Context, Test, Suite } from 'mocha';
import { Builder, By, until, WebDriver, Origin } from 'selenium-webdriver';
import { Extension, jsVariants, ExtensionDescriptor, Hook } from 'interpret';
import { Config, BrowserConfig, SkipOptions, isDefined, StoryInput } from './types';

declare global {
  interface Window {
    __CREEVEY_RESTORE_SCROLL__?: () => void;
  }
}

const LOCALHOST_REGEXP = /(localhost|127\.0\.0\.1)/gi;
const TESTKONTUR_REGEXP = /testkontur/gi;

// NOTE Patch @babel/register hook due issue https://github.com/gulpjs/interpret/issues/61
['.ts', '.tsx'].forEach((patchExtension: string) => {
  const moduleDescriptor = jsVariants[patchExtension];
  if (Array.isArray(moduleDescriptor)) {
    const babelCompiler = moduleDescriptor.find(
      (ext): ext is ExtensionDescriptor => typeof ext == 'object' && ext.module == '@babel/register',
    );
    if (!babelCompiler) return;
    const oldRegister = babelCompiler.register;
    babelCompiler.register = function(hook) {
      oldRegister((options =>
        // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
        // @ts-ignore
        hook({ ...options, extensions: ['.es6', '.es', '.jsx', '.js', '.mjs', '.ts', '.tsx'] })) as Hook);
    };
  }
});

function getRealIp(): Promise<string> {
  return new Promise((resolve, reject) =>
    https.get('https://fake.testkontur.ru/ip', res => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Couldn't resolve real ip for \`localhost\`. Status code: ${res.statusCode}`));
      }

      let data = '';

      res.setEncoding('utf8');
      res.on('data', chunk => (data += chunk));
      res.on('end', () => resolve(data));
    }),
  );
}

async function resetMousePosition(browser: WebDriver): Promise<void> {
  const isChrome = (await browser.getCapabilities()).get('browserName') == 'chrome';
  const { top, left, width, height } = await browser.executeScript(function() {
    /* eslint-disable no-var */
    // NOTE On storybook >= 4.x already reset scroll
    window.scrollTo(0, 0);

    var bodyRect = document.body.getBoundingClientRect();
    return {
      top: bodyRect.top,
      left: bodyRect.left,
      width: bodyRect.width,
      height: bodyRect.height,
    };
    /* eslint-enable no-var */
  });

  if (isChrome) {
    // NOTE Bridge mode not support move mouse relative viewport
    await browser
      .actions({ bridge: true })
      .move({
        origin: browser.findElement(By.css('body')),
        x: Math.ceil((-1 * width) / 2) - left,
        y: Math.ceil((-1 * height) / 2) - top,
      })
      .perform();
  } else {
    // NOTE Firefox for some reason moving by 0 x 0 move cursor in bottom left corner :sad:
    // NOTE IE don't emit move events until force window focus or connect by RDP on virtual machine
    await browser
      .actions()
      .move({ origin: Origin.VIEWPORT, x: 0, y: 1 })
      .perform();
  }
}

async function resizeViewport(browser: WebDriver, viewport: { width: number; height: number }): Promise<void> {
  const windowRect = await browser
    .manage()
    .window()
    .getRect();
  const { innerWidth, innerHeight } = await browser.executeScript(function() {
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    };
  });
  const dWidth = windowRect.width - innerWidth;
  const dHeight = windowRect.height - innerHeight;
  await browser
    .manage()
    .window()
    .setRect({
      width: viewport.width + dWidth,
      height: viewport.height + dHeight,
    });
}

function disableAnimations(browser: WebDriver): Promise<void> {
  const disableAnimationsStyles = `
*,
*:hover,
*::before,
*::after {
  animation-delay: -0.0001ms !important;
  animation-duration: 0s !important;
  animation-play-state: paused !important;
  cursor: none !important;
  caret-color: transparent !important;
  transition: 0s !important;
}
`;
  return browser.executeScript(function(stylesheet: string) {
    /* eslint-disable no-var */
    var style = document.createElement('style');
    var textNode = document.createTextNode(stylesheet);
    style.setAttribute('type', 'text/css');
    style.appendChild(textNode);
    document.head.appendChild(style);
    /* eslint-enable no-var */
  }, disableAnimationsStyles);
}

async function hideBrowserScroll(browser: WebDriver): Promise<() => Promise<void>> {
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

  await browser.executeScript(function(stylesheet: string) {
    /* eslint-disable no-var */
    var style = document.createElement('style');
    var textNode = document.createTextNode(stylesheet);
    style.setAttribute('type', 'text/css');
    style.appendChild(textNode);
    document.head.appendChild(style);

    window.__CREEVEY_RESTORE_SCROLL__ = function() {
      if (document.head.contains(style)) {
        document.head.removeChild(style);
      }
      delete window.__CREEVEY_RESTORE_SCROLL__;
    };
    /* eslint-enable no-var */
  }, HideScrollStyles);

  return () =>
    browser.executeScript(function() {
      if (window.__CREEVEY_RESTORE_SCROLL__) {
        window.__CREEVEY_RESTORE_SCROLL__();
      }
    });
}

async function takeCompositeScreenshot(
  browser: WebDriver,
  windowSize: { width: number; height: number },
  elementRect: DOMRect,
): Promise<string> {
  const screens = [];
  const cols = Math.ceil(elementRect.width / windowSize.width);
  const rows = Math.ceil(elementRect.height / windowSize.height);
  const isFitHorizontally = windowSize.width >= elementRect.width + elementRect.left;
  const isFitVertically = windowSize.height >= elementRect.height + elementRect.top;
  const xOffset = Math.round(
    isFitHorizontally ? elementRect.left : Math.max(0, cols * windowSize.width - elementRect.width),
  );
  const yOffset = Math.round(
    isFitVertically ? elementRect.top : Math.max(0, rows * windowSize.height - elementRect.height),
  );

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const dx = Math.min(windowSize.width * col + elementRect.left, Math.max(0, elementRect.right - windowSize.width));
      const dy = Math.min(
        windowSize.height * row + elementRect.top,
        Math.max(0, elementRect.bottom - windowSize.height),
      );
      await browser.executeScript(
        function(x: number, y: number) {
          window.scrollTo(x, y);
        },
        dx,
        dy,
      );
      screens.push(await browser.takeScreenshot());
    }
  }

  const images = screens.map(s => Buffer.from(s, 'base64')).map(b => PNG.sync.read(b));
  const compositeImage = new PNG({ width: Math.round(elementRect.width), height: Math.round(elementRect.height) });

  for (let y = 0; y < compositeImage.height; y += 1) {
    for (let x = 0; x < compositeImage.width; x += 1) {
      const col = Math.floor(x / windowSize.width);
      const row = Math.floor(y / windowSize.height);
      const isLastCol = cols - col == 1;
      const isLastRow = rows - row == 1;
      const i = (y * compositeImage.width + x) * 4;
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
  return PNG.sync.write(compositeImage).toString('base64');
}

async function takeScreenshot(browser: WebDriver, captureElement?: string | null): Promise<string> {
  if (!captureElement) return browser.takeScreenshot();

  const { elementRect, windowSize } = await browser.executeScript(function(selector: string) {
    return {
      elementRect: document.querySelector(selector)?.getBoundingClientRect(),
      windowSize: { width: window.innerWidth, height: window.innerHeight },
    };
  }, captureElement);

  const isFitIntoViewport =
    elementRect.width + elementRect.left <= windowSize.width &&
    elementRect.height + elementRect.top <= windowSize.height;

  if (isFitIntoViewport) return browser.findElement(By.css(captureElement)).takeScreenshot();

  const restoreScroll = await hideBrowserScroll(browser);
  const screenshot = await takeCompositeScreenshot(browser, windowSize, elementRect);
  await restoreScroll();
  return screenshot;
}

function selectStory(browser: WebDriver, storyId: string, kind: string, story: string): Promise<void> {
  return browser.executeAsyncScript(
    function(storyId: string, kind: string, name: string, callback: Function) {
      window.__CREEVEY_SELECT_STORY__(storyId, kind, name, callback);
    },
    storyId,
    kind,
    story,
  );
}

export async function getBrowser(config: Config, browserConfig: BrowserConfig): Promise<WebDriver> {
  const {
    gridUrl = config.gridUrl,
    storybookUrl: address = config.storybookUrl,
    limit,
    testRegex,
    viewport,
    ...capabilities
  } = browserConfig;
  void limit;
  void testRegex;
  let realAddress = address;
  if (LOCALHOST_REGEXP.test(address) && TESTKONTUR_REGEXP.test(gridUrl)) {
    realAddress = address.replace(LOCALHOST_REGEXP, await getRealIp());
  }
  const browser = await new Builder()
    .usingServer(gridUrl)
    .withCapabilities(capabilities)
    .build();

  if (viewport) {
    await resizeViewport(browser, viewport);
  }
  try {
    await browser.get(`${realAddress}/iframe.html`);
    await browser.wait(until.elementLocated(By.css('#root')), 10000);
  } catch (_) {
    throw new Error(`Can't load storybook root page by URL ${realAddress}/iframe.html`);
  }
  await disableAnimations(browser);

  return browser;
}

export async function switchStory(this: Context): Promise<void> {
  let testOrSuite: Test | Suite | undefined = this.currentTest;

  if (!testOrSuite) throw new Error("Can't switch story, because test context doesn't have 'currentTest' field");

  this.testScope.length = 0;
  this.testScope.push(this.browserName);
  while (testOrSuite?.title) {
    this.testScope.push(testOrSuite.title);
    testOrSuite = testOrSuite.parent;
  }
  const story: StoryInput | undefined = this.currentTest?.ctx?.story;

  if (!story) throw new Error(`Current test '${this.testScope.join('/')}' context doesn't have 'story' field`);

  await resetMousePosition(this.browser);
  await selectStory(this.browser, story.id, story.kind, story.name);

  const { captureElement } = story.parameters.creevey ?? {};

  if (captureElement)
    Object.defineProperty(this, 'captureElement', {
      enumerable: true,
      configurable: true,
      get() {
        return this.browser.findElement(By.css(captureElement));
      },
    });
  else Reflect.deleteProperty(this, 'captureElement');

  this.takeScreenshot = () => takeScreenshot(this.browser, captureElement);

  this.testScope.reverse();
}

function matchBy(pattern: string | string[] | RegExp | undefined, value: string): boolean {
  return (
    (typeof pattern == 'string' && pattern == value) ||
    (Array.isArray(pattern) && pattern.includes(value)) ||
    (pattern instanceof RegExp && pattern.test(value)) ||
    !isDefined(pattern)
  );
}

export function shouldSkip(
  meta: {
    browser: string;
    kind: string;
    story: string;
  },
  skipOptions: SkipOptions,
  test?: string,
): string | boolean {
  if (typeof skipOptions == 'string') {
    return skipOptions;
  }
  if (Array.isArray(skipOptions)) {
    return skipOptions.map(skipOption => shouldSkip(meta, skipOption, test)).find(Boolean) || false;
  }
  const { in: browsers, kinds, stories, tests, reason = true } = skipOptions;
  const { browser, kind, story } = meta;
  const skipByBrowser = matchBy(browsers, browser);
  const skipByKind = matchBy(kinds, kind);
  const skipByStory = matchBy(stories, story);
  const skipByTest = !isDefined(test) || matchBy(tests, test);

  return skipByBrowser && skipByKind && skipByStory && skipByTest && reason;
}

function registerCompiler(moduleDescriptor: Extension | null): void {
  if (moduleDescriptor) {
    if (typeof moduleDescriptor === 'string') {
      require(moduleDescriptor);
    } else if (!Array.isArray(moduleDescriptor)) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      moduleDescriptor.register(require(moduleDescriptor.module));
    } else {
      moduleDescriptor.find(extension => {
        try {
          registerCompiler(extension);
          return true;
        } catch (e) {
          // do nothing
        }
      });
    }
  }
}

export function requireConfig<T>(configPath: string): T {
  let ext = path.extname(configPath);
  if (!ext || ext == '.config') {
    ext = Object.keys(jsVariants).find(key => fs.existsSync(`${configPath}${key}`)) || ext;
    configPath += ext;
  }
  try {
    require(configPath);
  } catch (error) {
    const childModules = require.cache[__filename].children;
    // NOTE If config load failed then the module of config can't have child modules
    if (childModules.find(child => child.filename == configPath)?.children.length != 0) {
      throw error;
    }
    registerCompiler(jsVariants[ext]);
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const configModule = require(configPath);
  return configModule && configModule.__esModule ? configModule.default : configModule;
}
