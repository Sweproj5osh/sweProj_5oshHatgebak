/**
 * Scheduler — owner: Zeyad (Area 1, Sprint 2: Z11–Z13). May-fail set.
 * Time-driven jobs run once per due time with retry: stale tickets, retention purge. Needs TicketDesk, PersonalData,
 * MoneyCheck. Provides no interface to other modules (Q12); this registry is for job owners.
 */

export interface ScheduledJob {
  readonly name: string;
  /** Returns the next due instant after `after`, or undefined when the job will never run again. */
  nextDueAfter(after: Date): Date | undefined;
  run(dueAt: Date): Promise<void>;
}

export interface JobRunReport {
  readonly ran: number;
  readonly retried: number;
}

export interface Scheduler {
  register(job: ScheduledJob): void;
  runDueJobs(now: Date): Promise<JobRunReport>;
}
