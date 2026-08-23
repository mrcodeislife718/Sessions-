"use client";

import { useEffect, useState } from "react";

export function InstallClient() {
  const [origin, setOrigin] = useState("https://sessions.example.com");
  useEffect(() => setOrigin(window.location.origin), []);
  return (
    <div className="checkout-panel">
      <div className="checkout-step"><span>1</span><div><strong>Install Sessions</strong><p>Download the first-party Sessions client. Git is not required for Sessions-native repositories.</p></div></div>
      <a className="button button-large sessions-primary button-full" href="/downloads/sessions-cli.tgz">Download Sessions CLI</a>
      <div className="sessions-code-block"><code>{`tar -xzf sessions-cli.tgz\ncd sessions-cli\n./install.sh`}</code></div>
      <div className="checkout-step"><span>2</span><div><strong>Sign in</strong><p>The CLI authenticates directly with Sessions.</p></div></div>
      <div className="sessions-code-block"><code>{`sessions login ${origin} you@example.com`}</code></div>
      <div className="checkout-step"><span>3</span><div><strong>Create or move a repository</strong><p>Sessions has its own repository, branch, commit, object, ref, push, pull and recovery model.</p></div></div>
      <div className="sessions-code-block"><code>{`cd your-project\nsessions init\nsessions remote add origin ${origin}\nsessions add .\nsessions commit "Initial Sessions commit"\nsessions push origin\nsessions start "Your next engineering objective"`}</code></div>
      <p className="checkout-status">Existing Git repositories can be imported once with <code>sessions import</code>, after which normal operation is Sessions-native.</p>
    </div>
  );
}
