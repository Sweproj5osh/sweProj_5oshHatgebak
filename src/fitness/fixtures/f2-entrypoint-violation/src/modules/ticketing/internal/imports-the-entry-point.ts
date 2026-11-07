// Planted violation for F2: a module imports the entry point, which imports the modules back (a cycle, P5).
import { createRequestHandler } from '../../../entrypoint/handle-request';

export const peek = createRequestHandler;
