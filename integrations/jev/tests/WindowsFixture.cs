using System;
using System.Drawing;
using System.IO;
using System.Windows.Forms;
public class WindowsFixture : Form {
    [STAThread] public static void Main(string[] args) {
        Application.EnableVisualStyles();
        Application.Run(new WindowsFixture(args[0]));
    }
    WindowsFixture(string resultPath) {
        Text="TypeSafe Windows Port Test"; WindowState=FormWindowState.Maximized;
        BackColor=Color.White; Font=new Font("Arial",18);
        var title=new Label {Text="TypeSafe Windows Port Test",Location=new Point(50,40),Size=new Size(900,50)};
        var label=new Label {Text="Test mesaji:",Location=new Point(50,120),Size=new Size(400,40)};
        var field=new TextBox {AccessibleName="Test mesaji",Location=new Point(50,170),Size=new Size(850,50)};
        var check=new CheckBox {Text="Testi onayla",AccessibleName="Testi onayla",Location=new Point(50,240),Size=new Size(400,55)};
        var button=new Button {Text="Tamamla",Location=new Point(50,330),Size=new Size(250,65)};
        var status=new Label {Text="Durum: Bekliyor",Location=new Point(50,440),Size=new Size(1300,160)};
        button.Click+=(sender,e)=>{
            bool ok=field.Text=="Merhaba kralim 123" && check.Checked;
            status.Text=ok?"BASARILI: Merhaba kralim 123 - Onaylandi":"EKSIK: Metni ve onay kutusunu kontrol edin";
            File.WriteAllText(resultPath,"{\"verified\":"+(ok?"true":"false")+",\"checked\":"+(check.Checked?"true":"false")+",\"exactText\":"+(field.Text=="Merhaba kralim 123"?"true":"false")+"}");
        };
        Controls.AddRange(new Control[]{title,label,field,check,button,status});
        Shown+=(sender,e)=>{Activate();button.Focus();};
    }
}
