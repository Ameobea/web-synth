// declare module 'path-browserify';

declare module 'path-browserify' {
  export interface Path {
    dir: string;
    root: string;
    base: string;
    name: string;
    ext: string;
  }

  export const parse: (raw: string) => Path;
}
