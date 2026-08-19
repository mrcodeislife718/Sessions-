CREATE TABLE IF NOT EXISTS repository_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, repository_id text NOT NULL,
  number bigint NOT NULL, title text NOT NULL, body text NOT NULL DEFAULT '', state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','closed')),
  author_principal_id text REFERENCES principals(id), assignee_principal_id text REFERENCES principals(id), labels jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz,
  UNIQUE(repository_id, number)
);
CREATE INDEX IF NOT EXISTS repository_issues_workspace_repo_idx ON repository_issues(workspace_id, repository_id, state);

CREATE TABLE IF NOT EXISTS issue_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), issue_id uuid NOT NULL REFERENCES repository_issues(id) ON DELETE CASCADE,
  author_principal_id text REFERENCES principals(id), body text NOT NULL, provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pull_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, repository_id text NOT NULL,
  number bigint NOT NULL, title text NOT NULL, body text NOT NULL DEFAULT '', state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','closed','merged')),
  base_branch text NOT NULL, head_branch text NOT NULL, head_commit_id text, merge_commit_id text, author_principal_id text REFERENCES principals(id),
  draft boolean NOT NULL DEFAULT false, mergeable boolean NOT NULL DEFAULT false, verification_state text NOT NULL DEFAULT 'pending' CHECK (verification_state IN ('pending','passed','failed')),
  required_approvals integer NOT NULL DEFAULT 1 CHECK (required_approvals >= 0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), merged_at timestamptz, closed_at timestamptz,
  UNIQUE(repository_id, number)
);
CREATE INDEX IF NOT EXISTS pull_requests_workspace_repo_idx ON pull_requests(workspace_id, repository_id, state);

CREATE TABLE IF NOT EXISTS pull_request_commits (
  pull_request_id uuid NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE, commit_id text NOT NULL, position integer NOT NULL,
  PRIMARY KEY(pull_request_id, commit_id), UNIQUE(pull_request_id, position)
);

CREATE TABLE IF NOT EXISTS pull_request_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pull_request_id uuid NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  author_principal_id text REFERENCES principals(id), body text NOT NULL, path text, line integer, provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pull_request_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pull_request_id uuid NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  reviewer_principal_id text REFERENCES principals(id), state text NOT NULL CHECK (state IN ('commented','approved','changes_requested','dismissed')),
  body text NOT NULL DEFAULT '', provenance jsonb NOT NULL DEFAULT '{}'::jsonb, submitted_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pull_request_active_review_idx ON pull_request_reviews(pull_request_id, reviewer_principal_id) WHERE state IN ('approved','changes_requested');

CREATE TABLE IF NOT EXISTS action_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, repository_id text NOT NULL,
  commit_id text, pull_request_id uuid REFERENCES pull_requests(id) ON DELETE CASCADE, trigger text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','cancelled')),
  conclusion text CHECK (conclusion IN ('success','failure','neutral','cancelled','skipped')),
  actor_principal_id text REFERENCES principals(id), started_at timestamptz, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS action_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), action_run_id uuid NOT NULL REFERENCES action_runs(id) ON DELETE CASCADE,
  name text NOT NULL, category text NOT NULL CHECK (category IN ('build','test','security','policy','verification','deployment')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed')),
  conclusion text CHECK (conclusion IN ('success','failure','neutral','cancelled','skipped')),
  summary text NOT NULL DEFAULT '', evidence jsonb NOT NULL DEFAULT '{}'::jsonb, started_at timestamptz, completed_at timestamptz,
  UNIQUE(action_run_id, name)
);

CREATE TABLE IF NOT EXISTS repository_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, repository_id text NOT NULL,
  tag_name text NOT NULL, name text NOT NULL, commit_id text NOT NULL, body text NOT NULL DEFAULT '', prerelease boolean NOT NULL DEFAULT false,
  author_principal_id text REFERENCES principals(id), created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz,
  UNIQUE(repository_id, tag_name)
);

CREATE TABLE IF NOT EXISTS repository_deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, repository_id text NOT NULL,
  release_id uuid REFERENCES repository_releases(id), commit_id text NOT NULL, environment text NOT NULL, status text NOT NULL CHECK (status IN ('queued','running','success','failure','rolled_back')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb, actor_principal_id text REFERENCES principals(id), created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
