import React from 'react';

import './FileUploader.css';

interface ControlPanelCustomComponentProps<T> {
  value: T;
  onChange: (newVal: T) => void;
  theme: { [key: string]: React.CSSProperties };
}

export interface FileUploaderValue<T = ArrayBuffer> {
  fileName: string;
  fileContent: T;
}

const parseUploadedFile = (evt: React.ChangeEvent<HTMLInputElement>): Promise<FileUploaderValue> =>
  new Promise((resolve, reject) => {
    const file = evt.target.files![0]!;

    const reader = new FileReader();

    reader.onload = function () {
      if (this.readyState !== FileReader.DONE) {
        reject(new Error('Error converting uploaded file to `ArrayBuffer`'));
        return;
      }

      const value: FileUploaderValue = {
        fileName: file.name,
        fileContent: this.result as ArrayBuffer,
      };

      resolve(value);
    };

    reader.readAsArrayBuffer(file);
  });

export const parseUploadedFileAsText = (
  evt: React.ChangeEvent<HTMLInputElement>
): Promise<FileUploaderValue<string>> =>
  new Promise((resolve, reject) => {
    const file = evt.target.files![0]!;

    const reader = new FileReader();

    reader.onload = function () {
      if (this.readyState !== FileReader.DONE) {
        reject(new Error('Error converting uploaded file to `ArrayBuffer`'));
        return;
      }

      const value: FileUploaderValue<string> = {
        fileName: file.name,
        fileContent: this.result as string,
      };

      resolve(value);
    };

    reader.readAsText(file);
  });

const FileUploader: React.FC<ControlPanelCustomComponentProps<FileUploaderValue>> = ({
  onChange,
  value,
}) => (
  <div className='file-uploader'>
    <div>Upload file</div>
    <div>
      <div>{value ? value.fileName : null}</div>
      <input type='file' onChange={evt => parseUploadedFile(evt).then(onChange)} />
    </div>
  </div>
);

export default FileUploader;
