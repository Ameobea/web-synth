import { initGlobals } from 'src/util';

/**
 * Put as a module so that we can import it first before other imports and have this flag set
 * in all other modules.
 */
(window as any).isHeadless = true;
initGlobals();
