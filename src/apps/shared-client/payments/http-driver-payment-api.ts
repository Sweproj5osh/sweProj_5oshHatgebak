/**
 * HTTP adapter for the Driver App payment flow: call the main system with the driver's token and map its answers to
 * app-level refusal and transport errors.
 */
import { requiredBoolean, requiredNumber, requiredString } from '../server-answer';
import { ServerCall, ServerRefusedError, UNAUTHORIZED, type EntryPointHandle } from '../server-call';
import {
  DriverPaymentRefusedError,
  isDriverPaymentRefusal,
  type DriverPaymentApi,
  type DriverPayResult,
  type DriverReceipt,
} from './driver-payment-api';
import { DRIVER_PAY_PATH, DRIVER_RECEIPT_PATH } from './driver-payment-routes';

export interface HttpDriverPaymentApiOptions {
  readonly handle: EntryPointHandle;
  readonly token: () => string | undefined;
}

export class HttpDriverPaymentApi implements DriverPaymentApi {
  private readonly server: ServerCall;

  constructor(options: HttpDriverPaymentApiOptions) {
    this.server = new ServerCall({ handle: options.handle, token: options.token });
  }

  async pay(ticketId: string, amount: number, requestId: string): Promise<DriverPayResult> {
    const answer = await this.server
      .write(DRIVER_PAY_PATH, requestId, { ticketId, amount: String(amount) })
      .catch(rethrowAsDriverPaymentRefusal);
    return {
      ok: true,
      requestId: requiredString(answer, 'requestId'),
      ticketId: requiredString(answer, 'ticketId'),
      paid: requiredBoolean(answer, 'paid'),
    };
  }

  async receipt(ticketId: string): Promise<DriverReceipt> {
    const answer = await this.server.read(DRIVER_RECEIPT_PATH, { ticketId }).catch(rethrowAsDriverPaymentRefusal);
    return {
      ticketId: requiredString(answer, 'ticketId'),
      siteId: requiredString(answer, 'siteId'),
      openedAt: requiredString(answer, 'openedAt'),
      closedAt: requiredString(answer, 'closedAt'),
      hours: requiredNumber(answer, 'hours'),
      fee: requiredNumber(answer, 'fee'),
      plate: requiredString(answer, 'plate'),
    };
  }
}

function rethrowAsDriverPaymentRefusal(error: unknown): never {
  if (error instanceof ServerRefusedError) {
    if (isDriverPaymentRefusal(error.refusal)) {
      throw new DriverPaymentRefusedError(error.refusal);
    }
    if (error.status === UNAUTHORIZED) {
      throw new DriverPaymentRefusedError('ticket not closed');
    }
  }
  throw error;
}
