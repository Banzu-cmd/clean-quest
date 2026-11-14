# クリーンクエスト(仮称) — 実証実験用アプリ

まちのごみを「見つけて報告 → 拾って報告 → ポイント/コイン/レベル」の仕組みが、実際に使われるかを確かめるための PWA。
要件定義書(Claude Docs)の F-01〜F-10 に対応。

## すぐ試す(デモモード)
```bash
npm install
npm run demo     # (Windowsでも動く) http://localhost:5173 。Supabase不要。データは端末のlocalStorageのみ。管理者として動く
```

## 本番セットアップ
1. **Supabase** で新規プロジェクトを作成 → SQL Editor に `supabase/schema.sql` を貼って実行(1回だけ)
   - **続けて `supabase/002_oneshot_social.sql` も貼って実行**(1枚報告と「みんな」機能。何度実行しても壊れません。管理者昇格のSQLが通らない不具合の修正も含みます)
2. Authentication → メール認証。実験中は「Confirm email」をオフにすると登録がスムーズ
3. `.env.local` を作る(`.env.example` を参照): `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
4. 自分を管理者にする: アプリで一度登録 → SQL Editor で
   ```sql
   update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'あなたのメール');
   ```
5. `npm run build` → **Vercel** にデプロイ(環境変数2つを設定。`vercel.json` はSPA用の設定済み)
6. 利用規約・プライバシーポリシー(`src/pages/Legal.tsx`)の【】を埋める。公開前に専門家の確認を推奨

## 追加機能(v0.2)
- **その場で捨てた(1枚報告)**: 見つけて拾って捨てるまでを、捨てたあとのごみ箱の写真1枚で報告。承認で+40pt(発見10+回収30と同じ)。運営の承認は必須。
- **みんな(SNS)**: 掃除の募集(日時・場所・定員)と、ごみ情報の発信(写真必須)。いいね・コメント・参加。投稿はすぐ公開、通報3人で自動非表示、管理画面の「投稿」タブで対応。ブロック可。1日の投稿5件・コメント30件まで。
- 禁止語フィルタはありません。通報と管理者の目視が頼りです。
- 募集・発信は今のところ地図には表示されません(「地図で見る」でOpenStreetMapが開きます)。

## Google Play へ
- 個人の開発者アカウントは **12人以上が14日連続でクローズドテスト** に参加しないと本番公開できない(2023-11-13以降に作成した個人アカウント)。テスター15〜20人を先に集める
- まずWeb(PWA)で配り、並行してクローズドテストを進める
- アプリ化: 公開したURLを Bubblewrap(TWA)でパッケージ。UGCアプリなので報告・ブロック機能(実装済み)と規約同意が必須

## 値を変えるとき
ポイント・上限などは `supabase/schema.sql` 末尾の `settings` と `src/config.ts` を**同じ値**に合わせる。

## コマンド
`npm run dev | demo | build | typecheck | test`

## 構成
- `src/lib/api/` — `Api` インターフェース。`supabase.ts`(本番)と `demo.ts`(デモ)
- 不正対策・上限・ポイント付与はすべてDB側(トリガーとRPC)で強制。クライアントは信用しない
- 写真は端末で縮小・EXIF削除してからアップロード

## 未実装・要確認
- 通知、ニックネームの不適切語チェック、画像の自動モデレーション、パスワード再設定画面
- ポイントに金銭的価値を持たせる場合は法的確認が必要(実験中は無価値のまま)
