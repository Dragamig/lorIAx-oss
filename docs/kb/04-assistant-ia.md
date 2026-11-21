---
title: "Assistant IA"
description: "Utiliser l'IA de LorIAx : chat conversationnel, résumé automatique de documents, réponses fondées sur vos documents (RAG), fournisseurs IA disponibles et quotas."
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

## Les fournisseurs IA

LorIAx fonctionne avec plusieurs fournisseurs de modèles, configurables par l'administrateur de l'instance :

- Claude (Anthropic)
- OpenAI
- Mistral
- Ollama (modèles auto-hébergés en local)

Le choix du fournisseur permet d'arbitrer entre qualité, coût et confidentialité. Avec Ollama, les traitements peuvent rester entièrement sur votre infrastructure.

## Configuration et quotas

- Les fonctions IA nécessitent qu'au moins un fournisseur soit configuré sur l'instance (par l'administrateur, dans la section Administration).
- Si aucune clé n'est configurée, les fonctions IA restent indisponibles.
- Des quotas peuvent encadrer l'usage de l'IA pour maîtriser la consommation.

## Questions fréquentes

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
