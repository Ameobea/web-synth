import React from 'react';

import { ControlPanelCustomComponentProps } from '../types';

export interface Value<T = ArrayBuffer> {
  fileName: string;
  fileContent: T;
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

export const parseUploadedFileAsText = (
  evt: React.ChangeEvent<HTMLInputElement>
): Promise<Value<string>> =>
  new Promise((resolve, reject) => {
    const file = evt.target.files![0]!;

    const reader = new FileReader();

    reader.onload = function() {
      if (this.readyState !== FileReader.DONE) {
        reject(new Error('Error converting uploaded file to `ArrayBuffer`'));
        return;
      }

      const value: Value<string> = {
        fileName: file.name,
        fileContent: this.result as string,
      };

      resolve(value);
    };

    reader.readAsText(file);
  });

const FileUploader: React.FC<ControlPanelCustomComponentProps<Value>> = ({ onChange }) => (
  <div>
    Upload file
    <input type='file' onChange={evt => parseUploadedFile(evt).then(onChange)} />
  </div>
);

export default FileUploader;
