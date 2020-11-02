import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import ControlPanel from 'react-control-panel';
import { UnreachableException } from 'ameo-utils';

import { actionCreators, dispatch, ReduxStore } from 'src/redux';
import { ControlInfo, ControlPanelConnection } from 'src/redux/modules/controlPanel';

const SettingLabel: React.FC<{
  label: string;
  onChange: (newLabel: string) => void;
}> = ({ label, onChange }) => {
  const [editingValue, setEditingValue] = useState<string | null>(null);

  if (editingValue === null) {
    return (
      <span style={{ cursor: 'text' }} onDoubleClick={() => setEditingValue(label)}>
        {label}
      </span>
    );
  }

  return (
    <input
      style={{ width: 86 }}
      value={editingValue}
      onChange={evt => setEditingValue(evt.target.value)}
      onKeyDown={evt => {
        if (evt.key === 'Enter') {
          onChange(editingValue);
          setEditingValue(null);
        } else if (evt.key === 'Escape') {
          setEditingValue(null);
        }
      }}
      ref={ref => ref?.focus()}
    />
  );
};

const mkLabelComponent = (
  controlPanelVcId: string,
  vcId: string,
  name: string
): React.FC<{ label: string }> => ({ label }) => (
  <SettingLabel
    label={label}
    onChange={(newLabel: string) =>
      dispatch(
        actionCreators.controlPanel.SET_CONTROL_LABEL(controlPanelVcId, vcId, name, newLabel)
      )
    }
  />
);

const buildSettingForControl = (
  info: ControlInfo,
  labelValue: string,
  controlPanelVcId: string,
  vcId: string,
  name: string
) => {
  const LabelComponent = mkLabelComponent(controlPanelVcId, vcId, name);

  switch (info.type) {
    case 'range': {
      return {
        type: 'range',
        min: info.min,
        max: info.max,
        label: labelValue,
        LabelComponent,
      };
    }
    case 'gate': {
      return {
        type: 'button',
        action: () =>
          dispatch(
            // TODO: Make gate value configurable
            actionCreators.controlPanel.SET_CONTROL_PANEL_VALUE(controlPanelVcId, vcId, name, 1.0)
          ),
        label: labelValue,
        LabelComponent,
      };
    }
    default:
      throw new UnreachableException(`Unhandled control type: ${(info as any).type}`);
  }
};

const ControlComp: React.FC<ControlPanelConnection & { controlPanelVcId: string }> = ({
  controlPanelVcId,
  vcId,
  name,
  control: {
    data,
    label,
    color,
    position: { x, y },
  },
}) => (
  <div className='control'>
    <div className='label' style={{ color }}>
      <ControlPanel
        position={{ top: y, left: x }}
        draggable
        state={{ [label]: data.value }}
        onChange={(_key: string, value: any) =>
          dispatch(
            actionCreators.controlPanel.SET_CONTROL_PANEL_VALUE(controlPanelVcId, vcId, name, value)
          )
        }
        onDrag={(newPosition: { top?: number; left?: number }) =>
          dispatch(
            actionCreators.controlPanel.SET_CONTROL_POSITION(
              controlPanelVcId,
              vcId,
              name,
              newPosition
            )
          )
        }
        settings={[buildSettingForControl(data, label, controlPanelVcId, vcId, name)]}
        theme={{
          background1: color,
          background2: 'rgb(54,54,54)',
          background2hover: 'rgb(58,58,58)',
          foreground1: 'rgb(112,112,112)',
          text1: 'rgb(235,235,235)',
          text2: 'rgb(161,161,161)',
        }}
      />
    </div>
  </div>
);

const ControlPanelUI: React.FC<{ stateKey: string }> = ({ stateKey }) => {
  const vcId = stateKey.split('_')[1];
  const connections = useSelector(
    (state: ReduxStore) => state.controlPanel.stateByPanelInstance[vcId].connections
  );

  return (
    <div>
      {connections.map(conn => (
        <ControlComp key={`${conn.vcId}${conn.name}`} {...conn} controlPanelVcId={vcId} />
      ))}
    </div>
  );
};

export default ControlPanelUI;
