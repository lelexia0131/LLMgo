# LLMgo

桌面端围棋复盘工作台。默认 19 路棋盘，点击合法空点直接写入 SGF；KataGo 提供分析，LLM 根据工具证据讲解。

## 启动

Windows 独立构建完成后，运行 `release/win-unpacked/LLMgo.exe`。整个 `win-unpacked` 文件夹需要保留，内含 Python Core，无需另外安装 Python。KataGo 和权重使用本机已有文件，不随包分发、不自动下载。

源码开发需要 Node.js 22+、Python 3.12+：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm install
npm run dev
```

`requirements.lock.txt` 记录本次 Windows 验收的完整 Python 依赖版本；`package-lock.json` 锁定 JavaScript 依赖。

已有构建可用 `npm start` 打开；可用 `LLMGO_PYTHON` 指定 Python 解释器。

## 使用

1. 从原生“文件”菜单打开 SGF，或拖入棋谱；仓库附带 `samples/teaching.sgf`。
2. 左右方向键、底部导航和真实变化树均可切换节点；两侧无边框箭头折叠侧栏，拖动边界调整栏宽；左栏两条横向分隔线调整棋局信息与注释高度，变化树占用其余空间。棋盘自动适配。
3. 点击合法空点直接落子。相同后续节点会被复用，不同落点追加 variation；“停一手”写入 pass。
4. F4 循环“关闭 / 最新 / 全部”，也可在“界面设置 → 手数显示”立即修改并持久化。pass 计数，setup 不编号；新旧棋子使用相同规则。
5. 在“棋谱注释”编辑当前 C[] 并保存注释。“编辑”菜单支持撤销、重做、删除当前节点及其后续、删除当前所在分支。
6. APP 启动即后台初始化 KataGo。“引擎设置”选择 executable、model、config、backend、GPU、threads 和 visits，可重启并查看日志。GPU / threads 默认沿用原配置；覆盖值写入用户数据目录中的派生配置，不改原文件。
7. F5 分析当前局面；F6 启停跟随节点的自动分析。KataGo 推荐在交叉点直接显示胜率与目差，颜色使用相对最优候选的目差损失；左键推荐点仍为真实落子，右键预览 PV。分析与 PV 切换保持棋盘尺寸不变。
8. “AI / API 设置”支持 OpenAI、DeepSeek、OpenAI Compatible，可修改 Base URL 和 Model，使用原生凭据窗口配置 Key，再测试连接。
9. 右栏保留对话历史；每个问题基于当前局面独立查询证据，历史项标注手数和对应推荐坐标，不提供跨局面模型记忆。

原生菜单支持 Ctrl+O / Ctrl+S / Ctrl+Shift+S、Ctrl+Z / Ctrl+Shift+Z。聊天 Enter 发送，Shift+Enter 换行。用户新增落子才异步播放真实落子采样（pass、导航和 PV 无声），可在“界面设置”关闭。音频来源及 MIT 许可见 [stone.SOURCE.md](assets/stone.SOURCE.md)。侧栏宽度在当前会话内保留。

首次 OpenCL 初始化可能进行 GPU 调优；引擎只有在真实搜索完成后才显示“就绪”。初始化不阻塞 Renderer 或打开棋谱。

## API Key

Windows 原生密码窗口由 Electron Main 打开，Renderer 无密钥输入框。Main 使用 Electron `safeStorage` 加密持久化，Python 仅持有内存中的密钥；设置接口只返回 `has_api_key`。原生窗口留空保存可清除持久密钥。

也支持 `OPENAI_API_KEY` / `OPENAI_MODEL` 环境变量。环境变量 Key 在启动时优先。默认 OpenAI 地址为 `https://api.openai.com/v1`；DeepSeek 是可修改的 preset，兼容服务使用用户填写的 Base URL。当前活动 Provider 共用一份加密凭据，切换服务时请设置对应 Key。不读取其他应用凭据。Agents tracing 已禁用。

桌面设置和引擎缓存位于 Electron `userData`（Windows 通常为 `%APPDATA%/LLMgo`）；测试写入项目 `.runtime/`。可用 `LLMGO_USER_DATA` 指定桌面数据目录。

## 实现范围

