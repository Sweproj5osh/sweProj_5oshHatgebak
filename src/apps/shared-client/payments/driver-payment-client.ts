/**
 * Driver App client for payment and receipt (task D4). The app displays the server's decision: a paid attempt, or a
 * pending one with the server's "pay later or pay cash" (P18). It keeps the request id of a payment while the
 * connection is lost, so the retry charges once (Rule H), and gives each receipt read its own request id, because the
 * receipt shows the plate and is a logged read (P9).
 */
import type { RequestId } from '../../../shared/request-id';
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
  readonly createRequestId: () => RequestId;
}

interface PendingRequest {
  readonly input: string;
  readonly requestId: RequestId;
}

export class DriverPaymentClient {
  private readonly api: DriverPaymentApi;
  private readonly createRequestId: () => RequestId;
  private pendingPayment: PendingRequest | undefined;
  private pendingReceipt: PendingRequest | undefined;

  constructor(options: DriverPaymentClientOptions) {
    this.api = options.api;
    this.createRequestId = options.createRequestId;
  }

  pendingPaymentRequestId(): RequestId | undefined {
    return this.pendingPayment?.requestId;
  }

  /** One tap pays the ticket; the amount is the server's and never leaves the phone (Rule I). */
  async pay(ticketId: string): Promise<DriverPaymentClientResult<PayAnswer>> {
    const pending = this.keepOrCreate(this.pendingPayment, ticketId);
    this.pendingPayment = pending;

    try {
      const answer = await this.api.pay(ticketId, pending.requestId);
      this.pendingPayment = undefined;
      return { ok: true, value: answer };
    } catch (error) {
      if (error instanceof ServerTransportError) {
        return { ok: false, error: 'connection lost', requestId: pending.requestId };
      }
      this.pendingPayment = undefined;
      return refusalOrRethrow(error);
    }
  }

  async receipt(ticketId: string): Promise<DriverPaymentClientResult<DriverReceipt>> {
    const pending = this.keepOrCreate(this.pendingReceipt, ticketId);
    this.pendingReceipt = pending;

    try {
      const receipt = await this.api.receipt(ticketId, pending.requestId);
      this.pendingReceipt = undefined;
      return { ok: true, value: receipt };
    } catch (error) {
      if (error instanceof ServerTransportError) {
        return { ok: false, error: 'connection lost', requestId: pending.requestId };
      }
      this.pendingReceipt = undefined;
      return refusalOrRethrow(error);
    }
  }

  private keepOrCreate(existing: PendingRequest | undefined, input: string): PendingRequest {
    return existing?.input === input ? existing : { input, requestId: this.createRequestId() };
  }
}

function refusalOrRethrow(error: unknown): DriverPaymentClientFailure {
  if (error instanceof DriverPaymentRefusedError) {
    return { ok: false, error: error.refusal };
  }
  throw error;
}
