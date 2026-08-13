import * as vscode from "vscode";
import {
  checkoutWorkstream,
  createCheckpoint,
  getActiveWorkstream,
  getSourceManifest,
  listWorkstreams,
  openRepository,
  repositoryStatus,
  stagePaths,
  unstagePaths,
  verifyRepositoryIntegrity,
} from "@sessions/native-repository";

const api = () => vscode.workspace.getConfiguration("sessions").get<string>("apiUrl") ?? "http://localhost:4000";

type Aggregate = {
  session: { id: string; objective: string; repository_id: string };
  events: any[];
  snapshots: any[];
  verifications: any[];
};

function rootPath(): string {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) throw new Error("Open a Sessions repository folder first.");
  return root.uri.fsPath;
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${api()}${path}`, { headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, ...init });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

function command(context: vscode.ExtensionContext, id: string, handler: () => Promise<void>) {
  context.subscriptions.push(vscode.commands.registerCommand(id, async () => {
    try { await handler(); }
    catch (error) { vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)); }
  }));
}

export function activate(context: vscode.ExtensionContext) {
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
  statusBar.command = "sessions.timeline";
  statusBar.text = "$(sync~spin) Sessions";
  statusBar.tooltip = "Sessions source-control and execution state";
  statusBar.show();
  context.subscriptions.push(statusBar);

  const provider = new SessionsOverviewProvider(context, (text) => { statusBar.text = text; });
  context.subscriptions.push(vscode.window.registerTreeDataProvider("sessions.overview", provider));

  command(context, "sessions.refresh", async () => provider.refresh());

  command(context, "sessions.start", async () => {
    const objective = await vscode.window.showInputBox({ prompt: "What are you trying to accomplish?", placeHolder: "Fix authentication regression" });
    if (!objective) return;
    const root = rootPath();
    const repository = await openRepository(root);
    const workstream = await getActiveWorkstream(root);
    const created = await request("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ objective, repositoryId: repository.id, projectId: workstream.id }),
    });
    await context.workspaceState.update("sessions.currentSessionId", created.session.id);
    provider.refresh();
    vscode.window.showInformationMessage(`Session started: ${objective}`);
  });

  command(context, "sessions.stageAll", async () => {
    const staged = await stagePaths(rootPath(), ["."]);
    provider.refresh();
    vscode.window.showInformationMessage(staged.length ? `Sessions staged ${staged.length} path(s).` : "Nothing to stage.");
  });

  command(context, "sessions.unstageAll", async () => {
    await unstagePaths(rootPath(), ["."]);
    provider.refresh();
    vscode.window.showInformationMessage("Sessions stage cleared. Working files were not changed.");
  });

  command(context, "sessions.checkpoint", async () => {
    const root = rootPath();
    const name = await vscode.window.showInputBox({ prompt: "Checkpoint name", placeHolder: "auth-refresh-stable" });
    if (!name) return;
    const sessionId = context.workspaceState.get<string>("sessions.currentSessionId");
    const checkpoint = await createCheckpoint(root, { friendlyName: name, sessionIds: sessionId ? [sessionId] : [] });
    let hosted = "";
    if (sessionId) {
      const manifest = await getSourceManifest(root, checkpoint.sourceManifestId);
      const snapshot = await request(`/api/sessions/${sessionId}/snapshots`, {
        method: "POST",
        body: JSON.stringify({ entries: manifest.entries.map((entry) => ({ path: entry.path, contentHash: entry.digest, size: entry.size })) }),
      });
      hosted = ` · recovery ${snapshot.id}`;
    }
    provider.refresh();
    vscode.window.showInformationMessage(`◆ ${checkpoint.friendlyName} created${hosted}`);
  });

  command(context, "sessions.switchWorkstream", async () => {
    const root = rootPath();
    const active = await getActiveWorkstream(root);
    const choices = (await listWorkstreams(root)).map((item) => ({ label: item.name, description: item.objective, detail: item.id, item }));
    const selected = await vscode.window.showQuickPick(choices, { placeHolder: `Current Workstream: ${active.name}` });
    if (!selected) return;
    const workstream = await checkoutWorkstream(root, selected.item.id);
    provider.refresh();
    vscode.window.showInformationMessage(`Switched to ${workstream.name}`);
  });

  command(context, "sessions.verify", async () => {
    const sessionId = context.workspaceState.get<string>("sessions.currentSessionId");
    if (!sessionId) return void vscode.window.showWarningMessage("Start a Session before attaching hosted verification evidence.");
    const kind = await vscode.window.showQuickPick(["lint", "typecheck", "test", "build", "security", "policy", "custom"], { placeHolder: "Verification kind" });
    if (!kind) return;
    const status = await vscode.window.showQuickPick(["passed", "failed", "requires_review"], { placeHolder: "Verification result" });
    if (!status) return;
    const summary = await vscode.window.showInputBox({ prompt: "Verification summary", value: `${kind} ${status}` });
    await request(`/api/sessions/${sessionId}/verifications`, { method: "POST", body: JSON.stringify({ kind, status, summary: summary ?? `${kind} ${status}` }) });
    provider.refresh();
  });

  command(context, "sessions.integrity", async () => {
    const result = await verifyRepositoryIntegrity(rootPath());
    provider.refresh();
    if (result.ok) vscode.window.showInformationMessage(`Sessions integrity verified: ${result.checkedCheckpoints} Checkpoint(s), ${result.checkedObjects} object(s).`);
    else vscode.window.showErrorMessage(`Sessions integrity failed: ${result.errors[0] ?? "unknown error"}`);
  });

  command(context, "sessions.timeline", async () => {
    provider.refresh();
    await vscode.commands.executeCommand("sessions.overview.focus");
  });

  command(context, "sessions.rollback", async () => {
    const sessionId = context.workspaceState.get<string>("sessions.currentSessionId");
    if (!sessionId) return void vscode.window.showWarningMessage("Start a Session first.");
    const aggregate = await request(`/api/sessions/${sessionId}`) as Aggregate;
    if (!aggregate.snapshots.length) return void vscode.window.showWarningMessage("No hosted recovery Checkpoint is available yet.");
    const snapshotId = await vscode.window.showQuickPick(aggregate.snapshots.map((snapshot) => snapshot.id), { placeHolder: "Choose recovery target" });
    if (!snapshotId) return;
    const confirmed = await vscode.window.showWarningMessage(`Prepare recovery to ${snapshotId}? No local files will be overwritten yet.`, { modal: true }, "Prepare recovery");
    if (!confirmed) return;
    const result = await request(`/api/sessions/${sessionId}/rollback`, { method: "POST", body: JSON.stringify({ snapshotId }) });
    vscode.window.showInformationMessage(`Recovery ${result.status}: ${snapshotId}`);
  });

  provider.refresh();
}

class SessionsOverviewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private aggregate?: Aggregate;

  constructor(private readonly context: vscode.ExtensionContext, private readonly setStatus: (text: string) => void) {}
  refresh() { this.aggregate = undefined; this.emitter.fire(); }
  getTreeItem(element: vscode.TreeItem) { return element; }

  async getChildren(): Promise<vscode.TreeItem[]> {
    try {
      const root = rootPath();
      const source = await repositoryStatus(root);
      const sessionId = this.context.workspaceState.get<string>("sessions.currentSessionId");
      if (sessionId) this.aggregate ??= await request(`/api/sessions/${sessionId}`).catch(() => undefined) as Aggregate | undefined;
      const verifications = this.aggregate?.verifications ?? [];
      const passed = verifications.filter((item) => item.status === "passed").length;
      this.setStatus(`$(source-control) Sessions: ${source.workstream.name} · ${source.stagedChanges.length} staged · ${source.unstagedChanges.length} changed`);

      const items = [
        item(`Workstream  ${source.workstream.name}`, "sessions.switchWorkstream", "Current line of work"),
        item(`Head  ${source.headCheckpoint?.friendlyName ?? "No Checkpoint"}`, undefined, source.headCheckpoint?.id),
        item(`Staged Changes  ${source.stagedChanges.length}`, "sessions.stageAll", "Changes captured for the next Checkpoint"),
        item(`Changes  ${source.unstagedChanges.length}`, "sessions.stageAll", "Working changes not staged"),
      ];
      if (this.aggregate) {
        items.push(
          item(`Session  ${this.aggregate.session.objective}`, "sessions.timeline", "Active execution record"),
          item(`Events  ${this.aggregate.events.length}`, "sessions.timeline"),
          item(`Verification  ${passed}/${verifications.length} passed`, "sessions.verify"),
        );
      } else items.push(item("Session  None", "sessions.start", "Start an attributable execution record"));
      return items;
    } catch (error) {
      this.setStatus("$(warning) Sessions: repository unavailable");
      return [item(error instanceof Error ? error.message : String(error))];
    }
  }
}

function item(label: string, commandId?: string, tooltip?: string) {
  const tree = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  tree.tooltip = tooltip;
  if (commandId) tree.command = { command: commandId, title: label };
  return tree;
}

export function deactivate() {}
