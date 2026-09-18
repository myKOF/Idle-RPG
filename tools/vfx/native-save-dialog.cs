// native-save-dialog.cs - VFX Editor Save As / Rename dialog (IFileDialog).
// Compiled by the PowerShell script in tools/vfx/save-as-dialog.cjs (Add-Type -Path, per dialog).
// Same Windows Save dialog as WinForms SaveFileDialog, plus: select the preset that is open in the
// editor and scroll it into view, so the user does not have to hunt for it among ~200 names.
// Selecting it also puts its name in the file-name box (Windows does that for any selection; the box
// cannot be written back once the dialog is shown - it is not a classic control on Windows 11).
// ASCII only: Windows PowerShell 5.1 reads this file with the ANSI code page.

using System;
using System.Runtime.InteropServices;

namespace VfxEditor {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct FilterSpec {
    [MarshalAs(UnmanagedType.LPWStr)] public string Name;
    [MarshalAs(UnmanagedType.LPWStr)] public string Spec;
  }

  [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IShellItem {
    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
    void GetParent(out IShellItem ppsi);
    void GetDisplayName(uint sigdnName, out IntPtr ppszName);
    void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
    void Compare(IShellItem psi, uint hint, out int piOrder);
  }

  [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IFileDialog {
    [PreserveSig] int Show(IntPtr parent);
    void SetFileTypes(uint cFileTypes, [MarshalAs(UnmanagedType.LPArray)] FilterSpec[] rgFilterSpec);
    void SetFileTypeIndex(uint iFileType);
    void GetFileTypeIndex(out uint piFileType);
    void Advise(IFileDialogEvents pfde, out uint pdwCookie);
    void Unadvise(uint dwCookie);
    void SetOptions(uint fos);
    void GetOptions(out uint pfos);
    void SetDefaultFolder(IShellItem psi);
    void SetFolder(IShellItem psi);
    void GetFolder(out IShellItem ppsi);
    [PreserveSig] int GetCurrentSelection(out IShellItem ppsi);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
    void GetResult(out IShellItem ppsi);
    void AddPlace(IShellItem psi, int fdap);
    void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
    void Close(int hr);
    void SetClientGuid(ref Guid guid);
    void ClearClientData();
    void SetFilter(IntPtr pFilter);
  }

  [ComImport, Guid("973510db-7d7f-452b-8975-74a85828d354"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IFileDialogEvents {
    [PreserveSig] int OnFileOk(IFileDialog pfd);
    [PreserveSig] int OnFolderChanging(IFileDialog pfd, IShellItem psiFolder);
    [PreserveSig] int OnFolderChange(IFileDialog pfd);
    [PreserveSig] int OnSelectionChange(IFileDialog pfd);
    [PreserveSig] int OnShareViolation(IFileDialog pfd, IShellItem psi, out int pResponse);
    [PreserveSig] int OnTypeChange(IFileDialog pfd);
    [PreserveSig] int OnOverwrite(IFileDialog pfd, IShellItem psi, out int pResponse);
  }

  [ComImport, Guid("6d5140c1-7436-11ce-8034-00aa006009fa"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IComServiceProvider {
    [PreserveSig] int QueryService(ref Guid guidService, ref Guid riid, out IntPtr ppvObject);
  }

  // Only QueryActiveShellView / SelectItem are called; the other slots keep the vtable order.
  [ComImport, Guid("000214E2-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IShellBrowser {
    void GetWindow(out IntPtr phwnd);
    void ContextSensitiveHelp(int fEnterMode);
    void InsertMenusSB(IntPtr a, IntPtr b);
    void SetMenuSB(IntPtr a, IntPtr b, IntPtr c);
    void RemoveMenusSB(IntPtr a);
    void SetStatusTextSB(IntPtr a);
    void EnableModelessSB(int a);
    void TranslateAcceleratorSB(IntPtr a, ushort b);
    void BrowseObject(IntPtr a, uint b);
    void GetViewStateStream(uint a, out IntPtr b);
    void GetControlWindow(uint a, out IntPtr b);
    void SendControlMsg(uint a, uint b, IntPtr c, IntPtr d, out IntPtr e);
    [PreserveSig] int QueryActiveShellView(out IShellView ppshv);
    void OnViewWindowActive(IShellView a);
    void SetToolbarItems(IntPtr a, uint b, uint c);
  }

  [ComImport, Guid("000214E3-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IShellView {
    void GetWindow(out IntPtr phwnd);
    void ContextSensitiveHelp(int fEnterMode);
    void TranslateAccelerator(IntPtr a);
    void EnableModeless(int a);
    void UIActivate(uint a);
    void Refresh();
    void CreateViewWindow(IntPtr a, IntPtr b, IntPtr c, IntPtr d, out IntPtr e);
    void DestroyViewWindow();
    void GetCurrentInfo(IntPtr a);
    void AddPropertySheetPages(uint a, IntPtr b, IntPtr c);
    void SaveViewState();
    [PreserveSig] int SelectItem(IntPtr pidlItem, uint uFlags);
    void GetItemObject(uint a, ref Guid b, out IntPtr c);
  }

  [ComImport, Guid("00000114-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IOleWindow {
    void GetWindow(out IntPtr phwnd);
    void ContextSensitiveHelp(int fEnterMode);
  }

  public static class ShellNative {
    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    public static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, ref Guid riid, out IShellItem ppv);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    public static extern int SHParseDisplayName(string name, IntPtr pbc, out IntPtr ppidl, uint sfgaoIn, out uint psfgaoOut);
    [DllImport("shell32.dll")]
    public static extern IntPtr ILFindLastID(IntPtr pidl);
  }

  [ComVisible(true)]
  public class NativeSaveDialog : IFileDialogEvents {
    const uint SIGDN_FILESYSPATH = 0x80058000;
    const uint SIGDN_PARENTRELATIVEPARSING = 0x80018001;
    // SVSI_SELECT | SVSI_DESELECTOTHERS | SVSI_ENSUREVISIBLE | SVSI_FOCUSED
    const uint SELECT_FLAGS = 0x1D;
    const int ERROR_CANCELLED_HR = unchecked((int)0x800704C7);
    const int E_NOTIMPL = unchecked((int)0x80004001);
    static readonly string NL = ((char)10).ToString();

    IFileDialog dlg;
    IntPtr absPidl = IntPtr.Zero;
    IntPtr childPidl = IntPtr.Zero;
    string selectName = "";
    bool probe;
    System.Windows.Forms.Timer timer;
    System.Windows.Forms.Timer guard;
    int tries;
    string selected = "";
    string nameAfter = "";
    string trace = "";

    // overwritePrompt: Save As may replace an existing preset (Windows asks "replace?"); Rename never does.
    // probe: manual test only - select, restore the name, report, and close the dialog by itself.
    public static string Run(IntPtr owner, string title, string dir, string fileName, string selectName,
        bool overwritePrompt, bool probe) {
      NativeSaveDialog sd = new NativeSaveDialog();
      return sd.RunDialog(owner, title, dir, fileName, selectName, overwritePrompt, probe);
    }

    string RunDialog(IntPtr owner, string title, string dir, string fileName, string select,
        bool overwritePrompt, bool probeMode) {
      probe = probeMode;
      dlg = (IFileDialog)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("C0B4E2F3-BA21-4773-8DBA-335EC946EB8B")));
      uint opts;
      dlg.GetOptions(out opts);
      // FOS_OVERWRITEPROMPT only for Save As; FOS_NOCHANGEDIR | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST
      opts = (opts & ~0x2u) | (overwritePrompt ? 0x2u : 0u) | 0x8u | 0x40u | 0x800u;
      dlg.SetOptions(opts);
      dlg.SetTitle(title ?? "");
      FilterSpec spec = new FilterSpec();
      spec.Name = "VFX Preset (*.json)";
      spec.Spec = "*.json";
      dlg.SetFileTypes(1, new FilterSpec[] { spec });
      dlg.SetDefaultExtension("json");
      Guid iidItem = typeof(IShellItem).GUID;
      IShellItem folder;
      ShellNative.SHCreateItemFromParsingName(dir, IntPtr.Zero, ref iidItem, out folder);
      dlg.SetFolder(folder);
      dlg.SetFileName(fileName ?? "");
      if (!string.IsNullOrEmpty(select) && System.IO.File.Exists(System.IO.Path.Combine(dir, select))) {
        uint attrs;
        if (ShellNative.SHParseDisplayName(System.IO.Path.Combine(dir, select), IntPtr.Zero, out absPidl, 0, out attrs) == 0) {
          childPidl = ShellNative.ILFindLastID(absPidl);
          selectName = select;
        }
      }
      uint cookie;
      dlg.Advise(this, out cookie);
      // Started before Show: the modal loop pumps this thread's messages, so the timer keeps ticking
      // while the dialog is open. Probe mode (manual test) always starts it so the dialog closes itself.
      if (childPidl != IntPtr.Zero || probe) {
        timer = new System.Windows.Forms.Timer();
        timer.Interval = 60;
        timer.Tick += delegate { try { TrySelect(); } catch (Exception ex) { trace += " tick:" + ex.Message; } };
        timer.Start();
      }
      if (probe) {
        // Manual test only: never leave a dialog open on the desktop, whatever happens above.
        guard = new System.Windows.Forms.Timer();
        guard.Interval = 8000;
        guard.Tick += delegate { try { guard.Stop(); trace += " guard"; CloseForProbe(); } catch { } };
        guard.Start();
      }
      int hr;
      try { hr = dlg.Show(owner); }
      finally {
        try { dlg.Unadvise(cookie); } catch { }
        if (timer != null) { timer.Stop(); timer.Dispose(); }
        if (guard != null) { guard.Stop(); guard.Dispose(); }
        if (absPidl != IntPtr.Zero) Marshal.FreeCoTaskMem(absPidl);
      }
      if (probe) return "PROBE" + NL + selected + NL + nameAfter + NL + trace;
      if (hr != 0) return "CANCEL";
      IShellItem item;
      dlg.GetResult(out item);
      IntPtr p;
      item.GetDisplayName(SIGDN_FILESYSPATH, out p);
      string path = Marshal.PtrToStringUni(p);
      Marshal.FreeCoTaskMem(p);
      return "OK" + NL + path;
    }

    // The file list fills in asynchronously after the dialog opens: retry until the item can be selected.
    void TrySelect() {
      tries++;
      bool done = false;
      try {
        if (childPidl == IntPtr.Zero) throw new InvalidOperationException("nothing to select");
        IComServiceProvider sp = (IComServiceProvider)dlg;
        Guid sid = new Guid("4C96BE40-915C-11CF-99D3-00AA004AE837");
        Guid iid = typeof(IShellBrowser).GUID;
        IntPtr pb;
        int qs = sp.QueryService(ref sid, ref iid, out pb);
        if (qs == 0 && pb != IntPtr.Zero) {
          IShellBrowser browser = (IShellBrowser)Marshal.GetObjectForIUnknown(pb);
          Marshal.Release(pb);
          IShellView view;
          if (browser.QueryActiveShellView(out view) == 0 && view != null && view.SelectItem(childPidl, SELECT_FLAGS) == 0) {
            IShellItem cur;
            if (dlg.GetCurrentSelection(out cur) == 0 && cur != null) {
              IntPtr n;
              cur.GetDisplayName(SIGDN_PARENTRELATIVEPARSING, out n);
              selected = Marshal.PtrToStringUni(n);
              Marshal.FreeCoTaskMem(n);
              done = string.Equals(selected, selectName, StringComparison.OrdinalIgnoreCase);
            }
          }
        }
        trace = tries.ToString() + ":qs=" + qs.ToString("X") + " sel=" + selected;
      } catch (Exception ex) { trace = tries.ToString() + ":" + ex.Message; }
      if (done || tries >= 60) Finish();
    }

    // Nothing here may throw: an exception escaping a WinForms timer tick pops a blocking error box.
    void Finish() {
      try { timer.Stop(); } catch { }
      if (probe) CloseForProbe();
    }

    void CloseForProbe() {
      try { string after; dlg.GetFileName(out after); nameAfter = after ?? ""; } catch { }
      // IFileDialog.Close does not close the dialog when called from a timer; close its window instead.
      try {
        IntPtr hwnd;
        ((IOleWindow)dlg).GetWindow(out hwnd);
        ShellNative.PostMessage(hwnd, 0x0010, IntPtr.Zero, IntPtr.Zero);
      } catch (Exception ex) { trace += " close:" + ex.Message; }
    }

    public int OnFileOk(IFileDialog pfd) { return 0; }
    public int OnFolderChanging(IFileDialog pfd, IShellItem psiFolder) { return 0; }
    public int OnFolderChange(IFileDialog pfd) { return 0; }
    public int OnSelectionChange(IFileDialog pfd) { return 0; }
    public int OnShareViolation(IFileDialog pfd, IShellItem psi, out int pResponse) { pResponse = 0; return E_NOTIMPL; }
    public int OnTypeChange(IFileDialog pfd) { return 0; }
    public int OnOverwrite(IFileDialog pfd, IShellItem psi, out int pResponse) { pResponse = 0; return E_NOTIMPL; }
  }
}
