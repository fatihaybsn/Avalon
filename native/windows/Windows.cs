using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public class JarvisWindow { public int pid; public string started; public string exe; public string hwnd; public string title; }
public static class JarvisWindows {
    delegate bool EnumProc(IntPtr h, IntPtr p);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder b, int n);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr h, int n);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [StructLayout(LayoutKind.Sequential)] struct Keyboard {public ushort key,scan;public uint flags,time;public UIntPtr extra;}
    [StructLayout(LayoutKind.Sequential)] struct Mouse {public int x,y;public uint data,flags,time;public UIntPtr extra;}
    [StructLayout(LayoutKind.Explicit)] struct InputUnion {[FieldOffset(0)]public Keyboard keyboard;[FieldOffset(0)]public Mouse mouse;}
    [StructLayout(LayoutKind.Sequential)] struct Input {public uint type;public InputUnion data;}
    [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,Input[] input,int size);
    public static JarvisWindow[] Windows() {
        var list = new List<JarvisWindow>();
        if (!EnumWindows((h,p) => { if (IsWindowVisible(h)) try {
            uint id; GetWindowThreadProcessId(h, out id); using(var proc=Process.GetProcessById((int)id)) {
                var b=new StringBuilder(512); GetWindowText(h,b,b.Capacity);
                list.Add(new JarvisWindow {pid=(int)id,started=proc.StartTime.ToUniversalTime().Ticks.ToString(),exe=proc.MainModule.FileName,hwnd=h.ToInt64().ToString(),title=b.ToString()});
            }
        } catch { /* inaccessible windows are not actionable */ } return true; },IntPtr.Zero)) throw new Exception("EnumWindows failed");
        return list.ToArray();
    }
    public static bool Current(int pid,string started,string exe,long hwnd) {
        var h=new IntPtr(hwnd); uint owner; GetWindowThreadProcessId(h,out owner);
        if (!IsWindow(h) || owner!=pid) return false;
        try { using(var p=Process.GetProcessById(pid)) return p.StartTime.ToUniversalTime().Ticks.ToString()==started && String.Equals(p.MainModule.FileName,exe,StringComparison.OrdinalIgnoreCase); } catch {return false;}
    }
    public static object Act(string action,int pid,string started,string exe,long hwnd) {
        if (!Current(pid,started,exe,hwnd)) throw new Exception("Window identity changed");
        var h=new IntPtr(hwnd);
        if(action=="close") {
            bool sent=PostMessage(h,0x10,IntPtr.Zero,IntPtr.Zero); if(!sent) throw new Exception("WM_CLOSE rejected");
            var end=DateTime.UtcNow.AddSeconds(2); while(Current(pid,started,exe,hwnd) && DateTime.UtcNow<end) Thread.Sleep(40);
            uint owner; GetWindowThreadProcessId(h,out owner);
            // Identity inspection failure alone does not prove a closed window.
            bool closed=!IsWindow(h) || owner!=pid;
            return new {closeRequested=true,windowClosed=closed,confirmed=closed,saveDecisionRequired=!closed,forceKill=false};
        }
        if(action=="minimize") ShowWindowAsync(h,6);
        else if(action=="restore" || action=="focus") ShowWindowAsync(h,9);
        else throw new Exception("Unknown window action");
        Thread.Sleep(100);
        if(!Current(pid,started,exe,hwnd)) throw new Exception("Window changed after show request");
        if(action=="focus") SetForegroundWindow(h);
        bool confirmed=action=="focus" ? GetForegroundWindow()==h : IsIconic(h)==(action=="minimize");
        confirmed=confirmed && Current(pid,started,exe,hwnd);
        return new {requested=action,confirmed};
    }
    public static object Media(string action) {
        var keys=new Dictionary<string,byte>{{"play_pause",0xB3},{"next",0xB0},{"previous",0xB1},{"stop",0xB2}};
        if(!keys.ContainsKey(action)) throw new Exception("Invalid media action");
        var input=new[]{new Input{type=1,data=new InputUnion{keyboard=new Keyboard{key=keys[action]}}},new Input{type=1,data=new InputUnion{keyboard=new Keyboard{key=keys[action],flags=2}}}};
        uint count=SendInput(2,input,Marshal.SizeOf(typeof(Input)));
        return new {requested=action,sent=count==2,inputEvents=count,confirmed=false,scope="active Windows media session; playback unobserved"};
    }
    public static object Audio(string action,double value,bool muted) {
        var e=(IDeviceEnumerator)new DeviceEnumerator(); IDevice d; Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0,1,out d));
        object o; var iid=typeof(IEndpointVolume).GUID; Marshal.ThrowExceptionForHR(d.Activate(ref iid,23,IntPtr.Zero,out o));
        var v=(IEndpointVolume)o; var context=Guid.Empty;
        try {
            if(action=="volume") {if(value<0||value>100)throw new Exception("Volume range"); Marshal.ThrowExceptionForHR(v.SetMasterVolumeLevelScalar((float)value/100,ref context));}
            else if(action=="mute") Marshal.ThrowExceptionForHR(v.SetMute(muted,ref context));
            else if(action!="audio_status") throw new Exception("Audio action");
            float actual; bool m; Marshal.ThrowExceptionForHR(v.GetMasterVolumeLevelScalar(out actual)); Marshal.ThrowExceptionForHR(v.GetMute(out m));
            return new {level=Math.Round(actual*100,2),muted=m,confirmed=action=="audio_status" || (action=="volume" ? Math.Abs(actual*100-value)<1 : m==muted)};
        } finally {Marshal.ReleaseComObject(o);Marshal.ReleaseComObject(d);Marshal.ReleaseComObject(e);}
    }
    [ComImport,Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class DeviceEnumerator {}
    [ComImport,Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IDeviceEnumerator {
        int EnumAudioEndpoints(int flow,uint mask,out IntPtr devices); [PreserveSig]int GetDefaultAudioEndpoint(int flow,int role,out IDevice device);
    }
    [ComImport,Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IDevice {
        [PreserveSig]int Activate(ref Guid iid,uint context,IntPtr activation,[MarshalAs(UnmanagedType.IUnknown)]out object result);
    }
    [ComImport,Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IEndpointVolume {
        int RegisterControlChangeNotify(IntPtr p); int UnregisterControlChangeNotify(IntPtr p); int GetChannelCount(out uint n);
        int SetMasterVolumeLevel(float v,ref Guid c); [PreserveSig]int SetMasterVolumeLevelScalar(float v,ref Guid c); int GetMasterVolumeLevel(out float v);
        [PreserveSig]int GetMasterVolumeLevelScalar(out float v); int SetChannelVolumeLevel(uint n,float v,ref Guid c); int SetChannelVolumeLevelScalar(uint n,float v,ref Guid c);
        int GetChannelVolumeLevel(uint n,out float v); int GetChannelVolumeLevelScalar(uint n,out float v); [PreserveSig]int SetMute([MarshalAs(UnmanagedType.Bool)]bool v,ref Guid c);
        [PreserveSig]int GetMute([MarshalAs(UnmanagedType.Bool)]out bool v);
    }
}
