# 文春の同一記事ページ結合（ローカル検証版）

## 調査結果と構成

基準コミットは008ceb57846f481d179c077725b9296a68254b4e。開始時の作業ツリーはクリーン。
Minifluxの標準Scraper Rulesは取得した1文書のCSS抽出、Rewrite Rulesはその文書の変更であり、
参照した公式scraper.goは単一ページしか取得しない。確認HTMLに全ページ表示URLは見つからない。
現在の .article-body と既存Rewrite RulesはMinifluxの1ページ抽出として有効だが、複数ページ結合には別処理が必要。
- https://miniflux.app/docs/rules.html
- https://github.com/miniflux/v2/blob/d5c529b94ce9a172bd4c22a2b89da068c583783b/internal/reader/scraper/scraper.go

別Worker workers/bunshun-articles を追加。画像Workerのコード、公開API、設定は変更しない。
NextfluxのGはVITE_BUNSHUN_ARTICLE_WORKER_URLが設定され、URLが許可形式の文春記事の場合だけ
新Workerへ通常GETする。未設定または他サイトは既存Miniflux fetch-content APIを使用する。

## 実HTMLでの根拠とHTTP実測

Cookie・認証なしのWindows GET（リダイレクト0、すべて200 text/html; charset=utf-8）：
- https://bunshun.jp/articles/-/93048
- https://bunshun.jp/articles/-/93048?page=2
- https://bunshun.jp/articles/-/93048?page=3
- https://bunshun.jp/articles/-/93233 （別の複数ページ記事）
- https://bunshun.jp/articles/-/93198 （単ページ記事）

対象3ページはcanonicalが93048、.pagination.articleの数字が1,2,3、activeが要求ページに一致。
最終ページの #article-series-next-link は93049?page=1であり、ページ番号リンクとは別。
93049は対象93048の続きとして取得しない。
別記事93233は同じ構造で2ページ、93198はページ案内なしの1ページとして判定。

ローカルworkerdの実取得：93048は3ページ、93233は2ページ、93198は1ページでcomplete=true。
93048はページ別本文11/6/9段落、合計26段落を元HTMLと順に全件照合（広告段落を除く）。
各ページ末尾の段落も保持。CDN本文画像2枚と写真ページリンク2件を保持し、画像URLは変更しない。
生HTMLや記事全文をリポジトリのテストfixtureには保存せず、テストには自作HTMLを使用する。

## 制限と安全性

- 許可URLはHTTPS、完全一致bunshun.jp、/articles/-/<数字ID> と任意の ?page=1..5 だけ。
  資格情報・明示ポート・fragment・他query・制御文字・percent表記を拒否。
- ページ番号とリンク先同一ID、canonical、active番号、全ページで同じ連続ページ集合を照合。
  関連記事や「次の記事」はたどらない。ページ案内が未知・欠落・不連続なら失敗。
- ページは直列（1リクエスト内同時実行1）、最大5ページ。リダイレクトは各ページ2回まで、
  同じ記事IDかつ要求ページだけ許可。循環・重複URL、同じ本文の再送、途中のページ数変化は失敗。
- 各ページ512KiB、合計2MiB、結合HTML1MiB。本文取得まで含め全体15秒。
- 収集中リクエストは同じWorker isolate内で最大2、超過は429。
  これは分散された全利用者のグローバル上限・認証ではない。公開後は使用量の確認が必要。
- 完全成功だけ5分キャッシュ（Cloudflare拠点内best effort）。途中失敗をcompleteとして返さない。
- サイトからの任意HTMLをそのまま渡さず、既存htmlparser2で構文解析して許可タグ・属性だけ再生成。
  script/style/iframe/svg/form/object等、イベント属性・style・任意class/idを除去。
  相対img/hrefは取得ページURLから絶対化。画像はHTTPS、リンクはhttp/https/mailtoのみ。
- #twitter-share-btn / .direct-access-info / #article-series-next-link / .photo-icon / 広告 / 写真案内・SVG等を除去。
  本文段落のテキストによる一括重複除去はしない。正当な反復文は保持する。
- Nextfluxのhtml-react-parser自体はサニタイザーではない。新経路は上記Workerの安全な出力だけを使用。
  既存Miniflux経路はMinifluxのSanitizeHTMLを維持。
- Cookie/Authorization/Miniflux認証情報を送らない。Worker上流ヘッダは固定Acceptのみ。
  ブラウザ呼出しはcredentials:omit、CORS、redirect:error。例外・失敗は元本文を保持してtoastで通知。
- CORSはALLOWED_ORIGINSのカンマ区切り完全一致。認証ではない。OriginなしのCLIアクセスも可能。
  credentials許可なし。OPTIONSはGETだけで認証ヘッダー等の要求は拒否。
