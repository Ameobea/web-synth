import React, { useState } from 'react';

import './GlobalVolume.css';

const ctx = new AudioContext();

export const setGlobalVolume = (newGlobalVolume: number) => {
  localStorage.setItem('globalVolume', newGlobalVolume.toString());
  ((ctx as any).globalVolume as GainNode).gain.value = newGlobalVolume / 100;
};

interface GlobalVolumeSliderProps {
  onClose: () => void;
}

export const GlobalVolumeSlider: React.FC<GlobalVolumeSliderProps> = ({ onClose }) => {
  const [value, setValue] = useState(localStorage.getItem('globalVolume') ?? 20);

  return (
    <>
      <div
        className='global-menu-backdrop'
        onClick={evt => {
          evt.stopPropagation();
          onClose();
        }}
      />
      <div className='global-volume-slider-container'>
        <input
          type='range'
          min={0}
          max={100}
          className='vertical-range-slider'
          style={{ position: 'absolute', left: -44 }}
          value={value}
          onChange={evt => {
            const value = +evt.target.value;
            setValue(value);
            setGlobalVolume(value);
          }}
        />
      </div>
    </>
  );
};
