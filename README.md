<h1 align="center">FH6 Vinyl Group Editor</h1>

<p align="center">
  <strong>一个独立于 Forza 游戏运行的桌面版彩绘纹饰编辑器。</strong>
</p>

<p align="center">
  <a href="README.md">中文</a> ·
  <a href="README.en.md">English</a>
</p>

<p align="center">
  <code>v1.0.0</code> · <code>Windows</code> · <code>Forza Horizon 6</code> · <code>单文件 EXE</code> · <code>五语言界面</code>
</p>


一个跑在本地的 **SVG 矢量编辑器**，专门为 **Forza Horizon 彩绘（Vinyl / Livery）** 的绘制流程设计。
本项目旨在绕过 FH6 笨拙的内置编辑器，使用更强大的桌面级编辑软件改善体验。利用 FH6 Vinyl Group Editor，你可以像设计师一样进行高精度排版、临摹和图层管理，并注入到游戏存档中。

**Electron + 原生 JavaScript（无前端框架）**，界面支持 **中 / 繁 / 英 / 日 / 韩** 五种语言。

## 核心特性

- **素材库** —— 编辑模板内置了高度精确的符号库，包含了《极限竞速：地平线 6》中全部 1400 种基础几何元素。
- **彩绘纹饰分组导入 / 导出** —— 支持从 FH6 存档导出为可编辑 SVG。（仅支持导出自己创建的彩绘纹饰分组）
- **完整的矢量编辑支持** —— 支持图形选择、着色、缩放、旋转、倾斜、透明度调整及图层层级排序，操作手感与 Forza Horizon 6 完全一致，并添加了巨量 Forza Horizon 6 没有的独有功能，使创作更容易。
- **便于临摹** —— 支持直接在底层垫入高清 PNG/JPG 位图用于描边临摹，手绘痛车党必备。注入工具会自动过滤辅助图层，并在制作途中可以随时调整底图 / 图层透明度，并配备取色器。
- **与 Forza Horizon 6 部分一致的快捷键与相关功能设计**，并支持自定义快捷键。
- **保存工作进程** —— 中断制作后保存工作进程，下次打开此工作进程软件可直接接着上次中断的步骤继续操作。
- **恢复工作进程** —— 因意外情况中断制作，可回退曾经自动保存的进程。
- 此软件以 F3ankk 开源的 **Inkscape2Forza** 核心功能为基础创建，并对其功能进行了优化。

## 启动工具

请在 **release 页面**下载最新的 `FH6 Vinyl Group Editor.exe`，双击运行即可。

**无需安装任何运行环境** —— exe 已自带所需的全部组件（Windows 10/11 直接双击即可，不需要 Node.js、Python 或任何其它依赖）。

> 只有当你打算**从源码运行或自行构建**时，才需要安装 Node.js 18+（推荐 22）。普通用户下载 exe 就行。

## 使用工作流指南

### 1. 画布与编辑

在主页中，点击**新建**可进入初始编辑画面。彩绘纹饰形状放置在右边，拖入画布即可使用。

![新建后进入编辑画面](img/01-new-canvas.png)

点击目标图层选中 / 点击 `Enter` 后，即可显示功能栏。

![选中图层后的功能栏](img/02-selected-toolbar.png)

其余按键详细功能介绍，请找到软件内「**？**」按键并**右键**（右键！右键！！右键！！！），即可进入帮助模式。点击对应需要查看功能的按键即可。（左侧图层栏 / 画布均可点击），**左键**「？」按键则是快捷键介绍。

<table>
  <tr>
    <td align="center" width="50%">
      <img src="img/03-help-mode.png" alt="右键「？」进入帮助模式"><br>
      <strong>右键「？」进入帮助模式</strong>
    </td>
    <td align="center" width="50%">
      <img src="img/04-help-canvas.png" alt="右键「？」进入帮助模式"><br>
      <strong>右键「？」进入帮助模式</strong>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="img/16-help-mode-2.png" alt="右键「？」进入帮助模式"><br>
      <strong>右键「？」进入帮助模式</strong>
    </td>
  </tr>
</table>

### 2. 图层系统

通过在软件内**右键**「？」按键并点击左侧图层栏 / 功能栏 / 画布查看相关功能与操作。

![图层系统](img/05-layer-panel.png)

### 3. 图层编辑系统

从左侧功能栏 / 选中图层后双击 `Enter` / 鼠标双击图层，可进入该图层的编辑操作。
相关详细功能请左键 / 右键点击软件内「？」按键。

