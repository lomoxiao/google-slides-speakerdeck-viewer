# Google Slides SpeakerDeck Viewer

Google Slides を SpeakerDeck 風に閲覧し、Web UI からスライド生成依頼を Slack へ送るための MVP です。

今回の移行では、状態管理の正本はまだローカル Codex Worker 側に残します。GitHub Pages の Web UI は生成依頼を GAS API 経由で Slack に投稿し、完了通知は従来どおり Slack で確認します。将来の GAS 中心 job 管理に備えて `trackingId` は GAS API レスポンスで先行発行しますが、現時点では Slack 本文には埋め込みません。

## 構成

```text
google-slides-speakerdeck-viewer/
  docs/
    index.html
    styles.css
    app.js
    config.js
  gas/
    Code.gs
    SlidesService.gs
    CacheService.gs
    SlackService.gs
```

## Architecture

現在のMVP:

```text
GitHub Pages
  -> GAS API
  -> Slack
  -> Socket Mode
  -> Local Codex Worker
       -> job状態管理
       -> 完了通知
       -> Slack投稿
```

将来フェーズ:

```text
GitHub Pages
  -> GAS API
  -> Slack
  -> Local Codex Worker
  -> GAS APIへ状態報告
  -> Web UIで状態同期
```

## GitHub Pages

1. GitHub の repository settings で Pages source を `Deploy from a branch` にします。
2. branch を選び、folder を `/docs` にします。
3. `docs/config.js` の `GAS_API_URL` に GAS Web App URL を設定します。
4. `CLIENT_KEY` は任意です。設定する場合は GAS Script Properties 側の `CLIENT_KEY` と同じ値にします。

`docs/config.js` は公開されます。Slack token などの秘密情報は絶対に置かないでください。

## GAS Deploy

Apps Script プロジェクトに `gas/*.gs` を配置します。

必要な Advanced Google Services:

- Google Slides API

Web App としてデプロイします。

- Execute as: 自分
- Who has access: GitHub Pages から呼べる公開範囲

API は `action` で切り替えます。

- `listPresentations`
- `getFirstThumbnail`
- `getPageWindow`
- `requestGeneration`
- `health`

返却形式:

```json
{
  "ok": true,
  "data": {}
}
```

エラー時:

```json
{
  "ok": false,
  "error": {
    "message": "..."
  }
}
```

## Script Properties

GAS の Script Properties に設定します。

- `SLIDES_FOLDER_ID`: 表示対象の Google Slides が入った Drive folder ID。未設定時は既定値を使います。
- `SLACK_BOT_TOKEN`: Slack Bot token。
- `SLACK_COMPLETION_CHANNEL_ID`: 生成依頼を投稿する Slack channel ID。
- `CLIENT_KEY`: 任意の簡易キー。設定した場合、Web 側の `docs/config.js` と一致する必要があります。

## Slack App

GAS は Slack Web API `chat.postMessage` で生成依頼を投稿します。

Slack 投稿本文は既存の Socket Mode / Worker が拾えるように、元の `[slide-generate]` コマンド形式だけにします。`trackingId` は将来の状態同期用として GAS API レスポンスでは返しますが、現時点では Worker のパースを壊さないよう Slack 本文には含めません。

```text
[slide-generate] --url https://example.com/article --audience "経営層" --focus "日本市場への影響" --pages 8
```

今回のフェーズでは Worker 側の既存処理を優先し、`trackingId` のSlack本文埋め込みは将来対応とします。

## Web UI

Web UI は以下を提供します。

- Google Slides 一覧
- 1枚目サムネイル
- Viewer
- Speaker Notes
- Search
- Slide navigation
- 画像 lazy load
- モバイル Bottom Bar
- スライド生成依頼フォーム

生成依頼に成功したら、Web UI は次の暫定メッセージを表示します。

```text
生成依頼をSlackへ送信しました。完了通知はSlackをご確認ください。
```

このMVPでは `queued`, `running`, `completed`, `failed` の状態管理UIは実装しません。

## Future Phase

Phase 5 では Codex Worker から GAS API へ状態を報告し、Web UI で状態を同期します。

将来API案:

- `reportGenerationResult`
- `getJobStatus`

将来状態:

- `queued`
- `running`
- `completed`
- `failed`

今回 `trackingId` を先行導入している理由は、Slack 経由の生成依頼と将来の GAS job 状態を同じIDで接続できるようにするためです。
