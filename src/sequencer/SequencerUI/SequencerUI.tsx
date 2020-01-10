/* eslint-disable react/jsx-key */
import React from 'react';
import { connect } from 'react-redux';

import { SequencerReduxState, SequencerReduxInfra } from '../redux';
import InputSelect from './InputSelect';
import SequencerSettings from './SequencerSettings';
import './SequencerUI.scss';

const CELL_SIZE_PX = 40 as const;

const EditingVoiceSelector: React.FC<{ isSelected: boolean; onSelect: () => void }> = ({
  isSelected,
  onSelect,
}) => (
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

const mapSequencerGridStateToProps = (state: { sequencer: SequencerReduxState }) => ({
  currentEditingVoiceIx: state.sequencer.currentEditingVoiceIx,
});

const SequencerGridInner: React.FC<{
  rowMarks: boolean[][];
  actionCreators: SequencerReduxInfra['actionCreators'];
  dispatch: SequencerReduxInfra['dispatch'];
} & ReturnType<typeof mapSequencerGridStateToProps>> = ({
  actionCreators,
  dispatch,
  rowMarks,
  currentEditingVoiceIx,
}) => (
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

const SequencerGrid = connect(mapSequencerGridStateToProps)(SequencerGridInner);

const mapStateToProps = (state: { sequencer: SequencerReduxState }) => ({
  marks: state.sequencer.marks,
});

const SequencerUI: React.FC<{
  vcId: string;
  actionCreators: SequencerReduxInfra['actionCreators'];
  dispatch: SequencerReduxInfra['dispatch'];
} & ReturnType<typeof mapStateToProps>> = ({ vcId, marks, dispatch, actionCreators }) => (
  <div className='sequencer'>
    <SequencerGrid rowMarks={marks} actionCreators={actionCreators} />
    <button onClick={() => dispatch(actionCreators.sequencer.ADD_VOICE())}>Add Voice</button>
    <SequencerSettings actionCreators={actionCreators} />
    <InputSelect vcId={vcId} actionCreators={actionCreators} />
  </div>
);

export default connect(mapStateToProps)(SequencerUI);