- URLをログ出力するコードはなく、observabilityは無効。VITE変数は公開情報であり秘密を入れない。
- 既存画像WorkerはArticleImage/PhotoViewの既存経路で使用。新Workerは画像を取得・再配信しない。
- Gの取得完了時は同一visitの同一記事であることを確認し、最新の既読・スター状態へ本文だけをマージ。
  他記事へ移動、元記事に戻った場合も古い取得結果は破棄。失敗・部分取得時は旧本文を維持。
- ArticleContentのkey={article.content}とラベルspanは変更しない。
  本文が同じ既読・スター操作では本文・メディアを再マウントしない。

## ローカル起動（2つのPowerShell）

既存依存がなければルートでnpm.cmd ci、既存Wranglerがなければnpm.cmd ci --prefix workers/bunshun-images。
今回は依存追加・更新を行っていない。Wranglerは既存画像Workerの固定版を再利用する。

ターミナル1：

```powershell
cd C:\dev\nextflux
$env:WRANGLER_SEND_METRICS="false"
node workers\bunshun-images\node_modules\wrangler\bin\wrangler.js dev --config workers/bunshun-articles/wrangler.jsonc --local --ip 127.0.0.1 --port 8788
```

ターミナル2：

```powershell
cd C:\dev\nextflux
$env:VITE_BUNSHUN_ARTICLE_WORKER_URL="http://127.0.0.1:8788"
$env:VITE_BUNSHUN_IMAGE_WORKER_URL="https://nextflux-bunshun-images.nago687-7e7.workers.dev"
npm.cmd run dev -- --host 127.0.0.1 --port 5175 --strictPort
```

http://127.0.0.1:5175 を開き、既存Minifluxへ接続して93048の要約からGを実行する。
1/3→2/3→3/3の順序と末尾、画像拡大、Gで要約へ戻ることを確認する。
Chrome標準翻訳後のG往復、既読・スター操作、取得中の他記事への移動、他サイトのGも確認する。
Networkの /article?url=... に認証ヘッダがなく、画像は別の既存画像Workerへ行くことを確認する。
新Workerを止めてからGを実行し、旧本文と失敗表示が維持されることも確認する。
無効化はVITE_BUNSHUN_ARTICLE_WORKER_URLを解除してdev再起動または再ビルド。

## 検証と未検証事項

合成HTMLテスト：ページ順・同一ID・canonical・active・別記事除外・相対URL・サニタイズ・重複本文・
循環・5ページ上限・サイズ・合計時間・同時実行・部分失敗・CORS・非文春/未設定の既存経路を検証。
状態管理テスト：古い結果破棄、取得中に変わった既読・スターの保持、失敗時の旧本文保持。
翻訳模擬テスト：実ArticleContentとReact DOMを使用し、翻訳相当のfont要素置換後の本文切替を検証。
周辺メディアUIはスタブ化。実Chrome標準翻訳、実アカウントのG操作、拡大画像・メディア操作は別の実機確認が必要。
Cloudflare本番からの公開記事取得・CORS・キャッシュ・負荷は未検証。ローカル200は本番成功を保証しない。

認証/購読/ボット対策回避は行わない。ページDOM構造が違う記事、5ページ超、購読制限で本文が得られない記事は対象外。
常に完全な公開原稿を保証するものではなく、取得応答と検証済みページ案内の範囲を結合する。

## 後日公開する場合（今回は実行しない）

1. 別Worker設定のALLOWED_ORIGINSへ実際のPages公開Originを明示する（秘密は不要）。
2. 同じWranglerで --config workers/bunshun-articles/wrangler.jsonc deploy を別途承認のもと実行。
3. Cloudflare上の /article で対象記事の全ページ取得が成功するか確認。403/失敗ならPagesへ適用しない。
4. VITE_BUNSHUN_ARTICLE_WORKER_URLへ新WorkerのHTTPS Originだけを設定し、Pagesを再ビルド。
   既存VITE_BUNSHUN_IMAGE_WORKER_URLはそのまま維持。Miniflux設定は変更不要。
5. 本番でG・翻訳・画像拡大・他サイト・失敗表示を確認する。

公式API確認：
- https://developers.cloudflare.com/workers/runtime-apis/fetch/
- https://developers.cloudflare.com/workers/runtime-apis/cache/
- https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/ （比較。今回依存済みパーサーを採用）
- https://developers.cloudflare.com/workers/wrangler/configuration/
最終検証：全156テスト、lint、Nextflux build、git diff --check、Worker deploy --dry-runが成功。
既存5174番は別設定で使用中だったため停止せず、新しいローカル画面には5175番を使用する。

## 93131の電子版canonical形式への限定対応

