import React from 'react';
import { useSelector } from 'react-redux';
import ControlPanel from 'react-control-panel';
import { UnreachableException } from 'ameo-utils';

import { ReduxStore } from 'src/redux';
import { Control, ControlInfo } from 'src/redux/modules/controlPanel';

const buildSettingForControl = (info: ControlInfo, label: string) => {
  switch (info.type) {
    case 'range': {
      return { type: 'range', min: info.min, max: info.max, label };
    }
    case 'gate': {
      return {
        type: 'button',
        action: () => {
          // TODO
        },
        label,
      };
    }
    default:
      throw new UnreachableException(`Unhandled control type: ${(info as any).type}`);
  }
};

const ControlComp: React.FC<Control> = ({ data, label, color, position: { x, y } }) => {
  return (
    <div className='control'>
      <div className='label' style={{ color }}>
        <ControlPanel
          position={{ top: y, left: x }}
          draggable
          state={{ label: data.value }}
          onChange={(_key: string, value: any) => {
            console.log(label, value); // TODO
          }}
          onDrag={({ top, left, right }: { top?: number; left?: number; right?: number }) => {
            // TODO
          }}
          settings={[buildSettingForControl(data, label)]}
        />
      </div>
    </div>
  );
};

const ControlPanelUI: React.FC<{ stateKey: string }> = ({ stateKey }) => {
  const vcId = stateKey.split('_')[1];
  const connections = useSelector(
    (state: ReduxStore) => state.controlPanel.stateByPanelInstance[vcId].connections
  );

  return (
    <div>
      {connections.map(conn => (
        <ControlComp key={`${conn.vcId}${conn.name}`} {...conn.control} />
      ))}
    </div>
  );
};

export default ControlPanelUI;
