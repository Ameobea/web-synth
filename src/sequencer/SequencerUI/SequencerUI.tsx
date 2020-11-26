/* eslint-disable react/jsx-key */
import React from 'react';

import { SequencerReduxInfra } from '../redux';
import InputSelect from './InputSelect';
import SequencerSettings from './SequencerSettings';
import './SequencerUI.scss';

const CELL_SIZE_PX = 40 as const;

const EditingVoiceSelector: React.FC<{
  isSelected: boolean;
  onSelect: () => void;
}> = ({ isSelected, onSelect }) => (
  <div className={`editing-voice-selector${isSelected ? ' selected' : ''}`} onClick={onSelect} />
);

const SequencerRowInner: React.FC<{
  actionCreators: SequencerReduxInfra['actionCreators'];
  dispatch: SequencerReduxInfra['dispatch'];
  rowIx: number;
  marks: boolean[];
}> = ({ actionCreators, dispatch, rowIx, marks }) => (
  <>
    {marks.map((marked, colIx) => (
      <rect
        className={marked ? 'marked' : undefined}
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
      />
    ))}
  </>
);
const SequencerRow = React.memo(SequencerRowInner);

interface SequencerGridProps extends SequencerReduxInfra {
  rowMarks: boolean[][];
}

const SequencerGrid: React.FC<SequencerGridProps> = ({
  actionCreators,
  dispatch,
  rowMarks,
  useSelector,
}) => {
  const currentEditingVoiceIx = useSelector(state => state.sequencer.currentEditingVoiceIx);

  return (
    <div className='sequencer-grid-wrapper'>
      <div className='editing-voice-selectors'>
        {rowMarks.map((_, i) => (
          <EditingVoiceSelector
            key={i}
            isSelected={currentEditingVoiceIx === i}
            onSelect={() => dispatch(actionCreators.sequencer.SET_CURRENTLY_EDITING_VOICE_IX(i))}
          />
        ))}
      </div>
      <svg>
        {rowMarks.map((marks, rowIx) => (
          <SequencerRow
            rowIx={rowIx}
            actionCreators={actionCreators}
            dispatch={dispatch}
            marks={marks}
          />
        ))}
      </svg>
    </div>
  );
};

export interface SequencerUIProps extends SequencerReduxInfra {
  vcId: string;
}

const SequencerUI: React.FC<SequencerUIProps> = ({ vcId, ...reduxInfra }) => {
  const marks = reduxInfra.useSelector(state => state.sequencer.marks);

  return (
    <div className='sequencer'>
      <SequencerGrid rowMarks={marks} {...reduxInfra} />
      <button onClick={() => reduxInfra.dispatch(reduxInfra.actionCreators.sequencer.ADD_VOICE())}>
        Add Voice
      </button>
      <SequencerSettings {...reduxInfra} />
      <InputSelect vcId={vcId} {...reduxInfra} />
    </div>
  );
};

export default SequencerUI;
