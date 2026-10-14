param([Parameter(Mandatory)][string]$ControlDirectory)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Text;
public static class GuiFixture {
 delegate IntPtr Proc(IntPtr h,uint m,IntPtr w,IntPtr l);
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Class {public uint style;public Proc proc;public int clsExtra,wndExtra;public IntPtr instance,icon,cursor,background;public string menu,name;}
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern ushort RegisterClass(ref Class c);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr DefWindowProc(IntPtr h,uint m,IntPtr w,IntPtr l);
 [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h,int mode);
 [StructLayout(LayoutKind.Sequential)] struct Message {public IntPtr hwnd;public uint message;public UIntPtr wparam;public IntPtr lparam;public uint time;public int x,y;public uint extra;}
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint ex,string cls,string name,uint style,int x,int y,int w,int h,IntPtr parent,IntPtr menu,IntPtr instance,IntPtr p);
 [DllImport("user32.dll")] static extern bool PeekMessage(out Message m,IntPtr h,uint min,uint max,uint remove);
 [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref Message m);
 [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr h);
 [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder b,int n);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 public static long window,edit;public static bool stop;static Proc callback;
 public static void Start() {
  var ready=new ManualResetEventSlim();
  var thread=new Thread(()=>{
   callback=(h,m,w,l)=>DefWindowProc(h,m,w,l);var name="JarvisGuiFixture"+Guid.NewGuid().ToString("N");var cls=new Class{name=name,proc=callback};RegisterClass(ref cls);
   var parent=CreateWindowEx(0,name,"JARVIS stage08 owned fixture",0x00CF0000,1400,760,400,180,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
   var child=CreateWindowEx(0,"EDIT","stage08 before",0x50010080,20,45,320,40,parent,new IntPtr(10),IntPtr.Zero,IntPtr.Zero);
   window=parent.ToInt64();edit=child.ToInt64();ShowWindow(parent,4);SetWindowPos(parent,new IntPtr(1),0,0,0,0,0x0013);ready.Set();
   Message msg;while(!stop){while(PeekMessage(out msg,IntPtr.Zero,0,0,1))DispatchMessage(ref msg);Thread.Sleep(15);}DestroyWindow(parent);
  });thread.IsBackground=true;thread.SetApartmentState(ApartmentState.STA);thread.Start();
  if(!ready.Wait(3000)||window==0||edit==0)throw new Exception("GUI fixture creation failed");
 }
 public static string Text(){var b=new StringBuilder(4096);GetWindowText(new IntPtr(edit),b,b.Capacity);return b.ToString();}
}
'@
$foreground=[GuiFixture]::GetForegroundWindow().ToInt64()
[GuiFixture]::Start()
try {
 @{pid=$PID;hwnd=[GuiFixture]::window;edit=[GuiFixture]::edit;foreground=$foreground}|ConvertTo-Json -Compress|Set-Content -LiteralPath (Join-Path $ControlDirectory 'ready.json')
 $deadline=[DateTime]::UtcNow.AddMinutes(5)
 while(-not (Test-Path -LiteralPath (Join-Path $ControlDirectory 'stop')) -and [DateTime]::UtcNow -lt $deadline) {
  @{text=[GuiFixture]::Text();foreground=[GuiFixture]::GetForegroundWindow().ToInt64()}|ConvertTo-Json -Compress|Set-Content -LiteralPath (Join-Path $ControlDirectory 'state.json')
  Start-Sleep -Milliseconds 100
 }
} finally {[GuiFixture]::stop=$true;Start-Sleep -Milliseconds 100}
