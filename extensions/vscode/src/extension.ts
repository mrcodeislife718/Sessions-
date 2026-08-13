import { createHash } from "node:crypto";
import * as vscode from "vscode";

const api = () => vscode.workspace.getConfiguration("sessions").get<string>("apiUrl") ?? "http://localhost:4000";

type Aggregate = { session: { id: string; objective: string; repository_id: string }; events: any[]; snapshots: any[]; verifications: any[] };

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${api()}${path}`, { headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, ...init });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new SessionsOverviewProvider(context);
  context.subscriptions.push(vscode.window.registerTreeDataProvider("sessions.overview", provider));

  context.subscriptions.push(
    vscode.commands.registerCommand("sessions.start", async () => {
      try {
        const objective = await vscode.window.showInputBox({ prompt: "What are you trying to accomplish?" });
        if (!objective) return;
        const root = vscode.workspace.workspaceFolders?.[0];
        if (!root) return vscode.window.showWarningMessage("Open a repository folder first.");
        const repositoryId = root.name;
        const created = await request("/api/sessions", { method: "POST", body: JSON.stringify({ objective, repositoryId }) });
        await context.workspaceState.update("sessions.currentSessionId", created.session.id);
        provider.refresh();
        vscode.window.showInformationMessage(`Session started: ${objective}`);
      } catch (error) { vscode.window.showErrorMessage(String(error)); }
    }),

    vscode.commands.registerCommand("sessions.checkpoint", async () => {
      try {
        const sessionId = context.workspaceState.get<string>("sessions.currentSessionId");
        if (!sessionId) return vscode.window.showWarningMessage("Start a Session first.");
        const root = vscode.workspace.workspaceFolders?.[0];
        if (!root) return vscode.window.showWarningMessage("Open a repository folder first.");
        const files = await vscode.workspace.findFiles("**/*", "{**/.git/**,**/.sessions/**,**/node_modules/**,**/.next/**,**/dist/**,**/coverage/**}");
        const entries = [];
        for (const uri of files) {
          const bytes = await vscode.workspace.fs.readFile(uri);
          const info = await vscode.workspace.fs.stat(uri);
          entries.push({ path: vscode.workspace.asRelativePath(uri, false), contentHash: createHash("sha256").update(bytes).digest("hex"), size: info.size });
        }
        const snapshot = await request(`/api/sessions/${sessionId}/snapshots`, { method: "POST", body: JSON.stringify({ entries }) });
        provider.refresh();
        vscode.window.showInformationMessage(`Checkpoint ${snapshot.id} captured ${entries.length} files.`);
      } catch (error) { vscode.window.showErrorMessage(String(error)); }
    }),

    vscode.commands.registerCommand("sessions.verify", async () => {
      try {
        const sessionId = context.workspaceState.get<string>("sessions.currentSessionId");
        if (!sessionId) return vscode.window.showWarningMessage("Start a Session first.");
        const kind = await vscode.window.showQuickPick(["lint", "typecheck", "test", "build", "security", "policy", "custom"], { placeHolder: "Verification kind" });
        if (!kind) return;
        const status = await vscode.window.showQuickPick(["passed", "failed", "requires_review"], { placeHolder: "Verification result" });
        if (!status) return;
        const summary = await vscode.window.showInputBox({ prompt: "Verification summary", value: `${kind} ${status}` });
        await request(`/api/sessions/${sessionId}/verifications`, { method: "POST", body: JSON.stringify({ kind, status, summary: summary ?? `${kind} ${status}` }) });
        provider.refresh();
      } catch (error) { vscode.window.showErrorMessage(String(error)); }
    }),

    vscode.commands.registerCommand("sessions.timeline", async () => {
      provider.refresh();
      vscode.commands.executeCommand("sessions.overview.focus");
    }),

    vscode.commands.registerCommand("sessions.rollback", async () => {
      try {
        const sessionId = context.workspaceState.get<string>("sessions.currentSessionId");
        if (!sessionId) return vscode.window.showWarningMessage("Start a Session first.");
        const aggregate = await request(`/api/sessions/${sessionId}`) as Aggregate;
        if (!aggregate.snapshots.length) return vscode.window.showWarningMessage("Create a checkpoint first.");
        const snapshotId = await vscode.window.showQuickPick(aggregate.snapshots.map((snapshot) => snapshot.id), { placeHolder: "Choose rollback checkpoint" });
        if (!snapshotId) return;
        const confirmed = await vscode.window.showWarningMessage(`Prepare rollback to ${snapshotId}?`, { modal: true }, "Prepare rollback");
        if (!confirmed) return;
        const result = await request(`/api/sessions/${sessionId}/rollback`, { method: "POST", body: JSON.stringify({ snapshotId }) });
        vscode.window.showInformationMessage(`Rollback ${result.status}: ${snapshotId}`);
      } catch (error) { vscode.window.showErrorMessage(String(error)); }
    })
  );
}

class SessionsOverviewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private aggregate?: Aggregate;

  constructor(private readonly context: vscode.ExtensionContext) {}
  refresh() { this.aggregate = undefined; this.emitter.fire(); }
  getTreeItem(element: vscode.TreeItem) { return element; }

  async getChildren(): Promise<vscode.TreeItem[]> {
    const sessionId = this.context.workspaceState.get<string>("sessions.currentSessionId");
    if (!sessionId) return [new vscode.TreeItem("No active Session", vscode.TreeItemCollapsibleState.None)];
    try {
      this.aggregate ??= await request(`/api/sessions/${sessionId}`) as Aggregate;
      const { session, events, snapshots, verifications } = this.aggregate;
      const passed = verifications.filter((item) => item.status === "passed").length;
      return [
        new vscode.TreeItem(session.objective),
        new vscode.TreeItem(`Repository: ${session.repository_id}`),
        new vscode.TreeItem(`Events: ${events.length}`),
        new vscode.TreeItem(`Checkpoints: ${snapshots.length}`),
        new vscode.TreeItem(`Verification: ${passed}/${verifications.length} passed`),
      ];
    } catch (error) {
      return [new vscode.TreeItem(`API unavailable: ${String(error)}`)];
    }
  }
}

export function deactivate() {}
