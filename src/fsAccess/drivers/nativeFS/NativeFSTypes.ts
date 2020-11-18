export interface FileSystemWriter {
  write: (position: number, data: unknown) => Promise<unknown>;
  truncate: (size: number) => Promise<unknown>;
  close: () => Promise<unknown>;
}

export interface FileSystemFileHandle {
  kind: 'file';
  name: string;
  createWriter: () => Promise<FileSystemWriter>;
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
