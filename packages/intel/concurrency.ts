/** Preserve input order, bound in-flight work, and drain it before propagating errors. */
export async function mapConcurrent<T, R>(items: readonly T[], limit: number, run: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const output: R[] = new Array(items.length);
  let cursor = 0, failed = false, failure: unknown;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failed && cursor < items.length) {
      const index = cursor++;
      try { output[index] = await run(items[index], index); }
      catch (error) { failed = true; failure ??= error; }
    }
  }));
  if (failed) throw failure;
  return output;
}
