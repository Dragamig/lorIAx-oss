---
title: "FAQ et dépannage"
description: "Résoudre les problèmes courants de LorIAx : connexion, mot de passe oublié, image qui ne s'affiche pas, IA non configurée, synchronisation, envoyer un mail, relancer le tuto, et comment décrire un problème à votre administrateur."
---

## Connexion

**Je n'arrive pas à me connecter.**

- Vérifiez votre email et votre mot de passe (attention aux majuscules).
- Si votre organisation utilise un annuaire (LDAP / Active Directory), utilisez vos identifiants habituels d'entreprise.
- Après plusieurs mots de passe erronés d'affilée, la connexion est temporairement bloquée pour votre compte. Le blocage se lève tout seul : attendez quelques minutes avant de réessayer, et insister le prolonge.
- Si le problème persiste, contactez l'administrateur de votre instance : votre compte est peut-être désactivé ou non encore créé.

**Email non vérifié à la connexion.**

- Un compte créé par l'inscription libre doit d'abord vérifier son adresse : le lien reçu par email est valable 24 heures.
- Lien perdu ou expiré : sur la page de connexion, utilisez « Renvoyer le lien ». Un nouveau lien invalide le précédent, et deux envois doivent être espacés d'une minute.
- Sans réception, un administrateur peut renvoyer le lien ou marquer l'adresse comme vérifiée depuis la liste des utilisateurs.

**J'ai changé mon mot de passe et je suis déconnecté partout.**

C'est voulu : un changement ou une réinitialisation de mot de passe invalide les sessions ouvertes, sur tous vos appareils. Reconnectez-vous avec le nouveau mot de passe.

**J'ai oublié mon mot de passe.**

- Sur la page de connexion, cliquez sur **Mot de passe oublié ?** (`/forgot-password`), saisissez votre email puis **Envoyer le lien**. Si un compte existe avec cette adresse, vous recevez un lien de réinitialisation valable une heure.
- Sinon, demandez à un administrateur de réinitialiser votre mot de passe : les administrateurs peuvent recréer ou réinitialiser les identifiants.
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
- Si le fournisseur IA refuse les requêtes (clé invalide, limite de son côté), contactez l'administrateur.
- Le chat IA est l'entrée **Assistant IA** de la barre latérale (`/ai`). Le bouton d'aide **?**, en bas de la barre latérale, n'apparaît que si un administrateur a activé l'assistant d'aide dans `/admin/ai/settings` et qu'une IA est configurée. Voir la fiche « Aide et prise en main ».

## Recherche

**Je ne trouve pas un document.**

- La recherche complète est l'entrée **Rechercher** de la barre latérale (`/search`) ; la palette `Ctrl+K` ne cherche que dans les documents et les médias.
- Vérifiez le filtre par espace (liste **Tous les espaces** de la page **Rechercher**) : la recherche peut être limitée à un périmètre.
- Essayez la recherche sémantique en reformulant par le sujet plutôt que par les mots exacts, ou passez en mode **Question IA**.
- Assurez-vous d'avoir les droits d'accès au document recherché (classification ou rôle d'espace).

## Calendrier et synchronisation

**Mon agenda externe ne se synchronise pas.**

- Vérifiez la configuration CalDAV dans votre client (Thunderbird, Apple Calendar, DAVx⁵).
- Authentifiez-vous avec votre adresse e-mail et votre mot de passe LorIAx. Si votre client accepte un jeton (en-tête Bearer), vous pouvez aussi utiliser une clé créée dans **Paramètres > Clés API** avec la permission **Calendrier (lecture)** ou **Calendrier (écriture)** cochée ; une clé sans permission calendrier est refusée.
- L'adresse à saisir se trouve dans **Paramètres > Général**, section **Synchronisation du calendrier**, lien **Synchroniser avec un autre agenda**.
- Si votre administrateur a exigé une réinitialisation de votre mot de passe, la synchronisation CalDAV est refusée tant que vous ne l'avez pas changé. Connectez-vous une fois dans l'application pour le faire.
- Après plusieurs échecs d'authentification d'affilée, la voie CalDAV est temporairement bloquée pour votre compte. Corrigez les identifiants dans votre client, puis patientez quelques minutes : une synchronisation réussie remet le compteur à zéro.
- Pour un calendrier externe ponctuel, utilisez l'import/export iCal (.ics).
- Le calendrier de LorIAx s'ouvre par l'entrée **Calendrier** de la barre latérale (`/calendar`).

## Visioconférence

**Je n'arrive pas à rejoindre une réunion.**

- Les réunions se trouvent dans l'entrée **Réunions** de la barre latérale (`/meet`) : bouton **Rejoindre** de la carte de la réunion. Si la page affiche « La visioconférence est désactivée », contactez un administrateur.
- Autorisez l'accès au micro et à la caméra dans votre navigateur.
- Les invités externes utilisent le lien d'invitation, sans compte.
- Essayez un navigateur récent à jour.

## Collaboration

**Mes modifications semblent ne pas être enregistrées.**

- Le contenu est sauvegardé automatiquement. En cas de coupure réseau, vous continuez à travailler hors-ligne ; les modifications se synchronisent au retour de la connexion.
- En cas de doute, l'historique des versions permet de retrouver un état antérieur.

## Décrire un problème

- L'assistant d'aide (bouton **?**) répond aux questions d'utilisation, mais ne transmet aucun signalement : il n'y a pas de bouton de remontée de bug dans l'édition open source. Voir la fiche « Aide et prise en main ».
- Notez ce que vous faisiez, ce que vous attendiez et ce qui s'est passé.
- Précisez la page concernée et, si possible, une capture d'écran.
- Transmettez ces informations à l'administrateur de votre instance ou au canal de support défini par votre organisation.

## Questions fréquentes

**À qui m'adresser en cas de problème ?**
À l'administrateur de votre instance LorIAx, qui gère les comptes, les rôles et la configuration (IA, annuaire, modules).

**Mes données sont-elles hébergées chez un tiers ?**
Non par défaut : LorIAx est auto-hébergé sur l'infrastructure de votre organisation. Certaines fonctions IA peuvent solliciter un fournisseur externe selon le choix de l'administrateur.

**Comment envoyer un mail depuis LorIAx ?**
Depuis le CRM, avec votre propre boîte mail. Configurez-la d'abord : menu utilisateur en bas de la barre latérale, **Paramètres**, onglet **Ma boîte mail** (`/settings?tab=mailbox`). Ouvrez ensuite la fiche d'un contact ou d'un dossier du CRM, onglet **Mails**, bouton **Écrire**. Le CRM doit être activé par un administrateur. Voir la fiche « Mailing ».

**Comment relancer la visite guidée ?**
Menu utilisateur en bas de la barre latérale, **Relancer le tuto**. Vos badges sont dans **Mes badges**. Voir la fiche « Aide et prise en main ».

**Comment récupérer une version précédente d'un document ?**
Ouvrez l'historique des versions du document et restaurez la version voulue.
