import React, { useState } from 'react';
import { shallowEqual } from 'react-redux';

import type { SequencerMark, SequencerReduxInfra, SequencerReduxState } from '../redux';
import InputSelect from './InputSelect';
import SequencerSettings from './SequencerSettings';
import './SequencerUI.css';

import FlatButton from 'src/misc/FlatButton';
import ConfigureMark from 'src/sequencer/SequencerUI/ConfigureMark';

const CELL_SIZE_PX = 40 as const;

const VoiceNameSelector: React.FC<{
  name: string;
  setName: (newName: string) => void;
}> = ({ name, setName }) => {
  const [isRenaming, setIsRenaming] = useState<string | null>(null);

  if (isRenaming !== null) {
    return (
      <input
        style={{ width: 88 }}
        type='text'
        value={isRenaming}
        onChange={evt => setIsRenaming(evt.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            setName(isRenaming);
            setIsRenaming(null);
          } else if (e.key === 'Escape') {
            setIsRenaming(null);
          }
        }}
        ref={elem => elem?.focus()}
      />
    );
  }

  return <span onClick={() => setIsRenaming(name)}>{name}</span>;
};

interface EditingVoiceSelectorProps extends SequencerReduxInfra {
  isSelected: boolean;
  onSelect: () => void;
  voiceIx: number;
}

const EditingVoiceSelector: React.FC<EditingVoiceSelectorProps> = ({
  isSelected,
  onSelect,
  voiceIx,
  useSelector,
  dispatch,
  actionCreators,
}) => {
  const name = useSelector(state => state.sequencer.voices[voiceIx].name);

  return (
    <div className='editing-voice-selector-wrapper'>
      <VoiceNameSelector
        name={name}
        setName={newName => dispatch(actionCreators.sequencer.SET_VOICE_NAME(voiceIx, newName))}
      />
      <div
        className={`editing-voice-selector${isSelected ? ' selected' : ''}`}
        onClick={onSelect}
      />
    </div>
  );
};

interface SequencerRowProps extends SequencerReduxInfra {
  rowIx: number;
}

const getMarkClassname = (
  editingIx: number | null,
  activeIx: number | null,
  markIx: number,
  isMarked: boolean
): string | undefined => {
  const baseClassName = editingIx === markIx ? 'editing' : isMarked ? 'marked' : undefined;
  if (activeIx !== markIx) {
    return baseClassName;
  } else if (baseClassName) {
    return baseClassName + ' active';
  } else {
    return 'active';
  }
};

const SequencerRow: React.FC<SequencerRowProps> = ({
  rowIx,
  actionCreators,
  dispatch,
  useSelector,
}) => {
  const {
    row: { marks },
    editingIx,
    curActiveMarkIx,
  } = useSelector(
    ({ sequencer }) => ({
      row: sequencer.marks[rowIx],
      editingIx:
        sequencer.markEditState?.voiceIx === rowIx ? sequencer.markEditState!.editingMarkIx : null,
      curActiveMarkIx: sequencer.curActiveMarkIx,
    }),
    (a, b) => shallowEqual(a, b) && a.row.marks === b.row.marks
  );

  return (
    <>
      {marks.map((marked, colIx) => (
        <rect
          key={colIx}
          className={getMarkClassname(editingIx, curActiveMarkIx, colIx, !!marked)}
          x={colIx * CELL_SIZE_PX}
          y={rowIx * CELL_SIZE_PX}
          width={CELL_SIZE_PX}
          height={CELL_SIZE_PX}
          onClick={() => {
            if (marked) {
              dispatch(actionCreators.sequencer.UNMARK(rowIx, colIx));
            } else {
              dispatch(actionCreators.sequencer.MARK(rowIx, colIx));
            }
          }}
          onContextMenu={evt => {
            evt.preventDefault();
            if (!marked) {
              return;
            }

            dispatch(actionCreators.sequencer.TOGGLE_EDIT_MODE(rowIx, colIx));
          }}
        />
      ))}
    </>
  );
};

interface SequencerGridProps extends SequencerReduxInfra {
  rows: { marks: (SequencerMark | null)[]; rowID: string }[];
}

const SequencerGrid: React.FC<SequencerGridProps> = ({ rows, ...reduxInfra }) => {
  const currentEditingVoiceIx = reduxInfra.useSelector(
    state => state.sequencer.currentEditingVoiceIx
  );

  return (
    <div className='sequencer-grid-wrapper'>
      <div className='editing-voice-selectors'>
        {rows.map((_, i) => (
          <EditingVoiceSelector
            key={i}
            isSelected={currentEditingVoiceIx === i}
            onSelect={() =>
              reduxInfra.dispatch(
                reduxInfra.actionCreators.sequencer.SET_CURRENTLY_EDITING_VOICE_IX(i)
              )
            }
            voiceIx={i}
            {...reduxInfra}
          />
        ))}
      </div>
      <svg>
        {rows.map(({ rowID }, rowIx) => (
          <SequencerRow key={rowID} rowIx={rowIx} {...reduxInfra} />
        ))}
      </svg>
    </div>
  );
};

const SequencerUI: React.FC<SequencerReduxInfra> = reduxInfra => {
  const { marks, markEditState } = reduxInfra.useSelector(
    state => ({ marks: state.sequencer.marks, markEditState: state.sequencer.markEditState }),
    shallowEqual
  );

  return (
    <div className='sequencer'>
      <SequencerGrid rows={marks} {...reduxInfra} />

      {markEditState && markEditState.editingMarkIx !== null ? (
        <ConfigureMark {...reduxInfra} />
      ) : null}

      <SequencerSettings {...reduxInfra} />

      <InputSelect {...reduxInfra} />
    </div>
  );
};

export const SequencerSmallView: React.FC<SequencerReduxInfra> = ({
  dispatch,
  actionCreators,
  useSelector,
  vcId,
}) => {
  const isPlaying = useSelector(
    (state: { sequencer: SequencerReduxState }) => state.sequencer.isPlaying
  );

  return (
    <FlatButton onClick={() => dispatch(actionCreators.sequencer.TOGGLE_IS_PLAYING(vcId))}>
      {isPlaying ? 'Stop' : 'Start'}
    </FlatButton>
  );
};

export default SequencerUI;
