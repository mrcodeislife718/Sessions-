import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';

const requiredFiles = [
  '.env.production.example',
  'docker-compose.production.yml',
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
  'scripts/qualify-team-auth.mjs',
  'scripts/qualify-tenancy.mjs',
  'scripts/validate-production-config.sh',
  'apps/api/src/auth-server.ts',
  'apps/api/src/billing-server.ts',
  'apps/api/src/repository-server.ts',
  'apps/api/src/workflow-server.ts',
  'apps/api/src/observability.ts',
  'apps/runner/src/workflow-executor.ts',
  'apps/web/app/settings/page.tsx',
  'apps/web/app/invite/page.tsx',
  'apps/web/app/repositories/[id]/releases/page.tsx',
  'apps/web/app/repositories/[id]/deployments/page.tsx',
  'apps/web/app/repositories/[id]/settings/page.tsx',
  'apps/web/app/repositories/[id]/actions/[runId]/page.tsx',
];

const requiredMigrations = [
  'infrastructure/postgres/init.sql',
  'infrastructure/postgres/002-hosted-repositories.sql',
  'infrastructure/postgres/003-source-storage.sql',
  'infrastructure/postgres/004-production-controls.sql',
  'infrastructure/postgres/005-commercial-operations.sql',
  'infrastructure/postgres/006-product-analytics.sql',
  'infrastructure/postgres/007-billing-integrations.sql',
  'infrastructure/postgres/008-repository-collaboration.sql',
  'infrastructure/postgres/009-lifecycle-evidence-events.sql',
  'infrastructure/postgres/010-hosted-auth.sql',
  'infrastructure/postgres/011-repository-onboarding.sql',
  'infrastructure/postgres/012-sessions-native-repository.sql',
  'infrastructure/postgres/013-team-invitations.sql',
];

const productionEnvKeys = [
  'SESSIONS_DOMAIN',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
  'REDIS_PASSWORD',
  'MINIO_ROOT_USER',
  'MINIO_ROOT_PASSWORD',
  'S3_BUCKET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_DEVELOPER',
];

const productionServices = [
  'proxy',
  'web',
  'api',
  'auth',
  'repositories',
  'workflows',
  'billing',
  'runner',
  'executor',
  'postgres',
  'redis',
  'minio',
];

async function requireFile(path) {
  try {
    await access(path, constants.R_OK);
  } catch {
    throw new Error(`Launch-critical asset missing or unreadable: ${path}`);
  }
}

async function main() {
  for (const path of [...requiredFiles, ...requiredMigrations]) await requireFile(path);

  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const scripts = pkg.scripts ?? {};
  for (const script of ['verify', 'qualify:launch', 'test:native', 'test:commercial', 'test:api', 'test:runner', 'docker:up', 'docker:down']) {
    if (!scripts[script]) throw new Error(`Launch-critical package script missing: ${script}`);
  }

  const envTemplate = await readFile('.env.production.example', 'utf8');
  for (const key of productionEnvKeys) {
    if (!new RegExp(`^${key}=`, 'm').test(envTemplate)) throw new Error(`Production environment contract missing ${key}`);
  }

  const compose = await readFile('docker-compose.production.yml', 'utf8');
  for (const service of productionServices) {
    if (!new RegExp(`^\s{2}${service}:`, 'm').test(compose)) throw new Error(`Production topology missing service: ${service}`);
  }
  for (const invariant of [
    'DATABASE_URL: postgresql://${POSTGRES_USER',
    'SESSIONS_PUBLIC_ORIGIN: https://${SESSIONS_DOMAIN}',
    'STRIPE_SECRET_KEY: ${STRIPE_SECRET_KEY:',
    'STRIPE_WEBHOOK_SECRET: ${STRIPE_WEBHOOK_SECRET:',
    'SESSIONS_ALLOW_INSECURE_LOCAL: "false"',
  ]) {
    if (!compose.includes(invariant)) throw new Error(`Production topology invariant missing: ${invariant}`);
  }

  const billing = await readFile('apps/api/src/billing-server.ts', 'utf8');
  for (const invariant of ['verifyStripeSignature', 'usage_events', 'workspace_entitlements', 'api_credentials']) {
    if (!billing.includes(invariant)) throw new Error(`Billing/entitlement invariant missing: ${invariant}`);
  }

  const report = {
    status: 'internally-launch-ready-structure',
    checkedAt: new Date().toISOString(),
    assets: requiredFiles.length,
    migrations: requiredMigrations.length,
    productionServices,
    externalProofStillRequired: [
      'live production deployment against real secrets/domains',
      'real Stripe test/live-mode account qualification',
      'external-user onboarding and collaboration acceptance run',
      'real customer payment and retention evidence',
    ],
  };

  console.log(JSON.stringify(report, null, 2));
}

await main();
