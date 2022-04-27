/**
 * Wraps the passed async function to only allow a single concurrent invocation. If a previous invocation is
 * still executing, it will instead wait for the current invocation to finish and return the same
 * return value.
 * @returns the wrapped function
 */
export function singleEntry<T extends unknown[], R>(asyncFunc: (...args: T) => Promise<R>): (...args: T) => Promise<R> {
  let currentInvocation: Promise<R> | undefined;
  return async (...args: T) => {
    if (currentInvocation) {
      return await currentInvocation;
    } else {
      currentInvocation = new Promise((resolve, reject) => {
        asyncFunc(...args)
          .then(resolve)
          .catch(reject)
          .finally(() => {
            currentInvocation = undefined;
          });
      });
      return currentInvocation;
    }
  };
}
