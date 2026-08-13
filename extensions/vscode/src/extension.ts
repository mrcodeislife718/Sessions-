import * as vscode from "vscode";

type SessionState = {
  id: string;
  objective: string;
  startedAt: string;
  participants: string[];
  verification: "pending" | "passed" | "failed";
};

let currentSession: SessionState | undefined;

export function activate(context: vscode.ExtensionContext) {
  const provider = new SessionsOverviewProvider();
  context.subscriptions.push(vscode.window.registerTreeDataProvider("sessions.overview", provider));

  context.subscriptions.push(
    vscode.commands.registerCommand("sessions.start", async () => {
      const objective = await vscode.window.showInputBox({ prompt: "What are you trying to accomplish?" });
      if (!objective) return;
      currentSession = {
        id: `session-${Date.now()}`,
        objective,
        startedAt: new Date().toISOString(),
        participants: ["human"],
        verification: "pending"
      };
      provider.refresh();
      vscode.window.showInformationMessage(`Sessions started: ${objective}`);
    }),
    vscode.commands.registerCommand("sessions.checkpoint", async () => {
      if (!currentSession) return vscode.window.showWarningMessage("Start a Session first.");
      vscode.window.showInformationMessage("Checkpoint requested. CodeVault integration is the next implementation step.");
    }),
    vscode.commands.registerCommand("sessions.verify", async () => {
      if (!currentSession) return vscode.window.showWarningMessage("Start a Session first.");
      vscode.window.showInformationMessage("Verification requested. Runner integration is the next implementation step.");
    }),
    vscode.commands.registerCommand("sessions.timeline", () => provider.refresh()),
    vscode.commands.registerCommand("sessions.rollback", async () => {
      if (!currentSession) return vscode.window.showWarningMessage("Start a Session first.");
      const choice = await vscode.window.showWarningMessage("Rollback must target a verified checkpoint.", { modal: true }, "Continue");
      if (choice) vscode.window.showInformationMessage("Rollback planner opened. Persistence integration is required before execution.");
    })
  );
}

class SessionsOverviewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh() { this.emitter.fire(); }

  getTreeItem(element: vscode.TreeItem) { return element; }

  getChildren(): vscode.TreeItem[] {
    if (!currentSession) return [new vscode.TreeItem("No active Session", vscode.TreeItemCollapsibleState.None)];
    return [
      new vscode.TreeItem(currentSession.objective),
      new vscode.TreeItem(`Started: ${new Date(currentSession.startedAt).toLocaleTimeString()}`),
      new vscode.TreeItem(`Verification: ${currentSession.verification}`),
      new vscode.TreeItem(`Participants: ${currentSession.participants.join(", ")}`)
    ];
  }
}

export function deactivate() {}
