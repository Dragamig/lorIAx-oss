# Contribuer à LorIAx

Le projet est édité et maintenu par Dragamig SAS, sous licence [FSL-1.1-MIT](LICENSE).

## Avant de contribuer

- Ouvrez une **issue** pour discuter d'un changement non trivial avant d'ouvrir une pull request.
- Une faille de sécurité ne se signale pas dans une issue : suivez [SECURITY.md](SECURITY.md).
- N'apportez que du code que vous avez le droit de soumettre. Le code copié d'un projet sous licence copyleft (GPL, AGPL) n'est pas accepté.
- Le projet vise l'auto-hébergement par des organismes : privilégiez la frugalité (peu de dépendances, aucun service externe imposé).

## Déroulement

1. Fork, puis branche thématique (`feat/...`, `fix/...`, `chore/...`).
2. Commits au format **Conventional Commits** (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `perf:`).
3. Chaque commit est signé avec `git commit -s` (voir [Certificat d'origine](#certificat-dorigine-du-développeur-dco)).
4. Vérifications avant d'ouvrir la pull request :

   ```bash
   npx tsc --noEmit
   npm run lint
   npm run test -- --run
   ```

5. Pull request avec une description claire : problème, solution, tests.

## Certificat d'origine du développeur (DCO)

Le DCO est obligatoire. Chaque commit d'une contribution porte une ligne de signature, placée à la fin du message :

```text
Signed-off-by: Prénom Nom <adresse>
```

`git commit -s` l'ajoute à partir de `user.name` et `user.email` de votre configuration Git. Le nom est votre nom réel, l'adresse une adresse à laquelle vous êtes joignable. Une pull request dont un commit n'est pas signé n'est pas fusionnée. Pour signer après coup : `git commit --amend -s` sur le dernier commit, `git rebase --signoff <base>` sur une série.

Par cette ligne, vous certifiez le texte suivant pour la contribution concernée :

```text
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

Dans ce projet, la licence visée par le DCO (« the open source license indicated in the file ») est la licence du projet décrite ci-dessous : FSL-1.1-MIT, puis MIT après conversion.

## Licence des contributions

Le projet est publié sous licence FSL-1.1-MIT. Chaque version publiée passe sous licence MIT deux ans après sa publication.

En apposant la ligne `Signed-off-by` sur un commit, vous acceptez, pour la contribution que contient ce commit, les trois points suivants.

1. **Licence du projet.** Votre contribution est placée sous la licence du projet, FSL-1.1-MIT, dans les mêmes conditions que le reste du code, y compris sa conversion en licence MIT deux ans après la publication de chaque version qui la contient.
2. **Licence accordée à Dragamig SAS.** En plus de la licence du projet, vous accordez à Dragamig SAS une licence non exclusive, mondiale, gratuite, perpétuelle (c'est-à-dire consentie pour toute la durée légale de protection des droits de propriété intellectuelle), irrévocable et sous-licenciable sur votre contribution. Cette licence porte sur le droit de l'utiliser, de la reproduire, de la représenter, de la modifier, de l'adapter, de l'intégrer à d'autres œuvres, de la distribuer et de la relicencier, en tout ou partie, sous forme de code source ou de code objet, sur tout support et par tout moyen, sous toute licence, libre ou propriétaire. Elle couvre notamment la conversion de la licence FSL-1.1-MIT vers la licence MIT deux ans après la publication de chaque version, ainsi que tout changement ultérieur de la licence du projet.
3. **Propriété.** Votre contribution reste la propriété de son auteur. Vous ne cédez aucun droit : vous conservez vos droits d'auteur, y compris vos droits moraux, et vous restez libre d'utiliser votre contribution comme vous l'entendez, y compris sous d'autres licences.

Vous garantissez avoir le droit d'accorder ces licences. Si la contribution a été créée dans le cadre de votre emploi ou d'une mission, il vous appartient d'obtenir l'accord de votre employeur ou de votre client avant de la soumettre.

## Conventions

- **TypeScript strict**, alias `@/` pour `src/`.
- **Langue** : français pour l'interface et la documentation, anglais pour le code.
- **Base de données** : snake_case (Drizzle). **Code** : camelCase. **Composants** : PascalCase.
- **Style** : classes utilitaires Tailwind, composants shadcn/ui (`@base-ui/react` : `render={}`, pas `asChild`).
- **Sécurité** : aucun secret en dur, validation Zod aux frontières, session et permissions vérifiées dans chaque handler d'API.
- **Tests** : toute correction ou fonction arrive avec ses tests (Vitest).

L'organisation du code est décrite dans [README.md](README.md#structure-du-projet), l'architecture dans [README.md](README.md#architecture).

## Périmètre

Tous les modules de l'édition sont actifs, sans quota ni clé de licence. Le studio vidéo ne fait pas partie de cette édition et les contributions qui le visent ne sont pas intégrées.

## Code de conduite

Le projet applique le [Contributor Covenant](CODE_OF_CONDUCT.md).
