import { readTokenSecret } from './auth/token';
import { composeInMemoryApplication } from './composition';
import { createHttpServer } from './server';

const DEFAULT_PORT = 3000;

const application = composeInMemoryApplication({ tokenSecret: readTokenSecret(process.env) });
const port = Number(process.env['PORT'] ?? DEFAULT_PORT);

createHttpServer(application.handle).listen(port, () => {
  console.log(`Street parking server listening on port ${port} with in-memory storage`);
  console.log(`Permission table holds ${application.permissions.operationCount()} operations`);
});
