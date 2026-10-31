using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Windows.Forms;

public sealed class GeneralFixture : Form {
    readonly string family;
    readonly int seed;
    readonly string output;
    readonly Random random;
    readonly DateTime launchedUtc = DateTime.UtcNow;
    DateTime? firstActionUtc;
    int actions;
    int validationErrors;
    bool loading;
    Label status;

    static readonly string[] Families = {
        "form", "long-list", "menu-dialog", "grid", "text-editor",
        "dynamic", "ocr-visual", "recovery"
    };

    [STAThread]
    public static void Main(string[] args) {
        if (args.Length < 3) {
            Console.Error.WriteLine("Usage: GeneralFixture.exe FAMILY SEED OUTPUT_DIR");
            Environment.Exit(2);
        }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new GeneralFixture(args[0], int.Parse(args[1], CultureInfo.InvariantCulture), args[2]));
    }

    GeneralFixture(string selectedFamily, int selectedSeed, string outputDir) {
        if (!Families.Contains(selectedFamily)) throw new ArgumentException("Unknown family: " + selectedFamily);
        family = selectedFamily;
        seed = selectedSeed;
        output = Path.GetFullPath(outputDir);
        Directory.CreateDirectory(output);
        random = new Random(seed * 7919 + Array.IndexOf(Families, family) * 104729);
        Text = "Jev General Benchmark - " + family + " - seed " + seed;
        AccessibleName = Text;
        WindowState = FormWindowState.Maximized;
        BackColor = Color.White;
        Font = new Font("Segoe UI", 16);
        StartPosition = FormStartPosition.CenterScreen;
        Build();
        Shown += delegate { Activate(); };
    }

    void Build() {
        loading = true;
        Controls.Clear();
        AddLabel("GENERAL COMPUTER USE BENCHMARK", 35, 20, 1300, 40, 24, FontStyle.Bold);
        AddLabel("Family: " + family + "    Seed: " + seed, 35, 65, 1200, 35, 14, FontStyle.Regular);
        status = AddLabel("Ready", 35, 745, 1450, 90, 16, FontStyle.Bold);
        if (family == "form") BuildForm();
        else if (family == "long-list") BuildLongList();
        else if (family == "menu-dialog") BuildMenuDialog();
        else if (family == "grid") BuildGrid();
        else if (family == "text-editor") BuildTextEditor();
        else if (family == "dynamic") BuildDynamic();
        else if (family == "ocr-visual") BuildOcrVisual();
        else BuildRecovery();
        loading = false;
    }

    Label AddLabel(string text, int x, int y, int w, int h, float size, FontStyle style) {
        Label label = new Label { Text = text, Location = new Point(x, y), Size = new Size(w, h), Font = new Font("Segoe UI", size, style) };
        Controls.Add(label);
        return label;
    }

    Button AddButton(string text, int x, int y, int w, int h) {
        Button button = new Button { Text = text, AccessibleName = text, Location = new Point(x, y), Size = new Size(w, h) };
        Controls.Add(button);
        return button;
    }

    void Mark(string kind, string value) {
        if (loading) return;
        DateTime now = DateTime.UtcNow;
        if (!firstActionUtc.HasValue) firstActionUtc = now;
        actions++;
        File.AppendAllText(Path.Combine(output, "events.jsonl"),
            "{\"utc\":\"" + now.ToString("o") + "\",\"family\":\"" + Escape(family) +
            "\",\"seed\":" + seed + ",\"kind\":\"" + Escape(kind) + "\",\"value\":\"" + Escape(value) + "\"}\n");
    }

    void Finish(bool success, string detail) {
        Mark("submit", detail);
        if (!success) validationErrors++;
        DateTime done = DateTime.UtcNow;
        double interaction = firstActionUtc.HasValue ? (done - firstActionUtc.Value).TotalSeconds : 0;
        string result = "{\"success\":" + (success ? "true" : "false") +
            ",\"family\":\"" + Escape(family) + "\",\"seed\":" + seed +
            ",\"detail\":\"" + Escape(detail) + "\",\"actions\":" + actions +
            ",\"validationErrors\":" + validationErrors +
            ",\"launchedUtc\":\"" + launchedUtc.ToString("o") + "\",\"firstActionUtc\":\"" +
            (firstActionUtc.HasValue ? firstActionUtc.Value.ToString("o") : "") + "\",\"completedUtc\":\"" +
            done.ToString("o") + "\",\"interactionSeconds\":" + interaction.ToString("F3", CultureInfo.InvariantCulture) + "}";
        File.WriteAllText(Path.Combine(output, "result.json"), result);
        status.Text = success ? "SUCCESS — independently verified" : "VALIDATION FAILED — correct the task and retry";
        status.ForeColor = success ? Color.DarkGreen : Color.DarkRed;
        if (success) {
            foreach (Control control in Controls) if (control is Button || control is TextBox || control is ComboBox || control is CheckBox || control is RadioButton || control is ListBox) control.Enabled = false;
        }
    }

    string Pick(params string[] values) { return values[random.Next(values.Length)]; }
    string Token(string prefix) { return prefix + random.Next(100, 999).ToString(CultureInfo.InvariantCulture); }

    void BuildForm() {
        string code = Token("FRM-");
        string department = Pick("Finance", "Support", "Sales");
        string urgency = Pick("Normal", "Urgent");
        AddLabel("Order code", 45, 130, 350, 36, 16, FontStyle.Regular);
        TextBox field = new TextBox { AccessibleName = "Order code", Location = new Point(45, 172), Size = new Size(520, 44) };
        field.TextChanged += delegate { Mark("text", field.Text); }; Controls.Add(field);
        AddLabel("Department", 45, 242, 350, 36, 16, FontStyle.Regular);
        ComboBox combo = new ComboBox { AccessibleName = "Department", DropDownStyle = ComboBoxStyle.DropDownList, Location = new Point(45, 284), Size = new Size(360, 44) };
        combo.Items.AddRange(new object[] { "Finance", "Support", "Sales" });
        combo.SelectedIndexChanged += delegate { Mark("department", Convert.ToString(combo.SelectedItem)); }; Controls.Add(combo);
        GroupBox group = new GroupBox { Text = "Urgency", Location = new Point(460, 242), Size = new Size(360, 150) };
        RadioButton normal = new RadioButton { Text = "Normal", AccessibleName = "Normal", Location = new Point(20, 38), Size = new Size(250, 40) };
        RadioButton urgent = new RadioButton { Text = "Urgent", AccessibleName = "Urgent", Location = new Point(20, 88), Size = new Size(250, 40) };
        normal.CheckedChanged += delegate { if (normal.Checked) Mark("urgency", "Normal"); };
        urgent.CheckedChanged += delegate { if (urgent.Checked) Mark("urgency", "Urgent"); };
        group.Controls.Add(normal); group.Controls.Add(urgent); Controls.Add(group);
        CheckBox verify = new CheckBox { Text = "Verify details", AccessibleName = "Verify details", Location = new Point(45, 420), Size = new Size(350, 44) };
        verify.CheckedChanged += delegate { Mark("verify", verify.Checked.ToString()); }; Controls.Add(verify);
        Button submit = AddButton("Complete order", 45, 510, 310, 62);
        submit.Click += delegate { Finish(field.Text == code && Convert.ToString(combo.SelectedItem) == department && verify.Checked && (urgency == "Urgent" ? urgent.Checked : normal.Checked), "form"); };
        WriteGoal("Enter order code " + code + ", choose department " + department + ", select " + urgency + " urgency, check Verify details, and click Complete order. Finish when SUCCESS is visible.");
    }

    void BuildLongList() {
        int targetIndex = 34 + random.Next(16);
        string target = "Record " + (targetIndex + 1).ToString("00") + " — " + Token("LST-");
        AddLabel("Select the requested record from the long list", 45, 120, 1000, 40, 17, FontStyle.Regular);
        ListBox list = new ListBox { AccessibleName = "Records", Location = new Point(45, 175), Size = new Size(700, 430) };
        for (int i = 0; i < 55; i++) list.Items.Add(i == targetIndex ? target : "Record " + (i + 1).ToString("00") + " — " + Token("ITEM-") );
        list.SelectedIndexChanged += delegate { Mark("selection", Convert.ToString(list.SelectedItem)); }; Controls.Add(list);
        Button submit = AddButton("Confirm selection", 790, 175, 330, 62);
        submit.Click += delegate { Finish(Convert.ToString(list.SelectedItem) == target, "long-list"); };
        WriteGoal("In the Records list, select exactly " + target + " and click Confirm selection. Finish when SUCCESS is visible.");
    }

    void BuildMenuDialog() {
        string operation = Pick("Normalize", "Validate", "Archive preview");
        string tabName = Pick("Details", "Audit", "Summary");
        string selectedOperation = "";
        MenuStrip menu = new MenuStrip();
        ToolStripMenuItem operations = new ToolStripMenuItem("Operations");
        foreach (string name in new[] { "Normalize", "Validate", "Archive preview" }) {
            ToolStripMenuItem item = new ToolStripMenuItem(name); string captured = name;
            item.Click += delegate { selectedOperation = captured; Mark("menu", captured); status.Text = "Operation selected: " + captured; };
            operations.DropDownItems.Add(item);
        }
        menu.Items.Add(operations); MainMenuStrip = menu; Controls.Add(menu);
        AddLabel("Use the Operations menu, then choose the requested tab.", 45, 130, 1200, 45, 17, FontStyle.Regular);
        TabControl tabs = new TabControl { AccessibleName = "Workspace tabs", Location = new Point(45, 205), Size = new Size(850, 330) };
        foreach (string name in new[] { "Summary", "Details", "Audit" }) {
            TabPage page = new TabPage(name); page.AccessibleName = name; page.Controls.Add(new Label { Text = name + " workspace", Location = new Point(35, 45), Size = new Size(600, 50) }); tabs.TabPages.Add(page);
        }
        tabs.SelectedIndexChanged += delegate { Mark("tab", tabs.SelectedTab.Text); }; Controls.Add(tabs);
        Button apply = AddButton("Apply workspace action", 45, 570, 360, 62);
        apply.Click += delegate { Finish(selectedOperation == operation && tabs.SelectedTab.Text == tabName, "menu-dialog"); };
        WriteGoal("Open the Operations menu and choose " + operation + ". Then switch to the " + tabName + " tab and click Apply workspace action. Finish when SUCCESS is visible.");
    }

    void BuildGrid() {
        string[] names = { "Orion", "Mavi", "Kestane", "Delta", "Poyraz" };
        string target = names[random.Next(names.Length)];
        string priority = Pick("Low", "Medium", "High");
        string selected = "";
        AddLabel("Record table", 45, 125, 800, 42, 18, FontStyle.Bold);
        TableLayoutPanel table = new TableLayoutPanel { Location = new Point(45, 180), Size = new Size(900, 330), ColumnCount = 3, RowCount = 6, CellBorderStyle = TableLayoutPanelCellBorderStyle.Single };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 45)); table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25)); table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 30));
        table.Controls.Add(new Label { Text = "Name", Dock = DockStyle.Fill }, 0, 0); table.Controls.Add(new Label { Text = "Current", Dock = DockStyle.Fill }, 1, 0); table.Controls.Add(new Label { Text = "Action", Dock = DockStyle.Fill }, 2, 0);
        for (int i = 0; i < names.Length; i++) {
            string captured = names[i];
            table.Controls.Add(new Label { Text = captured, Dock = DockStyle.Fill }, 0, i + 1);
            table.Controls.Add(new Label { Text = i % 2 == 0 ? "Open" : "Queued", Dock = DockStyle.Fill }, 1, i + 1);
            Button choose = new Button { Text = "Select " + captured, AccessibleName = "Select " + captured, Dock = DockStyle.Fill };
            choose.Click += delegate { selected = captured; Mark("row", captured); status.Text = "Selected row: " + captured; };
            table.Controls.Add(choose, 2, i + 1);
        }
        Controls.Add(table);
        ComboBox combo = new ComboBox { AccessibleName = "Priority", DropDownStyle = ComboBoxStyle.DropDownList, Location = new Point(980, 180), Size = new Size(300, 44) };
        combo.Items.AddRange(new object[] { "Low", "Medium", "High" }); combo.SelectedIndexChanged += delegate { Mark("priority", Convert.ToString(combo.SelectedItem)); }; Controls.Add(combo);
        Button save = AddButton("Save selected row", 980, 260, 330, 62);
        save.Click += delegate { Finish(selected == target && Convert.ToString(combo.SelectedItem) == priority, "grid"); };
        WriteGoal("In the record table select the row named " + target + ", set Priority to " + priority + ", and click Save selected row. Finish when SUCCESS is visible.");
    }

    void BuildTextEditor() {
        string line = "Review note " + Token("TXT-");
        AddLabel("Project note", 45, 125, 650, 40, 18, FontStyle.Bold);
        TextBox editor = new TextBox { AccessibleName = "Project note", Multiline = true, ScrollBars = ScrollBars.Vertical, Location = new Point(45, 180), Size = new Size(850, 330), Text = "Existing heading\r\nKeep this original paragraph." };
        editor.TextChanged += delegate { Mark("editor", editor.Text); }; Controls.Add(editor);
        CheckBox reviewed = new CheckBox { Text = "Mark reviewed", AccessibleName = "Mark reviewed", Location = new Point(45, 540), Size = new Size(330, 45) };
        reviewed.CheckedChanged += delegate { Mark("reviewed", reviewed.Checked.ToString()); }; Controls.Add(reviewed);
        Button save = AddButton("Save note", 430, 535, 250, 60);
        save.Click += delegate { Finish(editor.Text == "Existing heading\r\nKeep this original paragraph.\r\n" + line && reviewed.Checked, "text-editor"); };
        WriteGoal("In Project note, preserve all existing text and append a new final line exactly: " + line + ". Check Mark reviewed and click Save note. Finish when SUCCESS is visible.");
    }

    void BuildDynamic() {
        string target = Pick("Blue channel", "Green channel", "Amber channel");
        AddLabel("Dynamic workspace", 45, 130, 800, 45, 18, FontStyle.Bold);
        Panel area = new Panel { Location = new Point(45, 280), Size = new Size(1100, 250), BorderStyle = BorderStyle.FixedSingle }; Controls.Add(area);
        string selected = "";
        Button refresh = AddButton("Refresh workspace", 45, 195, 320, 62);
        refresh.Click += delegate {
            Mark("refresh", "requested"); refresh.Enabled = false; status.Text = "Loading workspace…";
            Timer timer = new Timer { Interval = 700 };
            timer.Tick += delegate {
                timer.Stop(); area.Controls.Clear();
                int x = 25;
                foreach (string name in new[] { "Blue channel", "Green channel", "Amber channel" }) {
                    string captured = name; Button choice = new Button { Text = name, AccessibleName = name, Location = new Point(x, 55), Size = new Size(280, 60) };
                    choice.Click += delegate { selected = captured; Mark("dynamic-choice", captured); status.Text = "Selected: " + captured; };
                    area.Controls.Add(choice); x += 330;
                }
                Button finish = new Button { Text = "Commit dynamic choice", AccessibleName = "Commit dynamic choice", Location = new Point(25, 145), Size = new Size(360, 58) };
                finish.Click += delegate { Finish(selected == target, "dynamic"); }; area.Controls.Add(finish); status.Text = "Workspace loaded";
            };
            timer.Start();
        };
        WriteGoal("Click Refresh workspace, wait for the dynamic controls, choose " + target + ", and click Commit dynamic choice. Finish when SUCCESS is visible.");
    }

    sealed class CodeCard : Panel {
        public string CodeText;
        public CodeCard(string text) { CodeText = text; BackColor = Color.FromArgb(245, 239, 218); BorderStyle = BorderStyle.FixedSingle; }
        protected override void OnPaint(PaintEventArgs e) {
            base.OnPaint(e);
            using (Font font = new Font("Consolas", 31, FontStyle.Bold)) using (Brush brush = new SolidBrush(Color.FromArgb(31, 62, 98))) {
                e.Graphics.DrawString(CodeText, font, brush, new PointF(34, 38));
            }
        }
    }

    void BuildOcrVisual() {
        string code = "V" + random.Next(10000, 99999).ToString(CultureInfo.InvariantCulture);
        AddLabel("Read the code from the visual card", 45, 125, 900, 42, 18, FontStyle.Bold);
        CodeCard card = new CodeCard(code) { AccessibleName = "Visual code card", Location = new Point(45, 190), Size = new Size(430, 135) }; Controls.Add(card);
        TextBox field = new TextBox { AccessibleName = "Visual code", Location = new Point(45, 370), Size = new Size(430, 46) };
        field.TextChanged += delegate { Mark("visual-code", field.Text); }; Controls.Add(field);
        Button submit = AddButton("Verify visual code", 45, 455, 310, 62);
        submit.Click += delegate { Finish(field.Text == code, "ocr-visual"); };
        WriteGoal("Read the code drawn inside the visual card, type that exact code into Visual code, and click Verify visual code. Finish when SUCCESS is visible.");
    }

    void BuildRecovery() {
        string target = Pick("Current package A", "Current package B", "Current package C");
        string selected = "";
        AddLabel("Recovery workflow", 45, 130, 800, 45, 18, FontStyle.Bold);
        Panel area = new Panel { Location = new Point(45, 270), Size = new Size(1150, 280) }; Controls.Add(area);
        Button start = AddButton("Start safe update", 45, 195, 320, 62);
        start.Click += delegate {
            Mark("start", "safe update");
            DialogResult answer = MessageBox.Show(this, "Continue to the refreshed package list?", "Local benchmark confirmation", MessageBoxButtons.OKCancel, MessageBoxIcon.Information);
            Mark("dialog", answer.ToString());
            if (answer != DialogResult.OK) { status.Text = "Update cancelled"; return; }
            area.Controls.Clear();
            Button stale = new Button { Text = "Finish old package", AccessibleName = "Finish old package", Enabled = false, Location = new Point(25, 25), Size = new Size(300, 58) }; area.Controls.Add(stale);
            int x = 25;
            foreach (string name in new[] { "Current package A", "Current package B", "Current package C" }) {
                string captured = name; Button choice = new Button { Text = name, AccessibleName = name, Location = new Point(x, 115), Size = new Size(300, 58) };
                choice.Click += delegate { selected = captured; Mark("package", captured); status.Text = "Selected: " + captured; };
                area.Controls.Add(choice); x += 340;
            }
            Button finish = new Button { Text = "Finish current update", AccessibleName = "Finish current update", Location = new Point(25, 200), Size = new Size(340, 58) };
            finish.Click += delegate { Finish(selected == target, "recovery"); }; area.Controls.Add(finish);
            status.Text = "Refreshed list ready";
        };
        WriteGoal("Click Start safe update. In the local confirmation dialog choose OK to continue. Ignore the disabled old-package control, select " + target + ", and click Finish current update. Finish when SUCCESS is visible.");
    }

    void WriteGoal(string goal) {
        string json = "{\"schemaVersion\":1,\"family\":\"" + Escape(family) + "\",\"seed\":" + seed +
            ",\"partition\":\"" + Partition(seed) + "\",\"windowTitle\":\"" + Escape(Text) +
            "\",\"goal\":\"" + Escape(goal) + "\",\"resultPath\":\"" + Escape(Path.Combine(output, "result.json")) + "\"}";
        File.WriteAllText(Path.Combine(output, "case.json"), json);
    }

    static string Partition(int value) {
        int part = Math.Abs(value) % 10;
        return part < 5 ? "development" : part < 8 ? "regression" : "holdout";
    }

    static string Escape(string text) {
        return (text ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
    }
}
