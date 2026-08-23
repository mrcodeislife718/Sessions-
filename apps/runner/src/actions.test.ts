import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { runActionOnce } from "./actions.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const digest = (content: Buffer) => createHash("sha256").update(content).digest("hex");

test(
  "runner verifies a Sessions-native pull request commit and persists evidence",
  { skip: databaseUrl ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const suffix = randomUUID();
    const organizationId = `org_action_${suffix}`;
    const workspaceId = `workspace_action_${suffix}`;
    const principalId = `principal_action_${suffix}`;
    const repositoryId = `repo_action_${suffix}`;
    const checkpointId = `checkpoint_action_${suffix}`;
    const manifestId = `manifest_action_${suffix}`;
    const actionRunId = randomUUID();
    const content = Buffer.from(`hello ${suffix}`);
    const contentDigest = digest(content);
    const objectId = `obj_${contentDigest}`;

    try {
      await pool.query("insert into organizations(id,name) values($1,$2)",[organizationId,"Actions Qualification"]);
      await pool.query("insert into workspaces(id,organization_id,name) values($1,$2,$3)",[workspaceId,organizationId,"Actions Workspace"]);
      await pool.query("insert into principals(id,kind,display_name) values($1,'human',$2)",[principalId,"Actions User"]);
      await pool.query("insert into workspace_memberships(workspace_id,principal_id,role) values($1,$2,'owner')",[workspaceId,principalId]);
      await pool.query("insert into hosted_repositories(id,workspace_id,name,visibility) values($1,$2,$3,'private')",[repositoryId,workspaceId,"native-actions"]);

      const manifest = {
        version: 1,
        id: manifestId,
        repositoryId,
        sourceDigest: contentDigest,
        entries: [{ path: "hello.txt", digest: contentDigest, objectId, size: content.length }],
      };
      const checkpoint = {
        version: 1,
        id: checkpointId,
        friendlyName: "Verify native pull request",
        repositoryId,
        workstreamId: "workstream_feature",
        parentCheckpointIds: [],
        sourceManifestId: manifestId,
        sourceDigest: contentDigest,
        lifecycle: "draft",
        actorIds: [principalId],
        sessionIds: [],
        verificationIds: [],
        approvalIds: [],
        recovery: { reconstructable: true, verified: false },
        createdAt: new Date().toISOString(),
      };

      await pool.query("insert into repository_manifests(id,repository_id,source_digest,manifest) values($1,$2,$3,$4)",[manifestId,repositoryId,contentDigest,JSON.stringify(manifest)]);
      await pool.query("insert into sessions_repository_objects(repository_id,object_id,digest,size_bytes,content) values($1,$2,$3,$4,$5)",[repositoryId,objectId,contentDigest,content.length,content]);
      await pool.query("insert into sessions_repository_checkpoints(repository_id,checkpoint_id,record) values($1,$2,$3)",[repositoryId,checkpointId,JSON.stringify(checkpoint)]);
      await pool.query("insert into sessions_repository_refs(repository_id,ref_type,name,checkpoint_id,metadata) values($1,'branch','feature',$2,$3)",[repositoryId,checkpointId,JSON.stringify({id:"workstream_feature"})]);

      const pull = await pool.query("insert into pull_requests(workspace_id,repository_id,number,title,base_branch,head_branch,head_commit_id,author_principal_id,required_approvals) values($1,$2,1,'Native PR','main','feature',$3,$4,0) returning id,verification_state,mergeable",[workspaceId,repositoryId,checkpointId,principalId]);
      const pullRequestId = pull.rows[0].id as string;
      assert.equal(pull.rows[0].verification_state, "pending");
      assert.equal(pull.rows[0].mergeable, false);

      await pool.query("insert into action_runs(id,workspace_id,repository_id,commit_id,pull_request_id,trigger,status,actor_principal_id) values($1,$2,$3,$4,$5,'pull_request','queued',$6)",[actionRunId,workspaceId,repositoryId,checkpointId,pullRequestId,principalId]);
      for (const [name, category] of [["Source integrity","verification"],["Repository policy","policy"],["Recovery readiness","verification"]] as const) {
        await pool.query("insert into action_checks(action_run_id,name,category,status) values($1,$2,$3,'queued')",[actionRunId,name,category]);
      }

      const result = await runActionOnce(pool);
      assert.equal(result.processed, true);
      assert.equal(result.runId, actionRunId);
      assert.equal(result.commitId, checkpointId);
      assert.equal(result.conclusion, "success");

      const run = await pool.query("select status,conclusion,started_at,completed_at from action_runs where id=$1",[actionRunId]);
      assert.equal(run.rows[0]?.status, "completed");
      assert.equal(run.rows[0]?.conclusion, "success");
      assert.ok(run.rows[0]?.started_at);
      assert.ok(run.rows[0]?.completed_at);

      const checks = await pool.query("select name,status,conclusion,summary,evidence from action_checks where action_run_id=$1 order by name",[actionRunId]);
      assert.equal(checks.rowCount, 3);
      for (const check of checks.rows) {
        assert.equal(check.status, "completed");
        assert.equal(check.conclusion, "success");
        assert.ok(check.summary.length > 0);
        assert.equal(typeof check.evidence, "object");
      }
      assert.match(checks.rows.find((row) => row.name === "Source integrity")?.summary ?? "", /Verified 1 source objects/);

      const verifiedPull = await pool.query("select verification_state,mergeable from pull_requests where id=$1",[pullRequestId]);
      assert.equal(verifiedPull.rows[0]?.verification_state, "passed");
      assert.equal(verifiedPull.rows[0]?.mergeable, false);
    } finally {
      await pool.query("delete from organizations where id=$1",[organizationId]).catch(()=>undefined);
      await pool.end();
    }
  },
);
