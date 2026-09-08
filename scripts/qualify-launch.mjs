import { access, readFile, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';

const requiredFiles = [
  '.env.production.example',
  'docker-compose.production.yml',
  'scripts/list-migrations.sh',
  'scripts/deploy-production.sh',
  'scripts/backup-production.sh',
  'scripts/restore-production.sh',
  'scripts/rollback-production.sh',
  'scripts/check-production-slo.sh',
  'scripts/provision-workspace.sh',
  'scripts/qualify-billing.mjs',
  'scripts/qualify-lifecycle.mjs',
  'scripts/qualify-native-collaboration.mjs',
  'scripts/qualify-postgres.sh',
  'scripts/qualify-current-postgres.sh',
  'scripts/qualify-webhook-outbox.sh',
  'scripts/qualify-release-governance.sh',
  'scripts/qualify-native-webhooks.sh',
  'scripts/qualify-repository-lifecycle.sh',
  'scripts/qualify-supply-chain.sh',
  'scripts/qualify-team-auth.mjs',
  'scripts/qualify-tenancy.mjs',
  'scripts/validate-production-config.sh',
  'infrastructure/docker/init-postgres.sh',
  'apps/api/src/auth-server.ts',
  'apps/api/src/billing-server.ts',
  'apps/api/src/repository-server.ts',
  'apps/api/src/release-governance.ts',
  'apps/api/src/repository-lifecycle.ts',
  'apps/api/src/supply-chain.ts',
  'apps/api/src/supply-chain.test.ts',
  'apps/api/src/workflow-server.ts',
  'apps/api/src/webhook-server.ts',
  'apps/api/src/webhook-worker.ts',
  'apps/api/src/webhook-crypto.ts',
  'apps/api/src/webhooks.ts',
  'apps/api/src/observability.ts',
  'apps/runner/src/workflow-executor.ts',
  'apps/web/app/settings/page.tsx',
  'apps/web/app/invite/page.tsx',
  'apps/web/app/repositories/[id]/releases/page.tsx',
  'apps/web/app/repositories/[id]/deployments/page.tsx',
  'apps/web/app/repositories/[id]/settings/page.tsx',
  'apps/web/app/repositories/[id]/actions/[runId]/page.tsx',
];

const migrationNames = (await readdir('infrastructure/postgres'))
  .filter((name) => /^\d{3}-.*\.sql$/.test(name))
  .sort();
const requiredMigrations = ['infrastructure/postgres/init.sql', ...migrationNames.map((name) => `infrastructure/postgres/${name}`)];

const productionEnvKeys = [
  'SESSIONS_DOMAIN','POSTGRES_USER','POSTGRES_PASSWORD','POSTGRES_DB','REDIS_PASSWORD','MINIO_ROOT_USER','MINIO_ROOT_PASSWORD','S3_BUCKET','SESSIONS_WEBHOOK_MASTER_KEY','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_PRICE_DEVELOPER',
];
const productionServices = ['proxy','web','api','auth','repositories','workflows','webhooks','webhook-worker','billing','runner','executor','postgres','redis','minio'];

async function requireFile(path) {
  try { await access(path, constants.R_OK); }
  catch { throw new Error(`Launch-critical asset missing or unreadable: ${path}`); }
}

async function main() {
  for (const path of [...requiredFiles, ...requiredMigrations]) await requireFile(path);
  if (!migrationNames.length) throw new Error('No numbered production migrations found');
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const scripts = pkg.scripts ?? {};
  for (const script of ['verify','qualify:launch','test:native','test:commercial','test:api','test:runner','docker:up','docker:down']) {
    if (!scripts[script]) throw new Error(`Launch-critical package script missing: ${script}`);
  }
  const envTemplate = await readFile('.env.production.example', 'utf8');
  for (const key of productionEnvKeys) if (!new RegExp(`^${key}=`, 'm').test(envTemplate)) throw new Error(`Production environment contract missing ${key}`);
  const compose = await readFile('docker-compose.production.yml', 'utf8');
  for (const service of productionServices) if (!new RegExp(`^\\s{2}${service}:`, 'm').test(compose)) throw new Error(`Production topology missing service: ${service}`);
  for (const invariant of ['DATABASE_URL: postgresql://${POSTGRES_USER','SESSIONS_PUBLIC_ORIGIN: https://${SESSIONS_DOMAIN}','STRIPE_SECRET_KEY: ${STRIPE_SECRET_KEY:','STRIPE_WEBHOOK_SECRET: ${STRIPE_WEBHOOK_SECRET:','SESSIONS_ALLOW_INSECURE_LOCAL: "false"','SESSIONS_WEBHOOK_MASTER_KEY: ${SESSIONS_WEBHOOK_MASTER_KEY:','SESSIONS_ALLOW_INSECURE_WEBHOOKS: "false"','./infrastructure/postgres:/sessions-migrations:ro','./infrastructure/docker/init-postgres.sh:/docker-entrypoint-initdb.d/001-sessions-migrations.sh:ro']) {
    if (!compose.includes(invariant)) throw new Error(`Production topology invariant missing: ${invariant}`);
  }
  const billing = await readFile('apps/api/src/billing-server.ts', 'utf8');
  for (const invariant of ['verifyStripeSignature','usage_events','workspace_entitlements','api_credentials']) if (!billing.includes(invariant)) throw new Error(`Billing/entitlement invariant missing: ${invariant}`);
  const repositoryServer = await readFile('apps/api/src/repository-server.ts', 'utf8');
  for (const invariant of ['repository_branch_policies','requiredHumanApprovals','branch-policies','handleReleaseGovernance','handleRepositoryLifecycle','handleSupplyChain']) if (!repositoryServer.includes(invariant)) throw new Error(`Repository governance invariant missing: ${invariant}`);
  const releaseGovernance = await readFile('apps/api/src/release-governance.ts', 'utf8');
  for (const invariant of ['environment-policies','deployment_approvals','requiredHumanApprovals','restrictAiDeploy','requireAttestedArtifact','requireSbom']) if (!releaseGovernance.includes(invariant)) throw new Error(`Release/deployment governance invariant missing: ${invariant}`);
  const lifecycle = await readFile('apps/api/src/repository-lifecycle.ts', 'utf8');
  for (const invariant of ['requireHumanAdmin','schedule_delete','confirmRepositoryId','sessions.lifecycle_purge']) if (!lifecycle.includes(invariant)) throw new Error(`Repository lifecycle invariant missing: ${invariant}`);
  const supplyChain = await readFile('apps/api/src/supply-chain.ts', 'utf8');
  for (const invariant of ['principal_signing_keys','repository_artifacts','artifact_attestations','Ed25519','signature verification failed']) if (!supplyChain.includes(invariant)) throw new Error(`Supply-chain invariant missing: ${invariant}`);
  const caddy = await readFile('infrastructure/docker/Caddyfile', 'utf8');
  for (const invariant of ['lifecycle','branch-policies','environment-policies','deployments/[^/]+/(approvals|status)','signing-keys','artifacts']) if (!caddy.includes(invariant)) throw new Error(`Repository governance route missing: ${invariant}`);
  const webhookWorker = await readFile('apps/api/src/webhook-worker.ts', 'utf8');
  for (const invariant of ['x-sessions-signature-256','createHmac','lease_expires_at','maxAttempts','assertSafeWebhookUrl']) if (!webhookWorker.includes(invariant)) throw new Error(`Webhook delivery invariant missing: ${invariant}`);
  const webhookCrypto = await readFile('apps/api/src/webhook-crypto.ts', 'utf8');
  for (const invariant of ['aes-256-gcm','SESSIONS_WEBHOOK_MASTER_KEY','private or reserved address']) if (!webhookCrypto.includes(invariant)) throw new Error(`Webhook security invariant missing: ${invariant}`);
  const nativeWebhook = await readFile('infrastructure/postgres/021-native-repository-webhook-events.sql', 'utf8');
  for (const invariant of ['checkpoint.insert','sessions_repository_refs','webhook_deliveries']) if (!nativeWebhook.includes(invariant)) throw new Error(`Native repository integration-event invariant missing: ${invariant}`);
  const supplyChainSchema = await readFile('infrastructure/postgres/023-supply-chain-attestations.sql', 'utf8');
  for (const invariant of ['repository_artifacts','artifact_attestations','require_attested_artifact','require_sbom']) if (!supplyChainSchema.includes(invariant)) throw new Error(`Supply-chain schema invariant missing: ${invariant}`);
  const signingKeySchema = await readFile('infrastructure/postgres/024-signing-keys.sql', 'utf8');
  for (const invariant of ['principal_signing_keys','fingerprint_sha256','signing_key_id']) if (!signingKeySchema.includes(invariant)) throw new Error(`Signing-key schema invariant missing: ${invariant}`);
  console.log(JSON.stringify({
    status: 'internally-launch-ready-structure',
    checkedAt: new Date().toISOString(),
    assets: requiredFiles.length,
    migrations: requiredMigrations.length,
    latestMigration: migrationNames.at(-1),
    productionServices,
    externalProofStillRequired: [
      'live production deployment against real secrets/domains',
      'real Stripe test/live-mode account qualification',
      'external-user onboarding and collaboration acceptance run',
      'real customer payment and retention evidence',
    ],
  }, null, 2));
}

await main();
