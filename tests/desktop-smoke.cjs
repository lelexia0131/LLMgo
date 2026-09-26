const {_electron: electron} = require('playwright')
const path = require('node:path')
const fs = require('node:fs/promises')
const {execFileSync} = require('node:child_process')
const assert = require('node:assert/strict')

async function main() {
  const root = path.resolve(__dirname, '..')
  const packaged = process.env.LLMGO_TEST_EXE
  const directory = path.join(root, '.runtime', packaged ? 'desktop-release' : 'desktop-smoke')
  await fs.mkdir(directory, {recursive: true})
  const env = {...process.env, LLMGO_USER_DATA: directory, PYTHONUTF8: '1'}
  delete env.ELECTRON_RUN_AS_NODE
  delete env.OPENAI_API_KEY
  const application = await electron.launch({...(packaged ? {executablePath: packaged, args: []} : {args: [root]}), env, timeout: 60000})
  let descendants = []
  const errors = []
  try {
    const page = await application.firstWindow({timeout: 60000})
    page.on('pageerror', error => errors.push(error.message))
    await page.locator('#main-goban').waitFor()
    assert.equal(await page.locator('.shudan-vertex').count(), 361)
    await application.evaluate(({dialog}, sample) => {
      dialog.showOpenDialog = async () => ({canceled: false, filePaths: [sample]})
    }, path.join(root, 'samples', 'teaching.sgf'))
    await page.getByRole('button', {name: '↥ 打开 SGF'}).click()
    await page.locator('.record-title h2').filter({hasText: 'teaching.sgf'}).waitFor()
    await page.getByRole('button', {name: '最后一手', exact: true}).click()
    await page.locator('.board-heading h1').filter({hasText: '第 14 手'}).waitFor()
    await page.keyboard.press('ArrowLeft')
    await page.locator('.board-heading h1').filter({hasText: '第 13 手'}).waitFor()
    await page.getByRole('treeitem').filter({hasText: '第 10 手'}).click()
    await page.locator('.board-heading h1').filter({hasText: '第 10 手'}).waitFor()
    const saved = path.join(directory, 'saved.sgf')
    await application.evaluate(({dialog}, target) => {
      dialog.showSaveDialog = async () => ({canceled: false, filePath: target})
    }, saved)
    await page.evaluate(() => window.llmgo.invoke('saveAs'))
    assert.ok((await fs.readFile(saved, 'utf8')).includes('LLMgo'))
    await page.getByRole('button', {name: '⚙ 设置'}).click()
    const model = page.getByRole('dialog').getByLabel('模型', {exact: true})
    assert.equal(await model.inputValue(), 'gpt-5.6')
    assert.ok(await page.getByLabel('发现的引擎').locator('option').count() >= 3)
    await page.getByLabel('默认 visits').fill('100')
    await page.getByRole('button', {name: '保存设置', exact: true}).click()
    await page.getByText('设置已保存', {exact: true}).waitFor()
    await page.getByRole('button', {name: '关闭设置'}).click()
    await page.getByRole('button', {name: '✧ 分析局面', exact: true}).click()
    await page.locator('.number-badge').nth(2).waitFor({timeout: 240000})
    assert.equal(await page.locator('.number-badge').count(), 3)
    assert.equal(await page.locator('#main-goban .shudan-marker_label').count(), 3)
    const alignment = await page.locator('#main-goban .shudan-marker_label').evaluateAll(elements => elements.map(el => {
      const cell = el.getBoundingClientRect()
      const marker = el.querySelector('.shudan-marker').getBoundingClientRect()
      return Math.hypot(cell.x + cell.width / 2 - marker.x - marker.width / 2, cell.y + cell.height / 2 - marker.y - marker.height / 2)
    }))
    assert.ok(alignment.every(distance => distance < 1), 'numeric markers must be centered on their intersections')
    await page.screenshot({path: path.join(directory, 'candidates.png')})
    await page.locator('.candidate-main').nth(1).click()
    await page.locator('.preview-bar').waitFor({timeout: 180000})
    await page.screenshot({path: path.join(directory, 'pv.png')})
    await page.getByRole('button', {name: '返回当前局面'}).click()
    await page.getByRole('button', {name: '清除标记', exact: true}).click()
    await page.locator('.candidate-empty').waitFor()
    await page.locator('.shudan-vertex[data-x="9"][data-y="9"]').click()
    await page.locator('.number-badge').filter({hasText: '1'}).waitFor()
    const state = await page.evaluate(() => window.llmgo.invoke('state'))
    assert.equal(state.markers[0].coordinate, 'K10')
    assert.equal(state.markers[0].id, 1)
    await page.getByRole('textbox', {name: '向助教提问'}).fill('如果走 1 呢？')
    await page.getByRole('button', {name: '发送问题'}).click()
    await page.getByRole('alert').filter({hasText: 'API Key'}).waitFor()
    assert.equal(await page.locator('.teacher-answer').count(), 0)
    const records = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress'], {encoding: 'utf8', windowsHide: true}))
    const rootPid = application.process().pid
    const ids = new Set([rootPid])
    let changed = true
    while (changed) {changed = false; for (const record of records) if (ids.has(record.ParentProcessId) && !ids.has(record.ProcessId)) {ids.add(record.ProcessId); changed = true}}
    descendants = records.filter(r => ids.has(r.ProcessId) && /python|katago|llmgo-core/i.test(r.Name))
    assert.ok(descendants.some(r => /python|llmgo-core/i.test(r.Name)))
    assert.ok(descendants.some(r => /katago/i.test(r.Name)))
    assert.deepEqual(errors, [])
  } finally {
    await application.close()
  }
  await new Promise(resolve => setTimeout(resolve, 1000))
  const surviving = descendants.filter(r => {try {process.kill(r.ProcessId, 0); return true} catch {return false}})
  assert.deepEqual(surviving, [])
  const report = {result: 'passed', checks: ['desktop startup', 'Python startup', '361 intersections', 'SGF open', 'branch navigation', 'arrow navigation', 'SGF save', 'engine discovery', 'real KataGo', 'three markers', 'candidate PV', 'free-point mapping', 'missing key error without fake answer', 'no orphan Python/KataGo'], processes: descendants, rendererErrors: errors}
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
main().catch(error => {console.error(error); process.exitCode = 1})
