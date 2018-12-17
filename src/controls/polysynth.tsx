import * as React from 'react';
import * as R from 'ramda';
import ControlPanel, { Range } from 'react-control-panel';

import { bitcrusher } from '../chords';

const flatten = (obj, prefix = '') =>
  Object.entries(obj).reduce((acc, [key, val]) => {
    if (typeof val === 'object') {
      return { ...acc, ...flatten(val, `${prefix}${prefix ? '.' : ''}${key}`) };
    }
    return { ...acc, [`${prefix}${prefix ? '.' : ''}${key}`]: val };
  }, {});

const comps = {
  'click here to select': null,
  harry_potter:
    'HQAAAAAAAAAFAAAAAAAAAAAA6EEAAABABgAAAAAAAAAAAPhBAACAPwcAAAAAAAAAAADAQAAAAEAHAAAAAAAAAAAAAEIAAABABwAAAAAAAAAAABBCAAAAQAgAAAAAAAAAAAAAAAAAAEAIAAAAAAAAAAAAQEAAAABACAAAAAAAAAAAAABBAACAPwgAAAAAAAAAAABAQQAAAEAIAAAAAAAAAAAAkEEAAEBACAAAAAAAAAAAALhBAAAAQAgAAAAAAAAAAADQQQAAAEAIAAAAAAAAAAAAGEIAAAA/CQAAAAAAAAAAABBBAAAAQAkAAAAAAAAAAAAwQQAAgD8JAAAAAAAAAAAAGkIAAAA/CgAAAAAAAAAAAAhCAACAPwoAAAAAAAAAAAAsQgAAAEAMAAAAAAAAAAAAAEAAAIA/DAAAAAAAAAAAAKBAAACAPwwAAAAAAAAAAABgQQAAAD8MAAAAAAAAAAAAiEEAAIA/DAAAAAAAAAAAALBBAACAPwwAAAAAAAAAAADIQQAAgD8MAAAAAAAAAAAA4EEAAIA/DAAAAAAAAAAAACRCAACAPw8AAAAAAAAAAABoQQAAAD8UAAAAAAAAAAAAcEEAAABAFAAAAAAAAAAAABxCAAAAQA==',
  sophia_frosty:
    'OQAAAAAAAAAQAAAAAAAAAAAAAEEAAAA/EAAAAAAAAAAAAHBBAAAAPxAAAAAAAAAAAAAUQgAAAD8QAAAAAAAAAAAAMkIAAAA/EgAAAAAAAAAAAIBAAAAAPxIAAAAAAAAAAADQQAAAAD8SAAAAAAAAAAAACEEAAAA/EgAAAAAAAAAAAGBBAAAAPxIAAAAAAAAAAACAQQAAAD8SAAAAAAAAAAAAqEEAAAA/EgAAAAAAAAAAAAhCAAAAPxIAAAAAAAAAAAAQQgAAAD8SAAAAAAAAAAAAGEIAAAA/EgAAAAAAAAAAAC5CAAAAPxIAAAAAAAAAAAA4QgAAAD8SAAAAAAAAAAAATEIAAAA/EwAAAAAAAAAAALBAAAAAPxMAAAAAAAAAAAAYQQAAAD8TAAAAAAAAAAAAUEEAAAA/EwAAAAAAAAAAAIhBAAAAPxMAAAAAAAAAAAAMQgAAAD8TAAAAAAAAAAAAHEIAAAA/EwAAAAAAAAAAACpCAAAAPxMAAAAAAAAAAAA8QgAAAD8VAAAAAAAAAAAAKEEAAAA/FQAAAAAAAAAAAIxBAAAAPxUAAAAAAAAAAACUQQAAAD8VAAAAAAAAAAAAIEIAAAA/FQAAAAAAAAAAAD5CAAAAPxUAAAAAAAAAAABCQgAAAD8XAAAAAAAAAAAAAD8AAAA/FwAAAAAAAAAAAGBAAAAAPxcAAAAAAAAAAAAwQQAAAD8XAAAAAAAAAAAAnEEAAAA/FwAAAAAAAAAAAMBBAAAAPxcAAAAAAAAAAADcQQAAAD8XAAAAAAAAAAAA7EEAAAA/FwAAAAAAAAAAAARCAAAAPxcAAAAAAAAAAAAkQgAAAD8XAAAAAAAAAAAARkIAAAA/FwAAAAAAAAAAAFhCAAAAPxkAAAAAAAAAAAAgQAAAAD8ZAAAAAAAAAAAAyEEAAAA/GQAAAAAAAAAAANhBAAAAPxkAAAAAAAAAAAD8QQAAAD8ZAAAAAAAAAAAAXkIAAAA/GgAAAAAAAAAAAMA/AAAAPxoAAAAAAAAAAACwQQAAAD8aAAAAAAAAAAAAuEEAAAA/GgAAAAAAAAAAAMxBAAAAPxoAAAAAAAAAAAD0QQAAAD8aAAAAAAAAAAAAUEIAAAA/GgAAAAAAAAAAAFRCAAAAPxoAAAAAAAAAAABkQgAAAD8cAAAAAAAAAAAA1EEAAAA/HAAAAAAAAAAAAGpCAAAAPx4AAAAAAAAAAABwQgAAAD8=',
  sophia_happy_birthday:
    'GQAAAAAAAAAAAAAAAAAAAAAAgEEAAAA/AgAAAAAAAAAAAKhBAAAAPwIAAAAAAAAAAACwQQAAAD8DAAAAAAAAAAAAiEEAAAA/AwAAAAAAAAAAALhBAAAAPwUAAAAAAAAAAAA4QQAAAD8FAAAAAAAAAAAAxEEAAAA/BwAAAAAAAAAAAKBAAAAAPwcAAAAAAAAAAABAQQAAAD8HAAAAAAAAAAAAkEEAAAA/BwAAAAAAAAAAALxBAAAAPwcAAAAAAAAAAADIQQAAAD8IAAAAAAAAAAAAwEAAAAA/CAAAAAAAAAAAAJhBAAAAPwoAAAAAAAAAAABgQAAAAD8KAAAAAAAAAAAAGEEAAAA/CgAAAAAAAAAAAKBBAAAAPwwAAAAAAAAAAADAPwAAAD8MAAAAAAAAAAAAIEAAAAA/DAAAAAAAAAAAAIBAAAAAPwwAAAAAAAAAAADwQAAAAD8MAAAAAAAAAAAACEEAAAA/DAAAAAAAAAAAAChBAAAAPwwAAAAAAAAAAABgQQAAAD8MAAAAAAAAAAAAcEEAAAA/',
  sophia_name:
    '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',
  steven:
    '6gAAAAAAAAADAAAAAAAAAAAAwEAAAAA/AwAAAAAAAAAAANBAAAAAPwQAAAAAAAAAAACwQAAAAEAEAAAAAAAAAAAAyEEAAAA/BQAAAAAAAAAAAKBAAABAQAUAAAAAAAAAAADEQQAAAD8FAAAAAAAAAAAAyEEAAAA/BQAAAAAAAAAAAMxBAAAAPwYAAAAAAAAAAACQQAAAgEAGAAAAAAAAAAAAwEEAAAA/BgAAAAAAAAAAAMRBAAAAPwYAAAAAAAAAAADIQQAAAD8GAAAAAAAAAAAAzEEAAAA/BgAAAAAAAAAAANBBAAAAPwcAAAAAAAAAAACAQAAAoEAHAAAAAAAAAAAAvEEAAAA/BwAAAAAAAAAAAMBBAAAAPwcAAAAAAAAAAADEQQAAAD8HAAAAAAAAAAAAyEEAAAA/BwAAAAAAAAAAAMxBAAAAPwcAAAAAAAAAAADQQQAAAD8HAAAAAAAAAAAA1EEAAAA/CAAAAAAAAAAAAGBAAADAQAgAAAAAAAAAAACsQQAAAD8IAAAAAAAAAAAAsEEAAAA/CAAAAAAAAAAAALxBAAAAPwgAAAAAAAAAAADAQQAAAD8IAAAAAAAAAAAAxEEAAAA/CAAAAAAAAAAAAMhBAAAAPwgAAAAAAAAAAADMQQAAAD8IAAAAAAAAAAAA0EEAAAA/CAAAAAAAAAAAANRBAAAAPwkAAAAAAAAAAABAQAAA4EAJAAAAAAAAAAAAOEEAAAA/CQAAAAAAAAAAAKxBAAAAPwkAAAAAAAAAAACwQQAAAD8JAAAAAAAAAAAAvEEAAAA/CQAAAAAAAAAAAMBBAAAAPwkAAAAAAAAAAADIQQAAAD8JAAAAAAAAAAAA0EEAAAA/CQAAAAAAAAAAANRBAAAAPwoAAAAAAAAAAAAAAAAAAD8KAAAAAAAAAAAAAD8AAAA/CgAAAAAAAAAAAIA/AAAAPwoAAAAAAAAAAAAgQAAAAEEKAAAAAAAAAAAAOEEAAAA/CgAAAAAAAAAAAKxBAAAAPwoAAAAAAAAAAACwQQAAAD8KAAAAAAAAAAAAvEEAAAA/CgAAAAAAAAAAAMBBAAAAPwoAAAAAAAAAAADEQQAAAD8KAAAAAAAAAAAAyEEAAAA/CgAAAAAAAAAAAMxBAAAAPwoAAAAAAAAAAADQQQAAAD8KAAAAAAAAAAAA1EEAAAA/CwAAAAAAAAAAAAA/AAAAPwsAAAAAAAAAAAAAQAAAEEELAAAAAAAAAAAAOEEAAAA/CwAAAAAAAAAAAFBBAAAAPwsAAAAAAAAAAACgQQAAAD8LAAAAAAAAAAAArEEAAAA/CwAAAAAAAAAAALBBAAAAPwsAAAAAAAAAAAC0QQAAAD8LAAAAAAAAAAAAvEEAAAA/CwAAAAAAAAAAAMBBAAAAPwsAAAAAAAAAAADIQQAAAD8LAAAAAAAAAAAA0EEAAAA/CwAAAAAAAAAAANRBAAAAPwwAAAAAAAAAAAAAAAAAAD8MAAAAAAAAAAAAAD8AAAA/DAAAAAAAAAAAAIA/AAAAPwwAAAAAAAAAAAAgQAAAAEEMAAAAAAAAAAAAOEEAAAA/DAAAAAAAAAAAAEhBAAAAPwwAAAAAAAAAAABQQQAAAD8MAAAAAAAAAAAAWEEAAAA/DAAAAAAAAAAAAJxBAAAAPwwAAAAAAAAAAACgQQAAAD8MAAAAAAAAAAAApEEAAAA/DAAAAAAAAAAAAKxBAAAAPwwAAAAAAAAAAACwQQAAAD8MAAAAAAAAAAAAtEEAAAA/DAAAAAAAAAAAALxBAAAAPwwAAAAAAAAAAADAQQAAAD8MAAAAAAAAAAAAxEEAAAA/DAAAAAAAAAAAAMhBAAAAPwwAAAAAAAAAAADMQQAAAD8MAAAAAAAAAAAA0EEAAAA/DAAAAAAAAAAAANRBAAAAPw0AAAAAAAAAAAAAAAAAAD8NAAAAAAAAAAAAAD8AAAA/DQAAAAAAAAAAAIA/AAAAPw0AAAAAAAAAAABAQAAA4EANAAAAAAAAAAAAOEEAAAA/DQAAAAAAAAAAAEhBAAAAPw0AAAAAAAAAAABQQQAAAD8NAAAAAAAAAAAAWEEAAAA/DQAAAAAAAAAAAGBBAAAAPw0AAAAAAAAAAACYQQAAAD8NAAAAAAAAAAAAnEEAAAA/DQAAAAAAAAAAAKBBAAAAPw0AAAAAAAAAAACkQQAAAD8NAAAAAAAAAAAArEEAAAA/DQAAAAAAAAAAALBBAAAAPw0AAAAAAAAAAAC0QQAAAD8NAAAAAAAAAAAAvEEAAAA/DQAAAAAAAAAAAMBBAAAAPw0AAAAAAAAAAADEQQAAAD8NAAAAAAAAAAAAyEEAAAA/DQAAAAAAAAAAAMxBAAAAPw0AAAAAAAAAAADQQQAAAD8NAAAAAAAAAAAA1EEAAAA/DgAAAAAAAAAAAGBAAADAQA4AAAAAAAAAAAA4QQAAAD8OAAAAAAAAAAAAUEEAAAA/DgAAAAAAAAAAAFhBAAAAPw4AAAAAAAAAAABgQQAAAD8OAAAAAAAAAAAAaEEAAAA/DgAAAAAAAAAAAJRBAAAAPw4AAAAAAAAAAACYQQAAAD8OAAAAAAAAAAAAnEEAAAA/DgAAAAAAAAAAAKBBAAAAPw4AAAAAAAAAAACsQQAAAD8OAAAAAAAAAAAAsEEAAAA/DgAAAAAAAAAAALRBAAAAPw4AAAAAAAAAAAC8QQAAAD8OAAAAAAAAAAAAwEEAAAA/DgAAAAAAAAAAAMRBAAAAPw4AAAAAAAAAAADIQQAAAD8OAAAAAAAAAAAAzEEAAAA/DgAAAAAAAAAAANBBAAAAPw4AAAAAAAAAAADUQQAAAD8PAAAAAAAAAAAAgEAAAJBADwAAAAAAAAAAAAhBAAAAPw8AAAAAAAAAAAA4QQAAAD8PAAAAAAAAAAAAWEEAAAA/DwAAAAAAAAAAAGBBAAAAPw8AAAAAAAAAAABoQQAAAD8PAAAAAAAAAAAAcEEAAAA/DwAAAAAAAAAAAJBBAAAAPw8AAAAAAAAAAACUQQAAAD8PAAAAAAAAAAAAmEEAAAA/DwAAAAAAAAAAAJxBAAAAPw8AAAAAAAAAAACsQQAAAD8PAAAAAAAAAAAAsEEAAAA/DwAAAAAAAAAAALRBAAAAPw8AAAAAAAAAAAC8QQAAAD8PAAAAAAAAAAAAwEEAAAA/DwAAAAAAAAAAAMhBAAAAPw8AAAAAAAAAAADQQQAAAD8PAAAAAAAAAAAA1EEAAAA/EAAAAAAAAAAAAJBAAACAQBAAAAAAAAAAAAA4QQAAAD8QAAAAAAAAAAAAYEEAAAA/EAAAAAAAAAAAAGhBAAAAPxAAAAAAAAAAAABwQQAAAD8QAAAAAAAAAAAAeEEAAAA/EAAAAAAAAAAAAIxBAAAAPxAAAAAAAAAAAACQQQAAAD8QAAAAAAAAAAAAlEEAAAA/EAAAAAAAAAAAAJhBAAAAPxAAAAAAAAAAAACsQQAAAD8QAAAAAAAAAAAAsEEAAAA/EAAAAAAAAAAAALRBAAAAPxAAAAAAAAAAAAC8QQAAAD8QAAAAAAAAAAAAwEEAAAA/EAAAAAAAAAAAAMRBAAAAPxAAAAAAAAAAAADIQQAAAD8QAAAAAAAAAAAAzEEAAAA/EAAAAAAAAAAAANBBAAAAPxAAAAAAAAAAAADUQQAAAD8RAAAAAAAAAAAAoEAAAAA/EQAAAAAAAAAAALBAAAAAPxEAAAAAAAAAAADAQAAAAD8RAAAAAAAAAAAA0EAAAAA/EQAAAAAAAAAAAOBAAAAAPxEAAAAAAAAAAADwQAAAAD8RAAAAAAAAAAAAOEEAAAA/EQAAAAAAAAAAAGhBAAAAPxEAAAAAAAAAAABwQQAAAD8RAAAAAAAAAAAAeEEAAAA/EQAAAAAAAAAAAIBBAAAAPxEAAAAAAAAAAACEQQAAAD8RAAAAAAAAAAAAiEEAAAA/EQAAAAAAAAAAAIxBAAAAPxEAAAAAAAAAAACQQQAAAD8RAAAAAAAAAAAAlEEAAAA/EQAAAAAAAAAAAKxBAAAAPxEAAAAAAAAAAACwQQAAAD8RAAAAAAAAAAAAtEEAAAA/EQAAAAAAAAAAALxBAAAAPxEAAAAAAAAAAADAQQAAAD8RAAAAAAAAAAAAyEEAAAA/EQAAAAAAAAAAANBBAAAAPxEAAAAAAAAAAADUQQAAAD8SAAAAAAAAAAAAsEAAAAA/EgAAAAAAAAAAAMBAAAAAPxIAAAAAAAAAAADQQAAAAD8SAAAAAAAAAAAA4EAAAAA/EgAAAAAAAAAAADhBAAAAPxIAAAAAAAAAAABwQQAAAD8SAAAAAAAAAAAAeEEAAAA/EgAAAAAAAAAAAIBBAAAAPxIAAAAAAAAAAACEQQAAAD8SAAAAAAAAAAAAiEEAAAA/EgAAAAAAAAAAAIxBAAAAPxIAAAAAAAAAAACQQQAAAD8SAAAAAAAAAAAArEEAAAA/EgAAAAAAAAAAALBBAAAAPxIAAAAAAAAAAAC8QQAAAD8SAAAAAAAAAAAAwEEAAAA/EgAAAAAAAAAAAMRBAAAAPxIAAAAAAAAAAADIQQAAAD8SAAAAAAAAAAAAzEEAAAA/EgAAAAAAAAAAANBBAAAAPxIAAAAAAAAAAADUQQAAAD8TAAAAAAAAAAAAwEAAAAA/EwAAAAAAAAAAANBAAAAAPxMAAAAAAAAAAAA4QQAAAD8TAAAAAAAAAAAAeEEAAAA/EwAAAAAAAAAAAIBBAAAAPxMAAAAAAAAAAACEQQAAAD8TAAAAAAAAAAAAiEEAAAA/EwAAAAAAAAAAAIxBAAAAPxMAAAAAAAAAAACsQQAAAD8TAAAAAAAAAAAAsEEAAAA/FAAAAAAAAAAAADhBAAAAPxQAAAAAAAAAAACAQQAAAD8UAAAAAAAAAAAAhEEAAAA/FAAAAAAAAAAAAIhBAAAAPxQAAAAAAAAAAACsQQAAAD8UAAAAAAAAAAAAsEEAAAA/FQAAAAAAAAAAADhBAAAAPxUAAAAAAAAAAACEQQAAAD8=',
  steven2:
    'uQAAAAAAAAAMAAAAAAAAAAAAIEAAAAA/DAAAAAAAAAAAAEBAAAAAPwwAAAAAAAAAAABgQAAAAD8MAAAAAAAAAAAAgEAAAAA/DAAAAAAAAAAAABBBAAAAPwwAAAAAAAAAAAAYQQAAAD8MAAAAAAAAAAAAIEEAAAA/DAAAAAAAAAAAAChBAAAAPw0AAAAAAAAAAABAQAAAAD8NAAAAAAAAAAAAYEAAAAA/DQAAAAAAAAAAAIBAAAAAPw0AAAAAAAAAAACQQAAAAD8NAAAAAAAAAAAACEEAAAA/DQAAAAAAAAAAABBBAAAAPw0AAAAAAAAAAAAYQQAAAD8NAAAAAAAAAAAAIEEAAAA/DgAAAAAAAAAAAGBAAAAAPw4AAAAAAAAAAACAQAAAAD8OAAAAAAAAAAAAkEAAAAA/DgAAAAAAAAAAAKBAAAAAPw4AAAAAAAAAAAAAQQAAAD8OAAAAAAAAAAAACEEAAAA/DgAAAAAAAAAAABBBAAAAPw4AAAAAAAAAAAAYQQAAAD8PAAAAAAAAAAAAgEAAAAA/DwAAAAAAAAAAAJBAAAAAPw8AAAAAAAAAAACgQAAAAD8PAAAAAAAAAAAAsEAAAAA/DwAAAAAAAAAAAPBAAAAAPw8AAAAAAAAAAAAAQQAAAD8PAAAAAAAAAAAACEEAAAA/DwAAAAAAAAAAABBBAAAAPxAAAAAAAAAAAACQQAAAAD8QAAAAAAAAAAAAoEAAAAA/EAAAAAAAAAAAALBAAAAAPxAAAAAAAAAAAADAQAAAAD8QAAAAAAAAAAAA0EAAAAA/EAAAAAAAAAAAAOBAAAAAPxAAAAAAAAAAAADwQAAAAD8QAAAAAAAAAAAAAEEAAAA/EAAAAAAAAAAAAAhBAAAAPxEAAAAAAAAAAACgQAAAAD8RAAAAAAAAAAAAsEAAAAA/EQAAAAAAAAAAAMBAAAAAPxEAAAAAAAAAAADQQAAAAD8RAAAAAAAAAAAA4EAAAAA/EQAAAAAAAAAAAPBAAAAAPxEAAAAAAAAAAAAAQQAAAD8RAAAAAAAAAAAAwEEAAAA/EQAAAAAAAAAAAMRBAAAAPxEAAAAAAAAAAADMQQAAAD8RAAAAAAAAAAAA0EEAAAA/EQAAAAAAAAAAANhBAAAAPxEAAAAAAAAAAADcQQAAAD8SAAAAAAAAAAAAsEAAAAA/EgAAAAAAAAAAAMBA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',
};

