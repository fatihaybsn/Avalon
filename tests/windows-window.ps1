$ErrorActionPreference='Stop'
Add-Type -Path (Join-Path $PSScriptRoot '../native/windows/Windows.cs')
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class WindowFixture {
    delegate IntPtr Proc(IntPtr h,uint m,IntPtr w,IntPtr l);
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Class {public uint style; public Proc proc;public int clsExtra,wndExtra;public IntPtr instance,icon,cursor,background;public string menu,name;}
    [StructLayout(LayoutKind.Sequential)] struct Message {public IntPtr hwnd;public uint message;public UIntPtr wparam;public IntPtr lparam;public uint time;public int x,y;public uint extra;}
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern ushort RegisterClass(ref Class c);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint ex,string c,string title,uint style,int x,int y,int w,int h,IntPtr parent,IntPtr menu,IntPtr instance,IntPtr p);
    [DllImport("user32.dll")] static extern int GetMessage(out Message m,IntPtr h,uint min,uint max);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref Message m);
    [DllImport("user32.dll")] static extern IntPtr DefWindowProc(IntPtr h,uint m,IntPtr w,IntPtr l);
    [DllImport("user32.dll")] static extern void PostQuitMessage(int exit);
    public static bool holdClose; static Proc callback;
    public static long Start(bool hold) {
        holdClose=hold; long hwnd=0; var ready=new ManualResetEventSlim();
        var thread=new Thread(()=>{
            callback=(h,m,w,l)=>{if(m==0x10&&holdClose)return IntPtr.Zero;if(m==2){PostQuitMessage(0);return IntPtr.Zero;}return DefWindowProc(h,m,w,l);};
            var name="JarvisStage07Fixture"+Guid.NewGuid().ToString("N"); var c=new Class{name=name,proc=callback};
            RegisterClass(ref c);var handle=CreateWindowEx(0,name,"JARVIS stage07 owned test",0x10CF0000,100,100,350,120,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
            hwnd=handle.ToInt64();ready.Set();Message msg;while(GetMessage(out msg,IntPtr.Zero,0,0)>0)DispatchMessage(ref msg);
        });thread.IsBackground=true;thread.SetApartmentState(ApartmentState.STA);thread.Start();
        if(!ready.Wait(3000)||hwnd==0)throw new Exception("Fixture not created");return hwnd;
    }
}
'@
function Check($condition,$message){if(-not $condition){throw $message}}
foreach($hold in @($false,$true)) {
    $handle=[WindowFixture]::Start($hold)
    $w=@([JarvisWindows]::Windows() | Where-Object { $_.hwnd -eq "$handle" })[0]
    Check ($null -ne $w) 'Own fixture window not observed'
    Check (-not [JarvisWindows]::Current($w.pid, '0', $w.exe, $handle)) 'Stale identity accepted'
    $min=[JarvisWindows]::Act('minimize',$w.pid,$w.started,$w.exe,$handle);Check $min.confirmed 'Minimize not observed'
    $restore=[JarvisWindows]::Act('restore',$w.pid,$w.started,$w.exe,$handle);Check $restore.confirmed 'Restore not observed'
    $close=[JarvisWindows]::Act('close',$w.pid,$w.started,$w.exe,$handle)
    Check $close.closeRequested 'WM_CLOSE not sent'
    Check ($close.windowClosed -eq (-not $hold)) 'Requested/closed distinction false'
    if($hold){Check $close.saveDecisionRequired 'Pending save state lost';[WindowFixture]::holdClose=$false;$cleanup=[JarvisWindows]::Act('close',$w.pid,$w.started,$w.exe,$handle);Check $cleanup.windowClosed 'Own fixture cleanup not closed'}
}
@{confirmed=$true;normalClose=$true;pendingCloseDistinct=$true;minimizeRestore=$true;staleIdentityRejected=$true}|ConvertTo-Json -Compress
