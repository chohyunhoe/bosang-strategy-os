using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

namespace BSO {
    // Use the Unicode Shell Link interface explicitly. WScript.Shell can reject
    // non-ANSI target paths on Windows installations with a different code page.
    [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
    internal class ShellLinkObject { }

    [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IShellLinkW {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size, IntPtr findData, uint flags);
        void GetIDList(out IntPtr idList);
        void SetIDList(IntPtr idList);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder description, int size);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string description);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder directory, int size);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string directory);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder arguments, int size);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string arguments);
        void GetHotkey(out short hotkey);
        void SetHotkey(short hotkey);
        void GetShowCmd(out int showCommand);
        void SetShowCmd(int showCommand);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size, out int index);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
        void Resolve(IntPtr window, uint flags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
    }

    public sealed class ShortcutInfo {
        public string TargetPath { get; set; }
        public string WorkingDirectory { get; set; }
        public string Description { get; set; }
        public string Arguments { get; set; }
    }

    public static class WindowsShortcut {
        public static void Write(string file, string target, string directory, string description) {
            object instance = new ShellLinkObject();
            try {
                IShellLinkW link = (IShellLinkW)instance;
                link.SetPath(Path.GetFullPath(target));
                link.SetWorkingDirectory(Path.GetFullPath(directory));
                link.SetDescription(description);
                link.SetArguments("");
                link.SetShowCmd(1);
                ((IPersistFile)instance).Save(Path.GetFullPath(file), true);
            } finally { Marshal.FinalReleaseComObject(instance); }
        }

        public static ShortcutInfo Read(string file) {
            object instance = new ShellLinkObject();
            try {
                ((IPersistFile)instance).Load(Path.GetFullPath(file), 0);
                IShellLinkW link = (IShellLinkW)instance;
                StringBuilder target = new StringBuilder(32768), directory = new StringBuilder(32768);
                StringBuilder description = new StringBuilder(1024), arguments = new StringBuilder(32768);
                link.GetPath(target, target.Capacity, IntPtr.Zero, 4);
                link.GetWorkingDirectory(directory, directory.Capacity);
                link.GetDescription(description, description.Capacity);
                link.GetArguments(arguments, arguments.Capacity);
                return new ShortcutInfo { TargetPath = target.ToString(), WorkingDirectory = directory.ToString(), Description = description.ToString(), Arguments = arguments.ToString() };
            } finally { Marshal.FinalReleaseComObject(instance); }
        }
    }
}
