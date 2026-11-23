import fs from 'fs';
import path from 'path';
import type { GameInstance } from '../../shared/GameInstance.ts';

export class OptionsWriter {
  private readonly instance: GameInstance;

  constructor(instance: GameInstance) {
    this.instance = instance;
  }

  forceResourcePacks(packs: string[]): void {
    this.writeResourcePacks(this.instance.optionsFile, packs, true);
    const defaults = path.join(this.instance.configDir, 'defaultoptions', 'options.txt');
    if (fs.existsSync(defaults)) this.writeResourcePacks(defaults, packs, false);
  }

  private writeResourcePacks(file: string, packs: string[], createIfMissing: boolean): void {
    const key = 'resourcePacks:';
    const line = key + JSON.stringify(packs);

    if (!fs.existsSync(file)) {
      if (!createIfMissing) return;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${line}\nincompatibleResourcePacks:[]\n`, 'utf8');
      return;
    }

    const raw = fs.readFileSync(file, 'utf8');
    const nl = raw.includes('\r\n') ? '\r\n' : '\n';
    const lines = raw.split(/\r?\n/);
    const idx = lines.findIndex((l) => l.startsWith(key));
    if (idx === -1) lines.push(line);
    else lines[idx] = line;

    const incompat = lines.findIndex((l) => l.startsWith('incompatibleResourcePacks:'));
    if (incompat === -1) lines.push('incompatibleResourcePacks:[]');
    else lines[incompat] = 'incompatibleResourcePacks:[]';

    const ended = raw.endsWith('\n') || raw.endsWith('\r\n');
    let text = lines.join(nl);
    if (ended && !text.endsWith('\n')) text += nl;
    fs.writeFileSync(file, text, 'utf8');
  }

  ensureShader(shaderFileName: string, enableShaders = true): void {
    const iris = this.instance.irisProperties;
    this.upsertLine(iris, `shaderPack=${shaderFileName}`, /^shaderPack=.*$/m, {
      createIfMissing: true,
    });
    this.upsertLine(iris, `enableShaders=${enableShaders ? 'true' : 'false'}`, /^enableShaders=.*$/m, {
      createIfMissing: true,
    });

    const optifineFile = path.join(this.instance.dir, 'optionsshaders.txt');
    if (fs.existsSync(optifineFile)) {
      this.upsertLine(optifineFile, `shaderPack=${shaderFileName}`, /^shaderPack=.*$/m, {
        createIfMissing: false,
      });
    }
  }

  private upsertLine(
    filePath: string,
    line: string,
    regex: RegExp,
    { createIfMissing }: { createIfMissing: boolean },
  ): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    if (!fs.existsSync(filePath)) {
      if (createIfMissing) fs.writeFileSync(filePath, line + '\n', 'utf8');
      return;
    }

    let content = fs.readFileSync(filePath, 'utf8');
    if (regex.test(content)) {
      content = content.replace(regex, line);
    } else {
      content += (content.endsWith('\n') ? '' : '\n') + line;
    }
    fs.writeFileSync(filePath, content, 'utf8');
  }
}
