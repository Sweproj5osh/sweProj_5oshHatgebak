import { readSiteCodeSecret } from './modules/identity-and-registry/sites-and-areas/index';
import { readTokenSecret } from './http/auth/token';
import { BOOTSTRAP_CHAIR_NAME_VARIABLE, BOOTSTRAP_CHAIR_PHONE_VARIABLE, type BootstrapOutcome } from './composition/bootstrap';
import { composeInMemoryServer } from './composition/compose-server';
import { createHttpsServer, readTlsCertificate } from './http/server';

const DEFAULT_PORT = 3000;

const certificate = await readTlsCertificate(process.env);
const application = composeInMemoryServer({ tokenSecret: readTokenSecret(process.env), siteCodeSecret: readSiteCodeSecret(process.env) });
const port = Number(process.env['PORT'] ?? DEFAULT_PORT);

const bootstrap = await application.bootstrapFirstChair(process.env);
console.log(`First Chair: ${describe(bootstrap)}`);

function describe(outcome: BootstrapOutcome): string {
  switch (outcome.kind) {
    case 'bootstrapped':
      return `created as ${outcome.chairId}`;
    case 'already bootstrapped':
      return 'already exists, nothing done';
    case 'not configured':
      return `not created (set ${BOOTSTRAP_CHAIR_PHONE_VARIABLE} and ${BOOTSTRAP_CHAIR_NAME_VARIABLE} to create one)`;
    case 'refused':
      return `refused: ${outcome.reason}`;
  }
}

createHttpsServer(application.handle, certificate).listen(port, () => {
  console.log(`Street parking server listening on https://localhost:${port} with in-memory storage`);
  console.log(`Permission table holds ${application.permissions.operationCount()} operations`);
});
