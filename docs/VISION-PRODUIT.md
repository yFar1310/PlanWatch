# PlanWatch — de l’idée à une action réalisable

Document de référence produit, 20 octobre 2026. Cette vision décrit la destination ; les lots ci-dessous distinguent les fonctions à construire de celles déjà disponibles.

## 1. La promesse

**« Une idée en tête ? Fais-lui une place dans ta journée. »**

PlanWatch aide à concrétiser les envies personnelles autour du travail, des études et des engagements existants : sport, proches, loisirs, démarches, apprentissage ou repos. La réussite se mesure à l’utilité du programme et aux intentions concrétisées, avec peu de manipulation.

L’hypothèse à tester : les utilisateurs ont besoin de capturer rapidement une envie, puis d’être aidés à choisir une action et un moment réalistes. Ajouter une couche d’IA ne suffit pas à démontrer cette utilité.

## 2. Les notions

| Notion | Sens | Exemple |
|---|---|---|
| Idée | Une envie conservée sans engagement de date | Appeler maman |
| Action | Une activité assez précise pour être réalisée | Appeler maman pendant 15 minutes |
| Plan | Un créneau choisi et confirmé | Demain, 20 h 45–21 h |
| Contrainte | Un engagement ou une limite à respecter | Travail jusqu’à 18 h, trajet, créneau protégé |
| Préférence | Un choix personnel qui guide les propositions | Garder des activités calmes après 22 h |
| Réalisation | Une action explicitement confirmée comme terminée | Appel effectué |

Une idée peut rester sans date. Une action peut être reportée, redimensionnée, abandonnée ou conservée pour plus tard. Le repos et les loisirs ont leur place ; une activité n’est pas jugée inutile sans référence aux choix de l’utilisateur.

## 3. Le parcours quotidien

### Capturer

La page d’accueil affiche une lampe, une invitation à écrire et un champ simple : « Qu’aimerais-tu faire ? ». La priorité, les dépendances et la date restent des détails accessibles au moment utile.

**Garder comme idée** sauvegarde l’envie sans lui attribuer aujourd’hui par défaut. L’enregistrement précède toute éventuelle analyse IA. Un échec de l’assistance ne doit pas empêcher la sauvegarde. Une sauvegarde réseau non confirmée reste signalée comme telle ; aucune réussite fictive ni duplication automatique.

### Clarifier

L’utilisateur peut transformer une envie en action et donner une durée. À terme, l’IA pourra décomposer une phrase contenant plusieurs envies et poser une question courte si une information manque. Toute décomposition devra être présentée avant création des actions supplémentaires.

### Trouver une place

L’utilisateur choisit une journée et indique une plage réellement disponible. Des créneaux sont proposés avec une explication et les limites connues. Il choisit une proposition ou ouvre l’éditeur pour planifier manuellement. Rien n’est déplacé ni supprimé sans validation.

Exemple illustratif, avec des horaires fournis par l’utilisateur : travail jusqu’à 18 h, trajet de 30 minutes, salle de 18 h 30 à 19 h 30, repas déjà prévu, puis appel de 15 minutes dans une plage libre. Les durées, disponibilités des proches et temps de trajet ne sont pas des faits que l’IA peut inventer.

### Agir et adapter

L’accueil met en avant la prochaine activité et le programme du jour. Le calendrier en vues Jour, Semaine et Mois reste disponible pour une vision plus détaillée. À terme, « Ma journée a changé » proposera un ajustement en cas de retard ou de changement d’énergie, avec aperçu et validation.

### Se rappeler

Les rappels seront configurables et pourront inclure une préparation ou un départ. Ils nécessitent une permission explicite et une implémentation mobile testée. L’installation de la PWA reste facultative pour utiliser l’application ; certaines capacités de notification peuvent dépendre de la plateforme. Une tâche ne devient jamais terminée parce qu’un rappel a été envoyé ou ouvert.

## 4. Les écrans

- **Accueil / Today** : lampe, capture rapide, dernière idée sauvegardée, prochaine activité et activités du jour.
- **Idées / Ideas** : activités ouvertes sans date, recherche, tri, édition, suppression et action « Trouver un créneau ».
- **Tâches / All tasks** : vue complète et contrôles avancés existants.
- **Calendar** : calendrier quotidien/hebdomadaire/mensuel et ajustement des horaires.
- **Corbeille** et **Administration** : fonctions existantes conservées.

L’interface conserve pour le premier lot les libellés anglais de l’application. Les formulations françaises de ce document expriment le produit ; une traduction complète fera l’objet d’un lot cohérent.

## 5. Les règles de confiance

- Les espaces privés et l’admission sur invitation restent appliqués côté API.
- Une proposition distingue ce qui est fourni, calculé ou estimé et explique ses limites.
- Les contraintes temporelles sont vérifiées par du code déterministe ; une réponse IA ne peut pas contourner ces validations.
- Une modification explicite du planning reste possible dans l’éditeur.
- Les confirmations de fin de tâche, versions optimistes, brouillons et clés d’idempotence sont conservés.
- Un programme ne remplit pas automatiquement chaque minute disponible. Les marges restent configurables.
- Les préférences de sommeil ou d’activité sont des choix renseignés ; l’application ne produit pas de prescriptions médicales.
- L’échec d’une suggestion laisse les idées et la planification manuelle utilisables.

## 6. Premier lot d’implémentation

Ce lot commence après la rédaction de cette documentation.

