import { createRoot } from 'react-dom/client';

import BrowserNotSupported from 'src/misc/BrowserNotSupported';
import { getSentry, initSentry } from 'src/sentry';

initSentry();
const root = createRoot(document.getElementById('root')!);

const environmentIsValid =
  typeof AudioWorkletNode !== 'undefined' && typeof ConstantSourceNode !== 'undefined';
if (environmentIsValid) {
  require('./FMSynthDemo');
} else {
  getSentry()?.captureException(
    new Error('Browser does not support `AudioWorkletNode`; displaying not supported message')
  );
  root.render(
    <div style={{ width: '100vw', height: '100vh', display: 'flex' }}>
      <BrowserNotSupported mobileSupported />
    </div>
  );
}
