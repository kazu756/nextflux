# 文春画像の取得補助

## 調査と対応範囲

2026-10-27、例示画像をローカルcurlで確認：Refererなし403 text/html、
Referer https://bunshun.jp/ 付き200 image/jpeg。ローカルWrangler（workerd）経由でも
GET/HEAD 200 image/jpeg、GET 82,645 bytesを確認。本番Cloudflareからの取得成功を意味しない。
認証済みMinifluxの記事HTML・サーバーバージョンにはアクセスしていない。

Nextfluxの経路：ArticleContentのhtml-react-parser → imgをArticleImageへ変換
→ Imageのimg（本文内）/ PhotoView（拡大）。添付画像もArticleImageを使用する。
ArticleImageでのみ表示用srcを解決し、本文HTML・srcset・リンク・動画は変更しない。
一覧はextractFirstImage（画像添付優先、なければ本文の先頭img）→ArticleCardCover→Image。
ArticleCardCoverでも同じURL解決を使用し、解決後URLにkeyを付けて読込・エラー状態を分離する。
両表示先へ同じURLを渡し、エラー時は既存エラー表示。元URLへの自動フォールバックなし。
一般のimg読込とPhotoViewのImage読込であり、fetch/canvasによる画素読取はないのでCORSは追加しない。

Miniflux公式参照コミット：d5c529b94ce9a172bd4c22a2b89da068c583783b
- https://github.com/miniflux/v2/blob/d5c529b94ce9a172bd4c22a2b89da068c583783b/internal/mediaproxy/url.go
- https://github.com/miniflux/v2/blob/d5c529b94ce9a172bd4c22a2b89da068c583783b/internal/ui/proxy.go
- https://github.com/miniflux/v2/blob/d5c529b94ce9a172bd4c22a2b89da068c583783b/internal/api/entry_handlers.go

標準形式は BASE_PATH/proxy/padded-base64url(HMAC-SHA256)/padded-base64url(UTF8原画像URL)。
設定済みMinifluxの同一origin・base pathだけを受け入れ、署名は32 bytesの構造確認のみ。
秘密鍵がないのでHMACは検証しないし、署名を生成・送信もしない。
Workerへ渡すのは復号した許可CDN画像URLだけ。プロキシURLやMiniflux認証情報は渡さない。
非標準/カスタムプロキシ、不正/省略padding、未知のorigin/path、query付きは推測せず元URLを保持する。
取得済み公式コードは403の上流応答を「Origin status code is 403」として返す。

## セキュリティ・運用制限

- 完全一致 bunshun.ismcdn.jp、HTTPS、/mwimgs/下のJPEG/PNG/GIF/WebPのみ。
- パスは英数字・ハイフン・アンダースコア・スラッシュと画像拡張子に限定。
  URL全長2048以下。資格情報、明示ポート（443含む）、query、fragment、percent表記は拒否。
- GET/HEADのみ。HEADでもGETして画像のMIMEと先頭シグネチャを確認してから本文を省く。
- Referer固定。Cookie/Authorization/Range等は転送しない。Set-Cookie等も返さない。
- redirect: manual、すべての3xxを502として拒否。403/404/429は同じ失敗コードを保持。
- ヘッダ取得から本文取得まで10秒、画像は5MiB以下（Content-Lengthとストリーム両方を検査）。
- HTML/SVGや偽MIMEを拒否。nosniff、制限的CSP。画像シグネチャ確認は完全な画像デコード検証ではない。
- 検証済み200だけ1時間キャッシュ。エラーはno-store。上流ヘッダはコピーしない。
- キャッシュは各Cloudflare拠点内のbest effort。Origin/CORSは認可境界に使わない。
  狭い宛先制限であり、公開エンドポイントへの第三者利用やリクエスト数そのものは防げない。
  まずFree枠で利用し、使用量を確認する。有料プラン/課金設定はこの実装では変更しない。
- アプリ内ログなし、Worker observabilityは無効。Wrangler等のプラットフォームアクセスログには
  公開画像URLが現れ得るため、URLやVITE環境変数に秘密を入れない。

## ローカル起動（PowerShell、2つのターミナル）

ターミナル1：

~~~powershell
cd C:\dev\nextflux\workers\bunshun-images
npm.cmd ci
$env:WRANGLER_SEND_METRICS="false"
npm.cmd run dev
~~~

ログインなしのローカルworkerd。http://127.0.0.1:8787 で待受。

ターミナル2：

~~~powershell
cd C:\dev\nextflux
$env:VITE_BUNSHUN_IMAGE_WORKER_URL="http://127.0.0.1:8787"
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
~~~

http://127.0.0.1:5173 で既存Minifluxに接続。記事内画像とクリック拡大を確認する。
直接URLと認証先と同一originの標準/proxy/URLの双方をテストデータで確認する。
Networkで/image?url=...となり、Minifluxの/proxyやトークンがWorkerに送信されていないことを確認。
画像取得に失敗したときは既存エラー表示で止まり、URLを往復しないことを確認する。
他サイトの画像・動画・リンク、Chrome翻訳中の記事移動/Gキーも確認する。
ローカルURLは開発用にだけ許可。本番はHTTPS Worker originを指定する。

