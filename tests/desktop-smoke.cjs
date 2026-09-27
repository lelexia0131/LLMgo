const {_electron: electron} = require('playwright')
const path = require('node:path')
const fs = require('node:fs/promises')
const {execFileSync} = require('node:child_process')
const assert = require('node:assert/strict')

async function main() {
  const root = path.resolve(__dirname, '..')
  const runtime = path.join(root, '.runtime')
  await fs.mkdir(runtime, {recursive: true})
  const directory = await fs.mkdtemp(path.join(runtime, 'workbench-test-'))
  let server
  if (process.env.LLMGO_TEST_DEV) {
    const {createServer} = await import('vite')
    server = await createServer({server: {port: 5173}})
    await server.listen()
  }
  const env = {...process.env, LLMGO_USER_DATA: directory, PYTHONUTF8: '1', ...(server ? {LLMGO_DEV_URL: 'http://127.0.0.1:5173'} : {})}
  delete env.ELECTRON_RUN_AS_NODE
  delete env.OPENAI_API_KEY
  const application = await electron.launch({args: [root], env, timeout: 60000})
  const checks = [], errors = []
  let descendants = []
  let page
  const menu = async action => {
    await page.waitForFunction(() => !document.querySelector('.navigation button')?.disabled)
    await application.evaluate(({BrowserWindow}, name) => BrowserWindow.getAllWindows()[0].webContents.send('llmgo:menu', name), action)
  }
  try {
    page = await application.firstWindow({timeout: 60000})
    await application.evaluate(({BrowserWindow}) => {const window = BrowserWindow.getAllWindows()[0]; window.hide(); window.webContents.setBackgroundThrottling(false)})
    page.on('pageerror', error => errors.push(error.message))
    const board = page.locator('#main-goban')
    await board.waitFor()
    assert.equal(await page.locator('header').count(), 0)
    assert.equal(await page.locator('.shudan-vertex').count(), 361)
    await page.waitForFunction(async () => ['starting', 'ready'].includes((await window.llmgo.invoke('health')).katago))
    checks.push('renderer ready automatically initializes KataGo')
    const source = path.join(directory, 'fixture.sgf')
    await fs.writeFile(source, '(;CA[UTF-8]SZ[19]PB[Black Player]PW[White Player]KM[7.5]RU[Japanese]AB[cc]' + Array.from({length: 110}, (_, i) => `;${i % 2 ? 'W' : 'B'}[${i === 0 ? 'aa' : ''}]`).join('') + ')')
    await application.evaluate(({dialog}, file) => {dialog.showOpenDialog = async () => ({canceled: false, filePaths: [file]})}, source)
    await menu('open')
    await page.getByText('Black Player', {exact: true}).waitFor()
    await page.getByRole('button', {name: '最后一手', exact: true}).click()
    await page.waitForFunction(() => document.querySelector('.board-heading h1').textContent.includes('110'))
    await page.evaluate(() => {
      window.boardIdentity = document.querySelector('#main-goban')
      window.treeIdentity = document.querySelector('[role=treeitem]')
      window.busyFlashes = 0
      window.observer = new MutationObserver(() => {if (window.boardIdentity.classList.contains('shudan-busy')) window.busyFlashes++})
      window.observer.observe(window.boardIdentity, {attributes: true, attributeFilter: ['class']})
      window.soundCount = 0
      const start = OscillatorNode.prototype.start
      OscillatorNode.prototype.start = function (...args) {window.soundCount++; return start.apply(this, args)}
    })
    const vertex = (x, y) => page.locator(`.shudan-vertex[data-x="${x}"][data-y="${y}"]`)
    const label = (x, y) => vertex(x, y).locator('.shudan-marker')
    await vertex(3, 15).click() // B D4 = 111
    await page.waitForFunction(() => document.querySelector('.board-heading h1').textContent.includes('111'))
    assert.equal(await label(3, 15).textContent(), '')
    await page.getByRole('button', {name: '手数：关闭', exact: true}).click()
    assert.equal(await label(3, 15).textContent(), '111')
    await vertex(4, 15).click() // W E4 = 112
    await page.waitForFunction(() => document.querySelector('.board-heading h1').textContent.includes('112'))
    assert.equal(await label(4, 15).textContent(), '112')
    assert.equal(await label(3, 15).count(), 0)
    await page.getByRole('button', {name: '手数：最新', exact: true}).click()
    assert.equal(await label(0, 0).textContent(), '1')
    assert.equal(await label(3, 15).textContent(), '111')
    await vertex(5, 15).click()
    await page.waitForFunction(() => document.querySelector('.board-heading h1').textContent.includes('113'))
    assert.equal(await label(5, 15).textContent(), '113')
    assert.equal(await label(2, 2).count(), 0) // setup never numbered
    for (const [x, expected] of [[3, 'rgb(255, 255, 255)'], [4, 'rgb(0, 0, 0)']]) {
      const metrics = await label(x, 15).evaluate(el => {
        const marker = el.getBoundingClientRect(), cell = el.parentElement.getBoundingClientRect()
        return {color: getComputedStyle(el).color, centered: Math.hypot(marker.x + marker.width / 2 - cell.x - cell.width / 2, marker.y + marker.height / 2 - cell.y - cell.height / 2), fits: el.scrollWidth <= el.clientWidth}
      })
      assert.equal(metrics.color, expected); assert.ok(metrics.centered < 1 && metrics.fits)
    }
    await page.getByRole('button', {name: '手数：全部', exact: true}).click()
    assert.equal(await board.locator('.shudan-marker_label').count(), 0)
    checks.push('off/latest/all cycle; 111/112/113 share SGF numbering; setup excluded; black/white contrast; centered 3 digits')
    assert.equal(await page.evaluate(() => window.soundCount), 3)
    await page.getByRole('button', {name: '前一手', exact: true}).click()
    await page.waitForFunction(() => document.querySelector('.board-heading h1').textContent.includes('112'))
    assert.equal(await page.evaluate(() => window.soundCount), 3)
    assert.ok(await page.evaluate(() => window.boardIdentity === document.querySelector('#main-goban') && window.treeIdentity === document.querySelector('[role=treeitem]') && !window.busyFlashes))
    checks.push('navigation retains board/tree DOM with no busy flash and no move sound')
    const before = await board.boundingBox()
    await page.getByRole('button', {name: '折叠棋谱栏'}).click()
    await page.getByRole('button', {name: '折叠 AI 栏'}).click()
    await page.waitForFunction(() => document.querySelector('.workspace').classList.contains('right-collapsed'))
    await page.waitForTimeout(100)
    const after = await board.boundingBox()
    assert.ok(after.width >= before.width && Math.abs(after.width - after.height) < 1)
    await application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setSize(1150, 780))
    await page.waitForTimeout(150)
    const smaller = await board.boundingBox()
    const space = await page.locator('.board-space').boundingBox()
    assert.ok(smaller.width <= space.width && smaller.height <= space.height && Math.abs(smaller.width - smaller.height) < 1, JSON.stringify({before, after, smaller, space}))
    assert.ok(await page.evaluate(() => window.boardIdentity === document.querySelector('#main-goban')))
    await page.getByRole('button', {name: '展开棋谱栏'}).click()
    await page.getByRole('button', {name: '展开 AI 栏'}).click()
    checks.push('sidebars collapse and resize preserve square board and state')
    await page.getByRole('treeitem', {name: '第 109 手 B pass', exact: true}).click()
    await page.waitForFunction(() => document.querySelector('.board-heading h1').textContent.includes('109'))
    await vertex(6, 15).click()
    await page.waitForFunction(() => document.querySelector('.board-heading h1').textContent.includes('110'))
    const state = await page.evaluate(() => window.llmgo.invoke('state'))
    const parent = state.nodes.find(n => n.id === state.nodes.find(n => n.id === state.node_id).parent_id)
    assert.equal(parent.children.length, 2)
    const edited = state.node_id
    await page.getByLabel('棋谱注释', {exact: true}).fill('新增变化 ] 中文注释')
    await page.getByRole('button', {name: '保存注释', exact: true}).click()
    await page.waitForFunction(async () => (await window.llmgo.invoke('state')).comment === '新增变化 ] 中文注释')
    await menu('deleteBranch')
    await page.waitForFunction(async id => !(await window.llmgo.invoke('state')).nodes.some(n => n.id === id), edited)
    await menu('undo')
    await page.waitForFunction(async id => (await window.llmgo.invoke('state')).node_id === id, edited)
    await menu('redo')
    await page.waitForFunction(async id => !(await window.llmgo.invoke('state')).nodes.some(n => n.id === id), edited)
    await menu('undo')
    await page.waitForFunction(async id => (await window.llmgo.invoke('state')).node_id === id, edited)
    const saved = path.join(directory, 'saved.sgf')
    await application.evaluate(({dialog}, target) => {dialog.showSaveDialog = async () => ({canceled: false, filePath: target})}, saved)
    await menu('saveAs')
    await page.getByRole('alert').filter({hasText: '已保存'}).waitFor()
    assert.ok((await fs.readFile(saved, 'utf8')).includes('新增变化'))
    checks.push('historical click creates real variation; comment save; native delete/undo/redo/save menus')
    await menu('apiSettings')
    await page.getByLabel('Provider').selectOption('deepseek')
    assert.equal(await page.getByLabel('Base URL', {exact: true}).inputValue(), 'https://api.deepseek.com')
    await page.getByLabel('Provider').selectOption('compatible')
    await page.getByLabel('Base URL', {exact: true}).fill('http://localhost:8000/v1')
    await page.getByLabel('Model', {exact: true}).fill('test-model')
    await page.getByRole('button', {name: '保存设置', exact: true}).click()
    await page.getByText('设置已保存', {exact: true}).waitFor()
    assert.equal((await page.evaluate(() => window.llmgo.invoke('settings'))).provider, 'compatible')
    await page.getByRole('button', {name: '界面设置', exact: true}).click()
    await page.getByLabel('落子音效').selectOption('false')
    await page.getByRole('button', {name: '保存设置', exact: true}).click()
    await page.getByText('设置已保存', {exact: true}).waitFor()
    await page.getByRole('button', {name: '关闭设置'}).click()
    checks.push('split settings; DeepSeek preset; compatible URL/model persisted; sound setting')
    await page.screenshot({path: path.join(directory, 'workbench.png')})
    let health
    const deadline = Date.now() + 240000
    do {
      health = await page.evaluate(() => window.llmgo.invoke('health'))
      if (health.katago === 'ready' || health.katago === 'error') break
      await page.waitForTimeout(500)
    } while (Date.now() < deadline)
    assert.equal(health.katago, 'ready', health.error)
    await page.getByRole('button', {name: '分析当前局面', exact: true}).click()
    await page.waitForFunction(() => !document.querySelector('.statusbar').textContent.includes('Visits —'), null, {timeout: 240000})
    assert.ok((await page.evaluate(() => window.llmgo.invoke('state'))).move_losses[edited] >= 0)
    await page.locator('.candidate').first().click()
    await page.getByRole('button', {name: '返回当前局面'}).waitFor({timeout: 180000})
    await page.getByRole('button', {name: '返回当前局面'}).click()
    await page.getByRole('button', {name: '前一手', exact: true}).click()
    await page.waitForFunction(() => document.querySelector('.statusbar').textContent.includes('Visits —'))
    assert.equal(await board.locator('.shudan-sign_0.shudan-marker_label').count(), 0)
    checks.push('real startup/search/PV; score-loss coloring; navigation clears stale analysis')
    const processes = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress'], {encoding: 'utf8', windowsHide: true}))
    const ids = new Set([application.process().pid])
    let changed = true
    while (changed) {changed = false; for (const process of processes) if (ids.has(process.ParentProcessId) && !ids.has(process.ProcessId)) {ids.add(process.ProcessId); changed = true}}
    descendants = processes.filter(process => ids.has(process.ProcessId) && /python|katago|llmgo-core/i.test(process.Name))
    assert.ok(descendants.some(process => /katago/i.test(process.Name)))
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({result: 'passed', checks, rendererErrors: errors}, null, 2))
  } finally {
    await application.close()
    await server?.close()
    const resolved = path.resolve(directory)
    assert.ok(resolved.startsWith(path.resolve(runtime) + path.sep) && path.basename(resolved).startsWith('workbench-test-'))
    await fs.rm(resolved, {recursive: true, force: true})
  }
  const surviving = descendants.filter(process => {try {global.process.kill(process.ProcessId, 0); return true} catch {return false}})
  assert.deepEqual(surviving, [], 'Python and KataGo terminate with the app')
  console.log('Process shutdown and temporary-file cleanup passed')
}
main().catch(error => {console.error(error); process.exitCode = 1})
