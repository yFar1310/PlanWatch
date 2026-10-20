<script setup lang="ts">
import {onMounted,onUnmounted,ref,useId} from 'vue';
import {X} from '@lucide/vue';
import {useDialogBackdrop} from './dialog-backdrop';
const emit=defineEmits<{close:[]}>();
const dialog=ref<HTMLDialogElement|null>(null),close=ref<HTMLButtonElement|null>(null),id=useId();
const previous=document.activeElement;
const {backdropStart,backdropClick}=useDialogBackdrop(dialog,()=>false,()=>emit('close'));
onMounted(()=>{if(typeof dialog.value?.showModal==='function')dialog.value.showModal();else dialog.value?.setAttribute('open','');close.value?.focus();});
onUnmounted(()=>{if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();});
</script>
<template>
  <dialog ref="dialog" class="task-dialog user-guide" :aria-labelledby="id" @cancel.prevent="emit('close')" @pointerdown="backdropStart" @click="backdropClick">
    <header><div><p class="eyebrow">UN PEU MOINS À RETENIR</p><h2 :id="id">Guide de PlanWatch</h2></div><button ref="close" class="icon-button" aria-label="Close user guide" title="Close user guide" @click="emit('close')"><X :size="20" /></button></header>
    <p>Une idée peut rester une idée. Choisissez quand la réaliser seulement lorsque vous êtes prêt.</p>
    <details open><summary>1. Enregistrer une idée</summary><p>Dans Today ou Ideas, écrivez un titre puis cliquez sur <strong>Save idea</strong>, ou appuyez sur Entrée. Le message « Idea saved » confirme l’enregistrement. Aucune date ni suggestion n’est obligatoire. Retrouvez-la dans <strong>Ideas</strong>.</p></details>
    <details><summary>2. Donner une date à une activité</summary><p>Dans Ideas, cliquez sur l’horloge « Plan… » ou sur <strong>Choose date &amp; time</strong> après l’enregistrement. Choisissez le jour, activez « Set a time » si nécessaire, puis enregistrez. Sans heure, l’activité apparaît dans la ligne « All day » du calendrier. Les horaires utilisent <strong>Europe/Paris</strong> ; une activité avec des heures doit commencer et finir le même jour.</p></details>
    <details><summary>3. Comprendre les créneaux proposés</summary><p><strong>Find available times</strong> est facultatif. Indiquez une période réellement libre, une durée et une marge. La recherche propose les premiers créneaux disponibles d’après vos activités enregistrées avec des heures. Elle ne connaît ni votre emploi du temps extérieur ni vos habitudes de sommeil. Ce n’est pas encore un conseil personnalisé par IA. Rien ne bouge avant « Confirm this time ».</p></details>
    <details><summary>4. Utiliser le calendrier</summary><p>Ouvrez <strong>Calendar</strong> et choisissez Day, Week ou Month. Cliquez dans une case vide ou sélectionnez une plage pour préparer une activité, puis confirmez sa création. Cliquez sur une activité pour la modifier. Glissez-la pour changer sa place ou tirez son bord pour ajuster sa durée. Sur téléphone, maintenez le doigt avant de déplacer. Un déplacement valide s’enregistre immédiatement ; en cas de conflit, le calendrier relit la version enregistrée.</p><p>En vue Mois ou Semaine, cliquez sur un numéro de jour pour ouvrir sa journée. Si « Load more scheduled tasks » apparaît, chargez les pages restantes pour voir toutes les activités. Les filtres peuvent masquer des tâches.</p></details>
    <details><summary>5. Terminer, supprimer et restaurer</summary><p>La coche demande confirmation avant de terminer une tâche. Retrouvez-la dans <strong>Tasks → Done</strong>, où vous pouvez la rouvrir ou la supprimer. Une dépendance signifie que la tâche préalable doit être terminée avant la suivante. La suppression envoie d’abord la tâche dans <strong>Trash</strong> : vous pouvez la restaurer, sélectionner plusieurs tâches ou vider la corbeille après confirmation. Une suppression définitive ne peut pas être annulée.</p></details>
    <details><summary>6. Brouillons, compte et téléphone</summary><p>Fermez une fenêtre avec sa croix, Échap ou un clic à l’extérieur. Vos brouillons restent sur cet appareil ; pendant un enregistrement, attendez sa fin. Hors connexion, vous pouvez écrire un brouillon mais devez vous reconnecter pour l’enregistrer.</p><p>L’installation sur téléphone est facultative : le site fonctionne dans le navigateur. Chaque invité dispose d’un espace privé. L’administrateur voit les statistiques d’usage annoncées à l’inscription. Le bouton de déconnexion demande toujours confirmation.</p></details>
    <details><summary>Un problème ?</summary><p>Essayez d’abord Refresh. Si le calendrier seul ne se charge pas, utilisez « Retry calendar » ou modifiez les dates depuis Tasks. Si une erreur remplace toute la page, relevez le domaine et le moment où elle apparaît, sans partager de jeton ni de mot de passe. Une connexion mobile permet de vérifier si le réseau Wi-Fi bloque le site.</p></details>
    <div class="confirmation-actions"><button class="primary" @click="emit('close')">J’ai compris</button></div>
  </dialog>
</template>
