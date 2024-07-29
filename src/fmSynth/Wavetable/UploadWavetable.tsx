import React, { useEffect, useState } from 'react';

import './UploadWavetable.css';
import type { ModalCompProps } from 'src/controls/Modal';
import type { WavetableBank } from 'src/fmSynth/ConfigureOperator';
import BasicModal from 'src/misc/BasicModal';
import { AsyncOnce } from 'src/util';

const SAMPLE_RATE = 44_100;

const WavDecoder = new AsyncOnce(() => import('src/wav_decoder'));

interface WavetableUploadInfo {
  samples: Float32Array;
}

interface UploadPromptProps {
  onUpload: (info: WavetableUploadInfo) => void;
  onCancel?: () => void;
}

const UploadPrompt: React.FC<UploadPromptProps> = ({ onUpload, onCancel }) => (
  <>
    <h2>Upload a wavetable</h2>
    <p>
      Upload a .wav file containing a wavetable. If you don&apos;t have a wavetable to upload, the
      program{' '}
      <a href='https://synthtech.com/waveedit/' target='_blank'>
        WaveEdit
      </a>{' '}
      is a great option for creating one. It also has a library of shared wavetables created by
      users you can download.
    </p>
    <input
      type='file'
      id='upload-wavetable-uploader'
      style={{ display: 'none' }}
      onChange={async evt => {
        try {
          const decoder = await WavDecoder.get();
          const file = evt.target.files?.[0];
          if (!file) {
            return;
          }
          const fileData = await file.arrayBuffer();
          const samples = decoder.decode_wav(new Uint8Array(fileData));
          if (samples.length === 0) {
            const errorMessage = decoder.get_error_message();
            alert(`Error decoding wavetable: ${errorMessage}`);

            if (evt.target) {
              evt.target.value = '';
            }
            return;
          }
          onUpload({ samples });
        } catch (err) {
          alert('Error decoding uploaded file: ' + `${err}`);
          if (evt.target) {
            evt.target.value = '';
          }
        }
      }}
    />
    <div className='buttons-container'>
      <button
        onClick={() => {
          const uploader = document.getElementById('upload-wavetable-uploader') as HTMLInputElement;
          uploader.dispatchEvent(new MouseEvent('click'));
        }}
      >
        Upload Wavetable
      </button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  </>
);

const validateUpload = (
  existingWavetableBankNames: string[],
  bank: WavetableBank
): string | null => {
  if (bank.samplesPerWaveform * bank.waveformsPerDimension !== bank.samples.length) {
    return `\`samples per waveform\` * \`waveforms per dimension\` must be equal to uploaded sample count (${bank.samples.length}).`;
  }

  if (!bank.name) {
    return 'Wavetable name is required.';
  }
  if (existingWavetableBankNames.includes(bank.name)) {
    return `A wavetable with the name \`${bank.name}\` already exists.`;
  }

  return null;
};

const buildInitialWavetableBank = (samples: Float32Array): WavetableBank => {
  let samplesPerWaveform = 0;
  let waveformsPerDimension = 0;
  if (samples.length % 256 === 0) {
    samplesPerWaveform = 256;
    waveformsPerDimension = samples.length / samplesPerWaveform;
  }

  return {
    name: '',
    samplesPerWaveform,
    waveformsPerDimension,
    samples,
    baseFrequency: samplesPerWaveform > 0 ? SAMPLE_RATE / samplesPerWaveform : 250,
  };
};

interface ConfigureUploadProps {
  existingWavetableBankNames: string[];
  upload: WavetableUploadInfo;
  onClear: () => void;
  onSubmit: (bank: WavetableBank) => void;
}

const ConfigureUpload: React.FC<ConfigureUploadProps> = ({
  existingWavetableBankNames,
  upload,
  onClear,
  onSubmit,
}) => {
  const [state, setState] = useState<WavetableBank>(buildInitialWavetableBank(upload.samples));
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <label>Name</label>
      <input
        type='text'
        value={state.name}
        onChange={evt => {
          setState({ ...state, name: evt.target.value });
        }}
      />
      <label>Samples per Waveform</label>
      <input
        type='number'
        value={state.samplesPerWaveform}
        onChange={evt => {
          const value = parseInt(evt.target.value, 10);
          if (value > 0) {
            setState({ ...state, samplesPerWaveform: value, baseFrequency: SAMPLE_RATE / value });
          }
        }}
      />
      <label>Waveforms per Dimension</label>
      <input
        type='number'
        value={state.waveformsPerDimension}
        onChange={evt => {
          const value = parseInt(evt.target.value, 10);
          if (value > 0) {
            setState({ ...state, waveformsPerDimension: value });
          }
        }}
      />
      <label>Base Frequency (only change if you know what you&apos;re doing)</label>
      <input
        type='number'
        value={state.baseFrequency}
        onChange={evt => {
          const value = parseFloat(evt.target.value);
          if (value > 0) {
            setState({ ...state, baseFrequency: value });
          }
        }}
      />
      <div className='buttons-container'>
        <button
          onClick={() => {
            setError(null);
            const errorMsg = validateUpload(existingWavetableBankNames, state);
            if (errorMsg) {
              setError(errorMsg);
              return;
            }

            onSubmit(state);
          }}
        >
          Submit
        </button>
        <button onClick={onClear}>Cancel</button>
      </div>
      {error ? <span style={{ color: 'red' }}>{error}</span> : null}
    </>
  );
};

export type UploadWavetableModalProps = ModalCompProps<WavetableBank>;

export const mkUploadWavetableModal = (existingWavetableBankNames: string[]) => {
  const UploadWavetableModal: React.FC<UploadWavetableModalProps> = ({ onSubmit, onCancel }) => {
    const [upload, setUpload] = useState<WavetableUploadInfo | null>(null);
    useEffect(() => {
      // Load the wav decoder Wasm module eagerly
      WavDecoder.get();
    }, []);

    return (
      <BasicModal className='upload-wavetable-modal'>
        {upload ? (
          <ConfigureUpload
            existingWavetableBankNames={existingWavetableBankNames}
            upload={upload}
            onClear={() => setUpload(null)}
            onSubmit={onSubmit}
          />
        ) : (
          <UploadPrompt onCancel={onCancel} onUpload={setUpload} />
        )}
      </BasicModal>
    );
  };
  return UploadWavetableModal;
};
