export interface FileSystemWriter {
  write: (position: number, data: unknown) => Promise<unknown>;
  truncate: (size: number) => Promise<unknown>;
  close: () => Promise<unknown>;
}

export interface FileSystemFileHandle {
  isDirectory: false;
  isFile: true;
  name: string;
  createWriter: () => Promise<FileSystemWriter>;
  getFile: () => Promise<File>;
}

export interface FileSystemDirectoryHandle {
  isDirectory: true;
  isFile: false;
  name: string;
  getEntries: () => AsyncIterable<FileSystemFileHandle | FileSystemDirectoryHandle>;
  getFile: (name: string, options?: { create?: boolean }) => Promise<FileSystemFileHandle>;
  getDirectory: (
    name: string,
    options?: { create?: boolean }
  ) => Promise<FileSystemDirectoryHandle>;
}

export interface ChooseFileSystemEntriesArgs {
  type?: 'openDirectory';
}

export interface NativeFSShim {
  chooseFileSystemEntries(
    args?: ChooseFileSystemEntriesArgs
  ): Promise<FileSystemFileHandle | FileSystemDirectoryHandle>;
}
