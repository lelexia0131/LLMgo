# LLMgo 第一版验收

日期：2026-09-26，Windows 11 x64，Python 3.12.14，Electron 41.10.7。

## 已通过

| 项目 | 验证方式与结果 |
|---|---|
| Python 关键测试 | `python -m pytest -q`：6 项通过 |
| TypeScript strict / Vite | `npm run build` 通过 |
| SGF | 样例真实打开、18 节点/双分支、导航第 10/13/14 手、左右方向键、另存为并读取文件 |
| SGF 属性与棋盘 | 单元测试验证摆子、让子行棋方、提子、评论、metadata 和全部分支往返保存 |
| 数字 Marker | 1/2/3 与后端 GTP 坐标对应；无效坐标和过期 revision 拒绝；最多五个；切换节点清空 |
| 棋盘视觉 | Electron 截图检查；361 交点；数字标记中心与交点中心误差小于 1 CSS px |
| 本地引擎发现 | 发现本机 OpenCL 和 TensorRT 两套安装；设置可以选择、手动浏览路径 |
| KataGo 真实分析 | OpenCL 1.16.3 + 本机 b28c512 模型，样例第 10 手，100 visits 配置、实际 111 visits，返回至少三候选 |
| 候选/PV | 桌面点击第二候选真实搜索，显示前五手；返回原局面正常 |
| SDK 工具 → KataGo | 实际调用 `analyze_marker(2)`、`compare_markers(1,2)`、`analyze_variation(2)`，验证 Evidence 数字和 PV 起点 |
| 自由点 | UI 点击中央空点生成 Marker 1，后端映射 K10；服务测试另选空点并调用真实引擎 |
| 分析缓存 | 同一局面第二次调用命中缓存 |
| 密钥边界 | GET settings 不返回 Key；Renderer 无 Key 输入；未配置时提问显示明确错误，不产生假讲解 |
| 正常退出 | 桌面关闭后确认该应用两个 python.exe 与 katago.exe PID 均不存在；Renderer 无异常 |
| Python 独立构建 | PyInstaller 构建完成；独立 Core `--help` 可运行，无外部 Python 依赖 |
| Windows 打包 | electron-builder 生成 `release/win-unpacked/LLMgo.exe` |
| 独立桌面包完整验收 | 直接运行打包后的 LLMgo.exe，重验 SGF、361 交点、引擎发现、真实 KataGo、候选数字居中、PV、自由点及保存，全部通过 |
| 独立包退出 | `llmgo-core.exe` 与 `katago.exe` 均退出，Renderer 无异常 |

## 尚未执行的真实外部验证

- GPT API：用户要求接好配置系统，不硬填密钥；无提供的 API Key，未发送真实 OpenAI 请求。
- GPT 自主选择工具并生成教学回答：同上，待配置 Key 后执行。已经验证的是 SDK 工具到真实 KataGo 的链路，**不能等同于 GPT 完整端到端验收**。
- TensorRT 引擎已发现并可选；本次真实棋力验收使用 OpenCL，没有声称 TensorRT 后端已验证。

运行真实 GPT 与 Agent 验收：设置 `OPENAI_API_KEY`，必要时配置有访问权限的 `OPENAI_MODEL`，运行 `python -m scripts.real_smoke --openai`。默认模型保持 `gpt-5.6`，不作账户可用性保证。

原始验收摘要与截图保存在 `.runtime/real-smoke-report.json`、`.runtime/desktop-smoke/report.json`、`.runtime/desktop-release/report.json` 和同目录 `candidates.png`、`pv.png`。自动化中的原生文件对话框使用固定测试路径返回值；棋谱读取、保存、界面交互、Python 与 KataGo 均是真实执行。
