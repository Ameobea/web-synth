import { UnreachableException } from 'ameo-utils';
import React, { useMemo } from 'react';
import ControlPanel from 'react-control-panel';

export type OperatorConfig =
  | { type: 'param buffer'; bufferIx: number }
  | { type: 'constant'; value: number }
  | { type: 'adsr'; adsrIx: number }
  | { type: 'base frequency multiplier'; multiplier: number };

export const buildDefaultOperatorConfig = (type: OperatorConfig['type']): OperatorConfig => {
  switch (type) {
    case 'param buffer': {
      return { type, bufferIx: 0 };
    }
    case 'constant': {
      return { type, value: 0 };
    }
    case 'adsr': {
      return { type, adsrIx: 0 };
    }
    case 'base frequency multiplier': {
      return { type, multiplier: 1 };
    }
    default: {
      throw new UnreachableException('Invalid operator state type: ' + type);
    }
  }
};

const buildTypeSetting = (type: OperatorConfig['type']) => ({
  type: 'select',
  label: 'type',
  options: ['param buffer', 'constant', 'adsr', 'base frequency multiplier'],
  initial: type,
});

const PARAM_BUFFER_COUNT = 8;
const ADSR_COUNT = 8;

const ConfigureOperator: React.FC<{
  state: OperatorConfig;
  onChange: (newState: OperatorConfig) => void;
}> = ({ state, onChange }) => {
  const settings = useMemo(() => {
    switch (state.type) {
      case 'param buffer': {
        return [
          buildTypeSetting(state.type),
          {
            type: 'select',
            label: 'buffer ix',
            options: new Array(PARAM_BUFFER_COUNT).fill(0).map((_i, i) => i),
            initial: state.bufferIx,
          },
        ];
      }
      case 'constant': {
        return [
          buildTypeSetting(state.type),
          { type: 'text', label: 'value', initial: state.value.toString() },
        ];
      }
      case 'adsr': {
        return [
          buildTypeSetting(state.type),
          {
            type: 'select',
            label: 'adsr index',
            options: new Array(ADSR_COUNT).fill(0).map((_i, i) => i),
            initial: state.adsrIx,
          },
        ];
      }
      case 'base frequency multiplier': {
        return [
          buildTypeSetting(state.type),
          {
            type: 'range',
            label: 'multiplier',
            min: 0,
            max: 16,
            step: 0.125,
            initial: state.multiplier.toString(),
          },
        ];
      }
      default: {
        console.error('Invalid operator state type: ', (state as any).type);
      }
    }
  }, [state]);

  return (
    <div className='operator-config'>
      <ControlPanel
        style={{ width: 500 }}
        settings={settings}
        onChange={(key: string, value: any) => {
          switch (key) {
            case 'type': {
              onChange(buildDefaultOperatorConfig(value as OperatorConfig['type']));
              break;
            }
            case 'buffer ix': {
              onChange({ ...(state as any), bufferIx: value });
              break;
            }
            case 'value': {
              if (window.isNaN(value)) {
                break;
              }
              onChange({ ...(state as any), value });
              break;
            }
            case 'adsr index': {
              onChange({ ...(state as any), adsrIx: value });
              break;
            }
            case 'multiplier': {
              if (window.isNaN(value)) {
                break;
              }
              onChange({ ...(state as any), multiplier: value });
              break;
            }
            default: {
              console.error('Unhandled key in operator config settings: ', key);
            }
          }
        }}
      />
    </div>
  );
};

export default ConfigureOperator;
