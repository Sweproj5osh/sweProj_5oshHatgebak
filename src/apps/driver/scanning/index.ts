export { DriverScanClient } from './driver-scan-client';
export type { DriverScanClientResult } from './driver-scan-client';
export {
  DRIVER_CLOSE_TICKET_PATH,
  DRIVER_OPEN_TICKET_PATH,
} from './driver-ticket-routes';
export { HttpTicketScanApi } from './http-ticket-scan-api';
export { InMemoryTicketScanApi } from './in-memory-ticket-scan-api';
export {
  TicketScanTransportError,
  type TicketScanApi,
  type OpenedTicketScan,
  type ClosedTicketScan,
} from './ticket-scan-api';
