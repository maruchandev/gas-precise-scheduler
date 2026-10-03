# gas-precise-scheduler

Google Apps Script（GAS）で、毎日指定した時刻に処理を実行するための軽量スケジューラです。

通常の繰り返し時間主導型トリガーではなく、`ScriptApp.newTrigger(...).timeBased().at(date)` で次回の実行日時を指定した単発トリガーを作成します。実行時には翌日の単発トリガーを作り直します。

> [!IMPORTANT]
> このプロジェクトは、指定時刻ちょうどの実行や秒単位の正確性を保証しません。`at(date)` は特定の `Date` を指定できますが、Apps Script の実行基盤、混雑、割り当て上限などにより開始が遅れる可能性があります。「通常の繰り返しトリガーより具体的な日時を指定する仕組み」として利用してください。

## 特徴

- 複数の毎日スケジュールを設定可能
- 時・分と IANA タイムゾーンを設定可能
- 実行後に次回の one-shot trigger を自動作成
- `LockService` によるセットアップ・実行の競合防止
- スケジュール ID の重複、時刻、対象関数を事前検証
- `triggerUid` とスケジュール ID を Script Properties で対応付け
- 再セットアップ時に、このスケジューラが所有するトリガーとプロパティだけを削除
- ユーザー処理の実行前に翌日分を予約し、ユーザー処理の失敗による連鎖停止を避ける設計
- Discord、Google Calendar、外部 API に非依存

## ファイル

```text
gas-precise-scheduler/
├── Scheduler.gs
├── Example.gs
├── appsscript.json
├── README.md
├── LICENSE
└── .gitignore
```

## セットアップ

1. Apps Script で新しいスタンドアロン プロジェクトを作成します。
2. `Scheduler.gs` と `Example.gs` の内容をプロジェクトへコピーします。
3. プロジェクト設定でマニフェスト ファイルを表示し、`appsscript.json` の内容を反映します。
4. `PRECISE_SCHEDULER_CONFIG` を編集します。
5. エディタから `setupDailySchedules()` を一度だけ手動実行し、必要な権限を承認します。
6. Apps Script の「トリガー」画面または実行ログで、予約が作成されたことを確認します。

設定変更後も `setupDailySchedules()` を再実行してください。古い予約を整理して、新しい設定から作り直します。

## 設定例

```javascript
const PRECISE_SCHEDULER_CONFIG = {
  timeZone: 'Asia/Tokyo',
  schedules: [
    {
      id: 'morning-job',
      functionName: 'exampleMorningTask',
      hour: 9,
      minute: 0
    },
    {
      id: 'night-job',
      functionName: 'exampleNightTask',
      hour: 21,
      minute: 0
    }
  ]
};
```

各項目の意味は次のとおりです。

| 項目 | 説明 |
| --- | --- |
| `timeZone` | スケジュール計算に使う IANA タイムゾーン |
| `id` | スケジュールを識別する一意の文字列 |
| `functionName` | 実行するトップレベル関数の名前 |
| `hour` | 0〜23 の時 |
| `minute` | 0〜59 の分 |

対象関数には引数を渡しません。

```javascript
function exampleMorningTask() {
  console.log('09:00向けの処理');
}
```

## 仕組み

```text
setupDailySchedules()
        │
        ├─ 設定を検証
        ├─ 以前のスケジューラ用予約を削除
        └─ 各スケジュールの次回 Date を at(date) で予約
                              │
                              ▼
                    runDailySchedule(e)
                              │
        ┌─────────────────────┴─────────────────────┐
        ▼                                           ▼
翌日の one-shot trigger を作成              ユーザー関数を実行
```

作成したトリガーの UID は、次の形式で Script Properties に保存されます。

```text
preciseDailyScheduler:trigger:<triggerUid> = <scheduleId>
```

これにより、すべてのトリガーが同じ `runDailySchedule(e)` を呼び出しても、イベントの `triggerUid` から実行対象を特定できます。

## 管理用関数

### `setupDailySchedules()`

設定を検証し、既存のスケジューラ用予約を削除してから、全スケジュールの次回予約を作成します。初回導入時と設定変更時に手動実行してください。

### `removeDailySchedules()`

このスケジューラが作成したトリガーと対応する Script Properties を削除します。通常のユーザー関数や、別のハンドラーを使うトリガーは削除しません。

### `runDailySchedule(e)`

時間主導型トリガー専用の入口です。手動実行しないでください。

## タイムゾーン

初期値は `Asia/Tokyo` です。変更する場合は、次の2か所を同じ値に揃えることを推奨します。

- `Scheduler.gs` の `PRECISE_SCHEDULER_CONFIG.timeZone`
- `appsscript.json` の `timeZone`

サマータイムを採用する地域では、存在しない時刻や重複する時刻が発生します。その境界に当たる時刻は避けて設定してください。

## 制約と運用上の注意

- Apps Script は実行時刻を厳密には保証しません。プラットフォーム都合で遅延することがあります。
- トリガー、実行時間、Script Properties などの Apps Script の割り当て上限が適用されます。
- トリガーは `setupDailySchedules()` を実行・承認したユーザーの権限で動作します。
- スクリプトの権限失効、上限超過、次回トリガー作成時の障害などでは連鎖が止まる可能性があります。重要用途では Apps Script の失敗通知とトリガー一覧を監視してください。
- スケジュールを過去時刻へ変更した場合、次回は翌日のその時刻になります。
- `runDailySchedule` という関数名と `preciseDailyScheduler:trigger:` で始まる Script Properties は、このスケジューラ専用として扱ってください。

## 公式ドキュメント

- [ClockTriggerBuilder](https://developers.google.com/apps-script/reference/script/clock-trigger-builder)
- [Installable triggers](https://developers.google.com/apps-script/guides/triggers/installable)
- [Trigger event objects](https://developers.google.com/apps-script/guides/triggers/events)

## ライセンス

[MIT License](LICENSE)
