<#
  The Windows side of `npm run testdata:watch` (fixtures/test_data_watch.cjs, which makes every
  decision). It only talks to Windows:
    - the key (Alt+T by default): Windows' own RegisterHotKey, so only that key is seen, in any
      program. With a browser in front the key goes on to the page;
    - copying the selection: saves the file first when asked (Ctrl+S), copies (Ctrl+C), and puts
      the clipboard back as it was;
    - the small window that lists the places and asks the key name, and the notifications.
  Lines of JSON: commands on stdin, events on stdout. -SelfTest registers the key, builds the
  window without showing it, and stops.
#>
param(
  [string]$Hotkey = 'Alt+T',
  [switch]$SelfTest
)
$ErrorActionPreference = 'Stop'

$source = @'
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace TestDataHotkey
{
    public static class Agent
    {
        const int WM_HOTKEY = 0x0312;
        const uint MOD_ALT = 0x1, MOD_CONTROL = 0x2, MOD_SHIFT = 0x4, MOD_WIN = 0x8, MOD_NOREPEAT = 0x4000;
        const ushort VK_SHIFT = 0x10, VK_CONTROL = 0x11, VK_MENU = 0x12, VK_LWIN = 0x5B, VK_RWIN = 0x5C, VK_MASK = 0xE8;
        const uint INPUT_KEYBOARD = 1, KEYEVENTF_KEYUP = 0x2;
        const int ID_KEY = 1, ID_ASK = 2;

        [StructLayout(LayoutKind.Sequential)]
        struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Sequential)]
        struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Explicit)]
        struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
        [StructLayout(LayoutKind.Sequential)]
        struct INPUT { public uint type; public InputUnion u; }

        [DllImport("user32.dll", SetLastError = true)] static extern bool RegisterHotKey(IntPtr window, int id, uint modifiers, uint key);
        [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr window, int id);
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
        [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
        [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
        const int SW_HIDE = 0, SW_SHOWNORMAL = 1;

        class KeyWindow : NativeWindow
        {
            public Action<int> Pressed;
            public KeyWindow() { CreateHandle(new CreateParams()); }
            protected override void WndProc(ref Message message)
            {
                if (message.Msg == WM_HOTKEY && Pressed != null) Pressed(message.WParam.ToInt32());
                base.WndProc(ref message);
            }
        }

        static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        static readonly object OutputLock = new object();
        static readonly string[] Browsers = { "chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "iexplore", "claude" };
        static StreamWriter output;
        static KeyWindow keyWindow;
        static Control ui;
        static NotifyIcon tray;
        static uint modifiers;
        static uint key;
        static bool askRegistered;
        static IntPtr editorWindow = IntPtr.Zero;

        public static int Start(string hotkey, bool selfTest)
        {
            int code = 0;
            Thread thread = new Thread(delegate () { code = Run(hotkey, selfTest); });
            thread.SetApartmentState(ApartmentState.STA);
            thread.Start();
            thread.Join();
            return code;
        }

        static int Run(string hotkey, bool selfTest)
        {
            output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            output.AutoFlush = true;
            try { SetProcessDPIAware(); } catch (Exception) { }
            Application.EnableVisualStyles();
            string problem = ParseHotkey(hotkey, out modifiers, out key);
            if (problem != null) { Emit(Event("error", "fatal", true, "message", problem)); return 2; }
            ui = new Control();
            IntPtr made = ui.Handle;
            keyWindow = new KeyWindow();
            keyWindow.Pressed = OnKey;
            // Started hidden (node's windowsHide), Windows applies "hidden" to the FIRST window this
            // process shows - which would be the small window, invisible. Spent here, on a window
            // that stays hidden anyway.
            ShowWindow(keyWindow.Handle, SW_HIDE);
            if (!Register())
            {
                Emit(Event("error", "fatal", true, "message", hotkey + " is taken by another program. Pick another key: npm run testdata:watch -- --hotkey Ctrl+Alt+T"));
                return 3;
            }
            if (selfTest)
            {
                TextBox box;
                CheckedListBox list;
                Dictionary<string, object> sample = new Dictionary<string, object>();
                sample["message"] = "Make \"Greensboro, NC\" test data in Flow_06.spec.js.";
                sample["needKey"] = true;
                sample["key"] = "pickupLocation";
                sample["note"] = "note";
                sample["error"] = "";
                sample["places"] = new ArrayList(new object[] { "Line 50: page.getByText('Greensboro, NC')", "Line 74: page.getByText('Greensboro, NC')" });
                sample["checked"] = new ArrayList(new object[] { true, false });
                sample["button"] = "Make test data";
                bool built;
                using (Form form = BuildWindow(sample, out box, out list))
                {
                    built = box != null && list != null && list.Items.Count == 2 && list.GetItemChecked(0) && !list.GetItemChecked(1) && box.Text == "pickupLocation";
                }
                Unregister();
                Emit(Event("selftest", "hotkey", hotkey, "registered", true, "askRegistered", askRegistered, "window", built));
                return built ? 0 : 4;
            }
            tray = new NotifyIcon();
            tray.Icon = SystemIcons.Information;
            string tip = "Test data: " + hotkey + " (npm run testdata:watch)";
            tray.Text = tip.Length > 63 ? tip.Substring(0, 63) : tip;
            tray.Visible = true;
            Thread reader = new Thread(ReadCommands);
            reader.IsBackground = true;
            reader.Start();
            Emit(Event("ready", "hotkey", hotkey, "askHotkey", askRegistered ? AskLabel(hotkey) : null));
            Application.Run();
            Unregister();
            tray.Visible = false;
            tray.Dispose();
            return 0;
        }

        static string AskLabel(string hotkey)
        {
            int plus = hotkey.LastIndexOf('+');
            return hotkey.Substring(0, plus) + "+Shift" + hotkey.Substring(plus);
        }

        static string ParseHotkey(string text, out uint mods, out uint vk)
        {
            mods = 0;
            vk = 0;
            string[] parts = (text ?? "").Split('+');
            if (parts.Length < 2) return "The key needs a modifier and a key, like Alt+T or Ctrl+Alt+T: " + text;
            for (int i = 0; i < parts.Length - 1; i++)
            {
                string part = parts[i].Trim().ToLowerInvariant();
                if (part == "alt") mods |= MOD_ALT;
                else if (part == "ctrl" || part == "control") mods |= MOD_CONTROL;
                else if (part == "shift") mods |= MOD_SHIFT;
                else if (part == "win") mods |= MOD_WIN;
                else return "Unknown modifier \"" + parts[i] + "\" in " + text + " (Alt, Ctrl, Shift, Win).";
            }
            string last = parts[parts.Length - 1].Trim().ToUpperInvariant();
            if (last.Length == 1 && ((last[0] >= 'A' && last[0] <= 'Z') || (last[0] >= '0' && last[0] <= '9'))) vk = last[0];
            else if (last.Length >= 2 && last[0] == 'F')
            {
                int number;
                if (int.TryParse(last.Substring(1), out number) && number >= 1 && number <= 12) vk = (uint)(0x70 + number - 1);
            }
            if (vk == 0) return "Unknown key \"" + parts[parts.Length - 1] + "\" in " + text + " (a letter, a digit or F1-F12).";
            return null;
        }

        static bool Register()
        {
            bool main = RegisterHotKey(keyWindow.Handle, ID_KEY, modifiers | MOD_NOREPEAT, key);
            askRegistered = main && (modifiers & MOD_SHIFT) == 0 && RegisterHotKey(keyWindow.Handle, ID_ASK, modifiers | MOD_SHIFT | MOD_NOREPEAT, key);
            return main;
        }

        static void Unregister()
        {
            UnregisterHotKey(keyWindow.Handle, ID_KEY);
            UnregisterHotKey(keyWindow.Handle, ID_ASK);
        }

        static void OnKey(int id)
        {
            IntPtr foreground = GetForegroundWindow();
            string process = ProcessName(foreground);
            if (Array.IndexOf(Browsers, process.ToLowerInvariant()) >= 0)
            {
                PassOn();
                Emit(Event("passed", "process", process, "title", WindowTitle(foreground)));
                return;
            }
            // The Alt let go next must not open the program's menu: a key nobody uses comes between.
            Tap(VK_MASK);
            editorWindow = foreground;
            Emit(Event("hotkey", "ask", id == ID_ASK, "title", WindowTitle(foreground), "process", process));
        }

        // The key goes on to the browser page: unregistered for a moment, sent again, registered again.
        static void PassOn()
        {
            Unregister();
            Send(new ushort[] { (ushort)key }, new bool[] { false });
            Send(new ushort[] { (ushort)key }, new bool[] { true });
            System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
            timer.Interval = 200;
            timer.Tick += delegate (object sender, EventArgs e) { timer.Stop(); timer.Dispose(); Register(); };
            timer.Start();
        }

        static void Copy(Dictionary<string, object> command)
        {
            object id = command.ContainsKey("id") ? command["id"] : null;
            WaitForKeysUp(2500);
            if (Flag(command, "save"))
            {
                Combo(VK_CONTROL, (ushort)'S');
                Thread.Sleep(500);
            }
            DataObject before = Snapshot();
            string text = "";
            bool copied = false;
            try
            {
                for (int i = 0; i < 5; i++) { try { Clipboard.Clear(); break; } catch (ExternalException) { Thread.Sleep(50); } }
                Combo(VK_CONTROL, (ushort)'C');
                for (int i = 0; i < 30 && !copied; i++)
                {
                    Thread.Sleep(40);
                    try { if (Clipboard.ContainsText()) { text = Clipboard.GetText(); copied = true; } } catch (ExternalException) { }
                }
            }
            finally
            {
                Restore(before);
            }
            Emit(Event("copied", "id", id, "text", text, "ok", copied));
        }

        // A copy of what the clipboard holds now, in every format that can be read.
        static DataObject Snapshot()
        {
            try
            {
                IDataObject current = Clipboard.GetDataObject();
                if (current == null) return null;
                DataObject copy = new DataObject();
                foreach (string format in current.GetFormats(false))
                {
                    try { object data = current.GetData(format, false); if (data != null) copy.SetData(format, false, data); } catch (Exception) { }
                }
                return copy.GetFormats().Length > 0 ? copy : null;
            }
            catch (Exception) { return null; }
        }

        static void Restore(DataObject before)
        {
            try
            {
                if (before != null) Clipboard.SetDataObject(before, true, 5, 60);
                else Clipboard.Clear();
            }
            catch (Exception) { }
        }

        static void WaitForKeysUp(int milliseconds)
        {
            int[] keys = { VK_MENU, VK_CONTROL, VK_SHIFT, VK_LWIN, VK_RWIN, (int)key };
            DateTime until = DateTime.Now.AddMilliseconds(milliseconds);
            while (DateTime.Now < until)
            {
                bool down = false;
                foreach (int k in keys) if ((GetAsyncKeyState(k) & 0x8000) != 0) down = true;
                if (!down) return;
                Thread.Sleep(20);
            }
        }

        static void ShowChoices(Dictionary<string, object> command)
        {
            TextBox box;
            CheckedListBox list;
            DialogResult result;
            List<int> ticked = new List<int>();
            string keyText = null;
            using (Form form = BuildWindow(command, out box, out list))
            {
                result = form.ShowDialog();
                if (list != null) foreach (int index in list.CheckedIndices) ticked.Add(index);
                if (box != null) keyText = box.Text.Trim();
            }
            if (editorWindow != IntPtr.Zero) SetForegroundWindow(editorWindow);
            Emit(Event("dialog", "id", command.ContainsKey("id") ? command["id"] : null, "ok", result == DialogResult.OK, "key", keyText, "checked", ticked));
        }

        static Form BuildWindow(Dictionary<string, object> command, out TextBox box, out CheckedListBox list)
        {
            box = null;
            list = null;
            Form form = new Form();
            form.Text = "Test data";
            form.FormBorderStyle = FormBorderStyle.FixedDialog;
            form.MaximizeBox = false;
            form.MinimizeBox = false;
            form.StartPosition = FormStartPosition.CenterScreen;
            form.TopMost = true;
            form.ShowInTaskbar = true;
            form.AutoSize = true;
            form.AutoSizeMode = AutoSizeMode.GrowAndShrink;
            form.Padding = new Padding(12);
            form.Font = SystemFonts.MessageBoxFont;

            TableLayoutPanel layout = new TableLayoutPanel();
            layout.ColumnCount = 1;
            layout.AutoSize = true;
            layout.AutoSizeMode = AutoSizeMode.GrowAndShrink;
            layout.Dock = DockStyle.Fill;
            form.Controls.Add(layout);

            Label message = new Label();
            message.AutoSize = true;
            message.MaximumSize = new Size(620, 0);
            message.Text = Text(command, "message");
            message.Margin = new Padding(0, 0, 0, 10);
            layout.Controls.Add(message);

            if (Flag(command, "needKey"))
            {
                FlowLayoutPanel row = new FlowLayoutPanel();
                row.AutoSize = true;
                row.WrapContents = false;
                Label label = new Label();
                label.Text = "Test data key:";
                label.AutoSize = true;
                label.Margin = new Padding(0, 6, 6, 0);
                box = new TextBox();
                box.Width = 300;
                box.Text = Text(command, "key");
                row.Controls.Add(label);
                row.Controls.Add(box);
                layout.Controls.Add(row);
            }

            string note = Text(command, "note");
            string error = Text(command, "error");
            if (error.Length > 0 || note.Length > 0)
            {
                Label hint = new Label();
                hint.AutoSize = true;
                hint.MaximumSize = new Size(620, 0);
                hint.Text = error.Length > 0 ? error : note;
                hint.ForeColor = error.Length > 0 ? Color.Firebrick : SystemColors.GrayText;
                hint.Margin = new Padding(0, 4, 0, 8);
                layout.Controls.Add(hint);
            }

            IList places = command.ContainsKey("places") ? command["places"] as IList : null;
            if (places != null && places.Count > 0)
            {
                Label title = new Label();
                title.AutoSize = true;
                title.Text = places.Count == 1 ? "The place it changes:" : "The places it changes (untick one to keep it as it is):";
                title.Margin = new Padding(0, 4, 0, 4);
                layout.Controls.Add(title);
                list = new CheckedListBox();
                list.CheckOnClick = true;
                list.Width = 620;
                list.HorizontalScrollbar = true;
                list.IntegralHeight = false;
                list.Height = Math.Min(260, Math.Max(2, places.Count) * (list.ItemHeight + 2) + 6);
                IList checks = command.ContainsKey("checked") ? command["checked"] as IList : null;
                for (int i = 0; i < places.Count; i++)
                {
                    bool on = checks == null || (i < checks.Count && checks[i] is bool && (bool)checks[i]);
                    list.Items.Add(Convert.ToString(places[i]), on);
                }
                layout.Controls.Add(list);
            }

            FlowLayoutPanel buttons = new FlowLayoutPanel();
            buttons.FlowDirection = FlowDirection.RightToLeft;
            buttons.AutoSize = true;
            buttons.Dock = DockStyle.Fill;
            buttons.Margin = new Padding(0, 12, 0, 0);
            Button cancel = new Button();
            cancel.Text = "Cancel";
            cancel.DialogResult = DialogResult.Cancel;
            cancel.AutoSize = true;
            Button ok = new Button();
            ok.Text = Text(command, "button").Length > 0 ? Text(command, "button") : "OK";
            ok.DialogResult = DialogResult.OK;
            ok.AutoSize = true;
            buttons.Controls.Add(cancel);
            buttons.Controls.Add(ok);
            layout.Controls.Add(buttons);
            form.AcceptButton = ok;
            form.CancelButton = cancel;

            TextBox focusBox = box;
            form.Shown += delegate (object sender, EventArgs e)
            {
                ShowWindow(form.Handle, SW_SHOWNORMAL);
                form.BringToFront();
                SetForegroundWindow(form.Handle);
                form.Activate();
                if (focusBox != null) { focusBox.Focus(); focusBox.SelectAll(); } else ok.Focus();
            };
            return form;
        }

        static void Notify(Dictionary<string, object> command)
        {
            string text = Text(command, "text");
            if (text.Length > 250) text = text.Substring(0, 247) + "...";
            ToolTipIcon icon = Text(command, "level") == "warning" ? ToolTipIcon.Warning : ToolTipIcon.Info;
            if (tray != null && text.Length > 0) tray.ShowBalloonTip(5000, "Test data", text, icon);
        }

        static void ReadCommands()
        {
            StreamReader input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
            string line;
            while ((line = input.ReadLine()) != null)
            {
                if (line.Trim().Length == 0) continue;
                Dictionary<string, object> command;
                try { command = Json.Deserialize<Dictionary<string, object>>(line); }
                catch (Exception error) { Emit(Event("error", "message", "Unreadable command: " + error.Message)); continue; }
                ui.BeginInvoke(new Action<Dictionary<string, object>>(Handle), command);
            }
            ui.BeginInvoke(new Action(Application.ExitThread));
        }

        static void Handle(Dictionary<string, object> command)
        {
            string name = Text(command, "cmd");
            try
            {
                if (name == "copy") Copy(command);
                else if (name == "dialog") ShowChoices(command);
                else if (name == "notify") Notify(command);
                else if (name == "quit") Application.ExitThread();
                else Emit(Event("error", "message", "Unknown command: " + name));
            }
            catch (Exception error)
            {
                Emit(Event("error", "message", name + ": " + error.Message, "id", command.ContainsKey("id") ? command["id"] : null));
            }
        }

        static void Tap(ushort vk)
        {
            Send(new ushort[] { vk, vk }, new bool[] { false, true });
        }

        static void Combo(ushort modifier, ushort vk)
        {
            Send(new ushort[] { modifier, vk, vk, modifier }, new bool[] { false, false, true, true });
        }

        static void Send(ushort[] keys, bool[] up)
        {
            INPUT[] inputs = new INPUT[keys.Length];
            for (int i = 0; i < keys.Length; i++)
            {
                inputs[i].type = INPUT_KEYBOARD;
                inputs[i].u.ki.wVk = keys[i];
                inputs[i].u.ki.dwFlags = up[i] ? KEYEVENTF_KEYUP : 0;
            }
            SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
        }

        static string WindowTitle(IntPtr window)
        {
            StringBuilder text = new StringBuilder(1024);
            GetWindowText(window, text, text.Capacity);
            return text.ToString();
        }

        static string ProcessName(IntPtr window)
        {
            try
            {
                uint id;
                GetWindowThreadProcessId(window, out id);
                using (Process process = Process.GetProcessById((int)id)) return process.ProcessName;
            }
            catch (Exception) { return ""; }
        }

        static bool Flag(Dictionary<string, object> command, string name)
        {
            return command.ContainsKey(name) && command[name] is bool && (bool)command[name];
        }

        static string Text(Dictionary<string, object> command, string name)
        {
            return command.ContainsKey(name) && command[name] != null ? Convert.ToString(command[name]) : "";
        }

        static Dictionary<string, object> Event(string type, params object[] pairs)
        {
            Dictionary<string, object> result = new Dictionary<string, object>();
            result["type"] = type;
            for (int i = 0; i + 1 < pairs.Length; i += 2) result[(string)pairs[i]] = pairs[i + 1];
            return result;
        }

        static void Emit(Dictionary<string, object> message)
        {
            lock (OutputLock) { output.WriteLine(Json.Serialize(message)); }
        }
    }
}
'@

Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms, System.Drawing, System.Web.Extensions
exit [TestDataHotkey.Agent]::Start($Hotkey, [bool]$SelfTest)
