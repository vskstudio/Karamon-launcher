import { useEffect, useRef } from 'preact/hooks';
import { api } from '../state/api';
import { clearLog, consoleOpen, logLines, logText } from '../state/console';
import { Button, cx, IconButton, Tag, toast } from '../ui';

export function ConsoleDrawer() {
  const listRef = useRef<HTMLDivElement>(null);
  const lines = logLines.value;

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [lines.length, consoleOpen.value]);

  if (!consoleOpen.value) return null;

  const exportLogs = async () => {
    try {
      if (await api.exportLogs(logText())) toast('Journaux exportés.');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error');
    }
  };

  const copyLogs = async () => {
    await navigator.clipboard.writeText(logText());
    toast('Journaux copiés.');
  };

  return (
    <section class="console" aria-label="Console">
      <header class="console__head">
        <span class="console__title">Console</span>
        <Tag>launcher et jeu</Tag>
        <span class="console__spacer" />
        <Button size="sm" glyph="copy" onClick={() => void copyLogs()}>
          Copier
        </Button>
        <Button size="sm" glyph="download" onClick={() => void exportLogs()}>
          Exporter
        </Button>
        <Button size="sm" glyph="trash" onClick={clearLog}>
          Effacer
        </Button>
        <IconButton glyph="close" label="Fermer la console" size="sm" onClick={() => (consoleOpen.value = false)} />
      </header>
      <div ref={listRef} class="console__lines selectable" role="log" aria-live="off">
        {lines.map((line) => (
          <div key={line.id} class={cx('console__line', `console__line--${line.tone}`)}>
            <span class="console__time">{line.time}</span>
            {line.text}
          </div>
        ))}
      </div>
    </section>
  );
}
