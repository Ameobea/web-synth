import React, { useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import ControlPanel from 'react-control-panel';
import { UnimplementedError, UnreachableException } from 'ameo-utils';

import { actionCreators, dispatch, ReduxStore } from 'src/redux';
import {
  buildDefaultControlPanelInfo,
  ControlInfo,
  ControlPanelConnection,
} from 'src/redux/modules/controlPanel';
import BasicModal from 'src/misc/BasicModal';
import { ModalCompProps, renderModalWithControls } from 'src/controls/Modal';

const ConfigureInputInner: React.FC<{
  info: ControlInfo;
  onChange: (newInfo: ControlInfo) => void;
}> = ({ info, onChange }) => {
  switch (info.type) {
    case 'gate':
      return (
        <ControlPanel
          state={info}
          onChange={(_key: string, _val: any, state: any) =>
            onChange({
              type: 'gate',
              value: Number.isNaN(state.value) ? info.value : +state.value,
              isPressed: info.isPressed,
            })
          }
          settings={[
            {
              type: 'text',
              label: 'value',
              initial: info.value.toString(),
            },
          ]}
        />
      );
    case 'range':
      return (
        <ControlPanel
          state={info}
          onChange={(_key: string, _val: any, state: any) =>
            onChange({
              type: 'range',
              min: Number.isNaN(state.min) ? info.min : +state.min,
              max: Number.isNaN(state.max) ? info.max : +state.max,
              value: Number.isNaN(state.value) ? info.value : +state.value,
            })
          }
          settings={[
            {
              type: 'text',
              label: 'min',
              initial: info.min.toString(),
            },
            {
              type: 'text',
              label: 'max',
              initial: info.max.toString(),
            },
          ]}
        />
      );
    default:
      throw new UnimplementedError(`Unhandled input type: ${(info as any).type}`);
  }
};

const mkConfigureInput = (
  providedConfig: ControlInfo
): React.FC<{
  onSubmit: (val: ControlInfo) => void;
  onCancel?: () => void;
}> => {
  const ConfigureInput: React.FC<ModalCompProps<ControlInfo>> = ({ onSubmit, onCancel }) => {
    const [config, setConfig] = useState(providedConfig);

    return (
      <BasicModal>
        <div className='control-panel-input-configurator'>
          <ControlPanel
            settings={[
              {
                type: 'select',
                label: 'input type',
                options: ['gate', 'range'],
                initial: config.type,
              },
            ]}
            onChange={(_key: string, val: ControlInfo['type']) => {
              if (val === config.type) {
                return;
              }

              setConfig(buildDefaultControlPanelInfo(val));
            }}
          />
          <ConfigureInputInner info={config} onChange={setConfig} />

          <div className='buttons'>
            <button onClick={() => onSubmit(config)}>Save</button>
            <button onClick={onCancel}>Close</button>
          </div>
        </div>
      </BasicModal>
    );
  };
  return ConfigureInput;
};

const ConfigureInputButton: React.FC<{
  controlPanelVcId: string;
  vcId: string;
  name: string;
  config: ControlInfo;
}> = ({ controlPanelVcId, vcId, name, config }) => (
  <div
    className='configure-input-button'
    onClick={async () => {
      try {
        const newInfo = await renderModalWithControls(mkConfigureInput(config));
        dispatch(
          actionCreators.controlPanel.SET_CONTROL_PANEL_INFO(controlPanelVcId, vcId, name, newInfo)
        );
      } catch (_err) {
        // pass
      }
    }}
  >
    ⚙️
  </div>
);

const SettingLabel: React.FC<{
  label: string;
  onChange: (newLabel: string) => void;
  controlPanelVcId: string;
  vcId: string;
  name: string;
  config: ControlInfo;
}> = ({ label, onChange, controlPanelVcId, vcId, name, config }) => {
  const [editingValue, setEditingValue] = useState<string | null>(null);

  if (editingValue === null) {
    return (
      <>
        <ConfigureInputButton
          controlPanelVcId={controlPanelVcId}
          vcId={vcId}
          name={name}
          config={config}
        />
        <span style={{ cursor: 'text' }} onDoubleClick={() => setEditingValue(label)}>
          {label}
        </span>
      </>
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
  name: string,
  config: ControlInfo
) => {
  const LabelComponent: React.FC<{ label: string }> = ({ label }) => (
    <SettingLabel
      label={label}
      onChange={(newLabel: string) =>
        dispatch(
          actionCreators.controlPanel.SET_CONTROL_LABEL(controlPanelVcId, vcId, name, newLabel)
        )
      }
      controlPanelVcId={controlPanelVcId}
      vcId={vcId}
      name={name}
      config={config}
    />
  );
  return LabelComponent;
};

const buildSettingForControl = (
  info: ControlInfo,
  labelValue: string,
  controlPanelVcId: string,
  vcId: string,
  name: string
) => {
  const LabelComponent = mkLabelComponent(controlPanelVcId, vcId, name, info);

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
        width={500}
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
