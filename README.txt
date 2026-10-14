HTML Editor - local visual editor for existing HTML files
=========================================================

This folder is a self-contained, portable tool. It runs the open-source
deckflow HTML editor (@deckflow/html-editor) locally and edits your existing
HTML files in place, with automatic backups.

It is fully independent from any project folder. Your research/data repos are
not modified by this tool except for the HTML file you actually open and edit.


Everyday use
------------
Open  : double-click the desktop shortcut "HTML Editor".

Inside the editor, click "Open project" to switch to any HTML file or project
folder on the machine. Editing different projects does not require restarting
the tool.

Autosave, backups, and relative asset paths are handled by the editor:
- changes are written back to the HTML file automatically;
- a backup is written to <project>\.local-html-editor\backups\ before each save;
- opening a single file makes its parent folder the project root, so sibling
  images/CSS/JS keep resolving.

Explorer integration
--------------------
Right-clicking any .html file shows "使用 HTML Editor 编辑". It opens that file
in the editor. The default program for .html files is NOT changed.


Moving to another Windows device
--------------------------------
Copy this whole "HtmlEditor" folder to the new machine (same path or any other
path), then double-click "Setup.cmd" once. Setup will:
- reuse the bundled portable Node runtime (no system install, no admin rights);
- reuse the bundled editor package (no download needed if the folder was copied);
- recreate the desktop shortcuts and the Explorer right-click entry for that
  machine;
- start the editor.

If you copy only part of the tool, Setup.cmd will download the Node runtime and
the editor package for you (internet required).

For a GitHub checkout or Download ZIP, node\ and app\node_modules\ are not
included. Setup.cmd downloads them and applies the local fixes automatically.
See README.md for the public repository download and installation steps.

To remove shortcuts and the context menu on a machine, run "Uninstall.cmd".


Folder layout
-------------
config.json   port, Node version, shortcut names, context-menu label
launcher.js   starts/reuses the background server, opens the browser
stopper.js    stops the background server
start.vbs     hidden launcher used by the desktop shortcut
open.vbs      hidden launcher used by the right-click menu (takes a file path)
stop.vbs      hidden stopper used during uninstall
message.vbs   small auto-closing notice dialog
Setup.cmd     one-click setup for a new device
Uninstall.cmd removes shortcuts + context menu on this device
node\         portable Node.js runtime (created by Setup)
app\          @deckflow/html-editor installation (created by Setup)
workspace\    default start page (welcome.html)
logs\         server.log and launcher.log
.server.pid   pid of the running background server


Notes / known behavior
----------------------
- The local tweak in scripts\patch-local.js adds windowsHide to the editor's
  native file-picker call so no console window flashes when using "Open project".
  File and folder dialogs are promoted to the foreground and topmost only while
  open; no global Windows focus setting is changed.
  It is re-applied automatically by Setup.cmd after any npm install.
- The same patch script fixes stale element targets after component deletion,
  duplication, or child text edits. Regression tests are in scripts\test-delete-save.mjs.
- The editor toolbar can generate a self-contained review copy (*.review.html).
  Recipients can open it in Chrome/Edge without this editor, select text, add
  comments/highlights/suggestions, and download a *.reviewed.html result.
  The right annotation panel can be collapsed with its close button or the
  annotation toggle; drafts and saved comments remain available when reopened.
  Three selectable colors map consistently to author names and survive export.
  The active text range stays highlighted while typing in the annotation panel.
  Existing review files keep their embedded runtime. To upgrade, export pending
  drafts first, open that result in the editor, then generate a new review copy;
  saved comments and author colors are preserved while the runtime is replaced.
- The editor binds to 127.0.0.1 only; nothing is exposed to the network.
- Settings live in config.json (for example change "port" if 4177 is taken).
