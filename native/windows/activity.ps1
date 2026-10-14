param()
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$null=[Console]::In.ReadToEnd()
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class DesktopActivity {
 [StructLayout(LayoutKind.Sequential)] struct LastInput { public uint size,tick; }
 [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LastInput input);
 [DllImport("kernel32.dll")] public static extern uint WTSGetActiveConsoleSessionId();
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 public static uint LastTick(){var value=new LastInput{size=(uint)Marshal.SizeOf(typeof(LastInput))};if(!GetLastInputInfo(ref value))throw new Exception("Input activity unavailable");return value.tick;}
}
'@
$session=[Diagnostics.Process]::GetCurrentProcess().SessionId
$interactive=[Environment]::UserInteractive -and $session -ne 0 -and $session -eq [DesktopActivity]::WTSGetActiveConsoleSessionId()
@{interactive=$interactive;sessionId=$session;lastAnyInputTick=[DesktopActivity]::LastTick();foreground=[DesktopActivity]::GetForegroundWindow().ToInt64();physicalInputDistinguished=$false}|ConvertTo-Json -Compress
