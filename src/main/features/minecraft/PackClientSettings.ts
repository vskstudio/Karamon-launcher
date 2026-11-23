import type { ClientOptions } from '../../shared/ClientOptions.ts';
import type { GameInstance } from '../../shared/GameInstance.ts';
import { applyKaramonBranding } from './BrandingWriter.ts';
import { OptionsWriter } from './OptionsWriter.ts';
import type { ShaderPolicy } from './ShaderChoice.ts';

export function applyPackClientSettings(
  instance: GameInstance,
  options: ClientOptions | null,
  shaders: ShaderPolicy,
  onStatus: (message: string) => void,
): void {
  try {
    if (options) {
      const writer = new OptionsWriter(instance.dir);
      writer.forceResourcePacks(options.resourcePacks);
      const applied = shaders.applyChoice(writer, options.shaderPack, options.enableShaders, options.shaderRevision);
      if (applied && shaders.bumped) onStatus(`Shader du pack appliqué : ${options.shaderPack}.`);
    }
    applyKaramonBranding(instance, options?.resourcePacks);
  } catch (e) {
    onStatus(`Réglages du pack non appliqués : ${(e as Error).message}`);
  }
}
