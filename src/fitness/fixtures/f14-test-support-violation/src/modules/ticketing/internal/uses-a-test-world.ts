// Planted violation for F14: a production file imports a test world.
import { buildTicketingWorld } from './testing/ticketing-world';

export const leaked = buildTicketingWorld;
