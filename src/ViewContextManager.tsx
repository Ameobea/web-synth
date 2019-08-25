import React, { Fragment, useState, useRef, useEffect } from 'react';
import { connect } from 'react-redux';
import * as R from 'ramda';

import { State as ViewContextManagerState } from './redux/reducers/viewContextManager';
import { State as ReduxState } from './redux';
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

const viewContexts = [
  { children: 'C', name: 'clip_compositor', displayName: 'Clip Compositor' },
  { children: 'M', name: 'midi_editor', displayName: 'MIDI Editor' },
  { children: 'F', name: 'faust_editor', displayName: 'Faust Code Editor' },
  { children: 'G', name: 'graph_editor', displayName: 'Graph Editor' },
];

interface ViewContextIconProps extends React.HtmlHTMLAttributes<HTMLDivElement> {
  name: string;
  displayName: string | undefined;
  engine: typeof import('./engine');
  style?: React.CSSProperties;
  onClick: () => void;
}

const ViewContextIcon = ({
  displayName,
  style,
  onClick,
  children,
  ...rest
}: ViewContextIconProps) => (
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

interface ViewContextManagerProps {
  engine: typeof import('./engine');
}

export const ViewContextManager = ({ engine }: ViewContextManagerProps) => (
  <div style={styles.root}>
    <ViewContextIcon
      engine={engine}
      displayName='Reset View Context Manager'
      onClick={engine.reset_vcm}
      style={{ backgroundColor: 'red' }}
      name='Delete'
    >
      X
    </ViewContextIcon>
    {viewContexts.map(({ ...props }) => (
      <ViewContextIcon
        engine={engine}
        {...props}
        key={props.name}
        onClick={() => engine.create_view_context(props.name)}
      />
    ))}

    <br />
    <br />
  </div>
);

interface ViewContextSwitcherProps {
  engine: typeof import('./engine');
  viewContextManager: ViewContextManagerState;
}

interface ViewContextTabProps {
  engine: typeof import('./engine');
  name: string;
  uuid: string;
  title?: string;
  active: boolean;
  i: number;
}

const ViewContextTabRenamer = ({
  value,
  setValue,
  submit,
}: {
  value: string;
  setValue: (newValue: string) => void;
  submit: () => void;
}) => {
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

const VCTabCloseIcon = ({
  onClick,
}: {
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
}) => (
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
      engine={engine}
      name={name}
      displayName={displayName}
      key={uuid}
      style={{
        ...styles.viewContextTab,
        backgroundColor: active ? 'DarkOrchid' : undefined,
      }}
      onClick={() => engine.switch_view_context(uuid)}
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
        <Fragment>
          <VCTabCloseIcon
            onClick={e => {
              engine.delete_vc_by_id(uuid);
              e.stopPropagation();
            }}
          />
          <span className='vc-switcher-tab-title'>{displayName}</span>
        </Fragment>
      )}
    </ViewContextIcon>
  );
};

/**
 * Creates a list of tabs on the top of the screen that allow switching between the list of active
 * VCs.  It is kept up to date via Redux, which is in turn updated automatically by the VCM on the
 * backend every time there is a change.
 */
const ViewContextSwitcherInner = ({ engine, viewContextManager }: ViewContextSwitcherProps) => (
  <div style={styles.viewContextSwitcher}>
    {viewContextManager.activeViewContexts.map(({ ...props }, i) => (
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

const mapStateToProps: (
  state: ReduxState
) => { viewContextManager: ReduxState['viewContextManager'] } = R.pick(['viewContextManager']);

export const ViewContextSwitcher = connect(mapStateToProps)(ViewContextSwitcherInner);
