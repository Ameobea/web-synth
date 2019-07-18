export const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL || 'http://localhost:7467';

export const FAUST_COMPILER_ENDPOINT =
  process.env.NODE_ENV === 'development' && false
    ? 'http://localhost:4565/compile'
    : 'https://faust.p.ameo.design/compile';
