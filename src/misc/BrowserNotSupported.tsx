import React from 'react';
import { ANewTab } from 'ameo-utils';

import 'src/index.css';
import './BrowserNotSupported.scss';

const BrowserNotSupported: React.FC<{}> = () => (
  <div className='browser-not-supported'>
    <h1>Your Browser Isn&apos;t Supported</h1>

    <p>
      Unfortunately, your current browser isn&apos;t supported by this application. Web Synth makes
      use of the modern{' '}
      <ANewTab to='https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletNode'>
        <code>AudioWorkletNode</code>
      </ANewTab>{' '}
      browser API for many of its internal components, and your browser doesn&apos;t support it. The
      one browser that I know for sure has support is Google Chrome, but others may have support by
      now as well.
    </p>
    <p>
      If you are using Google Chrome and are still seeing this message, you probably need to update
      to the latest version.
    </p>
    <hr />
    <p>
      I&apos;m sorry for the inconvenience. Web Synth makes use of bleeding-edge technologies and
      not all browsers have caught up yet. Trust me - you don&apos;t want to use it without them!
    </p>
    <br />
  </div>
);

export default BrowserNotSupported;
