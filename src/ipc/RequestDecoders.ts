import { WIKI_SLUG } from '../shared/WikiSlug.ts';

export type Decoder<T> = (input: unknown) => T;

export class InvalidRequest extends Error {
  constructor(expected: string) {
    super(`Demande invalide reçue par le launcher : ${expected} attendu.`);
    this.name = 'InvalidRequest';
  }
}

export const nothing: Decoder<void> = () => undefined;

export function text(expected: string, maxLength: number): Decoder<string> {
  return (input) => {
    if (typeof input !== 'string' || input.length > maxLength) throw new InvalidRequest(expected);
    return input;
  };
}

export function nonEmptyText(expected: string, maxLength: number): Decoder<string> {
  const decodeText = text(expected, maxLength);
  return (input) => {
    const value = decodeText(input);
    if (value.trim() === '') throw new InvalidRequest(expected);
    return value;
  };
}

export function matching(expected: string, pattern: RegExp): Decoder<string> {
  return (input) => {
    if (typeof input !== 'string' || !pattern.test(input)) throw new InvalidRequest(expected);
    return input;
  };
}

export function oneOf<const Values extends readonly string[]>(expected: string, values: Values): Decoder<Values[number]> {
  return (input) => {
    if (typeof input !== 'string' || !values.includes(input)) throw new InvalidRequest(expected);
    return input as Values[number];
  };
}

export const flag: Decoder<boolean> = (input) => input === true;

export function object<Shape extends object>(
  expected: string,
  fields: { [Key in keyof Shape]: Decoder<Shape[Key]> },
): Decoder<Shape> {
  return (input) => {
    if (!isRecord(input)) throw new InvalidRequest(expected);
    const decoded: Partial<Shape> = {};
    for (const key of Object.keys(fields) as (keyof Shape)[]) {
      decoded[key] = fields[key](input[key as string]);
    }
    return decoded as Shape;
  };
}

export function record<Shape extends object>(expected: string): Decoder<Partial<Shape>> {
  return (input) => {
    if (!isRecord(input)) throw new InvalidRequest(expected);
    return input as Partial<Shape>;
  };
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

const FILE_NAME_MAX = 255;
const ID_MAX = 128;
const URL_MAX = 2048;
const PLAYER_NAME_MAX = 64;
const LOG_EXPORT_MAX = 16 * 1024 * 1024;
const SKIN_BASE64_MAX = 64 * 1024;
const HTTP_URL = /^https?:\/\/\S+$/i;

export const fileName = nonEmptyText('un nom de fichier', FILE_NAME_MAX);
export const identifier = nonEmptyText('un identifiant', ID_MAX);
export const playerName = nonEmptyText('un pseudo', PLAYER_NAME_MAX);
export const wikiSlug = matching('une page du wiki', WIKI_SLUG);
export const logText = text('le texte du journal', LOG_EXPORT_MAX);
export const skinPng = nonEmptyText('une image de skin', SKIN_BASE64_MAX);
export const httpUrl: Decoder<string> = (input) => {
  if (typeof input !== 'string' || input.length > URL_MAX || !HTTP_URL.test(input)) throw new InvalidRequest('une adresse web');
  return input;
};
