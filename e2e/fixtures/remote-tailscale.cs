using System;
using System.IO;

// A real child-process fixture. All state stays next to this isolated executable.
internal static class RemoteTailscale
{
  private static int Main(string[] args)
  {
    string root = AppDomain.CurrentDomain.BaseDirectory;
    string command = String.Join(" ", args);
    File.AppendAllText(Path.Combine(root, "commands.log"), command + Environment.NewLine);
    string modeFile = Path.Combine(root, "mode");
    string mode = File.Exists(modeFile) ? File.ReadAllText(modeFile).Trim() : "healthy";
    if (mode == "fail") { Console.Error.WriteLine("fixture: temporary daemon unavailable"); return 1; }
    string mapping = Path.Combine(root, "mapping");
    if (command == "status --json")
      Console.WriteLine("{\"BackendState\":\"Running\",\"Self\":{\"DNSName\":\"recovery.test.ts.net.\"}}");
    else if (command == "serve status --json")
    {
      string entries = File.Exists(mapping)
        ? "\"TCP\":{\"8443\":{\"HTTPS\":true}},\"Web\":{\"recovery.test.ts.net:8443\":{\"Handlers\":{\"/\":{\"Proxy\":\"http://127.0.0.1:49387\"}}}}"
        : "\"TCP\":{},\"Web\":{}";
      Console.WriteLine("{" + entries + (mode == "funnel" ? ",\"AllowFunnel\":{\"recovery.test.ts.net:8443\":true}" : "") + "}");
    }
    else if (command == "serve --bg --https=8443 http://127.0.0.1:49387") File.WriteAllText(mapping, "owned");
    else if (command == "serve --https=8443 off") File.Delete(mapping);
    else { Console.Error.WriteLine("fixture: unexpected command " + command); return 2; }
    return 0;
  }
}