既存チェック：ルートで npm.cmd test / npm.cmd run lint / npm.cmd run build / git diff --check。
Workerだけのビルド確認はworkerディレクトリで npm.cmd exec -- wrangler deploy --dry-run。
dry-runはアップロードしない。実際のdeployは下記の公開時だけ行う。

## 公開・設定手順

1. Workerのコード・テスト・制限をレビューする。
2. workers/bunshun-imagesで npm.cmd ci → npm.cmd exec -- wrangler login。
   自分でCloudflareにログイン。worker名/アカウントを確認し、npm.cmd run deploy。
   Workerに秘密変数は不要。この操作はPages本体の公開とは別。
3. 発行されたHTTPS Worker originの/image?url=...で実画像の200・MIME・拡大表示を確認する。
   Cloudflare送信元IPが拒否され403なら、成功とみなさずPagesへ設定する前に停止する。
4. 実URL確定後、NextfluxのVITE_BUNSHUN_IMAGE_WORKER_URLにそのoriginだけを指定する。
   /imageやqueryを含めない。APIキー/Miniflux URL/認証情報は環境変数へ入れない。
5. そのURLでローカル確認後、明示的な公開判断をしてGitHubへプッシュし、Cloudflare Pagesの
   Production（必要ならPreview）環境変数を設定して再ビルド・デプロイする。
   VITE_*はビルド時に埋め込まれる公開情報。環境変数設定だけでは既存ビルドは変わらない。
6. 公開先で既存Minifluxに接続し、本文・拡大・Reader View・翻訳と他サイトを確認する。

公式ドキュメント（2026-10-27確認）：
- https://developers.cloudflare.com/workers/runtime-apis/fetch/
- https://developers.cloudflare.com/workers/runtime-apis/cache/
- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/workers/wrangler/commands/

## 最終確認時の状況

ユーザー確認：本文画像・一覧画像・拡大・Chrome翻訳・Gキーは正常。
公開済みWorkerを利用したローカル動作も正常。これらはユーザーによる実機検証報告であり、
エージェントが本番Workerの再デプロイやアカウント設定変更を行ったものではない。
Pages Productionに設定済みの公開ビルド変数：
VITE_BUNSHUN_IMAGE_WORKER_URL=https://nextflux-bunshun-images.nago687-7e7.workers.dev

初回作業時のHTTP・テスト結果は以下に記録。最終コミット時は一覧のDOM回帰テスト3件を追加し、
全139テスト・lint・指定Worker URLでのbuild・diff --checkを再実行し、すべて成功。
画像URL変更後のエラー復帰はjsdomの実React DOMで検証。jsdomは開発依存のみ。
一覧と本文は添付画像の有無で元URLが異なり得る。公開ページでは本文CDN画像と別ホストのOG画像が
異なるが、実Miniflux内の一覧URLは未取得。OG URLを一覧画像と断定しない。
公開HTMLのCDN一覧サイズ候補もRefererなし403、固定Referer/ローカルWorker経由200を確認済み。
今回の最終作業ではコミットとmainへの通常プッシュを許可されている。Worker再デプロイは行わない。

## 今回の検証結果

- npm test: 136件成功（既存120 + 追加16）。
- npm run lint / npm run build（Worker未設定）/ git diff --check: 成功。
- wrangler deploy --dry-run: 成功。アップロード・デプロイなし。
- ローカルWorker: GET 200 image/jpeg 82645 bytes、HEAD 200、類似不正ホスト400。
- ローカルNextflux: http://127.0.0.1:5173/ が200、Worker originのビルド時変数注入を確認。
- ArticleImageと実Imageのコンポーネントテストで本文imgと拡大用srcの一致を確認。
  PhotoView・翻訳・認証状態はテスト境界でスタブ化しており、実ブラウザ操作を意味しない。
- 基準コミット441315aの翻訳対策5ファイルは差分なし。
- GitHubプッシュ、Cloudflareデプロイ、外部ログイン、アカウント設定変更は実施していない。

## エージェント側の未検証範囲・戻し方

Cloudflare本番IPからの取得、実アカウントでのMiniflux HTML、実ブラウザの拡大操作/再生/
Chrome標準翻訳はエージェント側では未検証（上記のユーザー実機確認は完了）。テストはURL判定/Worker模擬応答とコンポーネント境界を検証し、
実際のブラウザ挙動やホスティング版のバージョン互換を保証しない。
Workerを使う場合だけ原画像URLを取得し直す。本文連結・他サイト本文取得は対象外。

最も簡単な無効化はVITE_BUNSHUN_IMAGE_WORKER_URLを空にして再ビルドすること。
ローカルの一時設定は Remove-Item Env:VITE_BUNSHUN_IMAGE_WORKER_URL で解除しdevサーバー再起動。
本番ではPages環境変数を削除して再デプロイ。Worker自体は別途停止/削除できるが今回変更しない。
コードを戻すなら今回の差分だけをレビューして戻す。git reset --hardなどで既存修正を消さない。
翻訳対策の基準コミット441315aは保持し、ArticleContentのkeyと既存spanを削除しない。
