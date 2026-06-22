// Bundled (see the `transportWorklet` vite plugin) into a classic script that exposes the
// transport classes on `globalThis` for the AudioWorklet scope.  Not imported by app code.
import { TempoMap, Transport } from './transport';

(globalThis as unknown as { WebSynthTransport: unknown }).WebSynthTransport = { TempoMap, Transport };
