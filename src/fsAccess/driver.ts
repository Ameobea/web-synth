import type {
  FileSystemDirectoryHandle,
  FileSystemFileHandle,
} from 'src/fsAccess/drivers/nativeFS/NativeFSTypes';

/**
 * A file system driver used to access files stored somewhere.
 */
export interface FSAccessDriver {
  init: () => Promise<void>;

  createDirectory: (dirName: string) => Promise<void>;
  getDirectory: (dirName: string) => Promise<FileSystemDirectoryHandle>;

  createSubdirectory: (dirName: string, subdirName: string) => Promise<FileSystemDirectoryHandle>;
  getSubdirectory: (dirName: string, subdirName: string) => Promise<FileSystemDirectoryHandle>;
  deleteSubdirectory: (dirName: string, subdirName: string) => Promise<void>;

  createFile: (dirName: string, fileName: string) => Promise<FileSystemFileHandle>;
  getFile: (dirName: string, fileName: string) => Promise<File>;
  deleteFile: (dirName: string, fileName: string) => Promise<void>;
}
