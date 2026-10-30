# Dinkeo — règles de travail

Application de ligue de pickleball (Centre Pickleball Saguenay), servie par GitHub Pages sur dinkeo.ca.
Tout le code est dans `index.html` (JS vanilla + Supabase). `sw.js` sert aux notifications push. Images dans `assets/`.

## À chaque modification
- Incrémenter `<meta name="app-build" content="Version N">`.
- Compatibilité vieux iOS : pas de `??` ni `?.`, syntaxe ES2018.
- Extraire les `<script>` en ligne et lancer `node --check` ; dire clairement quand seule la syntaxe a été vérifiée.
- Garder le thème sombre « terrain » (variables `--court`, `--ball`, `--muted`, `--paddle`, `--text`, `--line-soft`… ; polices Oswald / Inter) et les composants récents (`.pf-*`, `.ah-*`, `.rs-*`).

## Tous les supports, toujours
Chaque changement visuel doit être vérifié sur **tous les supports**, pas seulement le téléphone :
- téléphone : 390 px de large ;
- tablette : environ 820 px ;
- ordinateur : 1366 px et 1920 px (Windows : Chrome / Edge).

Les styles du téléphone (`@media (max-width:640px)`) ne doivent pas être les seuls à porter le nouveau look :
sur ordinateur, l'app est une colonne centrée (760 px max), avec la même barre flottante, les mêmes cartes et les mêmes onglets.
Les fenêtres restent centrées sur ordinateur et deviennent des feuilles par le bas sur téléphone.

## Base de données (Supabase)
- Donner le SQL en petits blocs, un à la fois (l'éditeur Supabase tronque les longs collages).
- Ne pas créer de comptes de test dans la vraie base.

## Git
- Travailler sur la branche `claude/textes-ligue-recreative`, la pousser, puis avancer `main` seulement quand l'utilisateur dit « go ».

## À ne pas toucher
- Le format MLP reste dans l'app, même s'il est peu utilisé.
