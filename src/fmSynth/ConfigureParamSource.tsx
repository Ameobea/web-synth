import { UnreachableException } from 'ameo-utils';
import React, { useMemo } from 'react';
import ControlPanel from 'react-control-panel';
import * as R from 'ramda';

export const PARAM_BUFFER_COUNT = 8;
const ADSR_COUNT = 8;

/**
 * A parameter/value generator function.  Used to produce the frequency input values for
 * operators.
 */
export type ParamSource =
  | { type: 'param buffer'; 'buffer index': number }
  | { type: 'constant'; value: number }
  | { type: 'adsr'; 'adsr index': number }
  | { type: 'base frequency multiplier'; multiplier: number };

const buildTypeSetting = () => ({
  type: 'select',
  label: 'type',
  options: ['param buffer', 'constant', 'adsr', 'base frequency multiplier'],
});

const updateState = (state: ParamSource, newState: Partial<ParamSource>): ParamSource => ({
  ...(state as any),
  ...newState,
});

export const buildDefaultParamSource = (type: ParamSource['type']): ParamSource => {
  switch (type) {
    case 'param buffer': {
      return { type, 'buffer index': 0 };
    }
    case 'constant': {
      return { type, value: 0 };
    }
    case 'adsr': {
      return { type, 'adsr index': 0 };
    }
    case 'base frequency multiplier': {
      return { type, multiplier: 1 };
    }
    default: {
      throw new UnreachableException('Invalid operator state type: ' + type);
    }
  }
};

const ConfigureParamSource: React.FC<{
  title?: string;
  theme?: { [key: string]: any };
  state: ParamSource;
  onChange: (newState: ParamSource) => void;
  min?: number;
  max?: number;
  step?: number;
  scale?: 'log';
}> = ({ title, theme, state, onChange, min, max, scale }) => {
  const { type: paramType } = state;
  const settings = useMemo(() => {
    switch (paramType) {
      case 'param buffer': {
        return [
          buildTypeSetting(),
          {
            type: 'select',
            label: 'buffer index',
            options: new Array(PARAM_BUFFER_COUNT).fill(0).map((_i, i) => i),
          },
        ];
      }
      case 'constant': {
        return [buildTypeSetting(), { type: 'range', label: 'value', min, max, scale }];
      }
      case 'adsr': {
        return [
          buildTypeSetting(),
          {
            type: 'select',
            label: 'adsr index',
            options: new Array(ADSR_COUNT).fill(0).map((_i, i) => i),
          },
        ];
      }
      case 'base frequency multiplier': {
        return [
          buildTypeSetting(),
          {
            type: 'range',
            label: 'multiplier',
            min: 0,
            max: 16,
            step: 0.125,
          },
        ];
      }
      default: {
        console.error('Invalid operator state type: ', paramType);
      }
    }
  }, [max, min, paramType, scale]);

  return (
    <ControlPanel
      title={title}
      theme={theme}
      style={{ width: 378 }}
      settings={settings}
      state={{
        ...state,
        'buffer index':
          state.type === 'param buffer' ? state['buffer index'].toString() : undefined,
      }}
      onChange={(key: string, value: any) => {
        switch (key) {
          case 'type': {
            if (state.type === value) {
              return;
            }

            onChange(updateState(state, buildDefaultParamSource(value)));
            break;
          }
          case 'buffer index': {
            onChange(updateState(state, { 'buffer index': +value }));
            break;
          }
          case 'value': {
            if (window.isNaN(value)) {
              break;
            }
            onChange(updateState(state, { value }));
            break;
          }
          case 'adsr index': {
            onChange(updateState(state, { 'adsr index': +value }));
            break;
          }
          case 'multiplier': {
            if (window.isNaN(value)) {
              break;
            }
            onChange(updateState(state, { multiplier: value }));
            break;
          }
          default: {
            console.error('Unhandled param value configurator key: ', key);
          }
        }
      }}
    />
  );
};

export default ConfigureParamSource;
