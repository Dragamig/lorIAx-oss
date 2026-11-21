---
title: "FAQ et dépannage"
description: "Résoudre les problèmes courants de LorIAx : connexion, mot de passe oublié, image qui ne s'affiche pas, IA non configurée, synchronisation, et comment signaler un bug."
---

## Connexion

**Je n'arrive pas à me connecter.**

- Vérifiez votre email et votre mot de passe (attention aux majuscules).
- Si votre organisation utilise un annuaire (LDAP / Active Directory), utilisez vos identifiants habituels d'entreprise.
- Après plusieurs mots de passe erronés d'affilée, la connexion est temporairement bloquée pour votre compte. Le blocage se lève tout seul : attendez quelques minutes avant de réessayer, et insister le prolonge.
- Si le problème persiste, contactez l'administrateur de votre instance : votre compte est peut-être désactivé ou non encore créé.

**J'ai changé mon mot de passe et je suis déconnecté partout.**

C'est voulu : un changement ou une réinitialisation de mot de passe invalide les sessions ouvertes, sur tous vos appareils. Reconnectez-vous avec le nouveau mot de passe.

**J'ai oublié mon mot de passe.**

- Demandez à un administrateur de réinitialiser votre mot de passe : les administrateurs peuvent recréer ou réinitialiser les identifiants.
- Si un email de bienvenue vous a été envoyé, il contient un lien de connexion.

## Images et fichiers

**Une image ne s'affiche pas dans mon document.**

- Vérifiez que le fichier a bien été téléversé (et non simplement collé depuis une source externe expirée).
- Rechargez la page : un affichage peut être temporairement bloqué par le réseau.
- Pour les fichiers volumineux, attendez la fin du téléversement avant de poursuivre.
- Si l'image vient d'un lien externe, ce lien peut avoir expiré ; téléversez plutôt le fichier dans LorIAx.

**Je n'arrive pas à joindre plusieurs fichiers.**

- Dans une base, utilisez une colonne de type « Pièces jointes » qui accepte plusieurs fichiers.

## Intelligence artificielle

**Les fonctions IA n'apparaissent pas ou ne répondent pas.**

- L'IA nécessite qu'un fournisseur soit configuré sur l'instance (Claude, OpenAI, Mistral ou Ollama).
- Si aucun fournisseur n'est configuré, les fonctions IA restent indisponibles. Demandez à votre administrateur d'en activer un.
- Si un quota est atteint, attendez son renouvellement ou contactez l'administrateur.

## Recherche

**Je ne trouve pas un document.**

- Vérifiez le filtre par espace : la recherche peut être limitée à un périmètre.
- Essayez la recherche sémantique en reformulant par le sujet plutôt que par les mots exacts.
- Assurez-vous d'avoir les droits d'accès au document recherché (classification ou rôle d'espace).

## Calendrier et synchronisation

**Mon agenda externe ne se synchronise pas.**

- Vérifiez la configuration CalDAV dans votre client (Thunderbird, Apple Calendar, DAVx⁵).
- Si vous vous authentifiez avec une clé d'API, vérifiez qu'elle porte bien une portée de calendrier (`calendars:read` ou `calendars:write`). Une clé créée pour un autre usage est refusée.
- Si votre administrateur a exigé une réinitialisation de votre mot de passe, la synchronisation CalDAV est refusée tant que vous ne l'avez pas changé. Connectez-vous une fois dans l'application pour le faire.
- Après plusieurs échecs d'authentification d'affilée, la voie CalDAV est temporairement bloquée pour votre compte. Corrigez les identifiants dans votre client, puis patientez quelques minutes : une synchronisation réussie remet le compteur à zéro.
- Pour un calendrier externe ponctuel, utilisez l'import/export iCal (.ics).

## Visioconférence

**Je n'arrive pas à rejoindre une réunion.**

- Autorisez l'accès au micro et à la caméra dans votre navigateur.
- Les invités externes utilisent le lien d'invitation, sans compte.
- Essayez un navigateur récent à jour.

## Collaboration

**Mes modifications semblent ne pas être enregistrées.**

- Le contenu est sauvegardé automatiquement. En cas de coupure réseau, vous continuez à travailler hors-ligne ; les modifications se synchronisent au retour de la connexion.
- En cas de doute, l'historique des versions permet de retrouver un état antérieur.

## Signaler un bug

- Notez ce que vous faisiez, ce que vous attendiez et ce qui s'est passé.
- Précisez la page concernée et, si possible, une capture d'écran.
- Transmettez ces informations à l'administrateur de votre instance ou au canal de support défini par votre organisation.

## Questions fréquentes

**À qui m'adresser en cas de problème ?**
À l'administrateur de votre instance LorIAx, qui gère les comptes, les rôles et la configuration (IA, annuaire, modules).

**Mes données sont-elles hébergées chez un tiers ?**
Non par défaut : LorIAx est auto-hébergé sur l'infrastructure de votre organisation. Certaines fonctions IA peuvent solliciter un fournisseur externe selon le choix de l'administrateur.

**Comment récupérer une version précédente d'un document ?**
Ouvrez l'historique des versions du document et restaurez la version voulue.
