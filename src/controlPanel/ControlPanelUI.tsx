import React, { useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import ControlPanel from 'react-control-panel';
import { UnimplementedError, UnreachableException } from 'ameo-utils';
import * as R from 'ramda';
import { Option } from 'funfix-core';

import { actionCreators, dispatch, ReduxStore } from 'src/redux';
import {
  buildDefaultControlPanelInfo,
  ControlInfo,
  Control,
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
              gateValue: Number.isNaN(+state.gateValue) ? info.gateValue : +state.gateValue,
              offValue: Number.isNaN(+state.offValue) ? info.offValue : +state.offValue,
            })
          }
          settings={[
            {
              type: 'text',
              label: 'gateValue',
            },
            {
              type: 'text',
              label: 'offValue',
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
              min: Number.isNaN(+state.min) ? info.min : +state.min,
              max: Number.isNaN(+state.max) ? info.max : +state.max,
            })
          }
          settings={[
            {
              type: 'text',
              label: 'min',
            },
            {
              type: 'text',
              label: 'max',
            },
          ]}
        />
      );
    default:
      throw new UnimplementedError(`Unhandled input type: ${(info as any).type}`);
  }
};

const mkConfigureInput = (
  providedControl: Control
): React.FC<{
  onSubmit: (val: Control) => void;
  onCancel?: () => void;
}> => {
  const ConfigureInput: React.FC<ModalCompProps<Control>> = ({ onSubmit, onCancel }) => {
    const [control, setControl] = useState(providedControl);

    return (
      <BasicModal>
        <div className='control-panel-input-configurator'>
          <ControlPanel
            settings={[
              {
                type: 'select',
                label: 'input type',
                options: ['gate', 'range'],
                initial: control.data.type,
              },
              {
                type: 'color',
                label: 'color',
                initial: control.color,
                format: 'hex',
              },
            ]}
            onChange={(key: string, val: ControlInfo['type']) => {
              switch (key) {
                case 'input type': {
                  if (val === control.data.type) {
                    return;
                  }

                  setControl({ ...control, data: buildDefaultControlPanelInfo(val) });
                  break;
                }
                case 'color': {
                  setControl({ ...control, color: val });
                  break;
                }
                default: {
                  throw new UnreachableException(`Unhandled key in control panel: ${key}`);
                }
              }
            }}
          />
          <ConfigureInputInner
            info={control.data}
            onChange={newData => setControl({ ...control, data: newData })}
          />

          <div className='buttons'>
            <button onClick={() => onSubmit(control)}>Save</button>
            <button onClick={onCancel}>Close</button>
          </div>
        </div>
      </BasicModal>
    );
  };
  return ConfigureInput;
};

const ConfigureInputButtons: React.FC<{
  controlPanelVcId: string;
  vcId: string;
  name: string;
  control: Control;
}> = ({ controlPanelVcId, vcId, name, control }) => (
  <>
    <div
      className='configure-input-button'
      onClick={async () => {
        try {
          const newControl = await renderModalWithControls(mkConfigureInput(control));
          dispatch(
            actionCreators.controlPanel.SET_CONTROL_PANEL_CONTROL(
              controlPanelVcId,
              vcId,
              name,
              newControl
            )
          );
        } catch (_err) {
          // pass
        }
      }}
    >
      ⚙️
    </div>
    <div
      className='delete-input-button'
      onClick={async () => {
        const shouldDelete = confirm(`Really delete this control named "${name}"?`);
        if (!shouldDelete) {
          return;
        }
        dispatch(actionCreators.controlPanel.REMOVE_CONNECTION(controlPanelVcId, vcId, name));
      }}
    >
      🗑️
    </div>
  </>
);

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