- Electron / React / TypeScript strict / Vite 三栏桌面界面。
- Shudan 棋盘：坐标、星位、棋子、最后一手、手数、hover、点击、胜率/目差候选叠加层及 PV。
- sgfmill 负责 SGF 解析、树结构、摆子、提子及序列化；保留 variations 和原始属性。支持 19/13/9 路，包含 SZ/PB/PW/BR/WR/KM/RU/RE/DT/HA/AB/AW/B/W/C。
- Python Game / GameNode / Move / BoardState / GameContext；中途 SGF 摆子重建有效引擎历史。
- 明确分离 KataGoProcess、KataGoClient、AnalysisService；请求路由、队列、取消、超时、schema 验证；128 项内存缓存。
- TeacherAgent 的五个函数工具仅调用 Service；紧凑 PositionEvidence，不直接传原始引擎 JSON。
- 局面 revision 校验、可取消分析、当前问题快照；KataGo 推荐数字与 SGF 手数分开。
- Main 启动 Python 后等待 health；正常退出取消 Agent、关闭 KataGo，再结束 Python。Python 监视父进程，防止主进程异常退出后持续后台运行。

SGF 保存保留主线、变化、摆子、pass、注释和元数据。编辑直接操作 sgfmill 树；撤销快照保存序列化 SGF、稳定节点 ID 和当前节点。PV 仅预览。变化树着色使用父局面最佳着与实际着的 scoreLead 差，阈值为 0.5 / 1.5 / 3 / 6 目；无数据为灰色，当前节点另用蓝色外框标示。

## 构建与检查

```powershell
.\.venv\Scripts\python.exe -m pytest -q tests/test_workbench.py tests/test_core.py -k "not katago_schema"
npm run build
.\.venv\Scripts\python.exe -m scripts.real_smoke
npm run test:desktop
```

真实 GPT / Agent 验收（先设置环境变量 Key；会使用 API 额度）：

```powershell
.\.venv\Scripts\python.exe -m scripts.real_smoke --openai
```

独立 Windows 文件夹打包：

```powershell
.\.venv\Scripts\python.exe -m pip install -e .[build]
npm run package
```

打包后复用桌面测试：

```powershell
$env:LLMGO_TEST_EXE = (Resolve-Path release/win-unpacked/LLMgo.exe).Path
npm run test:desktop
```

定向桌面测试覆盖三态手数/F4 键盘事件、采样播放、落子/变化、导航 DOM 复用、设置持久化、横纵拖动、推荐叠加层、真实 KataGo/F5/F6 和分析/PV 前后棋盘尺寸；结束自动清理临时数据；真实 Agent 单独验收仍输出 `.runtime/real-smoke-report.json`。`VALIDATION.md` 保留历史版本验收记录，不代表本次结果。

金黄色背景的正式图标位于 `assets/app.svg`、`app.png` 和多尺寸 `app.ico`；可在 Windows 用 `scripts/build-icon.ps1` 重建。窗口、任务栏、exe 和 NSIS 图标配置共用 ICO。`npm run package` 只打包独立文件夹；安装包可在 core 与前端构建完成后运行 `npx electron-builder --win nsis`。

## 复用与研究

| 项目 | 决定 |
|---|---|
| [Shudan](https://github.com/SabakiHQ/Shudan) | 复用 Goban，React 适配按其官方方案处理 |
| [sgfmill](https://mjw.woodcraft.me.uk/sgfmill/doc/1.1.1/) | 复用 Python SGF 树、解析、序列化和棋盘提子 |
| [KataGo](https://github.com/lightvector/KataGo/blob/master/docs/Analysis_Engine.md) | 使用官方 JSON Analysis Engine 协议 |
| [OpenAI Agents SDK](https://developers.openai.com/api/docs/guides/agents/sdk) | 一个 TeacherAgent，typed function tools + Runner |
| [Sabaki](https://github.com/SabakiHQ/Sabaki)、[SGF](https://github.com/SabakiHQ/sgf)、[GameTree](https://github.com/SabakiHQ/immutable-gametree) | 研究导航和变化树；核心在 Python，避免维护第二份 JS 业务棋谱树 |
| [KaTrain](https://github.com/sanderland/katrain) | 参考本地引擎教学工作流，未复制应用代码 |
| [GoAgent](https://github.com/wimi321/GoAgent) | 参考桌面工作台和事实/讲解职责分离；不加入知识库、同步或学生画像 |

源码分层及禁止依赖见 [ARCHITECTURE.md](ARCHITECTURE.md)。
