// Planted violation for F14: a production file imports a test file.
import { sample } from './opening.test';

export const leaked = sample;
