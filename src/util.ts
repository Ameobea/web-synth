import { UnreachableException } from 'ameo-utils';
import { Option, Try } from 'funfix-core';

export const clamp = (min: number, max: number, val: number) => Math.min(Math.max(val, min), max);

/**
 * Rounds a number to the specified number of decimals and returns it.
 *
 * @param num number to round
 * @param decimals number of decimal places to round it to
 */
export const roundTo = (num: number, decimals: number): number => {
  const multiplicand = Math.pow(10, decimals);
  return Math.round(num * multiplicand) / multiplicand;
};

export const midiToFrequency = (midiNote: number) => Math.pow(2, (midiNote - 69) / 12) * 440;

/**
 * Tries to parse the provided string out of JSON.
 **/
export const tryParseJson = <T, D = T>(
  serialized: string,
  defaultValue: D,
  errMsg?: string
): T | D =>
  Try.of(() => JSON.parse(serialized) as T).getOrElseL(() => {
    console.warn(errMsg || 'Failed to parse JSON; falling back to default value.');
    return defaultValue;
  });

// Taken from https://gist.github.com/jonleighton/958841
export function base64ArrayBuffer(arrayBuffer: ArrayBufferLike): string {
  let base64 = '';
  const encodings = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  const bytes = new Uint8Array(arrayBuffer);
  const byteLength = bytes.byteLength;
  const byteRemainder = byteLength % 3;
  const mainLength = byteLength - byteRemainder;

  let a, b, c, d;
  let chunk;

  // Main loop deals with bytes in chunks of 3
  for (let i = 0; i < mainLength; i = i + 3) {
    // Combine the three bytes into a single integer
    chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];

    // Use bitmasks to extract 6-bit segments from the triplet
    a = (chunk & 16515072) >> 18; // 16515072 = (2^6 - 1) << 18
    b = (chunk & 258048) >> 12; // 258048   = (2^6 - 1) << 12
    c = (chunk & 4032) >> 6; // 4032     = (2^6 - 1) << 6
    d = chunk & 63; // 63       = 2^6 - 1

    // Convert the raw binary segments to the appropriate ASCII encoding
    base64 += encodings[a] + encodings[b] + encodings[c] + encodings[d];
  }

  // Deal with the remaining bytes and padding
  if (byteRemainder == 1) {
    chunk = bytes[mainLength];

    a = (chunk & 252) >> 2; // 252 = (2^6 - 1) << 2

    // Set the 4 least significant bits to zero
    b = (chunk & 3) << 4; // 3   = 2^2 - 1

    base64 += encodings[a] + encodings[b] + '==';
  } else if (byteRemainder == 2) {
    chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1];

    a = (chunk & 64512) >> 10; // 64512 = (2^6 - 1) << 10
    b = (chunk & 1008) >> 4; // 1008  = (2^6 - 1) << 4

    // Set the 2 least significant bits to zero
    c = (chunk & 15) << 2; // 15    = 2^4 - 1

    base64 += encodings[a] + encodings[b] + encodings[c] + '=';
  }

  return base64;
}

// Taken from: https://stackoverflow.com/a/21797381/3833068
export function base64ToArrayBuffer(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export const delay = (delayMs: number) => new Promise(resolve => setTimeout(resolve, delayMs));

export const retryAsync = async <T>(
  fn: () => Promise<T>,
  attempts = 3,
  delayMs = 50
): Promise<T> => {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fn();
      return res;
    } catch (err) {
      if (i === attempts - 1) {
        // Out of attempts
        throw err;
      }

      await delay(delayMs);
    }
  }
  throw new UnreachableException();
};

export class AsyncOnce<T> {
  private getter: () => Promise<T>;
  private pending: Promise<T> | null = null;
  private res: Option<T> = Option.none();

  constructor(getter: () => Promise<T>) {
    this.getter = getter;
  }

  public async get(): Promise<T> {
    if (this.res.nonEmpty()) {
      return this.res.get();
    }
    if (this.pending) {
      return this.pending;
    }

    this.pending = new Promise(resolve =>
      this.getter().then(res => {
        this.res = Option.some(res);
        this.pending = null;
        resolve(res);
      })
    );
    return this.pending!;
  }
}

export const retryWithDelay = async <T>(
  delayMs: number,
  maxAttempts = 20,
  fn: () => Promise<T>
) => {
  function* retries() {
    let attempts = 0;
    while (attempts < maxAttempts) {
      yield attempts;
      attempts += 1;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
  for (const _i of retries()) {
    try {
      const res = await fn();
      return res;
    } catch (_err) {
      await delay(delayMs);
    }
  }
};

export const truncateWithElipsis = (s: string, maxLength: number): string => {
  let truncated = s.slice(0, maxLength);
  if (truncated.length !== s.length) {
    truncated += '…';
  }

  return truncated;
};

export const genRandomStringID = () => btoa(`${Math.random()}${Math.random()}`);
