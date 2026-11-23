import { api } from '../state/api';
import {
  answerPotatoSuggestion,
  dismissRepairOffer,
  dismissUpdate,
  pendingUpdate,
  potatoSuggestion,
  repairOffer,
} from '../state/notices';
import { play } from '../state/tasks';
import { Banner, Button } from '../ui';

export function NoticeStack() {
  const update = pendingUpdate.value;
  const repair = repairOffer.value;
  const potato = potatoSuggestion.value;
  if (!update && !repair && !potato) return null;

  return (
    <div class="notices">
      {update ? (
        <Banner
          pixel="gift"
          tone="lumis"
          actions={
            <>
              <Button size="sm" variant="lumis" onClick={() => api.installUpdate()}>
                {update.install === 'download' ? 'Télécharger' : 'Redémarrer'}
              </Button>
              <Button size="sm" onClick={dismissUpdate}>
                Plus tard
              </Button>
            </>
          }
        >
          {update.install === 'download'
            ? `La version ${update.version} du launcher est disponible.`
            : `La mise à jour ${update.version} est prête, elle s’installe au redémarrage.`}
        </Banner>
      ) : null}
      {repair ? (
        <Banner
          pixel="key"
          tone="warning"
          actions={
            <>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  dismissRepairOffer();
                  void play();
                }}
              >
                Relancer
              </Button>
              <Button size="sm" onClick={dismissRepairOffer}>
                Plus tard
              </Button>
            </>
          }
        >
          {repair.result.ok
            ? `Le jeu a planté sur des fichiers abîmés. ${repair.result.summary}`
            : 'Le jeu a planté sur des fichiers abîmés et la réparation a échoué.'}
        </Banner>
      ) : null}
      {potato ? (
        <Banner
          pixel="lightning"
          actions={
            <>
              <Button size="sm" variant="primary" onClick={() => void answerPotatoSuggestion(true)}>
                Activer
              </Button>
              <Button size="sm" onClick={() => void answerPotatoSuggestion(false)}>
                Non merci
              </Button>
            </>
          }
        >
          Ton PC semble modeste ({potato.reasons.join(', ')}). Le mode PC modeste coupe les shaders et allège le jeu.
        </Banner>
      ) : null}
    </div>
  );
}
