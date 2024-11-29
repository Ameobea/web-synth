import React, { useCallback, useEffect, useRef, useState } from 'react';
import { shallowEqual, useSelector } from 'react-redux';
import { useDrag, useDrop, DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

import { GlobalVolumeSlider } from './GlobalVolumeSlider';
import './ViewContextManager.css';
import {
  BookmarkPosBeats,
  getIsGlobalBeatCounterStarted,
  registerGlobalStartCB,
  registerGlobalStopCB,
  setCurBeat,
  startAll,
  stopAll,
  unregisterStartCB,
  unregisterStopCB,
} from 'src/eventScheduler';
import GlobalMenuButton from 'src/globalMenu/GlobalMenu';
import type { ReduxStore } from 'src/redux';
import { getSentry } from 'src/sentry';
import AddModulePicker from 'src/ViewContextManager/AddModulePicker';
import RestartPlaybackIcon from './Icons/RestartPlayback.svg';
import PlayIcon from './Icons/Play.svg';
import StopIcon from './Icons/Stop.svg';
import ResetEverythingIcon from './Icons/ResetEverything.svg';
import VolumeIcon from './Icons/Volume.svg';
import PlusIcon from './Icons/Plus.svg';
import { useSvelteStore } from 'src/reactUtils';

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

interface ViewContextIconProps extends React.HtmlHTMLAttributes<HTMLDivElement> {
  name: string;
  displayName: string | undefined;
  style?: React.CSSProperties;
  onClick: (evt: React.MouseEvent) => void;
  fref?: React.Ref<HTMLDivElement>;
}

const ViewContextIcon: React.FC<ViewContextIconProps> = ({
  displayName,
  style,
  onClick,
  children,
  fref,
  ...rest
}) => (
  <div
    ref={fref}
    role='button'
    title={displayName}
    className='view-context-icon'
    onClick={evt => {
      onClick(evt);
      evt.preventDefault();
      evt.stopPropagation();
    }}
    style={style}
    {...rest}
  >
    {children}
  </div>
);

interface VCMProps {
  engine: typeof import('src/engine');
}

export const ViewContextManager: React.FC<VCMProps> = ({ engine }) => {
  const [volumeSliderOpen, setVolumeSliderOpen] = useState(false);
  const [modulePickerOpen, setModulePickerOpen] = useState(false);
  const [globalBeatCounterStarted, setGlobalBeatCounterStarted] = useState(
    getIsGlobalBeatCounterStarted()
  );

  useEffect(() => {
    const startCb = () => setGlobalBeatCounterStarted(true);
    const stopCb = () => setGlobalBeatCounterStarted(false);
    registerGlobalStartCB(startCb);
    registerGlobalStopCB(stopCb);

    return () => {
      unregisterStartCB(startCb);
      unregisterStopCB(stopCb);
    };
  }, []);
  const bookmarkPosBeats = useSvelteStore(BookmarkPosBeats);
  const hasBookmark = bookmarkPosBeats !== null;

  return (
    <div style={styles.root}>
      <GlobalMenuButton engine={engine} />
      <ViewContextIcon
        displayName='Reset Everything'
        onClick={() => {
          const confirmed = confirm('Really clear EVERYTHING and reset to scratch?');
          if (!confirmed) {
            return;
          }
          getSentry()?.captureMessage('Reset Everything button clicked');
          engine.reset_vcm();
        }}
        style={{ backgroundColor: '#730505', padding: 1 }}
        name='Reset Everything'
      >
        <div className='svg-wrapper' dangerouslySetInnerHTML={{ __html: ResetEverythingIcon }} />
      </ViewContextIcon>
      <ViewContextIcon
        displayName={globalBeatCounterStarted ? 'Stop Global Playback' : 'Start Global Playback'}
        onClick={() => {
          if (globalBeatCounterStarted) {
            stopAll();
          } else {
            startAll();
          }
        }}
        style={{ backgroundColor: 'rgb(26, 130, 24)' }}
        name={globalBeatCounterStarted ? 'Stop Global Play' : 'Start Global Play'}
      >
        <div
          className='svg-wrapper'
          dangerouslySetInnerHTML={{ __html: globalBeatCounterStarted ? StopIcon : PlayIcon }}
        />
      </ViewContextIcon>
      <ViewContextIcon
        displayName={
          hasBookmark
            ? 'Start Global Playback From Bookmark'
            : 'Start Global Playback From Beginning'
        }
        onClick={() => {
          if (globalBeatCounterStarted) {
            stopAll();
          }
          setCurBeat(bookmarkPosBeats ?? 0);
          startAll();
        }}
        style={{ backgroundColor: 'rgb(26, 130, 24)', padding: 3 }}
        name='Restart Playback'
      >
        <div className='svg-wrapper' dangerouslySetInnerHTML={{ __html: RestartPlaybackIcon }} />
      </ViewContextIcon>
      <ViewContextIcon
        displayName='Set Global Volume'
        onClick={() => setVolumeSliderOpen(true)}
        style={{
          backgroundColor: 'rgb(47, 77, 121)',
          justifyContent: 'space-around',
          fontSize: 27,
        }}
        name='Set Global Volume'
      >
        <>
          <div className='svg-wrapper' dangerouslySetInnerHTML={{ __html: VolumeIcon }} />
          {volumeSliderOpen ? (
            <GlobalVolumeSlider onClose={() => setVolumeSliderOpen(false)} />
          ) : null}
        </>
      </ViewContextIcon>
      <ViewContextIcon
        displayName='Add Module'
        name='Add Module'
        onClick={evt => {
          if ((evt.target as HTMLElement).tagName.toLowerCase() === 'button') {
            return;
          }

          setModulePickerOpen(true);
        }}
      >
        <div className='svg-wrapper' dangerouslySetInnerHTML={{ __html: PlusIcon }} />
        {modulePickerOpen ? <AddModulePicker onClose={() => setModulePickerOpen(false)} /> : null}
      </ViewContextIcon>
    </div>
  );
};

interface VCMTabRenamerProps {
  value: string;
  setValue: (newValue: string) => void;
  submit: () => void;
}

const ViewContextTabRenamer: React.FC<VCMTabRenamerProps> = ({ value, setValue, submit }) => {
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
      onKeyDown={e => {
        if (e.key === 'Enter') {
          submit();
        }
      }}
      ref={ref}
    />
  );
};

