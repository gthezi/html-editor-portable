# HTML Editor Portable

Windows 本地 HTML 可视化编辑工具。基于 [deckflow/html-editor](https://github.com/deckflow/html-editor)，提供双击启动、桌面快捷方式和资源管理器右键入口。

## 如何安装

适用于 Windows 10/11 x64，需要可访问 Node.js 下载站和 npm 仓库。无需预装 Node.js，也无需管理员权限。

1. 登录 GitHub 。
2. 点击 **Code > Download ZIP**，把压缩包完整解压到一个固定目录；不要在压缩包内直接运行。
3. 双击根目录的 `Setup.cmd`。首次运行会下载便携 Node.js、安装锁定的编辑器依赖、应用本地修复，并建立桌面快捷方式和右键菜单。
4. 通过桌面的 **HTML Editor** 打开工具，或者右键任意 `.html` 文件，选择 **使用 HTML Editor 编辑**。

也可以通过 GitHub CLI 下载：

```powershell
gh auth login
gh repo clone gthezi/html-editor-portable
cd html-editor-portable
.\Setup.cmd
```

第一次安装需要联网。已有运行时和依赖会被复用。

## 日常使用

- 默认服务地址：<http://127.0.0.1:4177>，只绑定本机，不对外提供网络服务。
- 打开单个 HTML 或项目目录后，改动自动保存到原文件；看到 `Saved` 才表示保存成功。
- 保存前备份位于所编辑项目的 `.local-html-editor/backups/`，不在这个工具仓库中。
- 关闭浏览器标签不会停止服务；完全退出请使用 **HTML Editor - Stop** 桌面快捷方式。
- 移动安装目录后，重新运行 `Setup.cmd` 更新快捷方式和右键菜单。
- `Uninstall.cmd` 删除快捷方式和右键入口，不删除工具文件或所编辑的文档。

## 本地修复

`scripts/patch-local.js` 在安装后自动应用两项补丁：

1. 隐藏原生文件选择器启动时出现的控制台窗口。
2. 修复删除或复制组件、修改子元素后使用过期元素定位的问题，避免自动保存失败或重复文字兄弟节点被误删。

编辑器依赖固定为 `@deckflow/html-editor@0.1.8`。补丁保存在仓库里，依赖安装目录无需提交。浏览器中已经打开的旧编辑器页面需要刷新才能加载更新；刷新前请记录尚未保存的改动。

## 仓库内容

本仓库包含启动与停止脚本、安装与卸载脚本、锁定的依赖清单、本地补丁、回归测试和默认示例页。

上游编辑器采用 MIT 许可证；Node.js 和其他依赖保留各自许可证，并在安装时随依赖下载。
