import React, { useMemo } from 'react';
import { shallowEqual, useSelector } from 'react-redux';
import * as R from 'ramda';
import ControlPanel from 'react-control-panel';

import { ReduxStore, looperDispatch } from 'src/redux';
import { looperActions, LooperBank } from 'src/redux/modules/looper';
import './LooperUI.scss';
import { renderModalWithControls } from 'src/controls/Modal';
import { withReactQueryClient } from 'src/reactUtils';
import { mkLoadMIDICompositionModal } from 'src/midiEditor/LoadMIDICompositionModal';
import LooperViz from 'src/looper/LooperUI/LooperViz';

const DeleteBankButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button className='delete-looper-bank-button' onClick={onClick}>
    ×
  </button>
);

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
            const { composition } = await renderModalWithControls(
              withReactQueryClient(mkLoadMIDICompositionModal(undefined))
            );
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
    <div className='looper-bank' data-active={`${isActive}`}>
      {isLast ? (
        <div style={{ position: 'relative', background: 'red' }}>
          <DeleteBankButton
            onClick={() => {
              const proceed = window.confirm('Are you sure you want to delete this bank?');
              if (!proceed) {
                return;
              }
              looperDispatch(looperActions.deleteBank({ vcId, moduleIx, bankId: bank.id }));
            }}
          />
        </div>
      ) : (
        <div />
      )}
      <ControlPanel width={400} settings={settings} />
      <div className='active-composition-name'>
        Loaded Sequence:
        <br />
        <b>{bank.loadedComposition ? bank.loadedComposition.name : 'NONE'}</b>
      </div>
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

const LooperMainControlPanel: React.FC<LooperMainControlPanelProps> = ({ vcId, moduleIx }) => {
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
    </div>
  );
};

interface ModuleInfoProps {
  name: string;
}

const ModuleInfo: React.FC<ModuleInfoProps> = ({ name }) => {
  return (
    <div className='looper-module-info'>
      <h2>{name}</h2>
    </div>
  );
};

export interface LooperUIProps {
  vcId: string;
}

const LooperUI: React.FC<LooperUIProps> = ({ vcId }) => {
  const { activeModule, activeModuleIx, phaseSAB } = useSelector((state: ReduxStore) => {
    const instState = state.looper.stateByVcId[vcId];

    return {
      ...R.pick(['activeModuleIx', 'phaseSAB'], instState),
      activeModule: instState.modules[instState.activeModuleIx],
    };
  }, shallowEqual);

  return (
    <div className='looper'>
      <LooperTabSwitcher vcId={vcId} activeSubModuleIx={activeModuleIx} />
      <div className='looper-banks-wrapper'>
        <ModuleInfo name={activeModule.name} />
        <div className='looper-banks'>
          {activeModule.banks.map((bank, bankIx) => (
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
          ))}
        </div>

        <LooperMainControlPanel moduleIx={activeModuleIx} vcId={vcId} />
      </div>
    </div>
  );
};

export default LooperUI;
