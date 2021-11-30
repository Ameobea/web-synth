import React, { useCallback, useState } from 'react';
import { useDispatch } from 'react-redux';

import { useDraggable } from 'src/reactUtils';
import { actionCreators, useSelector } from 'src/redux';
import { ControlPanelVisualizationDescriptor } from 'src/redux/modules/controlPanel';
import { SpectrumVisualization } from 'src/visualizations/spectrum';

interface ControlPanelSpectrogramProps
  extends Extract<ControlPanelVisualizationDescriptor, { type: 'spectrogram' }> {
  vcId: string;
  isEditing: boolean;
}

const ControlPanelSpectrogram: React.FC<ControlPanelSpectrogramProps> = ({
  vcId,
  analyser,
  position,
  name,
  isEditing,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const dispatch = useDispatch();
  const onDrag = useCallback(
    (newPos: { x: number; y: number }) =>
      dispatch(actionCreators.controlPanel.SET_CONTROL_PANEL_VIZ_POS(vcId, name, newPos)),
    [dispatch, name, vcId]
  );
  const { onMouseDown, isDragging } = useDraggable(onDrag, position);
  const isHidden = useSelector(state => state.controlPanel.stateByPanelInstance[vcId]?.hidden);

  return (
    <div
      className='control-panel-spectrogram'
      onMouseDown={isEditing ? onMouseDown : undefined}
      style={{
        position: 'absolute',
        top: position.y,
        left: position.x,
        cursor: isEditing ? (isDragging ? 'grabbing' : 'grab') : 'default',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <SpectrumVisualization paused={isHidden} analyzerNode={analyser}>
        {isHovered ? (
          <div
            className='delete-input-button'
            onClick={() =>
              dispatch(actionCreators.controlPanel.DELETE_CONTROL_PANEL_VIZ(vcId, name))
            }
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              transform: 'scale(1.5)',
              cursor: 'pointer',
            }}
          >
            🗑️
          </div>
        ) : null}
      </SpectrumVisualization>
    </div>
  );
};

export default ControlPanelSpectrogram;