1. Une capture d’idée sur l’accueil avec une lampe et sans formulaire de priorité imposé.
2. Un espace Idées sauvegardé dans D1, retrouvé après connexion et sur un autre appareil.
3. Une proposition de créneau pour une activité à la fois : jour, plage disponible, durée et marge renseignés par l’utilisateur.
4. La vérification des activités déjà horaires, des prérequis, du passage de minuit et du temps déjà écoulé pour aujourd’hui.
5. Un aperçu sans écriture, puis une confirmation qui refuse un planning modifié entre-temps.
6. La conservation de la tâche, de son statut et de ses détails lors de sa planification.

**Choix de modèle pour ce lot :** une idée est une tâche ouverte dont `plannedDate` vaut `null`. Les tâches ouvertes déjà présentes sans date apparaîtront donc aussi dans Idées. Il n’y a pas de migration ni de duplication de contenu. Un état métier distinct pourra être ajouté si les tests d’usage en démontrent le besoin.

Les activités avec une date mais sans heure ne donnent pas une occupation précise : la proposition doit afficher leur présence et demander une vérification. Le premier moteur ne prétend pas connaître les horaires de travail, le trajet ou les événements d’un calendrier externe. L’utilisateur doit les exclure de sa plage disponible ou les représenter par des tâches horaires.

Le premier moteur produit des propositions fondées sur des règles, clairement identifiées. Il ne décompose pas une phrase, ne comprend pas encore « demain après le travail » et ne produit aucun conseil IA. Aucune nouvelle dépense IA n’est activée.

## 7. Lots suivants

| Lot | Résultat attendu | Condition de passage |
|---|---|---|
| Préférences et engagements | Horaires récurrents, temps protégés, marges et fuseau par utilisateur | Gestion des changements de date et d’heure testée |
| Capture assistée | Reconnaissance des dates, propositions d’actions et de durées | Aperçu modifiable, budget et comportement en cas d’échec définis |
| Rappels | Préparation, début d’activité, report et permissions | Tests réels sur les téléphones ciblés et déduplication |
| Adaptation | Replanification proposée et annulation possible | Contraintes et validations de concurrence conservées |
| Apprentissage utile | Ajustement à partir des durées et retours volontaires | Informations suffisantes ; incertitude affichée |
| Bilan hebdomadaire | Retour sur les objectifs, PDF privé et envoi choisi | Fonctionnement quotidien fiable, coûts et préférences d’envoi cadrés |

## 8. Architecture et validation

Le frontend Vue reste sur Cloudflare Pages, l’API Hono sur un Worker et les données privées dans D1. Le moteur de propositions est une fonction testable indépendante du modèle IA. Les suggestions n’écrivent rien. La confirmation utilise une version de tâche et une vérification atomique de fraîcheur du planning ; une suggestion devenue obsolète est recalculée sur demande.

Lors du futur ajout de l’IA, le serveur transmettra uniquement le contexte utile du membre connecté. Le fournisseur et le modèle, un plafond de dépenses propre à l’application, les limites par utilisateur et les règles de conservation devront être fixés avant activation. Aucun appel automatique illimité à chaque frappe.

Critères d’acceptation du premier lot : sauvegarder et retrouver une idée sans date, obtenir une proposition expliquée sans chevauchement horaire connu, accepter explicitement cette proposition, conserver les autres champs, refuser une proposition périmée et préserver les tâches en cas d’erreur. Les tests automatisés couvrent aussi l’isolation entre membres. Le rendu, les gestes et le parcours Google restent à vérifier sur appareil réel lorsque l’outil navigateur n’est pas disponible.

Le pilote se déroule sur une semaine avec quelques proches. Observer le nombre d’idées concrétisées, les propositions acceptées/modifiées, les reports et le ressenti de charge ; demander ce qui a aidé ou gêné. Ces résultats orienteront le lot suivant.

## 9. Premier lot livré — 21 octobre 2026

L’accueil avec sa lampe, la capture d’idées sans date, la page Ideas et les propositions de créneaux à confirmer sont implémentés. Les captures rapides ont des brouillons propres à chaque espace, séparés du formulaire avancé Tasks. La carte « Next on your schedule » lit la prochaine activité horaire du jour indépendamment de la pagination de la liste. Le bouton New task ouvre le formulaire avancé ; l’accueil conserve sa capture légère.

Le moteur propose jusqu’à trois alternatives à partir d’une grille de quinze minutes, d’une durée de 5 à 240 minutes et d’une marge de 0 à 60 minutes. Il ne propose rien avant l’heure actuelle pour aujourd’hui et ne traverse pas minuit. Les autres activités sans horaire donnent un avertissement ; les prérequis non terminés doivent avoir une fin antérieure connue. La confirmation n’altère que les dates, heures, durée estimée et version de l’activité choisie. La borne d’historique est vérifiée atomiquement ; même une autre modification de tâche dans le même espace invalide prudemment l’aperçu.

La déconnexion demande aussi confirmation. Annuler ou Échap conserve la session, la page et les brouillons ; confirmer lance la déconnexion Clerk et garde les brouillons sur cet appareil.

Validation : 162 tests automatisés passent, dont 83 dans le runtime Worker/D1, 58 composants Vue et 21 contrôles client/assets, avec typage strict et builds. Les tests couvrent notamment deux confirmations concurrentes du même créneau, le retour arrière après échec d’historique, l’isolation entre membres, les brouillons, les propositions périmées et l’annulation de déconnexion. L’outil navigateur reste indisponible (`Importing module "node:process" is not allowed in node_repl`) ; le rendu et les gestes sur appareil réel restent à vérifier.

Les préférences récurrentes, les événements de calendriers externes, l’interprétation en langage naturel, l’IA, les rappels et le bilan hebdomadaire restent les prochains lots. Aucune clé ni dépense IA n’a été activée.
