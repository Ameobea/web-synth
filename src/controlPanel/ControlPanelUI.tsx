import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import ControlPanelMidiKeyboard from 'src/controlPanel/ControlPanelMidiKeyboard';
import ControlPanelSpectrogram from 'src/controlPanel/ControlPanelSpectrogram';
import ControlPanelNote from 'src/controlPanel/ControlPanelNote';

interface ConfigureInputInnerProps {
  info: ControlInfo;
  onChange: (newInfo: ControlInfo) => void;
}

const ConfigureInputInner: React.FC<ConfigureInputInnerProps> = ({ info, onChange }) => {
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
          state={{ ...info, width: info.width ?? 500 }}
          onChange={(_key: string, _val: any, state: any) =>
            onChange({
              type: 'range',
              min: Number.isNaN(+state.min) ? info.min : +state.min,
              max: Number.isNaN(+state.max) ? info.max : +state.max,
              width: Number.isNaN(+state.width) ? undefined : +state.width,
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
            {
              type: 'text',
              label: 'width',
            },
          ]}
        />
      );
    default:
      throw new UnimplementedError(`Unhandled input type: ${(info as any).type}`);
  }
};

const mkConfigureInput = (
  providedControl: Control,
  providedName: string
): React.FC<{
  onSubmit: (val: { control: Control; name: string }) => void;
  onCancel?: () => void;
}> => {
  const ConfigureInput: React.FC<ModalCompProps<{ control: Control; name: string }>> = ({
    onSubmit,
    onCancel,
  }) => {
    const [control, setControl] = useState(providedControl);
    const [name, setName] = useState(providedName);
    const handleChange = useCallback(
      (key: string, val: ControlInfo['type']) => {
        switch (key) {
          case 'input type': {
            if (val === control.data.type) {
              return;
            }

            setControl(control => ({ ...control, data: buildDefaultControlPanelInfo(val) }));
            break;
          }
          case 'color': {
            setControl(control => ({ ...control, color: val }));
            break;
          }
          case 'name': {
            setName(val);
            break;
          }
          default: {
            throw new UnreachableException(`Unhandled key in control panel: ${key}`);
          }
        }
      },
      [control.data.type]
    );
    const settings = useMemo(
      () => [
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
        {
          type: 'text',
          label: 'name',
          initial: name,
        },
      ],
      [control.color, control.data.type, name]
    );

    return (
      <BasicModal>
        <div className='control-panel-input-configurator'>
          <ControlPanel settings={settings} onChange={handleChange} />
          <ConfigureInputInner
            info={control.data}
            onChange={newData => setControl(control => ({ ...control, data: newData }))}
          />

          <div className='buttons'>
            <button onClick={() => onSubmit({ control, name })}>Save</button>
            <button onClick={onCancel}>Close</button>
          </div>
        </div>
      </BasicModal>
    );
  };
  return ConfigureInput;
};

interface ConfigureInputButtonsProps {
  controlPanelVcId: string;
  vcId: string;
  name: string;
  control: Control;
}

