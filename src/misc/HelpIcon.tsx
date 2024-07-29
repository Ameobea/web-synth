import React from 'react';
import { Tooltip, type Position } from 'react-tippy';

import 'react-tippy/dist/tippy.css';
import './HelpIcon.css';

interface HelpIconIconProps
  extends React.DetailedHTMLProps<React.HTMLAttributes<SVGSVGElement>, SVGSVGElement> {
  size?: number;
  color?: string;
}

// From: https://icons.mono.company/, MIT license
const HelpIconIcon: React.FC<HelpIconIconProps> = ({ size = 18, color = '#FCFCFC', ...props }) => (
  <svg
    fill='none'
    viewBox='0 0 24 24'
    height={size}
    width={size}
    xmlns='http://www.w3.org/2000/svg'
    className='help-icon'
    {...props}
  >
    <path
      xmlns='http://www.w3.org/2000/svg'
      d='M12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4ZM2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12Z'
      fill={color}
    ></path>
    <path
      xmlns='http://www.w3.org/2000/svg'
      d='M12 14C11.4477 14 11 13.5523 11 13V12C11 11.4477 11.4477 11 12 11C12.5523 11 13 11.4477 13 12V13C13 13.5523 12.5523 14 12 14Z'
      fill={color}
    ></path>
    <path
      xmlns='http://www.w3.org/2000/svg'
      d='M10.5 16.5C10.5 15.6716 11.1716 15 12 15C12.8284 15 13.5 15.6716 13.5 16.5C13.5 17.3284 12.8284 18 12 18C11.1716 18 10.5 17.3284 10.5 16.5Z'
      fill={color}
    ></path>
    <path
      xmlns='http://www.w3.org/2000/svg'
      d='M12.3899 7.81137C11.4329 7.7658 10.6304 8.3004 10.4864 9.1644C10.3956 9.70917 9.88037 10.0772 9.3356 9.9864C8.79083 9.8956 8.42281 9.38037 8.51361 8.8356C8.86961 6.69961 10.8171 5.73421 12.4851 5.81363C13.3395 5.85432 14.2176 6.16099 14.8937 6.79278C15.5866 7.44027 16 8.36777 16 9.5C16 10.7913 15.4919 11.7489 14.6172 12.3321C13.8141 12.8675 12.8295 13 12 13C11.4477 13 11 12.5523 11 12C11 11.4477 11.4477 11 12 11C12.6705 11 13.1859 10.8825 13.5078 10.668C13.7581 10.5011 14 10.2087 14 9.5C14 8.88224 13.7884 8.49723 13.5282 8.2541C13.2512 7.99526 12.848 7.83318 12.3899 7.81137Z'
      fill={color}
    ></path>
  </svg>
);

interface HelpIconProps {
  link: string;
  size?: number;
  style?: React.CSSProperties;
  tooltipStyle?: React.CSSProperties;
  color?: string;
  arrow?: boolean;
  position?: Position;
}

const HelpIcon: React.FC<HelpIconProps> = ({
  link,
  size,
  style,
  tooltipStyle,
  color,
  arrow = true,
  position,
}) => {
  const content = (
    <a href={link.startsWith('http') ? link : `/docs/${link}`} target='_blank'>
      <HelpIconIcon style={style} size={size} color={color} />
    </a>
  );

  if (link.startsWith('http')) {
    return content;
  }

  return (
    <Tooltip
      interactive
      distance={6}
      duration={200}
      arrow={arrow}
      position={position}
      style={tooltipStyle}
      html={
        <>
          web synth docs: <code>{link}</code>
        </>
      }
    >
      {content}
    </Tooltip>
  );
};

export default HelpIcon;
