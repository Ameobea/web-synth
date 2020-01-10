import * as R from 'ramda';
import { UnimplementedError } from 'ameo-utils';

import { renderModalWithControls } from 'src/controls/Modal';
import { FSAccessDriver } from 'src/fsAccess/driver';
import FSAccessDialog from 'src/fsAccess/drivers/nativeFS/FSAccessDialog';
import { FileSystemDirectoryHandle, NativeFSShim, FileSystemFileHandle } from './NativeFSTypes';

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

  private async traverse(
    dirHandle: FileSystemDirectoryHandle | Promise<FileSystemDirectoryHandle>,
    filePath: string
  ): Promise<{ targetName: string; finalDir: FileSystemDirectoryHandle }> {
    const path = filePath.split('/');
    const subdirNames = R.init(path);
    const targetName = R.last(path)!;

    const finalDir = await subdirNames.reduce(
      (dirHandle, dirName) => dirHandle.then(dirHandle => dirHandle.getDirectory(dirName)),
      Promise.resolve(dirHandle)
    );

    return { targetName, finalDir };
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
    return this.deleteFile(dirName, subdirName);
  }

  public async getFile(dirName: string, filePath: string): Promise<File> {
    const rootDirHandle = this.getHandle().getDirectory(dirName);
    const { targetName, finalDir } = await this.traverse(rootDirHandle, filePath);

    const fileHandle = await finalDir.getFile(targetName);
    return fileHandle.getFile();
  }

  public async createFile(dirName: string, filePath: string): Promise<FileSystemFileHandle> {
    const rootDirHandle = await this.getHandle().getDirectory(dirName);
    const { targetName, finalDir } = await this.traverse(rootDirHandle, filePath);
    return finalDir.getFile(targetName);
  }

  public async deleteFile(dirName: string, filePath: string): Promise<void> {
    const rootDirHandle = await this.getHandle().getDirectory(dirName);
    const { targetName, finalDir } = await this.traverse(rootDirHandle, filePath);
    finalDir.removeEntry(targetName);
  }
}
