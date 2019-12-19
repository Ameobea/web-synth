/* eslint-disable react/jsx-key */
import React from 'react';
import { connect } from 'react-redux';

import { SequencerReduxState, SequencerReduxInfra } from './redux';
import './SequencerUI.scss';

const CELL_SIZE_PX = 40 as const;

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

const SequencerGrid: React.FC<{
  rowMarks: boolean[][];
  actionCreators: SequencerReduxInfra['actionCreators'];
  dispatch: SequencerReduxInfra['dispatch'];
}> = ({ actionCreators, dispatch, rowMarks }) => (
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
);

const mapStateToProps = (state: { sequencer: SequencerReduxState }) => ({
  marks: state.sequencer.marks,
});

const SequencerUI: React.FC<{
  actionCreators: SequencerReduxInfra['actionCreators'];
  dispatch: SequencerReduxInfra['dispatch'];
} & ReturnType<typeof mapStateToProps>> = ({ marks, dispatch, actionCreators }) => {
  return (
    <div className='sequencer'>
      <SequencerGrid rowMarks={marks} dispatch={dispatch} actionCreators={actionCreators} />
    </div>
  );
};

export default connect(mapStateToProps)(SequencerUI);
