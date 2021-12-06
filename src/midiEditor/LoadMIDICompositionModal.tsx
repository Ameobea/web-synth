import { filterNils } from 'ameo-utils';
import React, { useRef } from 'react';
import ControlPanel from 'react-control-panel';
import * as R from 'ramda';
import { useQuery } from 'react-query';

import { getSavedMIDICompositions, SavedMIDIComposition } from 'src/api';
import type { ModalCompProps } from 'src/controls/Modal';
import BasicModal from 'src/misc/BasicModal';

interface LoadMIDICompositionModalContentProps {
  midiCompositions: SavedMIDIComposition[] | undefined;
  onSubmit: (args: { composition: SavedMIDIComposition }) => void;
  onCancel: (() => void) | undefined;
  prompt: string | undefined;
}

const LoadMIDICompositionModalContent: React.FC<LoadMIDICompositionModalContentProps> = ({
  midiCompositions,
  onSubmit,
  onCancel,
  prompt,
}) => {
  const controlPanelCtx = useRef<null | any>(null);
  if (!midiCompositions) {
    return (
      <>
        <i>Loading MIDI Compositions...</i>
        <br />
        {onCancel ? (
          <ControlPanel settings={[{ type: 'button', label: 'cancel', action: onCancel }]} />
        ) : null}
      </>
    );
  }

  return (
    <>
      <ControlPanel
        contextCb={(ctx: any) => {
          controlPanelCtx.current = ctx;
        }}
        settings={filterNils([
          {
            label: 'composition',
            type: 'select',
            options: R.zipObj(
              midiCompositions.map(R.prop('name')),
              midiCompositions.map(R.prop('id'))
            ),
            initial: midiCompositions[0].id,
          },
          {
            type: 'button',
            label: 'load',
            action: () => {
              if (!controlPanelCtx.current) {
                console.warn('Submitted w/o control panel ctx being set');
                return;
              }
              const proceed = !prompt || confirm(prompt);
              if (!proceed) {
                return;
              }

              const compositionID = controlPanelCtx.current.composition;
              const composition = midiCompositions.find(comp => comp.id == compositionID);
              if (!composition) {
                console.error('Selected composition not loaded, id=' + compositionID);
                return;
              }
              onSubmit({ composition });
            },
          },
          onCancel ? { type: 'button', label: 'cancel', action: onCancel } : null,
        ])}
      />
    </>
  );
};

type LoadMIDICompositionModalProps = ModalCompProps<{ composition: SavedMIDIComposition }>;

export const mkLoadMIDICompositionModal = (prompt?: string) => {
  const LoadMIDICompositionModal: React.FC<LoadMIDICompositionModalProps> = ({
    onSubmit,
    onCancel,
  }) => {
    const { data: midiCompositions } = useQuery(['midiCompositions'], getSavedMIDICompositions);

    return (
      <BasicModal className='midi-modal'>
        <h2>Load MIDI Composition</h2>
        <LoadMIDICompositionModalContent
          midiCompositions={midiCompositions}
          onSubmit={onSubmit}
          onCancel={onCancel}
          prompt={prompt}
        />
      </BasicModal>
    );
  };
  return LoadMIDICompositionModal;
};
