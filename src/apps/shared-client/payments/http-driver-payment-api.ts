/**
 * HTTP adapter for the Driver App payment flow: call the main system with the driver's token and map its answers to
 * app-level refusal and transport errors. No fee ever travels from here (Rule I).
 */
import type { RequestId } from '../../../shared/request-id';
import { optionalString, requiredNumber, requiredRecord, requiredString, requiredWord, type ServerAnswer } from '../server-answer';
import { asTransportFailureIfServerFailed, ServerCall, ServerRefusedError, UNAUTHORIZED, type EntryPointHandle } from '../server-call';
import {
  ATTEMPT_STATES,
  DriverPaymentRefusedError,
  isDriverPaymentRefusal,
  PAYMENT_METHODS,
  type DriverPaymentApi,
  type DriverReceipt,
  type PayAnswer,
  type PaymentRecord,
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

  async pay(ticketId: string, requestId: RequestId): Promise<PayAnswer> {
    const answer = await this.server.write(DRIVER_PAY_PATH, requestId, { ticketId }).catch(rethrowAsDriverPaymentRefusal);
    const payment = readPaymentRecord(requiredRecord(answer, 'payment'));
    const message = optionalString(answer, 'message');
    return message === undefined ? { payment } : { payment, message };
  }

  async receipt(ticketId: string, requestId: RequestId): Promise<DriverReceipt> {
    const answer = await this.server.loggedRead(DRIVER_RECEIPT_PATH, { ticketId }, requestId).catch(rethrowAsDriverPaymentRefusal);
    return readReceipt(requiredRecord(answer, 'receipt'));
  }
}

function readPaymentRecord(payment: ServerAnswer): PaymentRecord {
  const reason = optionalString(payment, 'reason');
  const providerReference = optionalString(payment, 'providerReference');
  return {
    paymentId: requiredString(payment, 'paymentId'),
    ticketId: requiredString(payment, 'ticketId'),
    amount: requiredNumber(payment, 'amount'),
    method: requiredWord(payment, 'method', PAYMENT_METHODS),
    state: requiredWord(payment, 'state', ATTEMPT_STATES),
    ...(reason === undefined ? {} : { reason }),
    ...(providerReference === undefined ? {} : { providerReference }),
  };
}

function readReceipt(receipt: ServerAnswer): DriverReceipt {
  return {
    ticketId: requiredString(receipt, 'ticketId'),
    siteId: requiredString(receipt, 'siteId'),
    openedAt: requiredString(receipt, 'openedAt'),
    closedAt: requiredString(receipt, 'closedAt'),
    hours: requiredNumber(receipt, 'hours'),
    fee: requiredNumber(receipt, 'fee'),
    plate: requiredString(receipt, 'plate'),
  };
}

function rethrowAsDriverPaymentRefusal(error: unknown): never {
  if (error instanceof ServerRefusedError) {
    if (isDriverPaymentRefusal(error.refusal)) {
      throw new DriverPaymentRefusedError(error.refusal);
    }
    if (error.status === UNAUTHORIZED) {
      throw new DriverPaymentRefusedError('not signed in');
    }
  }
  return asTransportFailureIfServerFailed(error);
}
