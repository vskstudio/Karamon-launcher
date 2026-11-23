import { app, dialog, type BrowserWindow } from 'electron/main';
import { shell } from 'electron/common';
import fs from 'fs';
import path from 'path';

export function openFolder(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  void shell.openPath(dir);
}

export async function exportLogs(text: string, window: BrowserWindow | null): Promise<boolean> {
  const options = {
    title: 'Exporter les logs',
    defaultPath: path.join(app.getPath('desktop'), `karamon-logs-${Date.now()}.txt`),
    filters: [{ name: 'Fichiers texte', extensions: ['txt'] }],
  };
  const choice = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
  if (choice.canceled || !choice.filePath) return false;
  fs.writeFileSync(choice.filePath, text, 'utf8');
  return true;
}
