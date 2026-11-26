// Planted violation for F14: a production file imports the fitness functions.
import { allImports } from '../fitness/support/import-scanner';

export const leaked = allImports;
