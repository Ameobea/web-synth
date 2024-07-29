import * as R from 'ramda';
import React, { useEffect, useMemo, useState } from 'react';
import ControlPanel from 'react-control-panel';
import { shallowEqual, useSelector } from 'react-redux';

import './LooperUI.css';
import {
  fetchLooperPresets,
  getExistingLooperPresetTags,
  getLooperPreset,
  saveLooperPreset,
  type GenericPresetDescriptor,
} from 'src/api';
import {
  pickPresetWithModal,
  type PresetDescriptor,
} from 'src/controls/GenericPresetPicker/GenericPresetPicker';
import { renderGenericPresetSaverWithModal } from 'src/controls/GenericPresetPicker/GenericPresetSaver';
import ConfigureTransitionAlgorithm from 'src/looper/LooperUI/ConfigureTransitionAlgorithm';
import LooperViz from 'src/looper/LooperUI/LooperViz';
import { mkLoadMIDICompositionModal } from 'src/midiEditor/LoadMIDICompositionModal';
import { connect } from 'src/patchNetwork/interface';
import type { ConnectableDescriptor } from 'src/patchNetwork/patchNetwork';
import { getState, looperDispatch, type ReduxStore } from 'src/redux';
import {
  deserializeLooper,
  looperActions,
  serializeLooper,
  type LooperBank,
  type LooperModule,
  type SerializedLooperInstState,
} from 'src/redux/modules/looper';

const DeleteBankButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button className='delete-looper-bank-button' onClick={onClick}>
    ×
  </button>
);

interface LoopLengthProps {
  vcId: string;
  moduleIx: number;
  bankIx: number;
  loopLenBeats: number;
  compositionLenBeats: number | null;
}

const LoopLength: React.FC<LoopLengthProps> = ({
  vcId,
  moduleIx,
  bankIx,
  loopLenBeats,
  compositionLenBeats,
}) => {
  const [editingValue, setEditingValue] = useState<string | null>(null);

  return (
    <div className='loop-length'>
      <div className='click-to-activate'>
        <div className='click-to-activate'>Loop Length:</div>
        {editingValue === null ? (
          <b className='loop-length-value' onDoubleClick={() => setEditingValue(`${loopLenBeats}`)}>
            {loopLenBeats} Beats
          </b>
        ) : (
          <input
            type='text'
            value={editingValue}
            onChange={e => setEditingValue(e.target.value)}
            ref={input => input?.focus()}
            onKeyDown={evt => {
              if (evt.key === 'Enter') {
                const lenBeats = +editingValue;
                if (isNaN(lenBeats)) {
                  alert('Please enter a number');
                  return;
                }

                looperDispatch(
                  looperActions.setLoopLenBeats({
                    vcId,
                    moduleIx,
                    bankIx,
                    lenBeats,
                  })
                );

                setEditingValue(null);
              } else if (evt.key === 'Escape') {
                setEditingValue(null);
              }
            }}
          />
        )}
      </div>
      <div className='click-to-activate'>
        <div className='click-to-activate'>Composition Length:</div>
        <b style={{ marginTop: 0 }}>
          {R.isNil(compositionLenBeats) ? '-' : `${compositionLenBeats} Beats`}
        </b>
      </div>
    </div>
  );
};

interface LooperBankCompProps {
  vcId: string;
  isActive: boolean;
  bank: LooperBank;
  bankIx: number;
  isLast: boolean;
  phaseSAB: Float32Array | null;
  moduleIx: number;
}

const LooperBankCompInner: React.FC<LooperBankCompProps> = ({
  isLast,
  vcId,
  isActive,
  bank,
  bankIx,
  phaseSAB,
  moduleIx,
}) => {
  const settings = useMemo(
    () => [
      {
        type: 'button',
        label: 'select midi sequence',
        action: async () => {
          try {
            const { preset: composition } = await mkLoadMIDICompositionModal();
            looperDispatch(
              looperActions.setLoadedComposition({ vcId, moduleIx, bankIx, composition })
            );
          } catch (_err) {
            return;
          }
        },
      },
      {
        type: 'button',
        label: 'activate bank',
        action: () => looperDispatch(looperActions.setActiveBankIx({ moduleIx, vcId, bankIx })),
      },
    ],
    [bankIx, moduleIx, vcId]
  );

  return (
    <div
      className='looper-bank'
      data-active={`${isActive}`}
      onClick={evt => {
        if (!evt.target) {
          return;
        }
        const target = evt.target as HTMLElement;
        if (target.classList.contains('loop-length-value')) {
          return;
        }

        if (
          Array.from(target.classList || []).some(cls =>
            [
              'looper-viz',
              'control-panel',
              'draggable',
              'active-composition-name',
              'loop-length',
            ].includes(cls)
          ) ||
          Array.from(target.parentElement?.classList ?? []).some(cls =>
            ['active-composition-name', 'loop-length', 'click-to-activate'].includes(cls)
          )
        ) {
          looperDispatch(looperActions.setActiveBankIx({ moduleIx, vcId, bankIx }));
        }
      }}
    >
      {isLast ? (
        <div style={{ position: 'relative' }}>
          <DeleteBankButton
            onClick={() => {
              const proceed =
                !bank.loadedComposition ||
                window.confirm('Are you sure you want to delete this bank?');
              if (!proceed) {
                return;
              }
              looperDispatch(looperActions.deleteBank({ vcId, moduleIx, bankId: bank.id }));
            }}
          />
        </div>
      ) : (
        // Still need to render a div for css grid layout
        <div />
      )}
      <div style={{ position: 'relative' }}>
        <div className='looper-bank-number'>{bankIx}</div>
      </div>
      <ControlPanel width={400} settings={settings} />
      <div className='active-composition-name'>
        <div className='click-to-activate'>Loaded Sequence:</div>
        <b>{bank.loadedComposition ? bank.loadedComposition.name : 'NONE'}</b>
      </div>
      <LoopLength
        vcId={vcId}
        loopLenBeats={bank.lenBeats}
        compositionLenBeats={bank.compositionLenBeats}
        moduleIx={moduleIx}
        bankIx={bankIx}
      />
      <div>
        {phaseSAB ? (
          <LooperViz vcId={vcId} bankIx={bankIx} phaseSAB={phaseSAB} width={500} height={100} />
        ) : null}
      </div>
    </div>
  );
};

