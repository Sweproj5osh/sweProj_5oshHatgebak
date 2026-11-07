import { readTokenSecret } from './auth/token';
import { BOOTSTRAP_CHAIR_NAME_VARIABLE, BOOTSTRAP_CHAIR_PHONE_VARIABLE, type BootstrapOutcome } from './bootstrap';
import { composeInMemoryServer } from './composition';
import { createHttpServer } from './server';

const DEFAULT_PORT = 3000;

const application = composeInMemoryServer({ tokenSecret: readTokenSecret(process.env) });
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

createHttpServer(application.handle).listen(port, () => {
  console.log(`Street parking server listening on port ${port} with in-memory storage`);
  console.log(`Permission table holds ${application.permissions.operationCount()} operations`);
});
