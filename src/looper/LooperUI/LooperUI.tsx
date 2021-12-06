import React, { useMemo } from 'react';
import { useSelector } from 'react-redux';
import * as R from 'ramda';
import ControlPanel from 'react-control-panel';

import { ReduxStore, looperDispatch } from 'src/redux';
import { looperActions, LooperBank } from 'src/redux/modules/looper';
import './LooperUI.scss';
import { renderModalWithControls } from 'src/controls/Modal';
import { withReactQueryClient } from 'src/reactUtils';
import { mkLoadMIDICompositionModal } from 'src/midiEditor/LoadMIDICompositionModal';

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
}

const LooperBankComp: React.FC<LooperBankCompProps> = ({
  isLast,
  vcId,
  isActive,
  bank,
  bankIx,
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
            looperDispatch(looperActions.setLoadedComposition({ vcId, bankIx, composition }));
          } catch (_err) {
            return;
          }
        },
      },
      {
        type: 'button',
        label: 'activate bank',
        action: () => looperDispatch(looperActions.setActiveBankIx({ vcId, bankIx })),
      },
    ],
    [bankIx, vcId]
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
              looperDispatch(looperActions.deleteBank({ vcId, bankId: bank.id }));
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
      <div>TODO</div>
    </div>
  );
};

interface LooperMainControlPanelProps {
  vcId: string;
}

const LooperMainControlPanel: React.FC<LooperMainControlPanelProps> = ({ vcId }) => {
  const settings = useMemo(
    () => [
      {
        type: 'button',
        label: 'add midi bank',
        action: () => looperDispatch(looperActions.addBank({ vcId })),
      },
    ],
    [vcId]
  );

  return <ControlPanel settings={settings} width={400} className='looper-main-control-panel' />;
};

export interface LooperUIProps {
  vcId: string;
}

const LooperUI: React.FC<LooperUIProps> = ({ vcId }) => {
  const { banks, activeBankIx } = useSelector((state: ReduxStore) =>
    R.pick(['banks', 'activeBankIx'], state.looper.stateByVcId[vcId])
  );

  return (
    <div className='looper'>
      <div className='looper-banks'>
        {banks.map((bank, bankIx) => (
          <LooperBankComp
            vcId={vcId}
            isActive={bankIx === activeBankIx}
            key={bank.id}
            bank={bank}
            bankIx={bankIx}
            isLast={bankIx === banks.length - 1}
          />
        ))}
      </div>

      <LooperMainControlPanel vcId={vcId} />
    </div>
  );
};

export default LooperUI;
