Option Explicit
Dim fso, sh, tool, node, launcher, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")
tool = fso.GetParentFolderName(WScript.ScriptFullName)
node = tool & "\node\node.exe"
launcher = tool & "\launcher.js"
If Not fso.FileExists(node) Then
  MsgBox "HTML Editor is not set up yet." & vbCrLf & vbCrLf & _
         "Please double-click Setup.cmd in:" & vbCrLf & tool, 48, "HTML Editor"
  WScript.Quit 1
End If
cmd = """" & node & """ """ & launcher & """"
sh.CurrentDirectory = tool
sh.Run cmd, 0, False
