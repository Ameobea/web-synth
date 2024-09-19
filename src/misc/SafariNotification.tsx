import { useState } from 'react';

import { isSafari } from 'src/util';
import './SafariNotification.css';
import { createRoot } from 'react-dom/client';

export const SafariNotification = () => {
  const [showBanner, setShowBanner] = useState(
    (() => {
      const dismissed = localStorage.getItem('safariNotificationDismissed');
      return isSafari() && !dismissed;
    })()
  );

  if (!showBanner) {
    return null;
  }

  return (
    <div className='safari-notification'>
      <p className='safari-notification-message'>
        The Safari browser has some significant problems with Web Audio that may result in issues or
        poor performance.
        <br />
        For the best experience, please use a different browser for Web Synth.
      </p>
      <button
        onClick={() => {
          localStorage.setItem('safariNotificationDismissed', 'true');
          setShowBanner(false);
        }}
        className='safari-notification-button'
      >
        Dismiss
      </button>
    </div>
  );
};

export const createSafariNotification = () => {
  const rootElem = document.createElement('div');
  rootElem.style.width = '100%';
  rootElem.id = 'safari-notification-root';
  document.body.appendChild(rootElem);

  createRoot(rootElem).render(<SafariNotification />);
};
