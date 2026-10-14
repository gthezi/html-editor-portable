Option Explicit
Dim fso, sh, tool, node, stopper, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")
tool = fso.GetParentFolderName(WScript.ScriptFullName)
node = tool & "\node\node.exe"
stopper = tool & "\stopper.js"
If Not fso.FileExists(node) Then
  MsgBox "HTML Editor has no runtime to stop.", 48, "HTML Editor"
  WScript.Quit 1
End If
cmd = """" & node & """ """ & stopper & """"
sh.CurrentDirectory = tool
sh.Run cmd, 0, False
