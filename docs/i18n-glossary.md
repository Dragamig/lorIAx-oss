# Glossaire i18n — LorIAx

Référence de traduction pour tous les stages d'internationalisation.

## Termes produit figés (ne jamais traduire)

| Terme | Note |
|-------|------|
| **LorIAx** | Nom du produit, invariant dans toutes les langues |
| **Hocuspocus** | Nom du serveur de collaboration (technique, jamais traduit) |
| **TipTap** | Nom de l'éditeur (marque déposée) |
| **Garage S3** | Nom du stockage objet (marque technique) |

## Vocabulaire métier

### « espace » / « space »

| Locale | Terme |
|--------|-------|
| fr | espace |
| en | space |
| es | espacio |
| de | Bereich |
| ja | スペース |
| zh | 空间 |
| br | egor |

### « base » / « database »

| Locale | Terme |
|--------|-------|
| fr | base de données |
| en | database |
| es | base de datos |
| de | Datenbank |
| ja | データベース |
| zh | 数据库 |
| br | diaz roadennoù |

### « organisation » / « organization »

| Locale | Terme |
|--------|-------|
| fr | organisation |
| en | organization |
| es | organización |
| de | Organisation |
| ja | 組織 |
| zh | 组织 |
| br | strollad |

### « connexion » / « log in »

| Locale | Terme |
|--------|-------|
| fr | connexion / se connecter |
| en | sign in / log in |
| es | iniciar sesión |
| de | Anmelden |
| ja | サインイン |
| zh | 登录 |
| br | Kevreadenniñ |

### « mot de passe » / « password »

| Locale | Terme |
|--------|-------|
| fr | mot de passe |
| en | password |
| es | contraseña |
| de | Passwort |
| ja | パスワード |
| zh | 密码 |
| br | ger-tremen |

### « compte » / « account »

| Locale | Terme |
|--------|-------|
| fr | compte |
| en | account |
| es | cuenta |
| de | Konto |
| ja | アカウント |
| zh | 账户 |
| br | kont |

### « inscription » / « sign up »

| Locale | Terme |
|--------|-------|
| fr | inscription / créer un compte |
| en | sign up / create account |
| es | registrarse / crear cuenta |
| de | Registrieren / Konto erstellen |
| ja | 登録する / アカウントを作成 |
| zh | 注册 / 创建账户 |
| br | Emezelañ / Krouiñ ur gont |

### « email » / « adresse email »

Terme technique universel — conserver « email » dans toutes les locales (sauf zh/ja où on peut ajouter le mot natif si naturel).

| Locale | Terme |
|--------|-------|
| fr | email / adresse email |
| en | email / email address |
| es | email / dirección de email |
| de | E-Mail / E-Mail-Adresse |
| ja | メールアドレス |
| zh | 邮箱 / 邮箱地址 |
| br | chomlec'h postel |

### « sous-domaine » / « subdomain »

| Locale | Terme |
|--------|-------|
| fr | sous-domaine |
| en | subdomain |
| es | subdominio |
| de | Subdomain |
| ja | サブドメイン |
| zh | 子域名 |
| br | isstachenn |

## Registres par locale

| Locale | Registre | Règle |
|--------|----------|-------|
| **fr** | tutoiement neutre | « vous » pour l'interface formelle, « tu » jamais |
| **en** | sobre, sentence case | Minuscules sauf première lettre et noms propres |
| **es** | tú neutre (Amérique latine + Espagne) | Pas de voseo ; forme accessible et chaleureuse |
| **de** | Sie (vouvoiement formel) | Toujours majuscule : « Sie », « Ihr », « Ihnen » |
| **ja** | です・ます (style poli) | Ni trop formel (keigo lourd) ni trop familier |
| **zh** | Chinois simplifié | Concis, sans particules de politesse superflues |
| **br** | Breton standard peurunvan | Sobre et littéral ; beta assumé |

## Intraduisibles (toujours conserver en clair)

- Noms de fonctions de formules (ex. `SUM`, `COUNT`, `IF`)
- Slugs d'organisation (ex. `acme-corp`)
- Codes d'erreur (ex. `CredentialsSignin`, `password_changed`)
- Identifiants techniques (ex. `lrx_...`, tokens JWT)
- Paramètres URL (ex. `?token=`, `?callbackUrl=`)
- Constantes d'environnement (ex. `NEXT_PUBLIC_ROOT_DOMAIN`)
- Clés i18n elles-mêmes

## Convention — Échappement des apostrophes en ICU

Le moteur ICU (utilisé par `next-intl`) interprète l'apostrophe comme un caractère d'échappement dans les valeurs contenant un placeholder `{var}` ou une balise `<tag>`.

Règles :
- **Apostrophe suivie de `{` ou `<`** → obligatoirement doublée (`''`) ; sans quoi l'apostrophe et le texte qui suit sont silencieusement supprimés.
- **Apostrophe littérale dans un contexte sans placeholder ni balise** → sûre telle quelle.

Exemples :
```
// Incorrect — l apostrophe disparaît silencieusement
"message": "L'espace {name} est prêt."

// Correct
"message": "L''espace {name} est prêt."

// Sûr sans placeholder
"label": "L'espace est prêt."
```

Vigilance particulière pour les locales **fr** et **br** dont la densité d'apostrophes est élevée. Vérifier systématiquement toute valeur traduisant une phrase française/bretonne contenant une apostrophe dès lors qu'un placeholder ou une balise est présent dans la même chaîne.

## Termes rencontrés durant Stage 1.1 (pages AUTH)

| fr | en | es | de | ja | zh | br |
|----|----|----|----|----|----|----|
| Se connecter | Sign in | Iniciar sesión | Anmelden | サインイン | 登录 | Kevreadenniñ |
| Mot de passe oublié ? | Forgot password? | ¿Olvidaste tu contraseña? | Passwort vergessen? | パスワードをお忘れですか？ | 忘记密码？ | Ankounac'het ho ker-tremen ? |
| Créer un compte | Create an account | Crear una cuenta | Konto erstellen | アカウントを作成 | 创建账户 | Krouiñ ur gont |
| Déjà un compte ? | Already have an account? | ¿Ya tienes cuenta? | Bereits ein Konto? | すでにアカウントをお持ちですか？ | 已有账户？ | Ur gont hoc'h eus endeo ? |
| Nom complet | Full name | Nombre completo | Vollständiger Name | フルネーム | 姓名 | Anv klok |
| Réinitialisation du mot de passe | Password reset | Restablecer contraseña | Passwort zurücksetzen | パスワードのリセット | 重置密码 | Adderaouekaat ger-tremen |
| Espace introuvable | Space not found | Espacio no encontrado | Bereich nicht gefunden | スペースが見つかりません | 空间未找到 | Egor n'eo ket kavet |
| Définissez votre mot de passe | Set your password | Establece tu contraseña | Passwort festlegen | パスワードを設定してください | 设置密码 | Termeniñ ho ker-tremen |
