/** One line for the player after « Réparer l'installation » or an automatic repair. */
export function repairSummary(damagedPackFiles: number, repairedConfigs: number): string {
  if (damagedPackFiles === 0 && repairedConfigs === 0) {
    return "Aucun fichier abîmé trouvé : l'installation est saine.";
  }
  const parts: string[] = [];
  if (damagedPackFiles > 0) {
    parts.push(
      damagedPackFiles === 1
        ? '1 fichier du pack abîmé a été réinstallé'
        : `${damagedPackFiles} fichiers du pack abîmés ont été réinstallés`,
    );
  }
  if (repairedConfigs > 0) {
    parts.push(
      repairedConfigs === 1
        ? '1 fichier de configuration abîmé a été réparé'
        : `${repairedConfigs} fichiers de configuration abîmés ont été réparés`,
    );
  }
  return parts.join(', ') + '.';
}
