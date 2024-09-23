import * as R from 'ramda';
import React, { useEffect, useRef, useState } from 'react';

import './GlobalMenu.css';
import { useQuery } from 'react-query';

import { getLoggedInUsername } from 'src/api';
import { parseUploadedFileAsText } from 'src/controls/FileUploader';
import { renderModalWithControls } from 'src/controls/Modal';
import { LoginModal } from 'src/login/LoginModal';
import {
  getLoginToken,
  reinitializeWithComposition,
  serializeAndDownloadComposition,
  setLoginToken,
} from 'src/persistance';
import { getState } from 'src/redux';
import { noop } from 'src/util';
import HamburgerMenuIcon from '../ViewContextManager/Icons/HamburgerMenu.svg';

const ctx = new AudioContext();

interface GlobalMenuItemProps {
  onClick: () => void;
  children?: React.ReactNode;
}

const GlobalMenuItem: React.FC<GlobalMenuItemProps> = ({ children, onClick }) => (
  <div className='global-menu-item' role='menuitem' onClick={onClick}>
    {children}
  </div>
);

const RetractGlobalMenuButton: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <button onClick={onClose} className='retract-global-menu-button'>
    &#x226b;
  </button>
);

export const globalTempoCSN = new ConstantSourceNode(ctx);
(window as any).globalTempoCSN = globalTempoCSN;
globalTempoCSN.offset.value = +(localStorage.getItem('globalTempo') ?? 120);
globalTempoCSN.start();

export const getGlobalBpm = () => globalTempoCSN.offset.value;

export const setGlobalBpm = (newGlobalTempo: number) => {
  globalTempoCSN.offset.value = newGlobalTempo;
  localStorage.globalTempo = newGlobalTempo.toFixed(1);
};

const GlobalTempoControl: React.FC = () => {
  const [tempo, setTempo] = useState<string>(globalTempoCSN.offset.value.toFixed(1));

  return (
    <div className='global-tempo-control'>
      <p>Global Tempo</p>
      <input
        type='number'
        value={tempo}
        onChange={evt => {
          const value = evt.target.value;
          let parsed = Number.parseFloat(value);

          if (!Number.isNaN(parsed)) {
            parsed = R.clamp(0.5, 1200, parsed);
            setGlobalBpm(parsed);
            setTempo(parsed.toFixed(1));
          } else {
            setTempo(value);
          }
        }}
      />
    </div>
  );
};

const LoginStatus: React.FC = () => {
  const [loggedIn, setLoggedIn] = useState<boolean | 'loading'>('loading');
  const loggedInUsername = useQuery([loggedIn], async () => {
    if (!loggedIn) {
      return null;
    }

    return getLoggedInUsername();
  });

  useEffect(
    () =>
      void getLoginToken()
        .then(token => setLoggedIn(!!token))
        .catch(noop),
    []
  );

  const handleLoginButtonClick = async () => {
    try {
      await renderModalWithControls(LoginModal, true);
    } catch (_err) {
      return;
    }
    setLoggedIn(!!(await getLoginToken()));
  };

  const logout = async () => {
    await setLoginToken('');
    setLoggedIn(false);
  };

  return (
    <div className='login-status'>
      {loggedIn === 'loading' ? <p>Loading login status...</p> : null}
      {loggedIn ? (
        <div className='logged-in-wrapper'>
          <p>Logged in{loggedInUsername.data ? ` as ${loggedInUsername.data}` : null}</p>
          <button onClick={logout}>Logout</button>
        </div>
      ) : (
        <button onClick={handleLoginButtonClick}>Log in / Register</button>
      )}
    </div>
  );
};

interface GlobalMenuProps {
  closeMenu: () => void;
  engine: typeof import('../engine');
  isOpen: boolean;
}

const GlobalMenu: React.FC<GlobalMenuProps> = ({ closeMenu, engine, isOpen }) => {
  const loadCompositionUploader = useRef<HTMLInputElement | null>(null);

  return (
    <div className='global-menu' role='menu' style={isOpen ? undefined : { right: -300 }}>
      <RetractGlobalMenuButton onClose={closeMenu} />
      <GlobalTempoControl />
      <GlobalMenuItem
        onClick={() => {
          serializeAndDownloadComposition();
          closeMenu();
        }}
      >
        Save to File
      </GlobalMenuItem>
      <GlobalMenuItem
        onClick={() => {
          if (!loadCompositionUploader.current) {
            throw new Error('loadCompositionUploader.current is null');
          }

          loadCompositionUploader.current.value = '';
          loadCompositionUploader.current.dispatchEvent(new MouseEvent('click'));
        }}
      >
        <>
          <input
            ref={loadCompositionUploader}
            type='file'
            id='load-composition-uploader'
            style={{ display: 'none' }}
            onChange={async evt => {
              const { fileContent } = await parseUploadedFileAsText(evt);
              const allViewContextIds = getState().viewContextManager.activeViewContexts.map(
                R.prop('uuid')
              );
              const res = reinitializeWithComposition(
                { type: 'serialized', value: fileContent },
                engine,
                allViewContextIds
              );
              if (res.value) {
                alert('Error loading composition: ' + res.value);
              }
              closeMenu();
            }}
          />
          Load from File
        </>
      </GlobalMenuItem>

      <LoginStatus />
    </div>
  );
};

const GlobalMenuButton: React.FC<{ engine: typeof import('../engine') }> = ({ engine }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <div
        title='Open Menu'
        role='button'
        onClick={() => setIsOpen(true)}
        className='global-menu-button'
        dangerouslySetInnerHTML={{ __html: HamburgerMenuIcon }}
      ></div>

      <GlobalMenu engine={engine} closeMenu={() => setIsOpen(false)} isOpen={isOpen} />
      {isOpen ? (
        <>
          <div className='global-menu-backdrop' onClick={() => setIsOpen(false)} />
        </>
      ) : null}
    </>
  );
};

export default GlobalMenuButton;