const LooperBankComp = React.memo(LooperBankCompInner);

interface LooperMainControlPanelProps {
  vcId: string;
  moduleIx: number;
}

const AddBankControlPanel: React.FC<LooperMainControlPanelProps> = ({ vcId, moduleIx }) => {
  const settings = useMemo(
    () => [
      {
        type: 'button',
        label: 'add midi bank',
        action: () => looperDispatch(looperActions.addBank({ vcId, moduleIx })),
      },
    ],
    [moduleIx, vcId]
  );

  return <ControlPanel settings={settings} width={400} className='looper-main-control-panel' />;
};

interface LooperTabProps {
  vcId: string;
  name: string;
  ix: number | null;
  isActive: boolean;
}

const LooperTab: React.FC<LooperTabProps> = ({ vcId, name, ix, isActive }) => {
  const onClick = () => {
    if (ix === null) {
      looperDispatch(looperActions.addModule({ vcId }));
      return;
    }

    looperDispatch(looperActions.setActiveModuleIx({ vcId, moduleIx: ix }));
  };

  return (
    <div className='looper-tab' data-active={`${isActive}`} onClick={onClick}>
      {name}
    </div>
  );
};

const loadLooperPreset = (vcId: string, preset: SerializedLooperInstState) => {
  const oldState = getState().looper.stateByVcId[vcId];

  // Tear down existing state, deleting all banks and all modules
  oldState.modules.forEach((mod, moduleIx) => {
    looperDispatch(looperActions.removeModule({ vcId, moduleIx }));
  });

  // Load the new state
  preset.modules.forEach((mod, moduleIx) => {
    looperDispatch(looperActions.addModule({ vcId }));
    // Delete the default bank that is created
    looperDispatch(
      looperActions.deleteBank({
        vcId,
        moduleIx,
        bankId: getState().looper.stateByVcId[vcId].modules[moduleIx].banks[0].id,
      })
    );
    looperDispatch(looperActions.setModuleName({ vcId, moduleIx, name: mod.name }));
    mod.banks.forEach((bank, bankIx) => {
      looperDispatch(looperActions.addBank({ vcId, moduleIx }));
      if (bank.loadedComposition) {
        looperDispatch(
          looperActions.setLoadedComposition({
            vcId,
            moduleIx,
            bankIx,
            composition: bank.loadedComposition,
          })
        );
      }
    });
    looperDispatch(looperActions.setActiveBankIx({ vcId, moduleIx, bankIx: mod.activeBankIx }));
  });
  looperDispatch(looperActions.setActiveModuleIx({ vcId, moduleIx: preset.activeModuleIx }));
};

interface LooperTabSwitcherProps {
  vcId: string;
  activeSubModuleIx: number;
}

