---
title: "Automatisations"
description: "Créer et gérer les automatismes et workflows de LorIAx : workflow autonome ou automatisation de base, déclencheurs (ligne créée, planifié cron, date atteinte, webhook entrant, bouton), actions (e-mail, IA, document, tâche, design, ligne), conditions, test simulé ou réel, historique des exécutions, trace, rejeu, activation, import Tally, limites de fréquence et droits."
---

## Ouvrir les automatisations

La page **Automatisations** est dans la barre latérale (`/automations`). L'Espace Bases y mène aussi par le lien **Automatisations** en bas de sa barre latérale.

La page affiche les automatismes de l'espace courant :

- les **workflows autonomes**, déclenchés par un bouton dans un document ou par un webhook, sans base ;
- les **automatisations de base**, liées à une base de l'espace.

À gauche, la liste est groupée par déclencheur, avec le champ **Filtrer par nom ou par base…**. Chaque élément affiche **Active** ou **Inactive** et l'état de sa dernière exécution. À droite, le canevas de l'automatisme sélectionné : **Déclencheur** en haut, **Actions** en dessous.

## Créer un automatisme

1. Cliquez sur **Nouvelle**, puis **Workflow autonome** ou **Automatisation de base**. Ce second choix est grisé si l'espace n'a aucune base.
2. Saisissez le **Nom**. Pour une automatisation de base, choisissez la **Base**.
3. Choisissez le **Déclencheur initial**, puis cliquez sur **Créer**.
4. Le canevas s'ouvre. L'automatisme est créé désactivé : configurez-le avant de l'activer.
5. Cliquez sur la carte du déclencheur pour le régler. Le menu **Type de déclencheur** permet d'en changer.
6. Cliquez sur **+** (**Ajouter une étape**), puis **Ajouter une action**. Choisissez son **Type** et remplissez ses champs.
7. Cliquez sur **Enregistrer le flux**.

## Déclencheurs disponibles

Automatisation de base :

- **Ligne créée**, **Ligne modifiée**, **Ligne supprimée** : sans réglage.
- **Planifié (cron)** : une expression cron, en heure UTC. La prochaine exécution s'affiche sous le champ. Exemple : « 0 9 * * * » = tous les jours à 09:00.
- **Date atteinte** : **Colonne date**, **Décalage (jours, +/−)** et **Heure (0 à 23)**.
- **Changement de valeur** : **Colonne surveillée**. Le workflow se déclenche quand la valeur de cette colonne change.
- **Webhook entrant** : voir plus bas.

Workflow autonome :

- **Manuel (bouton)** : se lance au clic sur un bouton dans un document. Insérez le bloc avec la commande `/Bouton`, puis choisissez **Workflow autonome** dans sa configuration.
- **Webhook entrant**.

## Actions disponibles

- **Créer un document**, **Générer un design**, **Créer une tâche**.
- **Envoyer un e-mail**, **Notifier un utilisateur**.
- **Générer avec l'IA** : prompt, avec génération de document en option (PDF ou Word).
- **Webhook** : appel d'une URL externe.
- Automatisations de base seulement : **Créer une ligne**, **Modifier une ligne**, **Chercher une ligne**.

Les jetons de date, la base cible et la correspondance de ces actions sont décrits dans la fiche Bases de données.

Réglages communs à chaque action :

- **Stocker le résultat (variable)** : rend la sortie disponible aux étapes suivantes.
- **Continuer si cette étape échoue** : l'erreur est tracée, le scénario continue et l'exécution est marquée « partiel ».

Les étapes se réordonnent par glisser-déposer ou avec **Monter l'étape** et **Descendre l'étape**. **Supprimer l'étape** les retire.

## Conditions

Dans une automatisation de base, **+** propose aussi **Ajouter une condition**. Réglez la **Source** (**Cellule de la ligne** ou **Variable**), la **Colonne**, l'**Opérateur** (est, n'est pas, contient, est vide, n'est pas vide, >, <) et la **Valeur**. Les étapes se placent sous **Si vrai** ou **Si faux**. Videz les deux branches avant de supprimer une condition.

## Webhook entrant

Au réglage du déclencheur, choisissez **Webhook générique** ou **Tally**. **Changer de mode** revient à ce choix.

- **Webhook générique** : copiez l'URL et le secret dans le service émetteur. Le secret est envoyé dans l'en-tête `X-Webhook-Secret`.
- **Dernier corps reçu** : affiche le dernier corps reçu. Un clic sur un champ l'insère dans le champ actif d'une action, ou copie sa variable.
- **Régénérer l'URL et le secret** : les anciens cessent de fonctionner immédiatement.

Un automatisme désactivé enregistre le corps reçu sans rien exécuter.

## Tester un scénario

Le test exécute la version enregistrée : cliquez d'abord sur **Enregistrer le flux**.

1. Choisissez l'échantillon : **Dernier corps reçu**, **Une ligne de la base** ou **Saisir des valeurs** (JSON).
2. Cliquez sur **Tester le scénario**, ou sur **Tester jusqu'ici** sur une étape.
3. Chaque carte affiche son statut : Succès, Erreur, Ignoré, Simulé ou Partiel. L'onglet **Résultat** du panneau montre les **Entrées résolues** et la **Sortie**.

