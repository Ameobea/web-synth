import React, { Suspense } from 'react';

const Inner = React.lazy(() => import('react-control-panel'));

const ControlPanel: React.FC<any> = props => (
  <Suspense fallback={null}>
    <Inner {...props} />
  </Suspense>
);

export default ControlPanel;
