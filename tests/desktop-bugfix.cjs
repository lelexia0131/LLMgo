const {_electron: electron} = require('playwright')
const path = require('node:path')
const fs = require('node:fs/promises')
const assert = require('node:assert/strict')

async function main() {
  const root = path.resolve(__dirname, '..')
  const runtime = path.join(root, '.runtime')
  await fs.mkdir(runtime, {recursive: true})
  const directory = await fs.mkdtemp(path.join(runtime, 'bugfix-test-'))
  const env = {...process.env, LLMGO_USER_DATA: directory, PYTHONUTF8: '1'}
  delete env.ELECTRON_RUN_AS_NODE
  delete env.OPENAI_API_KEY
  delete env.DEEPSEEK_API_KEY
  const app = await electron.launch({args: [root], env, timeout: 60000})
  let page
  const state = () => page.evaluate(() => window.llmgo.invoke('state'))
  const idle = () => page.waitForFunction(() => !document.querySelector('.navigation button')?.disabled)
  const menu = async name => {
    await idle()
    await app.evaluate(({Menu}, name) => {
      const item = Menu.getApplicationMenu().items.flatMap(i => i.submenu?.items || [])
        .find(i => i.accelerator === name || i.label === name)
      if (!item) throw new Error(`Missing menu ${name}`)
      item.click()
    }, name)
  }
  const move = n => page.waitForFunction(n => document.querySelector('.navigation b').textContent === String(n), n)
  const button = name => page.getByRole('button', {name, exact: true})
  const point = c => page.locator(`.shudan-vertex[data-x="${'ABCDEFGHJKLMNOPQRST'.indexOf(c[0])}"][data-y="${19 - Number(c.slice(1))}"]`)
  const sounds = () => page.evaluate(() => window.soundCount)
  const count = () => app.evaluate(() => global.analysisRequests.length)
  const recommended = async () => {
    await page.waitForFunction(() => document.querySelector('.recommendation') && /就绪 · 自动/.test(document.querySelector('.statusbar').textContent), null, {timeout: 240000})
    return state()
  }
  try {
    page = await app.firstWindow({timeout: 60000})
    await app.evaluate(({BrowserWindow, ipcMain}) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.setSkipTaskbar(true); win.setIgnoreMouseEvents(true); win.hide()
      win.webContents.setBackgroundThrottling(false)
      const handler = ipcMain._invokeHandlers.get('llmgo:invoke')
      global.analysisRequests = []
      ipcMain.removeHandler('llmgo:invoke')
      ipcMain.handle('llmgo:invoke', async (event, action, body) => {
        if (action === 'analyze') global.analysisRequests.push(body.revision)
        const result = await handler(event, action, body)
        if (action === 'analyze' && global.holdAnalysis && !result.cancelled) {
          global.holdAnalysis = false
          global.heldRevision = result.context.revision
          await new Promise(resolve => {global.releaseAnalysis = resolve})
        }
        return result
      })
    })
    await page.locator('#main-goban').waitFor()
    await idle()
    await page.evaluate(() => {
      window.soundCount = 0
      const start = AudioBufferSourceNode.prototype.start
      AudioBufferSourceNode.prototype.start = function (...args) {window.soundCount++; return start.apply(this, args)}
    })
    const fixture = path.join(directory, 'three-moves.sgf')
    await fs.writeFile(fixture, '(;SZ[19]KM[7.5];B[dd];W[pp](;B[pd])(;B[dp]))')
    await app.evaluate(({dialog}, file) => {dialog.showOpenDialog = async () => ({canceled: false, filePaths: [file]})}, fixture)
    await menu('打开 SGF')
    await page.getByText('three-moves.sgf', {exact: true}).waitFor()
    await idle()
    assert.equal(await page.getByRole('treeitem').count(), 4)
    assert.equal(await page.getByRole('treeitem', {name: '初始局面', exact: true}).count(), 0)
    const first = page.getByRole('treeitem', {name: '第 1 手 B D16', exact: true})
    assert.deepEqual(await first.evaluate(el => [el.style.left, el.style.top]), ['12px', '12px'])
    assert.equal(await page.locator('.tree-graph path').count(), 3)
    assert.equal((await state()).nodes[0].parent_id, null)
    assert.equal(await sounds(), 0)
    await button('后一手').click(); await move(1)
    await page.waitForFunction(() => window.soundCount === 1)
    await button('前一手').click(); await move(0)
    assert.equal(await sounds(), 1)
    await page.keyboard.press('ArrowRight'); await move(1)
    await page.waitForFunction(() => window.soundCount === 2)
    await button('最后一手').click(); await move(3)
    await page.waitForFunction(() => window.soundCount === 3)
    await button('第一手').click(); await move(0)
    await page.getByRole('treeitem', {name: '第 3 手 B D4', exact: true}).click(); await move(3)
    await page.waitForFunction(() => window.soundCount === 4)
    await point('E4').click(); await move(4)
    await page.waitForFunction(() => window.soundCount === 5)
    await button('前一手').click(); await move(3)
    assert.equal(await sounds(), 5)
    await point('E4').click(); await move(4)
    await page.waitForFunction(() => window.soundCount === 6)
    await button('停一手').click(); await move(5)
    assert.equal(await sounds(), 6)
    console.log('PASS tree projection/branches and forward/backward/pass sound')

    // Real safeStorage, fake test keys only; no API request is made.
    await app.evaluate(async (_, {root, directory}) => {
      const credentials = require(require('node:path').join(root, 'dist/electron/main/credentials.js'))
      process.env.OPENAI_API_KEY = 'old-environment-test-key'
      await credentials.saveCredential(directory, 'saved-deepseek-test-key')
      if (await credentials.loadCredential(directory) !== 'saved-deepseek-test-key') throw new Error('Saved key was overridden')
      await credentials.saveCredential(directory, '')
      delete process.env.OPENAI_API_KEY
    }, {root, directory})
    await menu('AI / API 设置')
    await page.getByLabel('Provider', {exact: true}).selectOption('deepseek')
    await button('保存设置').click()
    await page.getByText('设置已保存', {exact: true}).waitFor()
    const settings = await page.evaluate(() => window.llmgo.invoke('settings'))
    assert.deepEqual([settings.provider, settings.base_url, settings.openai_model], ['deepseek', 'https://api.deepseek.com', 'deepseek-chat'])
    await button('关闭设置').click()
    console.log('PASS saved credential priority and DeepSeek preset persistence (no paid API calls)')

    await page.waitForFunction(async () => (await window.llmgo.invoke('health')).katago === 'ready', null, {timeout: 240000})
    await menu('F6')
    let current = await recommended()
    for (let i = 0; i < 2; i++) {
      const previous = current
      const coordinate = await page.locator('.recommendation').first().getAttribute('data-coordinate')
      await point(coordinate).click()
      await move(previous.move_number + 1)
      current = await recommended()
      assert.ok(current.revision > previous.revision)
      assert.notEqual(current.node_id, previous.node_id)
      assert.equal(current.board_state.last_move, coordinate)
      const completed = await count()
      await page.waitForTimeout(900)
      assert.equal(await count(), completed, 'completed analysis must not trigger itself')
      console.log(`PASS F6 revision ${previous.revision} -> ${current.revision}: recommendations returned`)
    }
    const beforePreview = await sounds()
    const coordinate = await page.locator('.recommendation').first().getAttribute('data-coordinate')
    await point(coordinate).click({button: 'right'})
    await button('返回当前局面 · PV 预览').waitFor({timeout: 120000})
    assert.equal(await sounds(), beforePreview)
    await button('返回当前局面 · PV 预览').click()
    await recommended()
    await menu('界面设置')
    const paused = await count()
    await page.waitForTimeout(700)
    assert.equal(await count(), paused)
    await button('关闭设置').click()
    await recommended()
    // A same-node revision change must restart auto, too.
    const beforeComment = await state()
    await page.getByLabel('棋谱注释', {exact: true}).fill('F6 revision test')
    await button('保存注释').click()
    current = await recommended()
    assert.equal(current.node_id, beforeComment.node_id)
    assert.ok(current.revision > beforeComment.revision)
    console.log('PASS auto survives PV/settings and same-node revision changes')

    // Hold a real completed response, navigate, then deliver it late.
    await app.evaluate(() => {global.holdAnalysis = true; global.heldRevision = null})
    await menu('F5')
    const deadline = Date.now() + 120000
    while (!(await app.evaluate(() => global.heldRevision))) {
      if (Date.now() > deadline) throw new Error('Timed out holding analysis')
      await page.waitForTimeout(100)
    }
    await button('前一手').click(); await move(current.move_number - 1)
    const navigated = await state()
    await app.evaluate(() => global.releaseAnalysis())
    current = await recommended()
    assert.equal(current.node_id, navigated.node_id, 'late analysis must not restore the old node')
    assert.equal(current.move_number, navigated.move_number)
    const completed = await count()
    await page.waitForTimeout(900)
    assert.equal(await count(), completed)
    await menu('F6')
    await page.waitForFunction(() => !/自动|分析中/.test(document.querySelector('.statusbar').textContent))
    await page.waitForTimeout(700)
    assert.equal(await count(), completed)
    console.log('PASS late analysis is discarded; F6 stops only on user toggle')
  } catch (error) {
    if (page && !page.isClosed()) console.error(await page.evaluate(() => ({status: document.querySelector('.statusbar')?.textContent, error: document.querySelector('[role=alert]')?.textContent})))
    throw error
  } finally {
    await app.close()
    // Keep cleanup within this test's verified temporary directory.
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(runtime))
    assert.ok(path.basename(directory).startsWith('bugfix-test-'))
    await fs.rm(directory, {recursive: true, force: true})
  }
}
main().catch(error => {console.error(error); process.exitCode = 1})
