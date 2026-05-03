# Google Slides SpeakerDeck Viewer

Google Apps Script (GAS) の HTML Service で動作する、SpeakerDeck 風の Google Slides Viewer です。

外部ライブラリ、外部フォント、CDN、npm、React、Vue、Tailwind は使っていません。ローカル確認用の `index.html` は、`window.google` が存在しない環境でもサンプルデータで動作します。

## ファイル構成

```text
google-slides-speakerdeck-viewer/
  README.md
  index.html
  gas/
    Code.gs
    Index.html
    Styles.html
    Script.html
```

`index.html` はローカル確認用の単一ファイルです。GAS 版は `gas/Index.html`, `gas/Styles.html`, `gas/Script.html` に分割されています。

## 主な機能

- 2ステップ読み込み: 初回は `getPresentationsMeta()` でメタ情報のみ取得し、カードクリック後にページ情報を取得します。
- 20分メタキャッシュ: `presentations_meta_v3` を `CacheService` に保存し、期限切れサムネイルURLの再利用を避けながら一覧表示を高速化します。
- 時間主導トリガー: `warmPresentationsCache()` で一覧メタを事前更新できます。
- 段階的ページ取得: 初回は先頭1ページのみ取得し、残りは3ページ単位で順次プリフェッチします。
- 即時プレビュー: ビューア初回表示では一覧メタに含まれる `thumbnailUrl` を先に表示し、正規のページ情報は裏で取得します。
- ページ単位キャッシュ: `page_v3_${presentationId}_${updatedAtMillis}_${pageObjectId}` 単位でサムネイルURLとノートを20分キャッシュします。ページ構成とノートの outline は最大6時間キャッシュします。
- 更新日降順ソート: GAS とローカルサンプルの両方で `updatedAt` 降順に表示します。
- スマホスワイプ: ビューア上で左右スワイプによるページ移動ができます。
- スマホ表示最適化: iPhone幅ではスライド一覧を1列表示にし、スライド選択後はビューアを画面いっぱいに固定表示します。
- 全画面ボタン: ビューア右上の「全画面」ボタンでネイティブ Fullscreen API またはCSS疑似全画面を切り替えます。
- 全画面ビューア最適化: 全画面時はスライドとスピーカーノートが見やすく収まる専用レイアウトに切り替えます。
- スマホ閲覧最適化: スライド表示中はタイトルやページ数を隠し、スライドとスピーカーノートを縦横どちらでも1画面内に収めます。
- スピーカーノート表示: Slides API の notesPage から抽出したノートを右パネルに表示します。
- 元記事URL表示: Drive ファイルの description またはタイトルから URL を抽出し、ビューアタイトル下に「元記事を開く」リンクを表示します。
- URL入力からSlack経由でスライド生成依頼: Viewer 上部の入力欄から `[slide-generate] URL` を Slack に投稿します。

## GAS Script Properties

GAS の Script Properties に以下を設定してください。

- `SLIDES_FOLDER_ID`: Viewerに表示するGoogle SlidesのDriveフォルダID
- `SLACK_BOT_TOKEN`: GASからSlackへ生成依頼メッセージを投稿するためのBot Token
- `SLACK_COMPLETION_CHANNEL_ID`: `[slide-generate] URL` を投稿するチャンネルID。`article-to-slides-automation` 側でも同じ値を使う

## GASバックエンド

Advanced Google Services の Slides API を有効にしてください。Drive ファイルの列挙には `DriveApp` を使います。

- `getPresentationsMeta()`: Google Slides の一覧、先頭ページサムネイル、description、更新日時、ページ数を返します。
- `warmPresentationsCache()`: 一覧メタキャッシュを強制再構築します。
- `installWarmPresentationsTrigger()`: `warmPresentationsCache()` の15分おきトリガーを作成します。既存の同名トリガーは重複防止のため削除します。
- `getPresentationPageWindow(presentationId, startIndex, count)`: 指定範囲のページサムネイルとスピーカーノートだけを返します。
- `getPresentationPages(presentationId)`: 互換用に全ページを返します。内部ではページ単位キャッシュを使います。
- `getPresentations()`: 互換用に `getPresentationsMeta()` を返します。
- `requestSlideGeneration(articleUrl)`: Slack API `chat.postMessage` に `[slide-generate] URL` を投稿します。

## 時間主導トリガーの設定

Apps Script エディタで `installWarmPresentationsTrigger()` を一度手動実行してください。承認後、15分おきに `warmPresentationsCache()` が実行され、Viewer を開く前に一覧メタキャッシュが温まります。

手動で確認したい場合は、Apps Script エディタから `warmPresentationsCache()` を実行してから Web アプリを開きます。

## Slack連携の注意点

- GASから `/slides URL` を投稿してもSlash Commandは発火しません。
- Viewerからは `[slide-generate] URL` をSlackへ投稿します。
- `article-to-slides-automation` 側のSocket Modeがこのメッセージを拾ってローカルCodex処理を起動します。
- このプロジェクトでは `article-to-slides-automation` 側の実装は行いません。

## ローカル確認

`index.html` をブラウザで開くと、サンプルデータで以下を確認できます。

- 一覧表示
- 検索
- ビューア表示
- 前へ / 次へ
- 左右キー
- スワイプ相当の touch イベント
- サムネイルクリック
- スピーカーノート表示
- 元記事リンク表示
- URL入力からのダミー生成依頼
- 生成中カードとダミー完了
- エラー・空状態・画像読み込み失敗時の代替表示