観測したエラー条件は、canonicalを通常の /articles/-/<id> として解釈した結果が要求記事IDと一致しないこと。
公開URL https://bunshun.jp/articles/-/93131 と ?page=2 は、いずれもHTTP 200 text/html; charset=utf-8、
リダイレクト0、最終URLは要求URLのまま。要求/ページ番号/og:urlの公開記事IDは93131。
canonicalだけが https://bunshun.jp/denshiban/articles/b15071 を指す。
公開ページのJSON-LD Article.mainEntityOfPage.@idは https://bunshun.jp/articles/-/93131、headlineはh1と一致。
各ページのactive番号は1と2で、数字リンクも93131だけを指す。電子版ページ自体は見出しの異なる掲載形式であり、
b15071を93131へ数値変換するような推測は行わない。

通常canonicalの検証は保持。電子版canonicalは上記の厳密なHTTPS/ホスト/パス形式だけについて、
単一og:url、単一Article/NewsArticle JSON-LDの公開URL、単一h1とheadlineの一致をすべて要求する。
さらに全ページで同じcanonicalが維持されることを確認する。
メタデータを含むHTMLのJavaScriptは実行しない。JSON-LDはサイズ制限付きJSON.parseだけで扱う。
この例外は取得先を拡張しない。Workerは公開/articles/-/93131の2ページだけを取得し、
/denshiban/、他記事、認証ページを取得しない。

未確認の形式や矛盾は「記事の識別情報を確認できません（canonical / og:url / JSON-LD）。」として失敗させる。
既存の失敗処理により旧本文を保持してtoast表示する。検証を削除したり部分本文を完全成功として返したりしない。

回帰テストは記事ID/canonical/OG/JSON-LD/見出し/番号の構造を再現した自作HTMLで追加。
別記事ID、類似ホスト、メタデータ欠落/重複/不一致、ページ間canonical変化は拒否することを確認。
ローカルWorkerで93131=2ページ、93048=3ページ、93233=2ページ、93198=1ページの成功を確認。
既存画像Workerと翻訳対策、文春以外の取得経路は変更なし。
Cloudflare本番・実Chrome翻訳での今回の再検証は行っていない。プッシュ・公開・デプロイも実施していない。
## 公開準備済みの設定（まだデプロイしない）

記事Worker名：nextflux-bunshun-articles
ALLOWED_ORIGINS：
- https://nextflux-8zh.pages.dev
- http://127.0.0.1:5175

旧ローカル5174番は許可対象から除外。これはCORS許可であり、認証や利用量制限ではない。
既存の画像Workerには設定変更を行っていない。

ユーザーがPowerShellで後日実行するコマンド：

```powershell
cd C:\dev\nextflux
$env:WRANGLER_SEND_METRICS="false"
node workers\bunshun-images\node_modules\wrangler\bin\wrangler.js login
node workers\bunshun-images\node_modules\wrangler\bin\wrangler.js whoami
node workers\bunshun-images\node_modules\wrangler\bin\wrangler.js deploy --config workers/bunshun-articles/wrangler.jsonc
```

loginは未認証の場合に実行。whoamiで公開先アカウントを確認してからdeployする。
使用するCLIの場所は既存画像Worker配下だが、--configは記事Workerの設定を明示しているため、
公開対象はnextflux-bunshun-articles。画像Workerを再デプロイするコマンドではない。
もし複数アカウント選択が出たら、既存画像Workerと同じ意図したアカウントをユーザーが選ぶ。
Wranglerが未導入の場合のみ、既存手順のnpm.cmd ci --prefix workers/bunshun-imagesで導入する。

公開後は発行された記事WorkerのHTTPS Originを控え、ローカルNextfluxの
VITE_BUNSHUN_ARTICLE_WORKER_URLをその値にしてdevサーバーを再起動し、対象4記事でGを確認する。
末尾に/articleやqueryは付けない。VITE_BUNSHUN_IMAGE_WORKER_URLは変更しない。
Cloudflare本番からの取得成功を確認するまでは、Pagesの設定・公開は別途行わない。
今回の準備ではlogin/whoami/deploy、GitHub push、Pages設定変更はいずれも実行しない。
## 現在の公開・実機確認状況

以下はユーザーの実機確認報告：記事結合Workerは公開済みで、公開Workerを指定したローカルNextfluxにて、
ページ結合・画像拡大・Chrome標準翻訳後のGキー往復が正常。Pages Production環境変数も追加済み。

- VITE_BUNSHUN_ARTICLE_WORKER_URL=https://nextflux-bunshun-articles.nago687-7e7.workers.dev
- VITE_BUNSHUN_IMAGE_WORKER_URL=https://nextflux-bunshun-images.nago687-7e7.workers.dev

上記より前の「未公開」「未検証」「準備のみ」は各作業時点の記録。
エージェントによるWorker再デプロイ・Miniflux設定変更・Pages設定変更は行わない。
この変更の最終保存では、上記公開URLを指定したbuildとtest/lint/diffチェック後に、
対象ファイルだけをコミットしkazu756/nextfluxのmainへ通常プッシュする。
Pagesの自動デプロイ起動はユーザー承認済み。自動デプロイ完了の確認は別途必要。