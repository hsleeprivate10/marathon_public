export class OfficialTransportError extends Error {
  readonly name = "OfficialTransportError";

  constructor(readonly reason: "network" | "timeout") {
    super(reason);
  }
}

export function remainingTime(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

export function runWithTimeout<T>(
  start: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const timeout = new OfficialTransportError("timeout");
  if (timeoutMs <= 0) return Promise.reject(timeout);

  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(timeout);
      reject(timeout);
    }, timeoutMs);
    const operation = Promise.resolve().then(() => start(controller.signal));
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
