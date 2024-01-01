import React from 'react';
import { useMappedWritableValue } from 'src/reactUtils';
import GatedIndicatorCircleSvelte from 'src/sampler/SamplerUI/GatedIndicatorCircle.svelte';
import { mkSvelteComponentShim } from 'src/svelteUtils';
import type { Writable } from 'svelte/store';

interface MIDINumberDisplayProps {
  value: number | null | undefined;
}

const GatedIndicatorCircle = mkSvelteComponentShim(GatedIndicatorCircleSvelte);

export const mkMIDINumberDisplay = (
  getMidiGateStatusBufferF32: () => Float32Array | null,
  midiGateStatusUpdated: Writable<number>,
  midiNumber: number | undefined
) => {
  const MIDINumberDisplay: React.FC<MIDINumberDisplayProps> = ({ value }) => {
    const isGated = useMappedWritableValue(
      midiGateStatusUpdated,
      () => typeof midiNumber === 'number' && !!getMidiGateStatusBufferF32()?.[midiNumber]
    );

    return (
      <div
        style={{
          display: 'inline-flex',
          lineHeight: '20px',
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        {value ?? <i style={{ color: 'orange' }}>Not Set</i>}
        {isGated ? (
          <div style={{ marginLeft: 6 }}>
            <GatedIndicatorCircle />
          </div>
        ) : null}
      </div>
    );
  };
  return MIDINumberDisplay;
};
