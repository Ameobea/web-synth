import React from 'react';

import './BasicModal.scss';

const BasicModal: React.FC<{} & React.DetailsHTMLAttributes<HTMLDivElement>> = ({
  children,
  ...props
}) => (
  <div className='basic-modal' {...props}>
    {children}
  </div>
);

export default BasicModal;
