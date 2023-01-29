import { filterNils } from 'ameo-utils/util';
import React from 'react';

interface MIDIEditorControlButtonProps {
  onClick: () => void;
  label: React.ReactNode;
  disabled?: boolean;
  style?: React.CSSProperties;
  active?: boolean;
  title: string;
}

export const MIDIEditorControlButton: React.FC<MIDIEditorControlButtonProps> = ({
  onClick,
  label,
  disabled,
  style,
  active,
  title,
}) => (
  <div
    role='button'
    className={filterNils(['midi-editor-control-button', active ? 'active' : null]).join(' ')}
    style={disabled ? { ...(style ?? {}), color: '#666' } : style}
    onClick={disabled ? undefined : onClick}
    title={title}
  >
    {label}
  </div>
);
