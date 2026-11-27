---
title: "Assistant IA"
description: "Utiliser l'IA de LorIAx : chat conversationnel, résumé automatique de documents, réponses fondées sur vos documents (RAG) et fournisseurs IA disponibles."
---

## L'assistant IA de LorIAx

LorIAx intègre une intelligence artificielle qui s'appuie sur vos propres contenus. Elle se présente sous plusieurs formes.

### Le chat IA

- Posez vos questions en langage naturel à un assistant conversationnel.
- La réponse s'affiche progressivement (streaming).
- L'assistant peut s'appuyer sur vos documents pour répondre de façon contextualisée.

### Question IA et réponses fondées sur vos documents (RAG)

LorIAx utilise vos documents pour formuler ses réponses. C'est le principe du RAG (génération augmentée par la récupération) :

- l'IA recherche d'abord les passages pertinents dans votre base de connaissances,
- puis elle rédige une réponse appuyée sur ces passages.

Ainsi, les réponses reflètent le contenu réel de votre organisation, et non des connaissances génériques.

### Résumé automatique

L'IA peut résumer un document long pour en donner l'essentiel rapidement.

### Autres usages assistés par l'IA

- Création de base de données à partir d'une description (Espace Bases).
- Aide à l'écriture de formules dans les bases.
- Résumé automatique des réunions visio transcrites, généré sous forme de document.

## Le chat et vos bases

Le chat peut lire vos bases (recherche de lignes, doublons, totaux) et proposer des modifications : créer, modifier, supprimer ou fusionner des lignes. Chaque proposition s'affiche en carte : rien n'est écrit tant que vous ne cliquez pas sur Appliquer. Une proposition appliquée s'annule pendant 24 h. Les propositions en attente apparaissent dans un bandeau au-dessus de la saisie. Dans l'historique d'une ligne, les changements faits ainsi portent la source « Assistant IA ». L'administrateur choisit les actions autorisées dans Administration > IA > Réglages (suppression et fusion sont désactivées par défaut).

## Création de fichiers depuis le chat

Le chat peut proposer de créer un tableur, un document ou une présentation à partir de votre demande (par exemple « fais-moi un tableur de suivi des congés »). Il ne crée rien lui-même : la proposition s'affiche en carte dans la conversation, avec un aperçu (colonnes et lignes d'exemple, plan du document, titres des diapositives), l'espace cible et la visibilité.

- **Créer** : crée le fichier dans l'espace indiqué. Le bouton Ouvrir apparaît ensuite sur la carte.
- **Modifier avant création** : change le titre, l'espace cible, les colonnes, le plan ou les titres des diapositives avant de créer.
- **Ignorer** : écarte la proposition. **Rétablir** la remet en attente.
- **Annuler la création** : supprime le fichier créé, tant qu'il n'a pas été modifié depuis. Il n'y a pas de corbeille : la suppression est définitive. Si le fichier a déjà été modifié, l'annulation est refusée.

Règles à connaître :

- Vous devez être éditeur de l'espace cible ; ce droit est revérifié au moment de cliquer sur Créer.
- Le fichier créé est toujours privé (visible de vous seul) ; partagez-le ensuite comme n'importe quel fichier.
- Une présentation compte au plus 12 diapositives.
- Vingt propositions en attente au plus par personne : validez ou ignorez-en avant d'en demander d'autres.
- Le nombre de créations est limité (30 par heure et par personne).

Réglages de l'administrateur, dans **Administration > IA > Réglages** : les interrupteurs « Proposer des tableurs », « Proposer des documents » et « Proposer des présentations » (tableur et document activés par défaut, présentation désactivée par défaut ; la présentation exige en plus le module Présentations). Dans **Administration > IA**, l'usage « Création » permet de choisir le modèle employé ; sans choix, c'est le modèle du Chat qui sert.

## Les fournisseurs IA

LorIAx fonctionne avec plusieurs fournisseurs de modèles, configurables par l'administrateur de l'instance :

- Claude (Anthropic)
- OpenAI
- Mistral
- Ollama (modèles auto-hébergés en local)

Le choix du fournisseur permet d'arbitrer entre qualité, coût et confidentialité. Avec Ollama, les traitements peuvent rester entièrement sur votre infrastructure.

## Configuration

- Les fonctions IA nécessitent qu'au moins un fournisseur soit configuré sur l'instance (par l'administrateur, dans la section Administration).
- Si aucune clé n'est configurée, les fonctions IA restent indisponibles.
- L'édition open source n'applique aucun plafond d'usage de l'IA. La consommation dépend du fournisseur choisi.

## Questions fréquentes

**Pourquoi le chat ne me propose-t-il pas de créer une présentation ?**
L'administrateur doit activer « Proposer des présentations » (désactivé par défaut) et le module Présentations doit être actif.

**L'IA lit-elle mes documents ?**
Elle recherche les passages pertinents pour répondre à votre question (RAG). Les réponses sont fondées sur votre contenu.

**Pourquoi les fonctions IA n'apparaissent-elles pas chez moi ?**
Aucun fournisseur IA n'est probablement configuré. Demandez à votre administrateur d'en activer un dans l'Administration.

**Quels modèles puis-je utiliser ?**
Claude, OpenAI, Mistral ou Ollama, selon ce que l'administrateur a configuré.

**Mes données partent-elles vers un service externe ?**
Cela dépend du fournisseur choisi. Avec Ollama auto-hébergé, les traitements restent sur votre infrastructure.

**L'IA peut-elle résumer un document ?**
Oui, utilisez le résumé automatique.

## Demander l'état d'un mail envoyé

Le chat sait lire les mails que vous avez envoyés depuis LorIAx (onglet **Mails** des fiches du CRM) : statut (envoyé, programmé, en cours, échec, annulé), motif d'un échec et trace dans la base Interactions. Exemple : « le mail pour Yanis Sennani est-il bien parti ? ». Il ne voit que vos propres mails, jamais ceux d'un collègue.

