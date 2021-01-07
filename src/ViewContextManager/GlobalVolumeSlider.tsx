import React, { useState } from 'react';
import { Option } from 'funfix-core';

import './GlobalVolume.scss';

const ctx = new AudioContext();

const GlobalVolumeSlider: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [value, setValue] = useState(Option.of(localStorage.getItem('globalVolume')).getOrElse(20));

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
            localStorage.setItem('globalVolume', value.toString());
            setValue(value);
            (((ctx as unknown) as any).globalVolume as GainNode).gain.value = value / 100;
          }}
        />
      </div>
    </>
  );
};

export default GlobalVolumeSlider;
