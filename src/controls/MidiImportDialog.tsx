import React, { useState } from 'react';

import './MidiImportDialog.scss';
import { renderModalWithControls } from './Modal';

export interface MidiTrackInfo {
  copyright?: string | null;
  name?: string | null;
}

export interface MidiFileInfo {
  tracks: MidiTrackInfo[];
  division: number;
}

interface MidiImportSettings {
  track: number;
}

const TrackInputItem: React.FC<{ onSelect: () => void; isSelected: boolean } & MidiTrackInfo> = ({
  onSelect,
  isSelected,
  name,
  copyright,
}) => (
  <div className='track-input-item'>
    <input type='radio' checked={isSelected} onChange={onSelect} />
    <>
      Name: {name || '<untitled>'}; {copyright ? <>Copyright: {copyright}</> : null}
    </>
  </div>
);

const mkMidiImportDialog: (
  fileInfo: MidiFileInfo
) => React.FC<{
  onSubmit: (settings: MidiImportSettings) => void;
}> = fileInfo => {
  const MidiImportDialog = ({ onSubmit }) => {
    const [selectedTrack, setSelectedTrack] = useState(0);

    return (
      <div className='midi-import-dialog'>
        <>
          {fileInfo.tracks.map((track, i) => (
            <TrackInputItem
              {...track}
              key={i}
              onSelect={() => setSelectedTrack(i)}
              isSelected={selectedTrack === i}
            />
          ))}
        </>

        <button
          onClick={() => {
            const settings: MidiImportSettings = {
              track: selectedTrack,
            };

            onSubmit(settings);
          }}
        />
      </div>
    );
  };

  return MidiImportDialog;
};

export const getMidiImportSettings = (fileInfo: MidiFileInfo) =>
  renderModalWithControls(mkMidiImportDialog(fileInfo));
