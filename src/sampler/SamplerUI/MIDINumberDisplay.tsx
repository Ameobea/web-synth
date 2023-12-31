import React from 'react';

interface MIDINumberDisplayProps {
  value: number | null | undefined;
}

export const MIDINumberDisplay: React.FC<MIDINumberDisplayProps> = ({ value }) => (
  <div style={{ display: 'inline', lineHeight: '20px' }}>
    {value ?? <i style={{ color: 'orange' }}>Not Set</i>}
  </div>
);