const mkLabelComponent = (controlPanelVcId: string, vcId: string, name: string) => {
  const LabelComponent: React.FC<{ label: string }> = ({ label }) => (
    <SettingLabel
      label={label}
      onChange={(newLabel: string) =>
        dispatch(
          actionCreators.controlPanel.SET_CONTROL_LABEL(controlPanelVcId, vcId, name, newLabel)
        )
      }
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
        onmousedown: () =>
          dispatch(
            actionCreators.controlPanel.SET_CONTROL_PANEL_VALUE(
              controlPanelVcId,
              vcId,
              name,
              info.gateValue
            )
          ),
        onmouseup: () =>
          dispatch(
            actionCreators.controlPanel.SET_CONTROL_PANEL_VALUE(
              controlPanelVcId,
              vcId,
              name,
              info.offValue
            )
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
  control,
}) => (
  <div className='control'>
    <div className='label' style={{ color: control.color }}>
      <>
        <ControlPanel
          position={{ top: control.position.y, left: control.position.x }}
          draggable
          state={{ [control.label]: control.value }}
          onChange={(_key: string, value: any) =>
            dispatch(
              actionCreators.controlPanel.SET_CONTROL_PANEL_VALUE(
                controlPanelVcId,
                vcId,
                name,
                value
              )
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
          settings={[
            buildSettingForControl(control.data, control.label, controlPanelVcId, vcId, name),
          ]}
          theme={{
            background1: control.color,
            background2: 'rgb(54,54,54)',
            background2hover: 'rgb(58,58,58)',
            foreground1: 'rgb(112,112,112)',
            text1: 'rgb(235,235,235)',
            text2: 'rgb(161,161,161)',
          }}
          width={500}
        >
          <ConfigureInputButtons
            controlPanelVcId={controlPanelVcId}
            vcId={vcId}
            name={name}
            control={control}
          />
        </ControlPanel>
      </>
    </div>
  </div>
);

const ControlPanelUI: React.FC<{ stateKey: string }> = ({ stateKey }) => {
  const vcId = stateKey.split('_')[1];
  const { controls, presets } = useSelector(
    (state: ReduxStore) => state.controlPanel.stateByPanelInstance[vcId]
  );
  const panelCtx = useRef<any>(null);
  const presetPanelSettings = useMemo(
    () => [
      { type: 'select', label: 'preset', options: presets.map(R.prop('name')) },
      {
        type: 'button',
        label: 'load preset',
        action: () => {
          if (!panelCtx.current) {
            console.error("Tried to load preset, but panel context isn't set");
            return;
          }
          if (R.isEmpty(presets)) {
            alert('No preset to load!');
            return;
          }
          const presetName = panelCtx.current.preset || presets[0].name;
          dispatch(actionCreators.controlPanel.LOAD_PRESET(vcId, presetName));
        },
      },
      {
        type: 'button',
        label: 'delete preset',
        action: () => {
          if (!panelCtx.current) {
            console.error("Tried to delete preset, but panel context isn't set");
            return;
          }
          if (R.isEmpty(presets)) {
            alert('No preset to delete!');
            return;
          }
          const presetName = Option.of(panelCtx.current.preset).getOrElse(presets[0].name);
          const shouldDelete = confirm(`Really delete the preset named "${presetName}"?`);
          if (!shouldDelete) {
            return;
          }
          dispatch(actionCreators.controlPanel.DELETE_PRESET(vcId, presetName));
        },
      },
      { type: 'text', label: 'preset name' },
      {
        type: 'button',
        label: 'save preset',
        action: () => {
          if (!panelCtx.current) {
            console.error("Tried to save preset, but panel context isn't set");
            return;
          }
          const presetName = panelCtx.current['preset name'];
          if (presets.find(R.propEq('name' as const, presetName))) {
            alert('A preset already exists with that name; choose a unique name');
            return;
          }
          dispatch(actionCreators.controlPanel.SAVE_PRESET(vcId, presetName));
        },
      },
    ],
    [presets, vcId]
  );

  return (
    <div>
      <ControlPanel
        position='top-left'
        draggable
        settings={presetPanelSettings}
        contextCb={(ctx: any) => {
          panelCtx.current = ctx;
        }}
      />
      {controls.map(conn => (
        <ControlComp key={`${conn.vcId}${conn.name}`} {...conn} controlPanelVcId={vcId} />
      ))}
    </div>
  );
};

export default ControlPanelUI;