const ConfigureInputButtons: React.FC<ConfigureInputButtonsProps> = ({
  controlPanelVcId,
  vcId,
  name,
  control,
}) => (
  <>
    <div
      className='configure-input-button'
      onClick={async () => {
        try {
          const { control: newControl, name: newName } = await renderModalWithControls(
            mkConfigureInput(control, name)
          );
          dispatch(
            actionCreators.controlPanel.SET_CONTROL_PANEL_CONTROL(
              controlPanelVcId,
              vcId,
              name,
              newControl,
              newName
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
      onClick={() => {
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

interface SettingLabelProps {
  label: string;
  onChange: (newLabel: string) => void;
}

const SettingLabel: React.FC<SettingLabelProps> = ({ label, onChange }) => {
  const [editingValue, setEditingValue] = useState<string | null>(null);

  if (editingValue === null) {
    return (
      <div className='control-panel-setting-label' onDoubleClick={() => setEditingValue(label)}>
        {label}
      </div>
    );
  }

  return (
    <input
      style={{ width: 160 }}
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
          actionCreators.controlPanel.SET_CONTROL_NAME(controlPanelVcId, vcId, name, newLabel)
        )
      }
    />
  );
  return LabelComponent;
};

const buildSettingForControl = (
  info: ControlInfo,
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
        label: name,
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
        label: name,
        LabelComponent,
      };
    }
    default:
      throw new UnreachableException(`Unhandled control type: ${(info as any).type}`);
  }
};

const ControlComp: React.FC<
  ControlPanelConnection & { controlPanelVcId: string; snapToGrid: boolean }
> = ({ controlPanelVcId, vcId, name, control, snapToGrid }) => (
  <div className='control'>
    <div className='label' style={{ color: control.color }}>
      <ControlPanel
        position={useMemo(
          () => ({ top: control.position.y, left: control.position.x }),
          [control.position.x, control.position.y]
        )}
        draggable
        dragSnapPx={snapToGrid ? 10 : undefined}
        state={useMemo(() => ({ [name]: control.value }), [control.value, name])}
        onChange={useCallback(
          (_key: string, value: any) =>
            dispatch(
              actionCreators.controlPanel.SET_CONTROL_PANEL_VALUE(
                controlPanelVcId,
                vcId,
                name,
                value
              )
            ),
          [controlPanelVcId, name, vcId]
        )}
        onDrag={useCallback(
          (newPosition: { top?: number; left?: number }) =>
            dispatch(
              actionCreators.controlPanel.SET_CONTROL_POSITION(
                controlPanelVcId,
                vcId,
                name,
                newPosition
              )
            ),
          [controlPanelVcId, name, vcId]
        )}
        settings={useMemo(
          () => [buildSettingForControl(control.data, controlPanelVcId, vcId, name)],
          [control.data, controlPanelVcId, name, vcId]
        )}
        theme={useMemo(
          () => ({
            background1: control.color,
            background2: 'rgb(54,54,54)',
            background2hover: 'rgb(58,58,58)',
            foreground1: 'rgb(112,112,112)',
            text1: 'rgb(235,235,235)',
            text2: 'rgb(161,161,161)',
          }),
          [control.color]
        )}
        width={control.data.width ?? 500}
      >
        <ConfigureInputButtons
          controlPanelVcId={controlPanelVcId}
          vcId={vcId}
          name={name}
          control={control}
        />
      </ControlPanel>
    </div>
  </div>
);

const ControlPanelUI: React.FC<{ stateKey: string }> = ({ stateKey }) => {
  const [elementType, setElementType] = useState('midi keyboard');
  const vcId = stateKey.split('_')[1];
  const { controls, midiKeyboards, presets, visualizations, snapToGrid } = useSelector(
    (state: ReduxStore) => state.controlPanel.stateByPanelInstance[vcId]
  );
  const panelCtx = useRef<any>(null);
  const presetPanelSettings = useMemo(
    () => [
      {
        type: 'select',
        label: 'element type',
        options: ['midi keyboard', 'spectrogram', 'slider', 'button', 'note'],
      },
      {
        type: 'button',
        label: 'add element',
        action: () => {
          switch (elementType) {
            case 'midi keyboard':
              dispatch(actionCreators.controlPanel.ADD_CONTROL_PANEL_MIDI_KEYBOARD(vcId));
              break;
            case 'spectrogram':
              dispatch(actionCreators.controlPanel.ADD_CONTROL_PANEL_VIZ(vcId, 'spectrogram'));
              break;
            case 'slider':
              dispatch(
                actionCreators.controlPanel.ADD_CONTROL_PANEL_CONNECTION(
                  vcId,
                  '',
                  'slider',
                  'range'
                )
              );
              break;
            case 'button':
              dispatch(
                actionCreators.controlPanel.ADD_CONTROL_PANEL_CONNECTION(vcId, '', 'gate', 'gate')
              );
              break;
            case 'note':
              dispatch(actionCreators.controlPanel.ADD_CONTROL_PANEL_VIZ(vcId, 'note'));
              break;
            default:
              console.error('Unhandled element type when adding to control panel: ', elementType);
          }
        },
      },
      {
        type: 'checkbox',
        label: 'snap to grid',
      },
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
    [elementType, presets, vcId]
  );
  const ctxCb = useCallback((ctx: any) => {
    panelCtx.current = ctx;
  }, []);

  const [containerSize, setContainerSize] = useState({ height: 0, width: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!containerRef.current) {
      return;
    }

    // Measure positions of all children and calculate width of the container
    let maxEndHorizontal = 0;
    let maxEndVertical = 0;
    for (const child of Array.from(containerRef.current.children)) {
      const rect = child.getBoundingClientRect();
      const endHorizontal = rect.left + rect.width;
      const endVertical = rect.top + rect.height;
      maxEndHorizontal = Math.max(maxEndHorizontal, endHorizontal);
      maxEndVertical = Math.max(maxEndVertical, endVertical);
    }

    setContainerSize({ height: maxEndVertical, width: maxEndHorizontal });
  }, [controls, midiKeyboards, visualizations]);

  return (
    <div
      ref={containerRef}
      className='control-panel-content'
      style={{ width: containerSize.width, height: containerSize.height }}
    >
      {visualizations.map(viz => {
        switch (viz.type) {
          case 'oscilloscope':
            throw new UnimplementedError();
            break;
          case 'spectrogram':
            return <ControlPanelSpectrogram key={viz.type + viz.name} vcId={vcId} {...viz} />;
          case 'note':
            return <ControlPanelNote key={viz.type + viz.name} vcId={vcId} {...viz} />;
        }
      })}
      <ControlPanel
        className='main-control-panel'
        position='top-left'
        draggable
        dragSnapPx={snapToGrid ? 10 : undefined}
        settings={presetPanelSettings}
        state={useMemo(
          () => ({ 'snap to grid': snapToGrid, 'element type': elementType }),
          [elementType, snapToGrid]
        )}
        onChange={useCallback(
          (key: string, value: any) => {
            switch (key) {
              case 'element type':
                setElementType(value);
                break;
              case 'snap to grid':
                dispatch(actionCreators.controlPanel.SET_CONTROL_PANEL_SNAP_TO_GRID(vcId, value));
                break;
              default:
                console.error('Unhandled key in preset panel: ', key);
            }
          },
          [vcId]
        )}
        contextCb={ctxCb}
      />
      {midiKeyboards.map(kb => (
        <ControlPanelMidiKeyboard vcId={vcId} key={kb.name} {...kb} />
      ))}
      {controls.map(conn => (
        <ControlComp
          key={`${conn.vcId}${conn.name}`}
          {...conn}
          controlPanelVcId={vcId}
          snapToGrid={snapToGrid}
        />
      ))}
    </div>
  );
};

export default ControlPanelUI;
