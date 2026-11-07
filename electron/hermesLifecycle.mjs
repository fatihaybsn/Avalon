// Cancellation only ends this wait. Callers fence any continuation that can
// mutate shared state, and join owned operations before releasing resources.
export function abortable(operation, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => {
      signal.throwIfAborted();
      return operation();
    }).then(resolve, (error) => reject(signal.aborted ? signal.reason : error))
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

export const HERMES_CLEANUP_TIMEOUT_MS = 3000;

export async function settleWithin(operation, timeoutMs = HERMES_CLEANUP_TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(operation).then(() => true, () => true),
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}
