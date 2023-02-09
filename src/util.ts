import { filterNils, UnreachableException } from 'ameo-utils';
import { Option, Try } from 'funfix-core';
import * as R from 'ramda';

import type { ADSRValues } from 'src/controls/adsr';
import type { Adsr } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';

export const SAMPLE_RATE = 44_100;

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

export const msToSamples = (ms: number): number => (ms / 1000) * 44_100;

export const samplesToMs = (samples: number): number => (samples / 44_100) * 1000;

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
  private retry: boolean | { attempts?: number; delayMs?: number };
  private getter: () => Promise<T>;
  private pending: Promise<T> | null = null;
  private res: Option<T> = Option.none();

  constructor(
    getter: () => Promise<T>,
    retry: boolean | { attempts?: number; delayMs?: number } = false
  ) {
    this.getter = getter;
    this.retry = retry;
  }

  public async get(): Promise<T> {
    if (this.res.nonEmpty()) {
      return this.res.get();
    }
    if (this.pending) {
      return this.pending;
    }

    this.pending = new Promise(resolve => {
      let promise: Promise<T>;
      if (this.retry) {
        const { attempts = undefined, delayMs = undefined } =
          typeof this.retry === 'object' ? this.retry : {};
        promise = retryAsync(this.getter, attempts, delayMs);
      } else {
        promise = this.getter();
      }

      promise.then(res => {
        this.res = Option.some(res);
        this.pending = null;
        resolve(res);
      });
    });
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

export const classNameIncludes = (
  className: string | SVGAnimatedString | null | undefined,
  needle: string
): boolean => {
  if (R.isNil(className)) {
    return false;
  }

  if (className instanceof SVGAnimatedString) {
    return className.baseVal.includes(needle);
  }
  return className.includes(needle);
};

let engineHandle: typeof import('./engine');

export const setEngine = (engine: typeof import('./engine')) => {
  engineHandle = engine;
};
export const getEngine = (): typeof import('./engine') | undefined => engineHandle;

export const linearToDb = (res: number): number => {
  const db = (20 * Math.log(res)) / Math.LN10;
  if (db > 100) {
    return 100;
  } else if (db < -100) {
    return -100;
  }
  return Number.isNaN(db) ? -100 : db;
};

export const dbToLinear = (dB: number): number => Math.pow(10, dB / 20);

// prettier-ignore
export const getHasSIMDSupport = () => WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]))

// Adapted from https://github.com/Tokimon/vanillajs-browser-helpers/blob/master/src/inView.ts
// License: MIT
export function elemInView(elm: HTMLElement) {
  const rect = elm.getBoundingClientRect();
  const vpWidth = window.innerWidth;
  const vpHeight = window.innerHeight;

  const above = rect.bottom <= 0;
  const below = rect.top - vpHeight >= 0;
  const left = rect.right <= 0;
  const right = rect.left - vpWidth >= 0;
  return !above && !below && !left && !right;
}

export const mkLinearToLog = (logmin: number, logmax: number, logsign: number) => (x: number) =>
  logsign * Math.exp(Math.log(logmin) + ((Math.log(logmax) - Math.log(logmin)) * x) / 100);

export const mkLogToLinear = (logmin: number, logmax: number, logsign: number) => (y: number) =>
  ((Math.log(y * logsign) - Math.log(logmin)) * 100) / (Math.log(logmax) - Math.log(logmin));

export const normalizeEnvelope = (envelope: Adsr | ADSRValues): Adsr => {
  if (Object.keys(envelope).every(k => ['attack', 'decay', 'release'].includes(k))) {
    const env = envelope as ADSRValues;
    const normalizedSteps = filterNils([
      env.attack.pos === 0
        ? null
        : { x: 0, y: 0, ramper: { type: 'exponential' as const, exponent: 1 } },
      ...[env.attack, env.decay, env.release].map(s => ({
        x: s.pos,
        y: s.magnitude,
        ramper: { type: 'exponential' as const, exponent: 1 },
      })),
      env.release.pos === 1
        ? null
        : { x: 1, y: 0, ramper: { type: 'exponential' as const, exponent: 1 } },
    ]);
    return {
      steps: normalizedSteps,
      lenSamples: 44_100,
      loopPoint: null,
      releasePoint: env.release.pos ?? 0.9,
      audioThreadData: { phaseIndex: 0, debugName: '`normalizeEnvelope`' },
    };
  }
  return envelope as Adsr;
};
