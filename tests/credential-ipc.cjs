const path = require('node:path')
const root = path.resolve(__dirname, '..')

if (process.versions.electron) {
  const {BrowserWindow} = require('electron')
  // Exercise the real Main IPC without starting Python, engines or network requests.
  const corePath = require.resolve('../dist/electron/main/core')
  require.cache[corePath] = {exports: {PythonCore: class {
    key = ''
    async start() {}
    async stop() {}
    async request(method, endpoint, body) {
      if (endpoint === '/settings/credential') {this.key = body.api_key; return {has_api_key: !!this.key}}
      if (endpoint === '/settings') return {provider: 'openai', base_url: 'https://api.openai.com/v1', openai_model: 'test', has_api_key: !!this.key, engines: []}
      if (endpoint === '/health') return {katago: 'stopped', error: '', logs: []}
      throw new Error('Unexpected endpoint in credential test')
    }
  }}}
  BrowserWindow.prototype.loadFile = function () {return this.loadURL('data:text/html,<div id="root"></div>')}
  require('../dist/electron/main/index')
} else {
  const assert = require('node:assert/strict')
  const fs = require('node:fs/promises')
  const {_electron: electron} = require('playwright')

  async function main() {
    const runtime = path.join(root, '.runtime')
    await fs.mkdir(runtime, {recursive: true})
    const directory = await fs.mkdtemp(path.join(runtime, 'credential-test-'))
    const env = {...process.env, LLMGO_USER_DATA: directory}
    delete env.ELECTRON_RUN_AS_NODE
    delete env.OPENAI_API_KEY
    const application = await electron.launch({args: [__filename], env})
    try {
      const page = await application.firstWindow()
      // Mount the actual SettingsDialog, keeping the fixture out of the production bundle.
      const bundle = require('esbuild').buildSync({stdin: {contents: `
        import React from 'react'; import {createRoot} from 'react-dom/client';
        import {SettingsDialog} from './desktop/src/settings/SettingsDialog';
        createRoot(document.getElementById('root')).render(<SettingsDialog initialTab="api" numbers="off"
          onNumbers={()=>{}} beforeSave={async()=>{}} onClose={()=>{}} onSaved={()=>{}} />);
      `, loader: 'tsx', resolveDir: root}, bundle: true, write: false, jsx: 'automatic'}).outputFiles[0].text
      await page.addScriptTag({content: bundle})
      const button = page.getByRole('button', {name: '设置 API Key', exact: true})
      const idle = () => page.waitForFunction(() => !document.querySelector('.settings-message')?.textContent.includes('正在处理'))
      const open = async () => {
        const opened = application.waitForEvent('window')
        await button.click()
        const prompt = await opened
        await prompt.getByRole('button', {name: '保存', exact: true}).waitFor()
        await application.evaluate(async ({BrowserWindow}) => {
          const window = BrowserWindow.getAllWindows().find(w => w.getParentWindow())
          if (!window.isVisible()) await new Promise(resolve => window.once('show', resolve))
        })
        assert.equal(await button.isDisabled(), true)
        assert.equal(await prompt.locator('#api-key').inputValue(), '')
        return prompt
      }
      const secret = 'credential-test-only'
      let prompt = await open()
      assert.equal(await application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().find(w => w.getParentWindow()).isVisible()), true)
      await prompt.locator('#api-key').fill(secret)
      await prompt.getByRole('button', {name: '保存', exact: true}).click()
      await idle()
      assert.equal(await page.locator('.key-state').textContent(), '已配置，密钥已隐藏')
      const encrypted = await fs.readFile(path.join(directory, 'openai-key.enc'))
      assert.equal(encrypted.includes(Buffer.from(secret)), false)
      assert.equal(await application.evaluate(({safeStorage}, bytes) => safeStorage.decryptString(Buffer.from(bytes)) === 'credential-test-only', [...encrypted]), true)
      assert.equal(JSON.stringify(await page.evaluate(() => window.llmgo.invoke('settings'))).includes(secret), false)
      assert.equal(await fs.readFile(path.join(directory, 'settings.json'), 'utf8').catch(e => {if (e.code === 'ENOENT') return ''; throw e}), '')

      for (const exit of ['cancel', 'close', 'escape', 'destroy']) {
        console.log('credential exit:', exit)
        prompt = await open()
        if (exit === 'cancel') await prompt.getByRole('button', {name: '取消', exact: true}).click()
        else if (exit === 'escape') await prompt.keyboard.press('Escape').catch(error => {if (!prompt.isClosed()) throw error})
        else await application.evaluate(({BrowserWindow}, method) => BrowserWindow.getAllWindows().find(w => w.getParentWindow())[method](), exit)
        await idle()
        assert.equal(await button.isEnabled(), true)
        assert.equal(await page.locator('.key-state').textContent(), '已配置，密钥已隐藏')
      }

      // Direct repeated invokes share one prompt and return only status, never a key.
      const opened = application.waitForEvent('window')
      const repeated = page.evaluate(() => Promise.all([window.llmgo.invoke('credential'), window.llmgo.invoke('credential')]))
      prompt = await opened
      assert.equal(await application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().length), 2)
      await prompt.getByRole('button', {name: '取消', exact: true}).click()
      assert.deepEqual(await repeated, [{saved: false}, {saved: false}])

      prompt = await open()
      await prompt.getByRole('button', {name: '保存', exact: true}).click()
      await idle()
      assert.equal(await page.locator('.key-state').textContent(), '尚未配置')

      for (const failure of ['storage', 'create', 'load']) {
        console.log('credential failure:', failure)
        await application.evaluate(({safeStorage, BrowserWindow}, kind) => {
          const owner = kind === 'storage' ? safeStorage : BrowserWindow.prototype
          const method = kind === 'storage' ? 'encryptString' : kind === 'create' ? 'setMenu' : 'loadURL'
          const original = owner[method]
          owner[method] = function (...args) {
            if (kind === 'create' && args[0] !== null) return original.apply(this, args)
            owner[method] = original
            throw new Error('credential test failure')
          }
        }, failure)
        if (failure === 'storage') {
          prompt = await open()
          await prompt.locator('#api-key').fill(secret)
          await prompt.getByRole('button', {name: '保存', exact: true}).click()
        } else await button.click()
        await idle()
        assert.equal(await button.isEnabled(), true)
        assert.ok(await page.locator('.settings-message').textContent())
        assert.equal(await application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().length), 1, failure)
      }
      console.log('credential IPC passed: save, cancel, close, Escape, destroy, empty, duplicate, storage/create/load errors; busy resets; key stays private')
    } finally {
      await application.close()
      const target = path.resolve(directory)
      assert.ok(path.dirname(target) === path.resolve(runtime) && path.basename(target).startsWith('credential-test-'))
      await fs.rm(target, {recursive: true, force: true})
    }
  }
  main().catch(error => {console.error(error); process.exitCode = 1})
}
