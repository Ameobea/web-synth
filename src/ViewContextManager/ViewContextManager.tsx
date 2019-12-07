import React, { useState, useRef, useEffect } from 'react';
import { connect } from 'react-redux';
import * as R from 'ramda';

import { ReduxStore } from 'src/redux';
import GlobalMenuButton from 'src/globalMenu/GlobalMenu';
import GlobalVolumeSlider from './GlobalVolumeSlider';
import './ViewContextManager.css';

const styles: { [key: string]: React.CSSProperties } = {
  root: {
    display: 'flex',
    flexDirection: 'column',
  },
  viewContextSwitcher: {
    display: 'flex',
    flexDirection: 'row',
  },
  viewContextTab: {
    marginRight: 4,
    height: 28,
    width: 160,
  },
};

const viewContexts: { children: string; name: string; displayName: string }[] = [
  { children: 'C', name: 'clip_compositor', displayName: 'Clip Compositor' },
  { children: 'M', name: 'midi_editor', displayName: 'MIDI Editor' },
  { children: 'F', name: 'faust_editor', displayName: 'Faust Code Editor' },
  { children: 'G', name: 'graph_editor', displayName: 'Graph Editor' },
  { children: 'S', name: 'composition_sharing', displayName: 'Composition Sharing' },
  { children: 'D', name: 'synth_designer', displayName: 'Synth Designer' },
  { children: 'K', name: 'midi_keyboard', displayName: 'MIDI Keyboard' },
];

interface ViewContextIconProps extends React.HtmlHTMLAttributes<HTMLDivElement> {
  name: string;
  displayName: string | undefined;
  style?: React.CSSProperties;
  onClick: () => void;
}

const ViewContextIcon: React.FC<ViewContextIconProps> = ({
  displayName,
  style,
  onClick,
  children,
  ...rest
}) => (
  <div
    role='button'
    title={displayName}
    className='view-context-icon'
    onClick={onClick}
    style={style}
    {...rest}
  >
    {children}
  </div>
);

export const ViewContextManager: React.FC<{
  engine: typeof import('src/engine');
}> = ({ engine }) => {
  const [volumeSliderOpen, setVolumeSliderOpen] = useState(false);

  return (
    <div style={styles.root}>
      <GlobalMenuButton engine={engine} />
      <ViewContextIcon
        displayName='Reset View Context Manager'
        onClick={engine.reset_vcm}
        style={{ backgroundColor: '#730505' }}
        name='Delete'
      >
        X
      </ViewContextIcon>
      <ViewContextIcon
        displayName='Start Audio'
        onClick={() => new AudioContext().resume()}
        style={{ backgroundColor: 'rgb(26, 130, 24)' }}
        name='Start Audio'
      >
        …
      </ViewContextIcon>
      <ViewContextIcon
        displayName='Start Audio'
        onClick={() => setVolumeSliderOpen(true)}
        style={{ backgroundColor: 'rgb(47, 77, 121)' }}
        name='Start Audio'
      >
        <>
          🔊
          {volumeSliderOpen ? (
            <GlobalVolumeSlider onClose={() => setVolumeSliderOpen(false)} />
          ) : null}
        </>
      </ViewContextIcon>
      {viewContexts.map(({ ...props }) => (
        <ViewContextIcon
          {...props}
          key={props.name}
          onClick={() => engine.create_view_context(props.name)}
        />
      ))}

      <br />
      <br />
    </div>
  );
};

interface ViewContextTabProps {
  engine: typeof import('src/engine');
  name: string;
  uuid: string;
  title?: string;
  active: boolean;
  i: number;
}

const ViewContextTabRenamer: React.FC<{
  value: string;
  setValue: (newValue: string) => void;
  submit: () => void;
}> = ({ value, setValue, submit }) => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.focus();
    }
  });

  return (
    <input
      className='view-context-switcher-tab-renamer'
      type='text'
      value={value}
      onChange={e => setValue(e.target.value)}
      onKeyPress={e => {
        if (e.key === 'Enter') {
          submit();
        }
      }}
      ref={ref}
    />
  );
};

const VCTabCloseIcon: React.FC<{
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
}> = ({ onClick }) => (
  <div onClick={onClick} className='vc-close-tab-icon'>
    x
  </div>
);

const ViewContextTab = ({ engine, name, uuid, title, active }: ViewContextTabProps) => {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renamingTitle, setRenamingTitle] = useState(title || '');

  const displayName = title || name;

  return (
    <ViewContextIcon
      name={name}
      displayName={displayName}
      key={uuid}
      style={{
        ...styles.viewContextTab,
        backgroundColor: active ? 'DarkOrchid' : undefined,
      }}
      onClick={() => {
        if (!active) {
          engine.switch_view_context(uuid);
        }
      }}
      onDoubleClick={() => setIsRenaming(true)}
    >
      {isRenaming ? (
        <ViewContextTabRenamer
          value={renamingTitle}
          setValue={setRenamingTitle}
          submit={() => {
            setIsRenaming(false);
            engine.set_vc_title(uuid, renamingTitle);
          }}
        />
      ) : (
        <>
          <VCTabCloseIcon
            onClick={e => {
              engine.delete_vc_by_id(uuid);
              e.stopPropagation();
            }}
          />
          <span className='vc-switcher-tab-title'>{displayName}</span>
        </>
      )}
    </ViewContextIcon>
  );
};

const mapStateToProps = (state: ReduxStore) => R.pick(['viewContextManager'], state);

/**
 * Creates a list of tabs on the top of the screen that allow switching between the list of active
 * VCs.  It is kept up to date via Redux, which is in turn updated automatically by the VCM on the
 * backend every time there is a change.
 */
const ViewContextSwitcherInner: React.FC<{
  engine: typeof import('src/engine');
} & ReturnType<typeof mapStateToProps>> = ({ engine, viewContextManager }) => (
  <div style={styles.viewContextSwitcher}>
    {viewContextManager.activeViewContexts.map((props, i) => (
      <ViewContextTab
        engine={engine}
        {...props}
        i={i}
        key={i}
        active={viewContextManager.activeViewContextIx === i}
      />
    ))}
  </div>
);

export const ViewContextSwitcher = connect(mapStateToProps)(ViewContextSwitcherInner);
