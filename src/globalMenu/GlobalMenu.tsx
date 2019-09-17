import React, { useState } from 'react';
import { connect } from 'react-redux';
import * as R from 'ramda';

import { serializeAndDownloadComposition, loadComposition } from '../persistance';
import './GlobalMenu.scss';
import { parseUploadedFileAsText } from '../controls/FileUploader';

const GlobalMenuItem: React.FC<{ onClick: () => void }> = ({ children, onClick }) => (
  <div className='global-menu-item' role='menuitem' onClick={onClick}>
    {children}
  </div>
);

const mapGlobalMenuStateToProps = ({ viewContextManager }) => ({
  allViewContextIds: viewContextManager.activeViewContexts.map(R.prop('uuid')),
});

const GlobalMenuInner: React.FC<
  { closeMenu: () => void; engine: typeof import('../engine') } & ReturnType<
    typeof mapGlobalMenuStateToProps
  >
> = ({ closeMenu, engine, allViewContextIds }) => (
  <div className='global-menu' role='menu'>
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
        console.log('d');
        document
          .getElementById('load-composition-uploader')!
          .dispatchEvent(new MouseEvent('click'));
      }}
    >
      <>
        <input
          type='file'
          id='load-composition-uploader'
          style={{ display: 'none' }}
          onChange={async evt => {
            const { fileContent } = await parseUploadedFileAsText(evt);
            loadComposition(fileContent, engine, allViewContextIds);
            closeMenu();
          }}
        />
        Load from File
      </>
    </GlobalMenuItem>
  </div>
);

const GlobalMenu = connect(mapGlobalMenuStateToProps)(GlobalMenuInner);

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
      {isOpen ? (
        <>
          <div className='global-menu-backdrop' onClick={() => setIsOpen(false)} />
          <GlobalMenu engine={engine} closeMenu={() => setIsOpen(false)} />
        </>
      ) : null}
    </>
  );
};

export default GlobalMenuButton;
