# Politique de sécurité

## Signaler une vulnérabilité

Une faille de sécurité dans LorIAx se signale en privé :

- **Adresse** : `security@dragamig.fr`
- **Pas d'issue publique** pour une faille non encore corrigée.
- Décrivez le problème le plus précisément possible : version concernée, étapes de reproduction, impact estimé, correctif éventuel.

Nous accusons réception sous 72 heures ouvrées et vous tenons informé de l'avancement jusqu'à la publication du correctif. Les signalements de bonne foi ne font l'objet d'aucune poursuite de notre part.

## Versions prises en charge

| Version | Licence | Prise en charge |
|---|---|---|
| 2.1.x | FSL-1.1-MIT | Oui |
| 2.0.x | FSL-1.1-MIT | Correctifs de sécurité uniquement |
| 1.21.x | MIT | Correctifs de sécurité uniquement |
| Versions antérieures | | Non, mise à jour recommandée |

La branche 1.21.x ne reçoit plus de nouvelles fonctions. Le passage à la version 2.0 est décrit dans [CHANGELOG.md](CHANGELOG.md).

## Périmètre

Sont concernés :

- le code applicatif de ce dépôt (`src/`, `server.ts`, `scripts/`) ;
- les images et configurations Docker fournies (`Dockerfile`, `docker-compose.yml`, `docker-compose.livekit.yml`, `docker/`) ;
- les scripts d'installation (`install.sh`, `scripts/generate-env.sh`) ;
- les mécanismes de sécurité intégrés : authentification (NextAuth, LDAP), rôles et droits, classification des documents, partages publics, CSP, protection SSRF, limitation de débit, chiffrement des secrets en base.

Ne sont pas concernés : les dépendances tierces (signalez-les à leurs mainteneurs, et prévenez-nous si LorIAx y est exposé), les instances auto-hébergées mal configurées et l'ingénierie sociale.

## Mesures par défaut

L'application applique de série : CSP avec nonce, protection SSRF sur les URL entrantes, limitation de débit, classification hiérarchique des documents, hachage bcrypt des mots de passe et chiffrement AES-256-GCM des secrets stockés en base.

L'installation décrite dans [README.md](README.md#lancement-rapide) génère des secrets aléatoires propres à chaque instance, ne publie pas PostgreSQL et n'écoute que sur la machine. Avant d'ouvrir une instance au public : placer un reverse proxy HTTPS devant l'application, conserver le fichier `.env` en lecture réservée à son propriétaire (`chmod 600 .env`) et mettre en place la sauvegarde des volumes.

---

Créé par Studio Dragamig avec l'aide de Claude d'Anthropic
