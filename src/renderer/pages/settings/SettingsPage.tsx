import { useEffect, useState } from 'preact/hooks';
import { system } from '../../state/config';
import { log } from '../../state/console';
import { discardSettings, dirtySettingKeys, draftSettings, editSetting, saveSettings } from '../../state/settings';
import { Button, Page, PageHeader, Panel, Spinner, StatusDot, toast } from '../../ui';
import { formatNumber } from '../../util/format';
import { settingSections, SettingFieldView, type FieldContext, type SettingSection } from './fields';
import { ActivityPanel, MaintenancePanel, SystemPanel, VersionPanel } from './panels';
import './settings.css';

function sectionAnchor(id: string): string {
  return `settings-${id}`;
}

function SectionPanel({ section, context }: { section: SettingSection; context: FieldContext }) {
  return (
    <div id={sectionAnchor(section.id)} class="settings__anchor">
      <Panel padding="lg" title={section.title} actions={section.aside ? section.aside(context) : null}>
        <div class="settings__fields">
          {section.fields.map((field) => (
            <SettingFieldView key={field.key} field={field} context={context} />
          ))}
        </div>
      </Panel>
    </div>
  );
}

function SaveBar() {
  const [saving, setSaving] = useState(false);
  const count = dirtySettingKeys.value.length;
  if (count === 0) return null;

  const save = async () => {
    setSaving(true);
    try {
      await saveSettings();
      toast('Réglages enregistrés.');
      log('Réglages enregistrés.', 'success');
    } catch (error) {
      toast(`Enregistrement impossible : ${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="settings__savebar surface surface--accent" role="region" aria-label="Modifications non enregistrées">
      <StatusDot tone="warning" />
      <span class="settings__savebar-text" role="status">
        {count === 1 ? '1 modification non enregistrée' : `${formatNumber(count)} modifications non enregistrées`}
      </span>
      <Button variant="ghost" disabled={saving} onClick={discardSettings}>
        Annuler
      </Button>
      <Button variant="primary" loading={saving} onClick={() => void save()}>
        Enregistrer
      </Button>
    </div>
  );
}

export function SettingsPage({ param }: { param: string | null }) {
  const draft = draftSettings.value;

  useEffect(() => {
    if (!param || !draft) return;
    document.getElementById(sectionAnchor(param))?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [param, draft === null]);

  if (!draft) {
    return (
      <Page label="Réglages" class="settings">
        <PageHeader eyebrow="Préférences" title="Réglages" />
        <div class="settings__loading">
          <Spinner label="Chargement des réglages" />
        </div>
      </Page>
    );
  }

  const context: FieldContext = { draft, system: system.value, edit: editSetting };
  const left = settingSections.filter((section) => section.column === 'main');
  const right = settingSections.filter((section) => section.column === 'side');

  return (
    <Page label="Réglages" class="settings">
      <PageHeader eyebrow="Préférences" title="Réglages" description="Mémoire, Java, dossiers du jeu et comportement du launcher." />
      <div class="settings__columns">
        <div class="settings__column">
          {left.map((section) => (
            <SectionPanel key={section.id} section={section} context={context} />
          ))}
        </div>
        <div class="settings__column">
          {right.map((section) => (
            <SectionPanel key={section.id} section={section} context={context} />
          ))}
          <VersionPanel />
          <SystemPanel />
          <ActivityPanel />
          <MaintenancePanel />
        </div>
      </div>
      <SaveBar />
    </Page>
  );
}
