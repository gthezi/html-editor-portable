Option Explicit
Dim text, sh
If WScript.Arguments.Count > 0 Then
  text = WScript.Arguments(0)
Else
  text = "HTML Editor"
End If
Set sh = CreateObject("WScript.Shell")
' Auto-closing notice so it never blocks the desktop.
sh.Popup text, 8, "HTML Editor", 64
