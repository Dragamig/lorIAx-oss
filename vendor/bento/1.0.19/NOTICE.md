# Bento Slides, artefact vendorisé

Runtime de diaporama utilisé par le module « Présentations » de LorIAx, chargé dans une iframe
en origine opaque par `/api/presentations/runtime/1.0.19`.

| Élément | Valeur |
| --- | --- |
| Dépôt amont | https://github.com/nyblnet/bento |
| Paquet | `slides/` (`bento-slides`) |
| Version amont | 1.0.19 |
| Commit amont | `01000838496ec863ba1035eae12a8a4943020cdc` |
| Date du commit | 2026-09-05 |
| Date du build | 2026-09-09 |
| Commande de build | `npm install && npm run build:single` dans `slides/` |
| Fichier | `bento-runtime.html` (694151 octets) |
| SHA-256 | `33a1a0af104abe1687d7d81e6a7446e179ba515679450f3e1c527ce02681b62a` |
| Licence | MIT, texte complet dans `LICENSE` |

## Nature de l'artefact

Ce fichier est un **artefact vendorisé**, pas une dépendance npm : il n'apparaît donc dans aucun
relevé `license-checker`. Il est figé, versionné dans le dépôt, et ne peut pas bouger par un
`npm update`. Une montée de version amont est un lot à part entière, avec relecture d'un jeu de
présentations de référence.

## Autonomie vérifiée au build

Aucune référence réseau : ni `src` ni `href` distant, aucun `fetch` vers une URL externe.
Les quatre occurrences de `https://` du fichier sont des espaces de noms SVG (`xmlns`).
Le code et les styles sont inline, compressés en `deflate` et encodés en base64, décompressés
au chargement. La CSP posée par la route de service autorise donc `'unsafe-inline'` et
`'unsafe-eval'`, et coupe tout accès réseau par `connect-src 'none'`.

## Reconstruction

```
git clone https://github.com/nyblnet/bento.git
cd bento && git checkout 01000838496ec863ba1035eae12a8a4943020cdc
cd slides && npm install && npm run build:single
# dist-single/Bento_Slides.bento.html
```
