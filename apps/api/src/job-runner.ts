/**
 * Abstracts "start this now, without making the caller wait for it"
 * out of the handful of Orchestrator/service flows (an AI reply,
 * a knowledge-ingestion background step) that deliberately don't await
 * their own follow-up work - the HTTP response shouldn't hang on a
 * multi-second AI call or embedding job. This exists for the same
 * reason realtime/conversation-hub.ts's subscribe/unsubscribe/
 * publishToConversation trio does: today's implementation is in-process
 * only, and this interface is what keeps a future move to a real queue
 * (Redis is already provisioned, env.REDIS_URL) a contained, one-file
 * swap instead of a rewrite.
 *
 * The second, equally real reason this exists: fire-and-forget work is
 * otherwise untestable - a caller has no handle on when it finishes, so
 * a test asserting "no reply was sent" can't distinguish "correctly
 * declined" from "hasn't finished yet." SynchronousJobRunner gives
 * tests a deterministic way to wait for it by literally awaiting it
 * instead of detaching it - no polling, no sleeping.
 */
export interface JobRunner {
  run(task: () => Promise<void>): void | Promise<void>;
}

export class InProcessJobRunner implements JobRunner {
  run(task: () => Promise<void>): void {
    void task();
  }
}

export class SynchronousJobRunner implements JobRunner {
  run(task: () => Promise<void>): Promise<void> {
    return task();
  }
}

let defaultJobRunner: JobRunner | undefined;
export function getDefaultJobRunner(): JobRunner {
  return (defaultJobRunner ??= new InProcessJobRunner());
}