const LooperTabSwitcher: React.FC<LooperTabSwitcherProps> = ({ vcId }) => {
  const { activeModuleIx, tabNames } = useSelector(
    (state: ReduxStore) => {
      const instState = state.looper.stateByVcId[vcId];
      return {
        activeModuleIx: instState.activeModuleIx,
        tabNames: instState.modules.map(mod => mod.name),
      };
    },
    (a, b) => R.equals(a, b)
  );

  return (
    <div className='looper-tabs'>
      {tabNames.map((name, ix) => (
        <LooperTab
          vcId={vcId}
          name={name}
          ix={ix}
          isActive={activeModuleIx === ix}
          key={`${name}${ix}`}
        />
      ))}
      <LooperTab vcId={vcId} name={'+'} ix={null} isActive={false} key='+' />
      <div className='looper-preset-buttons'>
        <button
          onClick={async () => {
            const wrappedFetchLooperPresets = () =>
              fetchLooperPresets().then(presets =>
                presets.map(
                  (preset): PresetDescriptor<GenericPresetDescriptor> => ({
                    id: preset.id,
                    name: preset.name,
                    description: preset.description,
                    tags: preset.tags,
                    preset: preset,
                    userID: preset.userId,
                    userName: preset.userName,
                  })
                )
              );

            try {
              const selectedPreset = (await pickPresetWithModal(wrappedFetchLooperPresets)).preset;
              console.log('Selected looper preset: ', selectedPreset);
              const preset = await getLooperPreset(selectedPreset.id);
              console.log('Loaded looper preset: ', preset);
              loadLooperPreset(vcId, preset);
            } catch (err) {
              // pass
            }
          }}
          style={{ marginTop: 'auto' }}
        >
          Load Preset
        </button>
        <button
          onClick={async () => {
            try {
              const preset = await renderGenericPresetSaverWithModal({
                description: true,
                getExistingTags: getExistingLooperPresetTags,
              });
              console.log('User provided preset descriptor: ', preset);
              const id = await saveLooperPreset({
                name: preset.name,
                description: preset.description ?? '',
                tags: preset.tags ?? [],
                preset: deserializeLooper(serializeLooper(getState().looper.stateByVcId[vcId])),
              });
              console.log('Successfully created preset with id: ', id);
            } catch (err) {
              // pass
            }
          }}
        >
          Save Preset
        </button>
      </div>
    </div>
  );
};

interface ModuleInfoProps {
  vcId: string;
  name: string;
  moduleIx: number;
  totalModuleCount: number;
}

const ModuleInfo: React.FC<ModuleInfoProps> = ({ name, moduleIx, vcId, totalModuleCount }) => {
  const [editingName, setEditingName] = useState<string | null>(null);
  useEffect(() => setEditingName(null), [moduleIx]);

  return (
    <div className='looper-module-info'>
      {totalModuleCount > 1 ? (
        <button
          className='delete-looper-module-button'
          onClick={() => {
            const shouldDelete =
              getState().looper.stateByVcId[vcId].modules[moduleIx].banks.every(
                bank => !bank.loadedComposition
              ) || window.confirm(`Are you sure you want to delete module ${name}?`);
            if (!shouldDelete) {
              return;
            }

            looperDispatch(looperActions.removeModule({ vcId, moduleIx }));
          }}
        >
          ×
        </button>
      ) : null}
      {editingName === null ? (
        <h2 onDoubleClick={() => setEditingName(name)}>{name}</h2>
      ) : (
        <input
          ref={input => input?.focus()}
          type='text'
          value={editingName}
          onChange={evt => setEditingName(evt.target.value)}
          onKeyDown={evt => {
            if (evt.key === 'Enter') {
              // Re-connect everything previously connected the old name to the new name
              const allConnectedDestinations =
                getState().viewContextManager.patchNetwork.connections.filter(
                  ([from, _to]) => from.vcId === vcId && from.name === name
                );

              looperDispatch(
                looperActions.setModuleName({
                  vcId,
                  moduleIx,
                  name: editingName,
                  afterUpdateConnectables: () => {
                    const newFromDescriptor: ConnectableDescriptor = { vcId, name: editingName };
                    allConnectedDestinations.forEach(([_from, to]) =>
                      connect(newFromDescriptor, to)
                    );
                  },
                })
              );

              setEditingName(null);
            } else if (evt.key === 'Escape') {
              setEditingName(null);
            }
          }}
        />
      )}
    </div>
  );
};

export interface LooperUIProps {
  vcId: string;
}

const LooperUI: React.FC<LooperUIProps> = ({ vcId }) => {
  const { activeModule, activeModuleIx, phaseSAB, totalModuleCount } = useSelector(
    (state: ReduxStore) => {
      const instState = state.looper.stateByVcId[vcId];

      return {
        ...R.pick(['activeModuleIx', 'phaseSAB'], instState),
        activeModule: instState.modules[instState.activeModuleIx] as LooperModule | undefined,
        totalModuleCount: instState.modules.length,
      };
    },
    shallowEqual
  );

  return (
    <div className='looper'>
      <LooperTabSwitcher vcId={vcId} activeSubModuleIx={activeModuleIx} />
      <div className='looper-banks-wrapper'>
        {activeModule ? (
          <ModuleInfo
            name={activeModule.name}
            vcId={vcId}
            moduleIx={activeModuleIx}
            totalModuleCount={totalModuleCount}
          />
        ) : null}
        <div className='looper-banks'>
          {activeModule?.banks.map((bank, bankIx) => (
            <LooperBankComp
              vcId={vcId}
              isActive={bankIx === activeModule.activeBankIx}
              key={bank.id}
              bank={bank}
              bankIx={bankIx}
              isLast={bankIx === activeModule.banks.length - 1}
              phaseSAB={phaseSAB}
              moduleIx={activeModuleIx}
            />
          )) ?? null}
          {activeModule ? <AddBankControlPanel moduleIx={activeModuleIx} vcId={vcId} /> : null}
        </div>
        {activeModule ? <ConfigureTransitionAlgorithm vcId={vcId} /> : null}
      </div>
    </div>
  );
};

export default LooperUI;
