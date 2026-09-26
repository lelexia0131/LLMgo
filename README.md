# LLMgo

桌面端围棋 AI 助教。KataGo 算棋，GPT 通过工具获取证据并讲解，棋盘使用 **1、2、3** 指代具体位置。

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

1. 打开或拖入 SGF；仓库附带 `samples/teaching.sgf`。
2. 用底部按钮、左右方向键或左侧变化树选择局面。
3. 在设置选择 KataGo executable、模型、分析 config 和 visits。自动发现 PATH、`KATAGO_HOME`、项目 `katago/`、用户 `KataGo/`、`D:/Katago`、`C:/KataGo` 中的常见安装目录。下拉框可以切换 OpenCL、TensorRT 等已安装版本，也可手动选择。
4. 点击“分析局面”，棋盘显示最多三个候选数字。候选卡显示当前行棋方视角的胜率和目差。
5. 点击候选数字或卡片，查看该点搜索结果及 PV。PV 的数字是独立的变化手顺；“返回当前局面”恢复候选标记。默认前五手，可请求完整变化。
6. 点击普通空点创建临时标记；点击已有棋子标记教学目标。最多五个，必要时清除重新选择。
7. 在设置通过原生窗口输入 OpenAI API Key，并填写模型名。默认保留 `gpt-5.6`，模型能否调用由账户权限和 API 实际响应决定。
8. 问“为什么 2 不好？”或“如果走 1 呢？”。TeacherAgent 会通过 AnalysisService 查询 KataGo，再按结论、原因、关键变化、可复用棋理回答。

文件菜单支持 Save、Save As，快捷键 Ctrl+O / Ctrl+S / Ctrl+Shift+S。F5 分析。聊天 Enter 发送，Shift+Enter 换行。

首次 OpenCL 分析可能进行 GPU 调优，耗时比后续查询长；设置中的“测试 KataGo”执行真实局面搜索。“Test GPT”向官方 API 发出一次最小请求，无密钥时明确报未配置。

## API Key

Windows 原生密码窗口由 Electron Main 打开，Renderer 无密钥输入框。Main 使用 Electron `safeStorage` 加密持久化，Python 仅持有内存中的密钥；设置接口只返回 `has_api_key`。原生窗口留空保存可清除持久密钥。

也支持 `OPENAI_API_KEY` / `OPENAI_MODEL` 环境变量。环境变量 Key 在启动时优先。API 地址固定为官方 `https://api.openai.com/v1`。不读取其他应用凭据。Agents tracing 已禁用。

桌面设置和引擎缓存位于 Electron `userData`（Windows 通常为 `%APPDATA%/LLMgo`）；测试写入项目 `.runtime/`。可用 `LLMGO_USER_DATA` 指定桌面数据目录。

## 实现范围

- Electron / React / TypeScript strict / Vite 三栏桌面界面。
- Shudan 棋盘：坐标、星位、棋子、最后一手、手数、hover、点击、数字候选及 PV。
- sgfmill 负责 SGF 解析、树结构、摆子、提子及序列化；保留 variations 和原始属性。支持 19/13/9 路，包含 SZ/PB/PW/BR/WR/KM/RU/RE/DT/HA/AB/AW/B/W/C。
- Python Game / GameNode / Move / BoardState / GameContext；中途 SGF 摆子重建有效引擎历史。
- 明确分离 KataGoProcess、KataGoClient、AnalysisService；请求路由、队列、取消、超时、schema 验证；128 项内存缓存。
- TeacherAgent 的五个函数工具仅调用 Service；紧凑 PositionEvidence，不直接传原始引擎 JSON。
- 局面和标记版本校验、当前问题快照、最多五个关键数字；新问题建立新快照，保留本问题已引用位置的编号，避免“2”在提问中被重新解释。
- Main 启动 Python 后等待 health；正常退出取消 Agent、关闭 KataGo，再结束 Python。Python 监视父进程，防止主进程异常退出后持续后台运行。

SGF 保存保留原谱；第一版没有落子编辑或注释编辑器。PV 是预览，不写回棋谱。第一版每次提问使用当前局面独立上下文，不提供跨局面聊天记忆。已有棋子标记可以获取全局分析，但不会把全局胜率冒充单块棋的死活证明。

## 构建与检查

```powershell
.\.venv\Scripts\python.exe -m pytest -q
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

测试结果和截图输出 `.runtime/real-smoke-report.json`、`.runtime/desktop-smoke/`、`.runtime/desktop-release/`。实际验收记录见 [VALIDATION.md](VALIDATION.md)。

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
