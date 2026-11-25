// A test file beside the module may import the test runner and other modules: F1 skips it (P28 #28).
import { describe } from 'vitest';
import { createTicketOpening } from '../../ticketing/public';

describe(String(createTicketOpening), () => undefined);
