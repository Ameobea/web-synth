import { FSAccessDriver } from 'src/fsAccess/driver';
import { FileSystemDirectoryHandle, NativeFSShim, FileSystemFileHandle } from './NativeFSTypes';
import { UnimplementedError } from 'ameo-utils';
import { renderModalWithControls } from 'src/controls/Modal';
import FSAccessDialog from 'src/fsAccess/drivers/nativeFS/FSAccessDialog';

const patchedWindow: Window & NativeFSShim = window as any;

export default class NativeFSDriver implements FSAccessDriver {
  private handle: FileSystemDirectoryHandle | undefined;

  constructor() {
    if (!patchedWindow.chooseFileSystemEntries) {
      alert('No native filesystem API support in current browser');
      throw new Error('No native filesystem API support in current browser');
    }
  }

  public async init(): Promise<void> {
    await renderModalWithControls(FSAccessDialog);

    const dataDirHandle = (await patchedWindow.chooseFileSystemEntries({
      type: 'openDirectory',
    })) as FileSystemDirectoryHandle;
    this.handle = dataDirHandle;
  }

  private getHandle(): FileSystemDirectoryHandle {
    if (!this.handle) {
      throw new Error('`NativeFSDriver` has not been initialized');
    }

    return this.handle;
  }

  public async createDirectory(dirName: string): Promise<void> {
    await this.getHandle().getDirectory(dirName, { create: true });
  }

  public async getDirectory(dirName: string): Promise<FileSystemDirectoryHandle> {
    return this.getHandle().getDirectory(dirName, { create: false });
  }

  public async createSubdirectory(
    dirName: string,
    subdirName: string
  ): Promise<FileSystemDirectoryHandle> {
    const dirHandle = await this.getHandle().getDirectory(dirName);
    return dirHandle.getDirectory(subdirName, { create: true });
  }

  public async getSubdirectory(
    dirName: string,
    subdirName: string
  ): Promise<FileSystemDirectoryHandle> {
    const dirHandle = await this.getHandle().getDirectory(dirName);
    return dirHandle.getDirectory(subdirName, { create: false });
  }

  public async deleteSubdirectory(dirName: string, subdirName: string): Promise<void> {
    throw new UnimplementedError();
  }

  public async getFile(dirName: string, fileName: string): Promise<File> {
    const dirHandle = await this.getHandle().getDirectory(dirName);
    const fileHandle = await dirHandle.getFile(fileName);
    return fileHandle.getFile();
  }

  public async createFile(dirName: string, fileName: string): Promise<FileSystemFileHandle> {
    const dirHandle = await this.getHandle().getDirectory(dirName);
    return dirHandle.getFile(fileName);
  }

  public async deleteFile(dirName: string, fileName: string): Promise<void> {
    throw new UnimplementedError();
  }
}
