import React from 'react';

const styles: { [key: string]: React.CSSProperties } = {
  root: {
    display: 'flex',
    flexDirection: 'column',
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
}

const ViewContextIcon = ({ tabIndex, icon, name, displayName, engine }: ViewContextIconProps) => (
  <div
    role='button'
    tabIndex={tabIndex}
    title={displayName}
    className='view-context-icon'
    onClick={() => engine.switch_view_context(name)}
    onKeyPress={evt => {
      if (evt.key === ' ' || evt.key === 'Enter') {
        engine.switch_view_context(name);
      }
    }}
  >
    {icon}
  </div>
);

const ViewContextSwitcher = ({ engine }: { engine: typeof import('./engine') }) => (
  <div style={styles.root}>
    {viewContexts.map(({ ...props }, i) => (
      <ViewContextIcon tabIndex={i} engine={engine} {...props} key={props.name} />
    ))}
  </div>
);

export default ViewContextSwitcher;
