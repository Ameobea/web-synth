import type { FSAccessDriver } from 'src/fsAccess/driver';
import NativeFSDriver from 'src/fsAccess/drivers/nativeFS/nativeFS';

const fsDriversByName: { [driverName: string]: new () => FSAccessDriver } = {
  nativeFS: NativeFSDriver,
};

const DRIVER_NAME = 'nativeFS';
let globalFSDriver: FSAccessDriver | undefined;

/**
 * Creates all necessary subdirectories and other structure for the
 */
const initDataDir = async (fsHandle: FSAccessDriver) => {
  return Promise.all([fsHandle.createDirectory('samples')]);
};

export const initFSDriver = async (driverName: string): Promise<FSAccessDriver> => {
  const DriverClass = fsDriversByName[driverName];
  if (!DriverClass) {
    throw new Error(`No FS driver with name "${driverName}" found.`);
  }

  const driver = new DriverClass();
  await driver.init();
  await initDataDir(driver);

  return driver;
};

export const getFSAccess = async (): Promise<FSAccessDriver> => {
  if (!globalFSDriver) {
    globalFSDriver = await initFSDriver(DRIVER_NAME);
  }

  return globalFSDriver;
};