Par défaut, le test est simulé : rien n'est écrit ni envoyé, et rien n'apparaît dans l'historique. Pour un test réel, activez **Exécuter réellement**, puis confirmez avec **Activer le mode réel**. Un bandeau rouge reste affiché ; **Repasser en simulé** l'arrête. Un test réel écrit vraiment, n'est pas annulé, et figure dans l'historique comme « Test réel ».

## Historique et trace

1. Sélectionnez l'automatisme, puis l'onglet **Historique** (l'onglet **Éditeur** ramène au canevas).
2. La liste **Exécutions** montre les 100 dernières : date, source (Déclenchement, Test réel, Rejeu), statut et durée. **Actualiser** recharge la liste.
3. Cliquez sur une exécution pour voir ses étapes, puis sur une étape pour voir ses entrées et sa sortie.

Une trace trop volumineuse est tronquée : certaines étapes n'ont plus leurs entrées et sorties.

## Rejouer une exécution

Dans l'historique, **Rejouer** relance réellement l'exécution avec ses données d'origine. La nouvelle exécution remplace l'ancienne entrée. Les rejeux sont limités : 6 par minute pour une personne et un automatisme, 30 par heure par automatisme, 100 par heure par organisation.

## Activer, modifier, supprimer

- **Activer ou désactiver** : l'interrupteur en haut du canevas, ou le menu **…** de la liste (**Activer** / **Désactiver**).
- **Réglages…** : ouvre **Modifier l'automatisation** (nom, état, case **Activer immédiatement**). Validez avec **Mettre à jour**. La base et le type d'action ne se changent pas : recréez l'automatisme.
- **Supprimer…** (menu **…**) : après confirmation, l'automatisme et son historique sont supprimés définitivement.

## Importer les réponses Tally

Le mode **Tally** du webhook entrant ouvre la section **Réponses déjà reçues dans Tally**.

1. Saisissez la **Clé API Tally** (elle commence par `tly-`), puis **Connecter**. **Remplacer** et **Déconnecter** gèrent la clé ensuite.
2. Choisissez le **Formulaire Tally**. Le champ **Depuis le (facultatif)** limite les réponses à partir d'une date.
3. **Brancher Tally** crée le webhook dans Tally pour ce formulaire. Sans cela, **Branchement manuel : URL et secret** donne l'adresse et le secret à coller.
4. Cliquez sur **Simuler l'import** : rien n'est écrit.
5. Activez l'automatisme, puis cliquez sur **Importer réellement** et confirmez. Ce bouton reste grisé tant que l'automatisme est inactif ou qu'aucune simulation n'a eu lieu.

Un import traite au plus 2 000 réponses ; relancez-le pour la suite. **Annuler l'import** l'arrête avant la réponse suivante. Le récapitulatif liste les réponses par résultat (**Créés**, **Complétés**, **Ignorés**, **Erreurs**), avec un bouton **Trace** par réponse. Le détail reste consultable 30 jours. Pour l'automatisme **Réception Tally** du CRM, voir la fiche CRM.

## Limites et droits

- **Créer, modifier, activer, supprimer, tester, rejouer, configurer Tally** : administrateurs, super administrateurs, ou utilisateurs avec le rôle **Gestionnaire d'automatisations** (attribué par l'administrateur de l'organisation dans `/admin/users`), avec au moins le droit d'édition sur l'espace ou la base.
- **Sans ce rôle** (membre éditeur de l'espace compris) : l'écran reste consultable. La liste, l'enchaînement des étapes, leurs réglages et l'onglet **Historique** s'affichent, mais **Nouvelle**, **Réglages…**, l'interrupteur d'activation et le bouton du formulaire Tally sont grisés ; leur info-bulle indique le rôle nécessaire et invite à le demander à l'administrateur de l'organisation. Le menu **…** des éléments n'apparaît pas. Le canevas indique **Consultation seule** : ni ajout, ni suppression, ni déplacement d'étape, ni test, ni **Enregistrer le flux**, ni **Rejouer** dans l'historique. L'URL et le secret d'un webhook entrant restent masqués.
- **Lecteurs de l'espace** : même affichage en consultation seule.
- **Limites de fréquence** : une exécution par minute et par automatisme, 100 exécutions par heure et par organisation (imports Tally exclus). Au-delà, l'exécution est ignorée. Les tests simulés sont limités à 30 par minute.
- **Coupure globale** : dans `/admin/automations`, onglet **Configuration**, l'interrupteur **Activation globale** coupe tous les déclencheurs et bloque la création.

## Questions fréquentes

- **Mon automatisme ne se lance pas.** Vérifiez qu'il est activé, que le flux est enregistré et que l'activation globale n'est pas coupée. Consultez l'onglet **Historique**.
- **Le bouton de test est grisé.** Enregistrez le flux, puis choisissez un échantillon.
- **Tout est grisé et le canevas indique Consultation seule.** Vous n'avez pas le rôle **Gestionnaire d'automatisations**. Demandez-le à l'administrateur de votre organisation.
- **Un test simulé a-t-il envoyé un e-mail ?** Non. Seul le mode **Exécuter réellement** écrit et envoie.
- **Je ne vois pas Créer une ligne.** Ces actions n'existent que dans une automatisation de base.
- **Je ne trouve pas Automatisations dans la palette Ctrl+K.** Passez par la barre latérale.
