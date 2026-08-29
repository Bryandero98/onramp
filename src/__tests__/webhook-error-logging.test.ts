import type { Logger } from "probot";

import { logWebhookError, type WebhookErrorEvent } from "../index";

/**
 * Builds a fake of what Probot's `app.onError` hands its callback: an
 * iterable of the underlying errors, plus the raw webhook event (id, name,
 * payload) that produced them. Real shape comes from @octokit/webhooks'
 * AggregateError - faked here rather than driving a real Probot instance to
 * a handler failure, since logWebhookError's own logic (what gets logged,
 * with what fields) is what's under test, not Probot's error-routing.
 */
function fakeErrorEvent(args: {
  errors: Error[];
  id: string;
  name: string;
  payload: unknown;
}): WebhookErrorEvent {
  const event = { id: args.id, name: args.name, payload: args.payload };
  return {
    event,
    [Symbol.iterator]: () => args.errors[Symbol.iterator](),
  } as unknown as WebhookErrorEvent;
}

function fakeLogger(): { log: Logger; calls: [Record<string, unknown>, string][] } {
  const calls: [Record<string, unknown>, string][] = [];
  const log = {
    error: (fields: Record<string, unknown>, message: string) => {
      calls.push([fields, message]);
    },
  } as unknown as Logger;
  return { log, calls };
}

describe("logWebhookError", () => {
  it("logs one structured line per error, with the repo pulled from the payload", () => {
    const { log, calls } = fakeLogger();
    const error = new Error("insert failed");

    logWebhookError(
      log,
      fakeErrorEvent({
        errors: [error],
        id: "delivery-123",
        name: "pull_request.opened",
        payload: { repository: { full_name: "acme/widgets" } },
      }),
    );

    expect(calls).toHaveLength(1);
    const [fields, message] = calls[0];
    expect(message).toBe("webhook handler failed");
    expect(fields.err).toBe(error);
    expect(fields.deliveryId).toBe("delivery-123");
    expect(fields.webhookEvent).toBe("pull_request.opened");
    expect(fields.repo).toBe("acme/widgets");
  });

  it("logs every error when a delivery's handler(s) threw more than one", () => {
    const { log, calls } = fakeLogger();

    logWebhookError(
      log,
      fakeErrorEvent({
        errors: [new Error("first"), new Error("second")],
        id: "delivery-456",
        name: "issues.assigned",
        payload: { repository: { full_name: "acme/widgets" } },
      }),
    );

    expect(calls).toHaveLength(2);
    expect(calls.map(([fields]) => (fields.err as Error).message)).toEqual(["first", "second"]);
  });

  it("logs repo as undefined for a payload with no repository field", () => {
    const { log, calls } = fakeLogger();

    logWebhookError(
      log,
      fakeErrorEvent({
        errors: [new Error("boom")],
        id: "delivery-789",
        name: "ping",
        payload: { zen: "Anything added dilutes everything else." },
      }),
    );

    expect(calls[0][0].repo).toBeUndefined();
  });
});
