#!/usr/bin/env bash
# Usage: check-dco.sh <base> <head>
# Chaque commit de <base>..<head> doit porter une ligne
# "Signed-off-by: Nom <adresse>" dont l'adresse est celle de l'auteur ou du committer.
# Un commit de fusion est controle comme les autres des qu'il porte un contenu propre
# (conflit resolu, fichier ajoute : diff combine non vide). Une fusion pure, sans changement
# propre, n'ajoute rien que les commits fusionnes (eux aussi controles) n'aient deja certifie.
# Limite inherente au DCO : l'adresse de signature est choisie librement par le contributeur.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <base> <head>" >&2
  exit 2
fi

base="$1"
head="$2"
bad=()

while read -r sha; do
  [ -n "$sha" ] || continue
  if [ "$(git rev-list --parents -n 1 "$sha" | wc -w)" -gt 2 ] \
    && [ -z "$(git diff-tree --cc --no-commit-id -r "$sha")" ]; then
    continue
  fi
  author=$(git log -1 --format=%ae "$sha")
  committer=$(git log -1 --format=%ce "$sha")
  ok=0
  while read -r email; do
    [ -n "$email" ] || continue
    if [ "${email,,}" = "${author,,}" ] || [ "${email,,}" = "${committer,,}" ]; then
      ok=1
      break
    fi
  done < <(git log -1 --format=%B "$sha" \
    | sed -n 's/^Signed-off-by: .* <\(.*@.*\)>[[:space:]]*$/\1/p')
  if [ "$ok" -eq 0 ]; then
    bad+=("$sha")
  fi
done < <(git log --format=%H "$base..$head")

if [ "${#bad[@]}" -gt 0 ]; then
  echo "Commits sans ligne Signed-off-by valide :" >&2
  for sha in "${bad[@]}"; do
    git log -1 --format='  %h %s' "$sha" >&2
  done
  echo >&2
  echo "Signer le dernier commit : git commit --amend -s" >&2
  echo "Signer une série : git rebase --signoff <base>" >&2
  exit 1
fi
echo "DCO : tous les commits sont signés."
