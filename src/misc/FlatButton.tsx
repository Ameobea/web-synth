import React, { type ButtonHTMLAttributes } from 'react';

import './FlatButton.css';

const FlatButton: React.FC<ButtonHTMLAttributes<HTMLButtonElement>> = ({ ...props }) => (
  <button
    {...props}
    className={props.className ? `${props.className} flat-button` : 'flat-button'}
  />
);

export default FlatButton;
