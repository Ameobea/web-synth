import { filterNils } from 'ameo-utils';
import React from 'react';

import './BasicModal.scss';

const BasicModal: React.FC<React.DetailsHTMLAttributes<HTMLDivElement>> = ({
  children,
  className,
  ...props
}) => (
  <div className={filterNils(['basic-modal', className]).join(' ')} {...props}>
    {children}
  </div>
);

export default BasicModal;
