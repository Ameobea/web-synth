interface BandParamDisplayProps {
  value: number;
  onChange: (value: number) => void;
  theme: Record<string, string>;
}

export const mkBandParamDisplay = (isExternallyAutomated: boolean) => {
  const BandParamDisplay: React.FC<BandParamDisplayProps> = ({ value }) => {
    return (
      <div style={{ display: 'inline-block', paddingTop: 4, paddingBottom: 2 }}>
        <span style={{ display: 'inline-block', width: 80 }}>{value.toFixed(3)}</span>
        {isExternallyAutomated ? (
          <span style={{ color: '#f5427b', fontSize: 8.7, marginLeft: 8 }}>
            EXTERNALLY AUTOMATED
          </span>
        ) : null}
      </div>
    );
  };
  return BandParamDisplay;
};
