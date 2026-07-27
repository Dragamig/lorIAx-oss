# Politique de sécurité

## Signaler une vulnérabilité

Si vous découvrez une faille de sécurité dans LorIAx, merci de la signaler de manière responsable :

- **Email** : `security@dragamig.fr`
- **Ne pas ouvrir d'issue publique** pour une faille non encore corrigée.
- Décrivez le problème le plus précisément possible : version concernée, étapes de reproduction, impact estimé, éventuel correctif suggéré.

Nous accusons réception sous 72 heures ouvrées et vous tenons informé de l'avancement jusqu'à la publication du correctif. Les signalements de bonne foi ne feront l'objet d'aucune poursuite de notre part.

## Périmètre

Sont concernés :

- le code applicatif de ce dépôt (`src/`, `server.ts`, `scripts/`) ;
- les images et configurations Docker fournies (`Dockerfile`, `docker-compose*.yml`, `docker/`) ;
- les mécanismes de sécurité intégrés : authentification (NextAuth, LDAP), RBAC, classification de documents, partages publics, CSP, protection SSRF, rate limiting, chiffrement des secrets en base.

Ne sont pas concernés : les dépendances tierces (signalez-les à leurs mainteneurs, mais prévenez-nous si LorIAx y est exposé), les instances auto-hébergées mal configurées, et l'ingénierie sociale.

## Versions prises en charge

| Version | Support sécurité |
|---|---|
| 1.21.x (dernière publication) | Oui |
| Versions antérieures | Non, mise à jour recommandée |

## Mesures par défaut

L'application applique de série : CSP avec nonce, protection SSRF sur les URLs entrantes, rate limiting, classification hiérarchique des documents, hash bcrypt des mots de passe et chiffrement AES-256-GCM des secrets stockés en base. Avant toute mise en production, suivez la checklist sécurité de [`docs/deploiement.md`](./docs/deploiement.md) : secrets uniques, mots de passe changés, HTTPS, port PostgreSQL non exposé.

---

> Créé par [Studio Dragamig](https://dragamig.fr) avec l'aide de [Claude d'Anthropic](https://www.anthropic.com/claude).
