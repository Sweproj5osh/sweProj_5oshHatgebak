/**
 * Driver App client for payment and receipt (task D4). The app displays the server's decision: a paid attempt, or a
 * pending one with the server's "pay later or pay cash" (P18). It keeps the request id of a payment while the
 * connection is lost, so the retry charges once (Rule H), and gives each receipt read its own request id, because the
 * receipt shows the plate and is a logged read (P9).
 */
import type { RequestId } from '../../../shared/request-id';
import { RequestIdKeeper } from '../request-id';
import { ServerTransportError } from '../server-call';
import {
  DriverPaymentRefusedError,
  type DriverPaymentApi,
  type DriverPaymentRefusal,
  type DriverReceipt,
  type PayAnswer,
} from './driver-payment-api';

export type DriverPaymentClientSuccess<T> = { readonly ok: true; readonly value: T };
export type DriverPaymentClientFailure =
  | { readonly ok: false; readonly error: 'connection lost'; readonly requestId: RequestId }
  | { readonly ok: false; readonly error: DriverPaymentRefusal };
export type DriverPaymentClientResult<T> = DriverPaymentClientSuccess<T> | DriverPaymentClientFailure;

export interface DriverPaymentClientOptions {
  readonly api: DriverPaymentApi;
  /** Only tests replace the generator. */
  readonly createRequestId?: () => RequestId;
}

export class DriverPaymentClient {
  private readonly api: DriverPaymentApi;
  private readonly paymentRequests: RequestIdKeeper;
  private readonly receiptRequests: RequestIdKeeper;

  constructor(options: DriverPaymentClientOptions) {
    this.api = options.api;
    this.paymentRequests = new RequestIdKeeper(options.createRequestId);
    this.receiptRequests = new RequestIdKeeper(options.createRequestId);
  }

  pendingPaymentRequestId(): RequestId | undefined {
    return this.paymentRequests.pendingId();
  }

  /** One tap pays the ticket; the amount is the server's and never leaves the phone (Rule I). */
  async pay(ticketId: string): Promise<DriverPaymentClientResult<PayAnswer>> {
    const requestId = this.paymentRequests.idFor(ticketId);

    try {
      const answer = await this.api.pay(ticketId, requestId);
      this.paymentRequests.settle();
      return { ok: true, value: answer };
    } catch (error) {
      if (error instanceof ServerTransportError) {
        return { ok: false, error: 'connection lost', requestId };
      }
      this.paymentRequests.settle();
      return refusalOrRethrow(error);
    }
  }

  async receipt(ticketId: string): Promise<DriverPaymentClientResult<DriverReceipt>> {
    const requestId = this.receiptRequests.idFor(ticketId);

    try {
      const receipt = await this.api.receipt(ticketId, requestId);
      this.receiptRequests.settle();
      return { ok: true, value: receipt };
    } catch (error) {
      if (error instanceof ServerTransportError) {
        return { ok: false, error: 'connection lost', requestId };
      }
      this.receiptRequests.settle();
      return refusalOrRethrow(error);
    }
  }
}

function refusalOrRethrow(error: unknown): DriverPaymentClientFailure {
  if (error instanceof DriverPaymentRefusedError) {
    return { ok: false, error: error.refusal };
  }
  throw error;
}
