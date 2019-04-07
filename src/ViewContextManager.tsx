import React, { Fragment } from 'react';
import { connect } from 'react-redux';
import * as R from 'ramda';

import { State as ViewContextManagerState } from './redux/reducers/viewContextManager';
import { State as ReduxState } from './redux';

const styles: { [key: string]: React.CSSProperties } = {
  root: {
    display: 'flex',
    flexDirection: 'column',
  },
  viewContextSwitcher: {
    display: 'flex',
    flexDirection: 'row',
  },
};

const viewContexts = [
  { icon: 'C', name: 'clip_compositor', displayName: 'Clip Compositor' },
  { icon: 'M', name: 'midi_editor', displayName: 'MIDI Editor' },
  { icon: 'F', name: 'faust_editor', displayName: 'Faust Code Editor' },
];

interface ViewContextIconProps {
  tabIndex: number;
  icon: React.ReactNode;
  name: string;
  displayName: string | undefined;
  engine: typeof import('./engine');
  style?: React.CSSProperties;
  onClick: () => void;
}

const ViewContextIcon = ({
  tabIndex,
  icon,
  name,
  displayName,
  engine,
  style,
  onClick,
}: ViewContextIconProps) => (
  <div
    role='button'
    tabIndex={tabIndex}
    title={displayName}
    className='view-context-icon'
    onClick={onClick}
    onKeyPress={evt => {
      if (evt.key === ' ' || evt.key === 'Enter') {
        engine.create_view_context(name);
      }
    }}
    style={style}
  >
    {icon}
  </div>
);

interface ViewContextManagerProps {
  engine: typeof import('./engine');
}

export const ViewContextManager = ({ engine }: ViewContextManagerProps) => (
  <div style={styles.root}>
    <ViewContextIcon
      tabIndex={-1}
      engine={engine}
      displayName='Reset View Context Manager'
      onClick={engine.reset_vcm}
      style={{ backgroundColor: 'red' }}
      icon='X'
      name='Delete'
    />
    {viewContexts.map(({ ...props }, i) => (
      <ViewContextIcon
        tabIndex={i}
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

const ViewContextSwitcherInner = ({ engine, viewContextManager }: ViewContextSwitcherProps) => (
  <div style={styles.viewContextSwitcher}>
    {viewContextManager.activeViewContexts.map(({ name, uuid }, i) => (
      <ViewContextIcon
        tabIndex={i}
        icon='X'
        engine={engine}
        name={name}
        displayName={uuid}
        key={uuid}
        style={{
          marginRight: 20,
          paddingLeft: 20,
          paddingRight: 20,
          height: 28,
          backgroundColor: viewContextManager.activeViewContextIx === i ? 'DarkOrchid' : undefined,
        }}
        onClick={() => engine.switch_view_context(uuid)}
      />
    ))}
  </div>
);

const mapStateToProps: (
  state: ReduxState
) => { viewContextManager: ReduxState['viewContextManager'] } = R.pick(['viewContextManager']);

export const ViewContextSwitcher = connect(mapStateToProps)(ViewContextSwitcherInner);
