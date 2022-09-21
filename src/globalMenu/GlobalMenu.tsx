import * as R from 'ramda';
import React, { useState } from 'react';

import './GlobalMenu.scss';
import { parseUploadedFileAsText } from 'src/controls/FileUploader';
import { reinitializeWithComposition, serializeAndDownloadComposition } from 'src/persistance';
import { getState } from 'src/redux';

const ctx = new AudioContext();

const GlobalMenuItem: React.FC<{ onClick: () => void }> = ({ children, onClick }) => (
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

const setGlobalTempo = (newGlobalTempo: number) => {
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
            setGlobalTempo(parsed);
            setTempo(parsed.toFixed(1));
          } else {
            setTempo(value);
          }
        }}
      />
    </div>
  );
};

interface GlobalMenuProps {
  closeMenu: () => void;
  engine: typeof import('../engine');
  isOpen: boolean;
}

const GlobalMenu: React.FC<GlobalMenuProps> = ({ closeMenu, engine, isOpen }) => (
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
        const uploader = document.getElementById('load-composition-uploader')! as HTMLInputElement;
        uploader.value = '';

        uploader.dispatchEvent(new MouseEvent('click'));
      }}
    >
      <>
        <input
          type='file'
          id='load-composition-uploader'
          style={{ display: 'none' }}
          onChange={async evt => {
            const { fileContent } = await parseUploadedFileAsText(evt);
            const allViewContextIds = getState().viewContextManager.activeViewContexts.map(
              R.prop('uuid')
            );
            const res = reinitializeWithComposition(fileContent, engine, allViewContextIds);
            if (res.value) {
              alert('Error loading composition: ' + res.value);
            }
            closeMenu();
          }}
        />
        Load from File
      </>
    </GlobalMenuItem>
  </div>
);

const GlobalMenuButton: React.FC<{ engine: typeof import('../engine') }> = ({ engine }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <div
        title='Open Menu'
        role='button'
        onClick={() => setIsOpen(true)}
        className='global-menu-button'
      >
        ☰
      </div>

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
