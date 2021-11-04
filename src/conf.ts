export const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL || 'http://localhost:7467';

export const FAUST_COMPILER_ENDPOINT =
  process.env.FAUST_COMPILER_ENDPOINT ||
  (process.env.NODE_ENV === 'development'
    ? 'http://localhost:4565'
    : 'https://faust-compiler.ameo.design');
