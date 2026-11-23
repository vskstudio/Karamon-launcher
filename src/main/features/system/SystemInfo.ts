import os from 'os';
import { lowEndReasons, potatoMemoryCapMb } from '../potato/PotatoSettings.ts';
import { gpuDevices } from './Gpu.ts';

export interface SystemInfo {
  totalMemMb: number;
  freeMemMb: number;
  cpuCount: number;
  platform: string;
  arch: string;
  appVersion: string;
  lowEndReasons: string[];
  potatoMemoryCapMb: number | null;
}

export async function readSystemInfo(appVersion: string): Promise<SystemInfo> {
  const totalMemMb = Math.round(os.totalmem() / 1024 / 1024);
  const cpuCount = os.cpus().length;
  return {
    totalMemMb,
    freeMemMb: Math.round(os.freemem() / 1024 / 1024),
    cpuCount,
    platform: process.platform,
    arch: process.arch,
    appVersion,
    lowEndReasons: lowEndReasons({ totalMemMb, cpuCount, gpus: await gpuDevices() }),
    potatoMemoryCapMb: potatoMemoryCapMb(totalMemMb),
  };
}
