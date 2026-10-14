using System;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

// One native operation, no DeleteFile/Directory, SHFileOperation or fallback.
public static class JarvisRecycle {
    [StructLayout(LayoutKind.Sequential)] struct FileInfo {public uint attrs,createdLow,createdHigh,accessLow,accessHigh,writeLow,writeHigh,volume,sizeHigh,sizeLow,links,indexHigh,indexLow;}
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFile(string p,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out FileInfo info);
    static void CheckCurrentTree(string root) {
        var pending=new System.Collections.Generic.Stack<string>();pending.Push(root);int count=0;
        while(pending.Count>0) {
            var path=pending.Pop();if(++count>10000)throw new Exception("Native tree inspection budget exceeded");
            if(System.Text.RegularExpressions.Regex.IsMatch(path,@"(?i)(^|\\)(\$Recycle\.Bin|\.jarvis-undo|\.git|\.openclaw[^\\]*|\.codex|\.ssh|Windows|Program Files[^\\]*|ProgramData|AppData|AGENTS\.md|\.env[^\\]*|credentials[^\\]*|auth-profiles\.json|[^\\]*\.(pem|key|pfx|p12))(\\|$)"))throw new Exception("Protected native descendant");
            var attrs=File.GetAttributes(path);if((attrs&FileAttributes.ReparsePoint)!=0)throw new Exception("Native reparse target forbidden");
            using(var h=CreateFile(path,0,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero)) {
                FileInfo info;if(h.IsInvalid||!GetFileInformationByHandle(h,out info)||info.links>1)throw new Exception("Native file/link identity unavailable");
            }
            if((attrs&FileAttributes.Directory)!=0)foreach(var child in Directory.EnumerateFileSystemEntries(path))pending.Push(child);
        }
        var parent=Directory.GetParent(root);while(parent!=null){if((parent.Attributes&FileAttributes.ReparsePoint)!=0)throw new Exception("Native reparse ancestor forbidden");parent=parent.Parent;}
    }
    [StructLayout(LayoutKind.Sequential)] struct BinInfo {public uint cbSize; public long size; public long items;}
    [DllImport("shell32.dll",CharSet=CharSet.Unicode)] static extern int SHQueryRecycleBin(string root,ref BinInfo info);
    public static long Used(string root) {var info=new BinInfo{cbSize=(uint)Marshal.SizeOf(typeof(BinInfo))};return SHQueryRecycleBin(root,ref info)==0?info.size:-1;}
    [DllImport("shell32.dll",CharSet=CharSet.Unicode,PreserveSig=true)] static extern int SHCreateItemFromParsingName(string p,IntPtr bind,ref Guid iid,out IShellItem item);
    public static object Run(string path) {
        CheckCurrentTree(path);
        var sink=new Sink{root=Path.GetFullPath(path)}; var op=(IFileOperation)new FileOperation(); IShellItem item=null;
        try {
            var iid=typeof(IShellItem).GUID; Marshal.ThrowExceptionForHR(SHCreateItemFromParsingName(path,IntPtr.Zero,ref iid,out item));
            // RECYCLEONDELETE, undo, early failure, no error/progress UI; no elevation.
            Marshal.ThrowExceptionForHR(op.SetOperationFlags(0x00080000|0x20000000|0x00100000|0x400|0x4|0x2000));
            Marshal.ThrowExceptionForHR(op.DeleteItem(item,sink));
            int hr=op.PerformOperations(); bool aborted; int status=op.GetAnyOperationsAborted(out aborted);
            bool confirmed=hr==0 && status==0 && !aborted && sink.hr>=0 && sink.destination!=null && sink.destination.IndexOf("\\$Recycle.Bin\\",StringComparison.OrdinalIgnoreCase)>0 && (File.Exists(sink.destination)||Directory.Exists(sink.destination));
            return new {recycled=confirmed,confirmed,aborted,hresult=hr,itemHresult=sink.hr,preFlags=sink.preFlags,postFlags=sink.postFlags,recycleItem=sink.destination,sourceMissing=!File.Exists(path)&&!Directory.Exists(path),retryAllowed=false};
        } finally {if(item!=null)Marshal.ReleaseComObject(item);Marshal.ReleaseComObject(op);}
    }
    [ComImport,Guid("3AD05575-8857-4850-9277-11B85BDB8E09")] class FileOperation {}
    [ComImport,Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] public interface IShellItem {
        [PreserveSig]int BindToHandler(IntPtr p,ref Guid bhid,ref Guid iid,out IntPtr result);
        [PreserveSig]int GetParent(out IShellItem parent);
        [PreserveSig]int GetDisplayName(uint sigdn,out IntPtr name);
        [PreserveSig]int GetAttributes(uint mask,out uint attrs);
        [PreserveSig]int Compare(IShellItem other,uint hint,out int order);
    }
    [ComImport,Guid("947AAB5F-0A5C-4C13-B4D6-4BF7836FC9F8"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IFileOperation {
        [PreserveSig]int Advise(IFileOperationProgressSink s,out uint cookie); [PreserveSig]int Unadvise(uint cookie);
        [PreserveSig]int SetOperationFlags(uint flags); [PreserveSig]int SetProgressMessage([MarshalAs(UnmanagedType.LPWStr)]string m);
        [PreserveSig]int SetProgressDialog(IntPtr p); [PreserveSig]int SetProperties(IntPtr p); [PreserveSig]int SetOwnerWindow(uint h);
        [PreserveSig]int ApplyPropertiesToItem(IShellItem item); [PreserveSig]int ApplyPropertiesToItems(IntPtr items);
        [PreserveSig]int RenameItem(IShellItem item,[MarshalAs(UnmanagedType.LPWStr)]string name,IFileOperationProgressSink s); [PreserveSig]int RenameItems(IntPtr items,[MarshalAs(UnmanagedType.LPWStr)]string name);
        [PreserveSig]int MoveItem(IShellItem item,IShellItem folder,[MarshalAs(UnmanagedType.LPWStr)]string name,IFileOperationProgressSink s); [PreserveSig]int MoveItems(IntPtr items,IShellItem folder);
        [PreserveSig]int CopyItem(IShellItem item,IShellItem folder,[MarshalAs(UnmanagedType.LPWStr)]string name,IFileOperationProgressSink s); [PreserveSig]int CopyItems(IntPtr items,IShellItem folder);
        [PreserveSig]int DeleteItem(IShellItem item,IFileOperationProgressSink s); [PreserveSig]int DeleteItems(IntPtr items);
        [PreserveSig]int NewItem(IShellItem folder,uint attrs,[MarshalAs(UnmanagedType.LPWStr)]string name,[MarshalAs(UnmanagedType.LPWStr)]string template,IFileOperationProgressSink s);
        [PreserveSig]int PerformOperations(); [PreserveSig]int GetAnyOperationsAborted([MarshalAs(UnmanagedType.Bool)]out bool aborted);
    }
    [ComVisible(true),Guid("04B0F1A7-9490-44BC-96E1-4296A31252E2"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] public interface IFileOperationProgressSink {
        [PreserveSig]int StartOperations(); [PreserveSig]int FinishOperations(int hr);
        [PreserveSig]int PreRenameItem(uint f,IShellItem item,[MarshalAs(UnmanagedType.LPWStr)]string name); [PreserveSig]int PostRenameItem(uint f,IShellItem item,[MarshalAs(UnmanagedType.LPWStr)]string name,int hr,IShellItem newItem);
        [PreserveSig]int PreMoveItem(uint f,IShellItem item,IShellItem folder,[MarshalAs(UnmanagedType.LPWStr)]string name); [PreserveSig]int PostMoveItem(uint f,IShellItem item,IShellItem folder,[MarshalAs(UnmanagedType.LPWStr)]string name,int hr,IShellItem newItem);
        [PreserveSig]int PreCopyItem(uint f,IShellItem item,IShellItem folder,[MarshalAs(UnmanagedType.LPWStr)]string name); [PreserveSig]int PostCopyItem(uint f,IShellItem item,IShellItem folder,[MarshalAs(UnmanagedType.LPWStr)]string name,int hr,IShellItem newItem);
        [PreserveSig]int PreDeleteItem(uint f,IShellItem item); [PreserveSig]int PostDeleteItem(uint f,IShellItem item,int hr,IShellItem newItem);
        [PreserveSig]int PreNewItem(uint f,IShellItem folder,[MarshalAs(UnmanagedType.LPWStr)]string name); [PreserveSig]int PostNewItem(uint f,IShellItem folder,[MarshalAs(UnmanagedType.LPWStr)]string name,[MarshalAs(UnmanagedType.LPWStr)]string template,uint attrs,int hr,IShellItem newItem);
        [PreserveSig]int UpdateProgress(uint total,uint done); [PreserveSig]int ResetTimer(); [PreserveSig]int PauseTimer(); [PreserveSig]int ResumeTimer();
    }
    [ComVisible(true),ClassInterface(ClassInterfaceType.None)] public class Sink:IFileOperationProgressSink {
        public int hr=unchecked((int)0x80004005); public uint preFlags,postFlags; public string destination,root;
        public int StartOperations(){return 0;} public int FinishOperations(int h){return 0;}
        public int PreDeleteItem(uint f,IShellItem item){preFlags=f;try{if((f&0x80)==0)throw new Exception("Not recycle");IntPtr p;Marshal.ThrowExceptionForHR(item.GetDisplayName(0x80058000,out p));string source;try{source=Marshal.PtrToStringUni(p);}finally{Marshal.FreeCoTaskMem(p);}if(!String.Equals(source,root,StringComparison.OrdinalIgnoreCase)&&!source.StartsWith(root+"\\",StringComparison.OrdinalIgnoreCase))throw new Exception("Native source changed");CheckCurrentTree(root);return 0;}catch{return unchecked((int)0x80004004);}}
        public int PostDeleteItem(uint f,IShellItem item,int h,IShellItem n){hr=h;postFlags=f;if(h>=0&&n!=null){IntPtr p; if(n.GetDisplayName(0x80058000,out p)==0){try{destination=Marshal.PtrToStringUni(p);}finally{Marshal.FreeCoTaskMem(p);}}}return 0;}
        public int PreRenameItem(uint f,IShellItem i,string n){return 0;} public int PostRenameItem(uint f,IShellItem i,string n,int h,IShellItem v){return 0;}
        public int PreMoveItem(uint f,IShellItem i,IShellItem d,string n){return 0;} public int PostMoveItem(uint f,IShellItem i,IShellItem d,string n,int h,IShellItem v){return 0;}
        public int PreCopyItem(uint f,IShellItem i,IShellItem d,string n){return 0;} public int PostCopyItem(uint f,IShellItem i,IShellItem d,string n,int h,IShellItem v){return 0;}
        public int PreNewItem(uint f,IShellItem d,string n){return 0;} public int PostNewItem(uint f,IShellItem d,string n,string t,uint a,int h,IShellItem v){return 0;}
        public int UpdateProgress(uint t,uint d){return 0;} public int ResetTimer(){return 0;} public int PauseTimer(){return 0;} public int ResumeTimer(){return 0;}
    }
}
