export const LAB_REPORT_LIMIT_BYTES = 16 * 1024 * 1024;
const encoder = new TextEncoder();

export function labJson(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error("lab report is not JSON");
  const bytes = encoder.encode(json).byteLength;
  if (bytes > LAB_REPORT_LIMIT_BYTES)
    throw new Error(
      `lab report has ${bytes} bytes; limit is ${LAB_REPORT_LIMIT_BYTES}`,
    );
  return json;
}

export function awaitLabWrite<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("lab report write timed out after 10000 ms")),
      10000,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