![图层编辑](img/06-layer-edit.png)

### 4. 使用辅助底图进行临摹

你可以将真实照片、ACG 图片或 Logo 的 PNG/JPG 文件拖入 FH6 Vinyl Group Editor 作为底层参考图片。
一切非符号库元素都会在导入时被忽略，**不会写入游戏存档**。

![辅助底图临摹](img/07-reference-image.png)

### 5. 工作进程

- **`.svework` 工作进程** —— 把「图案 + 背景图 + 历史颜色」一起存下来，下次打开时可继续保存时的步骤进行制作。
- **自动保存** —— 每 10 分钟自动落一个历史工作进程，最多保留 20 个，遇到意外情况可回溯。

![工作进程](img/08-work-session.png)

## 存档注入与游戏内刷新

完成编辑后，请按照以下步骤将涂装注入游戏存档：

**1. 游戏内占位准备**
打开 FH6 彩绘纹饰分组编辑器并新建或选择任意分组即可（FH6 中一个分组最少需要包含 2 个图形）。待注入分组不再需要与 SVG 有效图层数相同的层数，占位图形也不再要求是白色圆形；任何颜色、任何图形、任何原有层数均可。

![游戏内占位](img/09-inject-placeholder.jpg)

**2. 保存占位符**
给它取一个简单易记的名字，并确保共享选项为**私密**（在共享页面时退出)，然后退出彩绘纹饰分组编辑器。（可以不退游戏，但是最好退出编辑器）。

**3. 定位存档目录**
首先确定你正在操作的存档是否正确（大部分人只登陆了一个账号，只有一个存档，但是对于帮人代打或者有小号这种情况，电脑上会有多套 FH6 存档，请一定多加注意），然后选择"将SVG导入存档"：

<table>
  <tr>
    <td align="center" width="50%">
      <img src="img/11-inject-menu.png" alt="将 SVG 导入存档"><br>
      <strong>将SVG导入存档</strong>
    </td>
    <td align="center" width="50%">
      <img src="img/12-inject-pick-svg.png" alt="选择 SVG 文件"><br>
      <strong>选择刚刚保存的svg文件/导入svg文件</strong>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="img/13-inject-pick-group.png" alt="选择彩绘纹饰分组"><br>
      <strong>然后选择需要导入的存档中的彩绘纹饰分组</strong>
    </td>
  </tr>
</table>

**4. 游戏内刷新（可选）**
注入成功后，回到游戏内，打开该分组，并重新覆盖保存以刷新缓存与缩略图。

## 从 Geometrize / Vinylizer JSON 生成 SVG 模板

本软件可从 Geometrize（forza-painter-fh6）和 Vinylizer 导出的 JSON 生成 SVG 文件。要从 Vinylizer JSON 生成 SVG，请选择"从 Vinylizer JSON 生成 SVG"。

![从 Vinylizer JSON 生成 SVG](img/14-vinylizer-json.png)

经测试，Vinylizer 经常会把一些图层优化到完全透明，这种图层放在彩绘纹饰分组里完全是浪费图层。因此本工具在从 Vinylizer JSON 生成 SVG 时提供了一个**不透明度阈值**设置项：导入时会忽略不透明度小于等于此阈值的图层。

由于忽略一些半透明图层可能会影响视觉效果，以及将不透明度阈值提升到 2-5 其实并不会节省更多的图层，因此正常情况下或者你不知道自己在干什么时，请保持此数值为 **0** —— 工具将只会过滤完全透明的图层。

![不透明度阈值](img/15-opacity-threshold.png)



## 更新说明

### v1.2.0

- 添加了分组内编辑功能
- 主题配色从 2 套扩展至 8 套，并支持自定义主题

### v1.1.0

- 优化了 UI 界面
- 优化了部分功能
- 添加了批量存档注入、存档导出功能

## 鸣谢

本项目的灵感与底层资源结构解析，完全来源于 **Inkscape2Forza** 项目。

感谢 **F3ankk** 对此项目相关疑难解答。

在此向原作者及开源社区表达最诚挚的感谢！

## 免责声明

请仔细阅读以下条款，**使用本工具即代表您同意自行承担所有风险**：

- **业余项目** —— 本项目属于业余探索，可能包含未知 Bug，更新随缘。
- **账号风险警告** —— 修改本地存档违反微软 / Xbox / FH6 用户条款，可能导致账号封禁或设备封锁。作者不承担任何后果。
