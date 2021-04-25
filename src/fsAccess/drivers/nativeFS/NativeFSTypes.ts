export interface FileSystemWriter {
  write: (position: number, data: unknown) => Promise<unknown>;
  truncate: (size: number) => Promise<unknown>;
  close: () => Promise<unknown>;
}

type WriteCommandType = 'write' | 'seek' | 'truncate';

interface WriteParams {
  type: WriteCommandType;
  size?: number;
  position?: number;
  data?: BufferSource | Blob | string;
}

export type FileSystemWriteChunkType = BufferSource | Blob | string | WriteParams;

export interface FileSystemWritableFileStream extends WritableStream {
  write: (data: FileSystemWriteChunkType) => Promise<undefined>;
  seek: (position: number) => Promise<undefined>;
  truncate: (size: number) => Promise<undefined>;
}

export interface FileSystemFileHandle {
  kind: 'file';
  name: string;
  createWritable: () => Promise<FileSystemWritableFileStream>;
  getFile: () => Promise<File>;
}

export interface FileSystemDirectoryHandle {
  kind: 'directory';
  name: string;
  entries: () => AsyncIterable<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<FileSystemFileHandle>;
  getDirectoryHandle: (
    name: string,
    options?: { create?: boolean }
  ) => Promise<FileSystemDirectoryHandle>;
  removeEntry: (name: string, options?: unknown) => Promise<void>;
}

export interface NativeFSShim {
  showDirectoryPicker(): Promise<FileSystemDirectoryHandle>;
}
