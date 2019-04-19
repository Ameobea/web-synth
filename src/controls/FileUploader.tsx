import React from 'react';
import { Label } from 'react-control-panel';

import { ControlPanelCustomComponentProps } from '../types';

export interface Value {
  fileName: string;
  fileContent: ArrayBuffer;
}

const parseUploadedFile = (evt: React.ChangeEvent<HTMLInputElement>): Promise<Value> =>
  new Promise((resolve, reject) => {
    const file = evt.target.files![0]!;

    const reader = new FileReader();

    reader.onload = function() {
      if (this.readyState !== FileReader.DONE) {
        reject(new Error('Error converting uploaded file to `ArrayBuffer`'));
        return;
      }

      const value: Value = {
        fileName: file.name,
        fileContent: this.result as ArrayBuffer,
      };

      resolve(value);
    };

    reader.readAsArrayBuffer(file);
  });

const FileUploader: React.FunctionComponent<ControlPanelCustomComponentProps<Value>> = ({
  value,
  onChange,
}) => (
  <div>
    Upload file
    <input type='file' onChange={evt => parseUploadedFile(evt).then(onChange)} />
  </div>
);

export default FileUploader;
