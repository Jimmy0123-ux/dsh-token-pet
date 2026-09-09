import { build } from 'esbuild'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = fileURLToPath(new URL('../', import.meta.url))
const out = await mkdtemp(join(tmpdir(), 'token-pet-ui-'))
const profile = join(out, 'profile')
const browser = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const result = await build({ entryPoints: [join(root, 'tests/ui-fixture.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } })
await writeFile(join(out, 'index.html'), `<html><meta charset="utf-8"><style>body{margin:0;background:#eceff5;font-family:Arial,sans-serif}</style><div id="root"></div><script>${result.outputFiles[0].text.replaceAll('</script>', '<\\/script>')}</script></html>`)
const chrome = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
let socket
try {
  let port
  for (let i = 0; i < 100; i++) {
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break } catch { await delay(100) }
  }
  if (!port) throw new Error('Chrome did not expose DevTools within 10 seconds')
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) { const { resolve, reject } = pending.get(message.id); pending.delete(message.id); message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result) }
  })
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const next = ++id; pending.set(next, { resolve, reject }); socket.send(JSON.stringify({ id: next, method, params })) })
  const evaluate = async expression => {
    const response = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails))
    return response.result.value
  }
  await cdp('Page.enable')
  await cdp('Emulation.setDeviceMetricsOverride', { width: 900, height: 760, deviceScaleFactor: 1, mobile: false })
  await cdp('Page.navigate', { url: pathToFileURL(join(out, 'index.html')).href })
  for (let i = 0; i < 100; i++) { if (await evaluate('typeof window.showPanel === "function"')) break; await delay(50) }
  const reports = []
  for (const width of [500, 360, 180]) for (const language of ['zh', 'en']) for (const tab of ['overview', 'models', 'settings']) {
    await evaluate(`window.showPanel(${width},${JSON.stringify(language)},${JSON.stringify(tab)})`)
    await delay(150)
    const metrics = await evaluate(`(() => {
      const region = document.querySelector('[role="region"]'); const main = region.querySelector('main');
      const overflowing = [...region.querySelectorAll('*')].filter(el => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1).map(el => ({ tag:el.tagName, text:el.textContent.slice(0,90), client:el.clientWidth, scroll:el.scrollWidth }));
      const scrollContainers = [...region.querySelectorAll('*')].filter(el => ['auto','scroll'].includes(getComputedStyle(el).overflowY)).map(el => el.tagName);
      return {lang:region.lang, client:main.clientWidth, scroll:main.scrollWidth, regionWidth:region.getBoundingClientRect().width, scrollContainers, overflowing, title:main.getAttribute('aria-label')};
    })()`)
    const screenshot = join(out, `${width}-${language}-${tab}.png`)
    const image = await cdp('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: width + 40, height: 670, scale: 1 } })
    await writeFile(screenshot, Buffer.from(image.data, 'base64'))
    let bottomScreenshot
    if (width === 360 && language === 'en' && tab !== 'models') {
      await evaluate('document.querySelector("main").scrollTop = document.querySelector("main").scrollHeight')
      bottomScreenshot = join(out, `${width}-${language}-${tab}-bottom.png`)
      const bottomImage = await cdp('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: width + 40, height: 670, scale: 1 } })
      await writeFile(bottomScreenshot, Buffer.from(bottomImage.data, 'base64'))
    }
    reports.push({ width, language, tab, ...metrics, screenshot, bottomScreenshot })
  }
  await evaluate('window.showPanel(360,"zh","overview")'); await delay(100)
  const before = await evaluate('document.querySelector("[role=region]").lang')
  await evaluate('window.switchLanguage("en")'); await delay(80)
  const after = await evaluate('({lang:document.querySelector("[role=region]").lang, text:document.querySelector("main").getAttribute("aria-label")})')
  await evaluate('document.querySelectorAll("[role=tab]")[1].click()'); await delay(60)
  const clickedTab = await evaluate('({title:document.querySelector("main").getAttribute("aria-label"), selected:[...document.querySelectorAll("[role=tab]")].map(el=>el.getAttribute("aria-selected"))})')
  const registeredSlots = await evaluate('window.shellFixture.mount()'); await delay(150)
  const shellSteps = []
  const shellCheck = async (name, expression) => shellSteps.push({ name, value: await evaluate(expression) })
  await shellCheck('starts closed with sound off', '({panel:!!document.querySelector("[role=region]"), sound:window.shellFixture.settings().completionSound, notes:window.shellFixture.audioLog.starts.length})')
  await evaluate('[...document.querySelectorAll("[aria-label]")].find(el=>el.getAttribute("aria-label")==="Show usage statistics").click()'); await delay(250)
  await shellCheck('pet click opens real shell', '!!document.querySelector("[role=region]")')
  const shellLayouts = []
  for (const viewportWidth of [900, 380, 196]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: viewportWidth, height: 760, deviceScaleFactor: 1, mobile: false }); await delay(120)
    const metrics = await evaluate(`(() => { const region=document.querySelector('[role="region"]'); const shell=region.parentElement; const header=shell.firstElementChild; return {shellWidth:shell.getBoundingClientRect().width,headerWidth:header.clientWidth,headerScroll:header.scrollWidth,headerText:header.textContent,mainWidth:region.querySelector('main').clientWidth,mainScroll:region.querySelector('main').scrollWidth}; })()`)
    const image = await cdp('Page.captureScreenshot', { format: 'png' })
    const screenshot = join(out, `shell-${viewportWidth}-en.png`); await writeFile(screenshot, Buffer.from(image.data, 'base64'))
    shellLayouts.push({ viewportWidth, ...metrics, screenshot })
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: 900, height: 760, deviceScaleFactor: 1, mobile: false }); await delay(100)
  await evaluate('window.shellFixture.patch({language:"zh"})'); await delay(70)
  await shellCheck('real shell language switches to Chinese', '({pet:!![...document.querySelectorAll("[aria-label]")].find(el=>el.getAttribute("aria-label")==="收起统计"),panel:document.querySelector("[role=region]").lang})')
  await evaluate('window.shellFixture.patch({language:"en"})'); await delay(70)
  await evaluate('document.querySelector("button[aria-controls]").click()'); await delay(70)
  await shellCheck('prompt drawer opens without switching tab', '({hidden:document.querySelector("aside").getAttribute("aria-hidden"),label:document.querySelector("aside").getAttribute("aria-label"),tab:document.querySelector("main").getAttribute("aria-label")})')
  const drawerImage = await cdp('Page.captureScreenshot', { format: 'png' }); await writeFile(join(out, 'shell-prompt-drawer.png'), Buffer.from(drawerImage.data, 'base64'))
  await evaluate('document.querySelector("button[aria-controls]").click();document.querySelectorAll("[role=tab]")[2].click()'); await delay(100)
  const audioSteps = []
  const audioStep = async (name, expression, expected) => {
    await evaluate(expression); await delay(70)
    const notes = await evaluate('window.shellFixture.audioLog.starts.length')
    audioSteps.push({ name, notes, expected, passed: notes === expected })
  }
  await audioStep('completed while default off is silent', 'shellFixture.start(1,1);shellFixture.end(1,2)', 0)
  await audioStep('enable actual checkbox only prepares, no notes', '[...document.querySelectorAll("label")].find(el=>el.textContent.trim()==="Completion sound").querySelector("input").click()', 0)
  await shellCheck('fake context prepared through real settings toggle', '({enabled:shellFixture.settings().completionSound,contexts:shellFixture.audioLog.contexts,resumes:shellFixture.audioLog.resumes})')
  await audioStep('actual English preview plays two scheduled notes', '[...document.querySelectorAll("button")].find(el=>el.textContent.trim()==="Preview sound").click()', 2)
  await audioStep('observed open then completed plays exactly two notes', 'shellFixture.start(2,3);shellFixture.end(2,4)', 4)
  await audioStep('duplicate completion snapshots do not replay', 'shellFixture.repeat();shellFixture.repeat()', 4)
  await audioStep('tool success does not signal turn completion', 'shellFixture.tool()', 4)
  await audioStep('cancelled turn is silent', 'shellFixture.start(3,5);shellFixture.end(3,6,"cancelled")', 4)
  await audioStep('switching to historical completed session is silent', 'shellFixture.switchSession("synthetic-B",true)', 4)
  await audioStep('next real observed completion plays once', 'shellFixture.start(100,192);shellFixture.end(100,193);shellFixture.repeat()', 6)
  await audioStep('disable through checkbox is silent', '[...document.querySelectorAll("label")].find(el=>el.textContent.trim()==="Completion sound").querySelector("input").click()', 6)
  await audioStep('completed after disabling is silent', 'shellFixture.start(101,194);shellFixture.end(101,195)', 6)
  await shellCheck('all audio uses fake context only', '({fake:window.AudioContext.name,log:shellFixture.audioLog})')
  await evaluate('[...document.querySelectorAll("button")].find(el=>el.getAttribute("aria-label")==="Hide the panel and keep the pet visible").click()'); await delay(60)
  await shellCheck('header close leaves pet visible', '({panel:!!document.querySelector("[role=region]"),pet:!![...document.querySelectorAll("[aria-label]")].find(el=>el.getAttribute("aria-label")==="Show usage statistics")})')
  await evaluate('window.shellFixture.dispose()')
  const output = { out, reports, hotSwitch: { before, after }, clickedTab, shell: { registeredSlots, shellSteps, shellLayouts, audioSteps }, note: 'Real headless Chrome DOM measurements using synthetic data on file://. 180px simulates constrained effective width, not browser zoom or the running DSH shell.' }
  await writeFile(join(out, 'report.json'), JSON.stringify(output, null, 2))
  console.log(JSON.stringify(output, null, 2))
  await cdp('Browser.close').catch(() => {})
} finally {
  socket?.close()
  chrome.kill()
  await delay(250)
  await rm(profile, { recursive: true, force: true }).catch(() => {})
}