class DuoSynthControls extends React.Component {
  private synth;

  constructor(props) {
    super(props);
    this.synth = (window as any).SYNTH;
  }

  render() {
    return (
      <React.Fragment>
        <ControlPanel
          onChange={(key, val) => {
            switch (key) {
              case 'bitcrusher': {
                this.synth.disconnect();
                if (val) {
                  this.synth.connect(bitcrusher);
                } else {
                  this.synth.toMaster();
                }
                break;
              }
              case 'load saved composition': {
                (this.props as any).loadComp(val);
                break;
              }
              default: {
                const parsed = parseFloat(val);
                this.synth.voices.forEach(voice => voice.set(key, isNaN(parsed) ? val : parsed));
              }
            }
          }}
          width={400}
          position="top-right"
          draggable
          settings={[
            { type: 'select', label: 'load saved composition', options: comps },
            { type: 'range', label: 'volume', min: -20, max: 20, initial: 0, steps: 200 },
            {
              type: 'select',
              label: 'oscillator.type',
              options: ['sine', 'square', 'triangle', 'sawtooth'],
              initial: 'sine',
            },
            { type: 'range', label: 'envelope.attack', min: 0, max: 2, initial: 0.005, steps: 300 },
            { type: 'range', label: 'envelope.decay', min: 0, max: 2, initial: 0.1 },
            { type: 'range', label: 'envelope.sustain', min: 0, max: 2, initial: 0.3 },
            { type: 'range', label: 'envelope.release', min: 0, max: 2, initial: 1.0 },
            { type: 'checkbox', label: 'bitcrusher', initial: true },
          ]}
        />
      </React.Fragment>
    );
  }
}

export default DuoSynthControls;
