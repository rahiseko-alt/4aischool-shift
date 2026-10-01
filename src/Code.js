// Web アプリケーション公開窓口
// 実装役向けルール: 公開関数は doGet のみ。その他の関数は末尾に _ を付ける。

function doGet() {
  var template = HtmlService.createTemplateFromFile('index');
  var output = template.evaluate();
  output.setTitle('外国人留学生アルバイト申告');
  output.addMetaTag('viewport', 'width=device-width, initial-scale=1');
  // ブラウザのタブのアイコン（この置き場所の assets/icon-64.png を、消えないようコミットを指定して参照する。GAS は画像の URL しか受け付けない）
  output.setFaviconUrl('https://raw.githubusercontent.com/rahiseko-alt/4aischool-shift/79bc09b04846f4046fd352541d89028414b24643/assets/icon-64.png');
  return output;
}

// 部品のファイルも <?!= ... ?> を含むので、テンプレートとして評価してから埋め込む
// （createHtmlOutputFromFile だと埋め込み記号がそのまま残り、画面の JavaScript が動かない）。
function include_(filename) {
  return HtmlService.createTemplateFromFile(filename).evaluate().getContent();
}
