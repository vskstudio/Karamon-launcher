import { app } from 'electron/main';
import type { GpuDevice } from '../potato/PotatoSettings';

export async function gpuDevices(): Promise<GpuDevice[]> {
  try {
    const info = (await app.getGPUInfo('basic')) as { gpuDevice?: { vendorId?: unknown; deviceId?: unknown }[] };
    return (info.gpuDevice ?? [])
      .filter((gpu) => typeof gpu.vendorId === 'number')
      .map((gpu) => ({ vendorId: gpu.vendorId as number, deviceId: gpu.deviceId as number | undefined }));
  } catch {
    return [];
  }
}

export async function gpuLabel(): Promise<string | undefined> {
  const gpus = await gpuDevices();
  if (gpus.length === 0) return undefined;
  const hex = (n: number | undefined): string => (n ?? 0).toString(16).padStart(4, '0');
  return gpus.map((gpu) => `${hex(gpu.vendorId)}:${hex(gpu.deviceId)}`).join(', ');
}