interface VCTabCloseIconProps {
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
}

const VCTabCloseIcon: React.FC<VCTabCloseIconProps> = ({ onClick }) => (
  <div onClick={onClick} className='vc-close-tab-icon'>
    ×
  </div>
);

const ItemTypes = {
  TAB: 'tab',
};

interface ViewContextTabProps {
  engine: typeof import('src/engine');
  name: string;
  uuid: string;
  title?: string;
  active: boolean;
  index: number;
  moveTab: (from: number, to: number) => void;
}

const ViewContextTab: React.FC<ViewContextTabProps> = ({
  engine,
  name,
  uuid,
  title,
  active,
  index,
  moveTab,
}) => {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renamingTitle, setRenamingTitle] = useState(title || '');

  const displayName = title || name;

  const ref = useRef(null);

  const [{ isDragging }, drag] = useDrag({
    type: ItemTypes.TAB,
    item: { index },
    collect: monitor => ({ isDragging: monitor.isDragging() }),
  });

  const [, drop] = useDrop({
    accept: ItemTypes.TAB,
    hover: (draggedItem: { index: number }) => {
      if (draggedItem.index !== index) {
        moveTab(draggedItem.index, index);
        draggedItem.index = index;
      }
    },
  });

  drag(drop(ref));

  return (
    <ViewContextIcon
      name={name}
      displayName={displayName}
      fref={ref}
      style={{
        ...styles.viewContextTab,
        opacity: isDragging ? 0.5 : 1,
        backgroundColor: active ? '#419282' : undefined,
        cursor: 'grab',
      }}
      onClick={() => {
        if (!active) {
          getSentry()?.addBreadcrumb({
            message: `Switching to VC ${uuid} name=${name} title=${title}`,
          });
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
            getSentry()?.addBreadcrumb({
              message: `Renaming VC ${uuid} name=${name} title=${title} to ${renamingTitle}`,
            });
            setIsRenaming(false);
            engine.set_vc_title(uuid, renamingTitle);
          }}
        />
      ) : (
        <>
          <VCTabCloseIcon
            onClick={e => {
              getSentry()?.addBreadcrumb({
                message: `Deleting VC ${uuid} name=${name} title=${title}`,
              });
              engine.delete_vc_by_id(uuid);
              e.stopPropagation();
            }}
          />
          <span className='vc-switcher-tab-title' data-vc-id={uuid} data-vc-name={name}>
            {displayName}
          </span>
        </>
      )}
    </ViewContextIcon>
  );
};

interface ViewContextSwitcherProps {
  engine: typeof import('src/engine');
}

/**
 * Creates a list of tabs on the top of the screen that allow switching between the list of active
 * VCs.  It is kept up to date via Redux, which is in turn updated automatically by the VCM on the
 * backend every time there is a change.
 */
export const ViewContextSwitcher: React.FC<ViewContextSwitcherProps> = ({ engine }) => {
  const { activeViewContexts, activeViewContextId, activeSubgraphID } = useSelector(
    (state: ReduxStore) => ({
      activeViewContexts: state.viewContextManager.activeViewContexts,
      activeViewContextId: state.viewContextManager.activeViewContextId,
      activeSubgraphID: state.viewContextManager.activeSubgraphID,
    }),
    shallowEqual
  );
  const [horizontalScroll, setHorizontalScroll] = useState(0);
  const [tabs, setTabs] = useState(activeViewContexts);

  useEffect(() => {
    setTabs(activeViewContexts.filter(vc => vc.subgraphId === activeSubgraphID));
  }, [activeViewContexts, activeSubgraphID]);

  const handleScroll: React.WheelEventHandler<HTMLDivElement> = useCallback(
    e => void setHorizontalScroll(prev => Math.max(prev + e.deltaY * 0.6, 0)),
    []
  );

  const moveTab = (fromIndex: number, toIndex: number) => {
    const origFromIndex = activeViewContexts.findIndex(vc => vc.uuid === tabs[fromIndex].uuid);
    const origToIndex = activeViewContexts.findIndex(vc => vc.uuid === tabs[toIndex].uuid);
    engine.swap_vc_positions(origFromIndex, origToIndex);
  };

  return (
    <DndProvider backend={HTML5Backend}>
      <div
        style={{
          ...styles.viewContextSwitcher,
          transform: `translateX(-${horizontalScroll}px)`,
        }}
        onWheel={handleScroll}
      >
        {tabs.map((props, index) => (
          <ViewContextTab
            engine={engine}
            {...props}
            key={props.uuid}
            active={props.uuid === activeViewContextId}
            index={index}
            moveTab={moveTab}
          />
        ))}
      </div>
    </DndProvider>
  );
};
