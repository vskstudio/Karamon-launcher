import path from 'path';
import zlib from 'zlib';
import { DurableFile, type FileCodec } from '../../shared/DurableFile.ts';

const TAG_END = 0;
const TAG_BYTE = 1;
const TAG_STRING = 8;
const TAG_LIST = 9;
const TAG_COMPOUND = 10;
const FIXED_PAYLOAD_BYTES: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 4, 6: 8 };
const ARRAY_ELEMENT_BYTES: Record<number, number> = { 7: 1, 11: 4, 12: 8 };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const KARAMON_FORMER_HOST = 'karamon.fr';
const PLAYIT_TUNNEL_USED_BEFORE_OVH_SUFFIX = '.ply.gg';

interface ServerEntry {
  ip: string;
  name?: string;
  payload?: Buffer;
}

interface ServerList {
  servers: ServerEntry[];
  otherRootTags: Buffer[];
}

class NbtReader {
  private readonly buf: Buffer;
  private pos = 0;

  constructor(buf: Buffer) {
    this.buf = buf;
  }

  get offset(): number {
    return this.pos;
  }

  slice(from: number): Buffer {
    return this.buf.subarray(from, this.pos);
  }

  byte(): number {
    this.need(1);
    return this.buf[this.pos++];
  }

  u16(): number {
    this.need(2);
    const value = this.buf.readUInt16BE(this.pos);
    this.pos += 2;
    return value;
  }

  i32(): number {
    this.need(4);
    const value = this.buf.readInt32BE(this.pos);
    this.pos += 4;
    return value;
  }

  string(): string {
    const length = this.u16();
    this.need(length);
    const value = this.buf.toString('utf8', this.pos, this.pos + length);
    this.pos += length;
    return value;
  }

  skip(bytes: number): void {
    this.need(bytes);
    this.pos += bytes;
  }

  skipPayload(type: number): void {
    if (type in FIXED_PAYLOAD_BYTES) return this.skip(FIXED_PAYLOAD_BYTES[type]);
    if (type in ARRAY_ELEMENT_BYTES) return this.skip(this.count() * ARRAY_ELEMENT_BYTES[type]);
    if (type === TAG_STRING) return this.skip(this.u16());
    if (type === TAG_LIST) {
      const elementType = this.byte();
      const count = this.count();
      for (let i = 0; i < count; i++) this.skipPayload(elementType);
      return;
    }
    if (type === TAG_COMPOUND) {
      for (let t = this.byte(); t !== TAG_END; t = this.byte()) {
        this.skip(this.u16());
        this.skipPayload(t);
      }
      return;
    }
    throw new Error(`type NBT inconnu ${type}`);
  }

  count(): number {
    const value = this.i32();
    if (value < 0) throw new Error('longueur NBT négative');
    return value;
  }

  private need(bytes: number): void {
    if (this.pos + bytes > this.buf.length) throw new Error('fichier NBT tronqué');
  }
}

const NBT = {
  u16(n: number): Buffer {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(n);
    return b;
  },
  i32(n: number): Buffer {
    const b = Buffer.alloc(4);
    b.writeInt32BE(n);
    return b;
  },
  str(s: string): Buffer {
    const sb = Buffer.from(s, 'utf8');
    return Buffer.concat([NBT.u16(sb.length), sb]);
  },
  named(type: number, key: string, payload: Buffer): Buffer {
    return Buffer.concat([Buffer.from([type]), NBT.str(key), payload]);
  },
};

const serverListCodec: FileCodec<ServerList> = {
  decode(raw) {
    const reader = new NbtReader(raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw);
    if (reader.byte() !== TAG_COMPOUND) throw new Error('servers.dat ne commence pas par un compound NBT');
    reader.string();
    const list: ServerList = { servers: [], otherRootTags: [] };
    for (;;) {
      const start = reader.offset;
      const type = reader.byte();
      if (type === TAG_END) return list;
      const name = reader.string();
      if (type === TAG_LIST && name === 'servers') list.servers = readServers(reader);
      else {
        reader.skipPayload(type);
        list.otherRootTags.push(reader.slice(start));
      }
    }
  },
  encode({ servers, otherRootTags }) {
    const entries = servers.map((s) => s.payload ?? newEntryPayload(s));
    const listPayload = Buffer.concat([Buffer.from([TAG_COMPOUND]), NBT.i32(entries.length), ...entries]);
    return Buffer.concat([
      Buffer.from([TAG_COMPOUND, 0, 0]),
      ...otherRootTags,
      NBT.named(TAG_LIST, 'servers', listPayload),
      Buffer.from([TAG_END]),
    ]);
  },
};

function readServers(reader: NbtReader): ServerEntry[] {
  const elementType = reader.byte();
  const count = reader.count();
  if (count === 0) return [];
  if (elementType !== TAG_COMPOUND) throw new Error('liste de serveurs inattendue');
  const servers: ServerEntry[] = [];
  for (let i = 0; i < count; i++) {
    const start = reader.offset;
    const fields: Record<string, string> = {};
    for (let t = reader.byte(); t !== TAG_END; t = reader.byte()) {
      const key = reader.string();
      if (t === TAG_STRING) fields[key] = reader.string();
      else reader.skipPayload(t);
    }
    if (fields.ip) servers.push({ ip: fields.ip, name: fields.name, payload: reader.slice(start) });
  }
  return servers;
}

function newEntryPayload(server: ServerEntry): Buffer {
  return Buffer.concat([
    NBT.named(TAG_STRING, 'ip', NBT.str(server.ip)),
    NBT.named(TAG_STRING, 'name', NBT.str(server.name || server.ip)),
    NBT.named(TAG_BYTE, 'acceptTextures', Buffer.from([1])),
    Buffer.from([TAG_END]),
  ]);
}

function hostOf(ip: string): string {
  return ip.split(':')[0].toLowerCase();
}

export class ServersDat {
  private readonly file: DurableFile<ServerList>;

  constructor(mcDir: string) {
    this.file = new DurableFile(path.join(mcDir, 'servers.dat'), serverListCodec, 'refuse');
  }

  static devServerName(name: string): string {
    return `${name} (local)`;
  }

  ensureDevServer(name: string): void {
    this.ensureServer('localhost', ServersDat.devServerName(name), true);
  }

  ensureServer(ip: string, name: string, keepLocal = false): void {
    const existing = this.file.readForUpdate() ?? { servers: [], otherRootTags: [] };
    const targetHost = hostOf(ip);

    const cleaned = keepLocal
      ? existing.servers
      : existing.servers.filter((s) => hostOf(s.ip) === targetHost || !ServersDat.isKaramonLeftover(s, name));

    const alreadyPresent = cleaned.some((s) => hostOf(s.ip) === targetHost);
    if (alreadyPresent && cleaned.length === existing.servers.length) return;

    const servers = alreadyPresent ? cleaned : [{ ip, name }, ...cleaned];
    this.file.write({ servers, otherRootTags: existing.otherRootTags });
  }

  private static isKaramonLeftover(server: ServerEntry, name: string): boolean {
    const host = hostOf(server.ip);
    if (host === KARAMON_FORMER_HOST || host.endsWith(PLAYIT_TUNNEL_USED_BEFORE_OVH_SUFFIX)) return true;
    return LOCAL_HOSTS.has(host) && server.name === ServersDat.devServerName(name);
  }
}
